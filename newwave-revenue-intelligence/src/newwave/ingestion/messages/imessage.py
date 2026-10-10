"""Read-only extraction from the macOS Messages database (iMessage/SMS).

Safety model:
  * The live ``~/Library/Messages/chat.db`` is never opened for writing. We
    copy chat.db (+ its -wal/-shm files) into a private temporary folder inside
    the workspace and read the *copy* with a read-only SQLite URI. The copy is
    deleted afterwards.
  * macOS protects this folder with Full Disk Access. If the terminal running
    this tool has not been granted access, the read fails with a permission
    error and we report that — we never try to work around it.
  * Only messages stored locally are visible. With "Messages in iCloud" some
    older history may not be downloaded to this Mac.
  * Extraction is scoped to the chats the user selects, a date range and a
    message limit. Attachments are not read.
"""
from __future__ import annotations

import platform
import shutil
import sqlite3
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterator

from ...normalization.identifiers import detect_contact
from ...security.permissions import make_private_dir
from .base import MessageRecord, ThreadRecord, participant

DEFAULT_DB = Path.home() / "Library" / "Messages" / "chat.db"
APPLE_EPOCH = datetime(2001, 1, 1, tzinfo=timezone.utc)
DEFAULT_MESSAGE_LIMIT = 500


@dataclass
class AccessReport:
    platform: str
    db_path: str
    exists: bool
    readable: bool
    detail: str
    chats: int = 0
    messages: int = 0
    first_message_at: str | None = None
    last_message_at: str | None = None


@dataclass
class ChatInfo:
    chat_id: int
    identifier: str
    display_name: str
    service: str
    message_count: int
    last_message_at: str | None


def apple_time_to_iso(value: int | None) -> str | None:
    if value is None or value == 0:
        return None
    seconds = value / 1e9 if abs(value) > 1e11 else float(value)  # ns since macOS 10.13
    return (APPLE_EPOCH + timedelta(seconds=seconds)).isoformat()


def iso_to_apple_ns(iso: str) -> int:
    dt = datetime.fromisoformat(iso)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int((dt - APPLE_EPOCH).total_seconds() * 1e9)


def decode_attributed_body(blob: bytes | None) -> str:
    """Best-effort text from an NSAttributedString typedstream (newer macOS
    leaves ``message.text`` NULL and stores the text here)."""
    if not blob:
        return ""
    try:
        idx = blob.find(b"NSString")
        if idx < 0:
            return ""
        rest = blob[idx + len("NSString"):]
        plus = rest.find(b"\x01+")
        if plus < 0:
            return ""
        rest = rest[plus + 2:]
        if rest[0] == 0x81:
            length, start = int.from_bytes(rest[1:3], "little"), 3
        elif rest[0] == 0x82:
            length, start = int.from_bytes(rest[1:4], "little"), 4
        else:
            length, start = rest[0], 1
        return rest[start:start + length].decode("utf-8", errors="replace")
    except (IndexError, ValueError):
        return ""


