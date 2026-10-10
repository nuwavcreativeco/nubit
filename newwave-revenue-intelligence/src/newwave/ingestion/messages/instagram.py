"""Instagram "Download your information" export (JSON format) reader.

Reads message threads from the official account-data export (a .zip or an
extracted folder). Media files are ignored. The zip is read in memory with
size limits; nothing is extracted to disk, so path-traversal entries are inert.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from ...security.sanitize import clean_field
from .base import MessageRecord, ThreadRecord, participant

THREAD_FILE_RE = re.compile(r"(?:^|/)messages/(inbox|message_requests)/([^/]+)/message_\d+\.json$")
MAX_JSON_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 500 * 1024 * 1024
MAX_MEMBERS = 200_000


def fix_mojibake(s: str) -> str:
    """Instagram exports encode UTF-8 bytes as latin-1 code points; undo that."""
    if not s:
        return s
    try:
        return s.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


@dataclass
class ThreadInfo:
    thread_id: str
    title: str
    folder: str
    message_count: int
    participants: list[str]
    last_message_at: str | None


class InstagramExport:
    def __init__(self, files: dict[str, bytes]):
        self._files = files  # thread json path -> bytes

    @classmethod
    def from_zip_bytes(cls, data: bytes) -> "InstagramExport":
        files: dict[str, bytes] = {}
        total = 0
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            infos = zf.infolist()
            if len(infos) > MAX_MEMBERS:
                raise ValueError("zip has too many entries")
            for info in infos:
                name = info.filename.replace("\\", "/")
                if info.is_dir() or not THREAD_FILE_RE.search(name):
                    continue
                if name.startswith("/") or ".." in name.split("/") or ":" in name.split("/")[0]:
                    continue  # absolute / traversal entries are refused outright
                if info.file_size > MAX_JSON_BYTES:
                    raise ValueError(f"message file too large: {name}")
                total += info.file_size
                if total > MAX_TOTAL_BYTES:
                    raise ValueError("message data in zip exceeds 500 MB")
                files[name] = zf.read(info)
        return cls(files)

    @classmethod
    def from_directory(cls, root: Path) -> "InstagramExport":
        root = Path(root).resolve()
        files: dict[str, bytes] = {}
        for path in root.rglob("message_*.json"):
            resolved = path.resolve()
            if root not in resolved.parents:
                continue  # symlink pointing outside the export
            rel = resolved.relative_to(root).as_posix()
            if THREAD_FILE_RE.search(rel) and resolved.stat().st_size <= MAX_JSON_BYTES:
                files[rel] = resolved.read_bytes()
        return cls(files)

    def _thread_groups(self) -> dict[str, list[str]]:
        groups: dict[str, list[str]] = {}
        for name in sorted(self._files):
            m = THREAD_FILE_RE.search(name)
            groups.setdefault(f"{m.group(1)}/{m.group(2)}", []).append(name)
        return groups

    def _load(self, name: str) -> dict:
        try:
            obj = json.loads(self._files[name].decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"unreadable message file {name}: {exc}") from exc
        if not isinstance(obj, dict):
            raise ValueError(f"unexpected structure in {name}")
        return obj

    def owner_name(self, configured: tuple[str, ...] = ()) -> str | None:
        """The owner is the participant present in every thread (or a configured name)."""
        if configured:
            return configured[0]
        counts: dict[str, int] = {}
        groups = self._thread_groups()
        for files in groups.values():
            names = {fix_mojibake(p.get("name", "")) for p in self._load(files[0]).get("participants", [])}
            for n in names:
                counts[n] = counts.get(n, 0) + 1
        if len(groups) < 2:
            return None
        full = [n for n, c in counts.items() if c == len(groups)]
        return full[0] if len(full) == 1 else None

    def list_threads(self) -> list[ThreadInfo]:
        out = []
        for tid, files in self._thread_groups().items():
            first = self._load(files[0])
            count, last_ms = 0, 0
            for f in files:
                msgs = self._load(f).get("messages", []) or []
                count += len(msgs)
                for m in msgs:
                    last_ms = max(last_ms, int(m.get("timestamp_ms") or 0))
            out.append(ThreadInfo(
                thread_id=tid, title=clean_field(fix_mojibake(first.get("title", "")) or tid),
                folder=tid.split("/", 1)[1], message_count=count,
                participants=[clean_field(fix_mojibake(p.get("name", ""))) for p in first.get("participants", [])],
                last_message_at=datetime.fromtimestamp(last_ms / 1000, tz=timezone.utc).isoformat() if last_ms else None,
            ))
        return sorted(out, key=lambda t: t.last_message_at or "", reverse=True)

    def read_threads(self, thread_ids: list[str], owner_name: str | None,
                     max_messages_per_thread: int = 5000) -> list[ThreadRecord]:
        groups = self._thread_groups()
        out = []
        for tid in thread_ids:
            if tid not in groups:
                raise KeyError(f"thread not in export: {tid}")
            files = groups[tid]
            first = self._load(files[0])
            folder = tid.split("/", 1)[1]
            # Folder names look like "<username>_<digits>"; the username is a
            # *candidate* Instagram handle, stored unverified.
            handle_guess = re.sub(r"_\d+$", "", folder)
            parts = []
            for p in first.get("participants", []):
                name = fix_mojibake(p.get("name", ""))
                is_owner = owner_name is not None and name == owner_name
                parts.append(participant(name, "name", name, is_owner))
            if handle_guess:
                parts.append(participant(f"@{handle_guess} (from export folder)", "instagram", handle_guess))
            th = ThreadRecord(thread_id=tid, title=fix_mojibake(first.get("title", "")) or folder, participants=parts)
            for f in files:
                for m in (self._load(f).get("messages", []) or []):
                    if len(th.messages) >= max_messages_per_thread:
                        break
                    content = m.get("content")
                    if not isinstance(content, str) or not content.strip():
                        continue  # media-only / reactions
                    sender = fix_mojibake(m.get("sender_name", ""))
                    ts = m.get("timestamp_ms")
                    sent_at = datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc).isoformat() if ts else None
                    role = "unknown" if owner_name is None else ("owner" if sender == owner_name else "counterparty")
                    th.messages.append(MessageRecord(
                        thread_id=tid, sent_at=sent_at, sender_label=sender, sender_role=role,
                        body=fix_mojibake(content), source_message_id=f"{ts}:{sender}" if ts else None,
                    ))
            out.append(th)
        return out