@contextmanager
def snapshot(db_path: Path, scratch_dir: Path) -> Iterator[sqlite3.Connection]:
    """Copy the Messages DB to a private temp dir and open the copy read-only."""
    make_private_dir(scratch_dir)
    with tempfile.TemporaryDirectory(dir=scratch_dir, prefix="messages-snapshot-") as tmp:
        tmp_path = Path(tmp)
        target = tmp_path / "chat.db"
        shutil.copy2(db_path, target)  # raises PermissionError without Full Disk Access
        for suffix in ("-wal", "-shm"):
            side = Path(str(db_path) + suffix)
            if side.exists():
                shutil.copy2(side, Path(str(target) + suffix))
        conn = sqlite3.connect(f"file:{target}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()


def inspect_access(db_path: Path = DEFAULT_DB, scratch_dir: Path | None = None) -> AccessReport:
    system = platform.system()
    rep = AccessReport(platform=system, db_path=str(db_path), exists=db_path.exists(), readable=False, detail="")
    if system != "Darwin" and db_path == DEFAULT_DB:
        rep.detail = "Not running on macOS: the Messages database is unavailable here. Use manual import instead."
        return rep
    if not rep.exists:
        rep.detail = ("Messages database not found. Messages may not be set up on this Mac, or the path is "
                      "protected. Use the manual conversation import as a fallback.")
        return rep
    try:
        with snapshot(db_path, scratch_dir or Path(tempfile.gettempdir())) as conn:
            r = conn.execute("SELECT COUNT(*) AS n, MIN(date) AS lo, MAX(date) AS hi FROM message").fetchone()
            rep.messages = r["n"]
            rep.first_message_at, rep.last_message_at = apple_time_to_iso(r["lo"]), apple_time_to_iso(r["hi"])
            rep.chats = conn.execute("SELECT COUNT(*) FROM chat").fetchone()[0]
        rep.readable = True
        rep.detail = ("Readable. Only messages stored on this Mac are visible; with Messages in iCloud, "
                      "older history may not be downloaded locally.")
    except PermissionError:
        rep.detail = ("Permission denied. macOS requires Full Disk Access for the app running this tool "
                      "(System Settings > Privacy & Security > Full Disk Access > add Terminal). "
                      "We will not bypass this protection.")
    except (sqlite3.DatabaseError, OSError) as exc:
        rep.detail = f"Could not read the Messages database: {type(exc).__name__}"
    return rep


def list_chats(conn: sqlite3.Connection, limit: int = 500) -> list[ChatInfo]:
    rows = conn.execute(
        """SELECT c.ROWID AS chat_id, c.chat_identifier, COALESCE(c.display_name, '') AS display_name,
                  COALESCE(c.service_name, '') AS service, COUNT(cmj.message_id) AS n, MAX(m.date) AS last_date
           FROM chat c
           LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
           LEFT JOIN message m ON m.ROWID = cmj.message_id
           GROUP BY c.ROWID ORDER BY last_date DESC LIMIT ?""", (limit,)).fetchall()
    return [ChatInfo(r["chat_id"], r["chat_identifier"] or "", r["display_name"], r["service"], r["n"],
                     apple_time_to_iso(r["last_date"])) for r in rows]


def extract_chats(
    conn: sqlite3.Connection,
    chat_ids: list[int],
    *,
    start_iso: str | None = None,
    end_iso: str | None = None,
    limit: int = DEFAULT_MESSAGE_LIMIT,
) -> list[ThreadRecord]:
    """Extract text messages from the selected chats only."""
    if not chat_ids:
        raise ValueError("select at least one chat; full-archive extraction is not automatic")
    threads = []
    remaining = limit
    for chat_id in chat_ids:
        chat = conn.execute("SELECT * FROM chat WHERE ROWID = ?", (int(chat_id),)).fetchone()
        if chat is None:
            raise KeyError(f"chat {chat_id} not found")
        service = (chat["service_name"] or "iMessage").lower()
        thread_id = f"{service}:{chat['guid']}"
        parts = []
        for h in conn.execute(
            "SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = ?",
            (int(chat_id),),
        ):
            c = detect_contact(h["id"])
            parts.append(participant(h["id"], c[0], c[1]) if c else participant(h["id"], "other", h["id"]))
        th = ThreadRecord(thread_id=thread_id, title=chat["display_name"] or chat["chat_identifier"] or thread_id,
                          participants=parts)
        sql = ["""SELECT m.ROWID, m.guid, m.text, m.attributedBody, m.date, m.is_from_me, h.id AS handle
                  FROM chat_message_join cmj JOIN message m ON m.ROWID = cmj.message_id
                  LEFT JOIN handle h ON h.ROWID = m.handle_id
                  WHERE cmj.chat_id = ?"""]
        params: list = [int(chat_id)]
        if start_iso:
            sql.append("AND m.date >= ?")
            params.append(iso_to_apple_ns(start_iso))
        if end_iso:
            sql.append("AND m.date < ?")
            params.append(iso_to_apple_ns(end_iso))
        sql.append("ORDER BY m.date LIMIT ?")
        params.append(max(remaining, 0))
        for r in conn.execute(" ".join(sql), params):
            text = r["text"] or decode_attributed_body(r["attributedBody"])
            if not text or not text.strip() or text.strip() == "￼":
                continue
            is_me = bool(r["is_from_me"])
            th.messages.append(MessageRecord(
                thread_id=thread_id, sent_at=apple_time_to_iso(r["date"]),
                sender_label="me" if is_me else (r["handle"] or "unknown"),
                sender_role="owner" if is_me else "counterparty", body=text, source_message_id=r["guid"],
            ))
        remaining -= len(th.messages)
        threads.append(th)
        if remaining <= 0:
            break
    return threads


def source_type_for(threads: list[ThreadRecord]) -> str:
    return "sms" if threads and all(t.thread_id.startswith("sms:") for t in threads) else "imessage"
