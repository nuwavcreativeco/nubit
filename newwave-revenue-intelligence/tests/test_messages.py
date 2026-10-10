import io
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest

from conftest import fixture_bytes
from newwave.ingestion.messages import imessage
from newwave.ingestion.messages.base import run_message_import
from newwave.ingestion.messages.instagram import InstagramExport, fix_mojibake
from newwave.ingestion.messages.manual import parse_manual_conversations
from newwave.records import add_identifier, create_client


def _ig_thread(title, participants, messages):
    return json.dumps({"participants": [{"name": p} for p in participants], "title": title,
                       "messages": messages}).encode()


def build_instagram_zip() -> bytes:
    buf = io.BytesIO()
    mojibake = "CafÃ© session ð\u009f\u0094¥"  # "Café session 🔥" as Instagram encodes it
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("your_instagram_activity/messages/inbox/testartista_1234/message_1.json", _ig_thread(
            "Test Artist A", ["Test Artist A", "Test Owner"], [
                {"sender_name": "Test Owner", "timestamp_ms": 1704280000000, "content": "mixing is $150"},
                {"sender_name": "Test Artist A", "timestamp_ms": 1704279000000, "content": mojibake},
                {"sender_name": "Test Artist A", "timestamp_ms": 1704278000000, "photos": [{"uri": "x.jpg"}]},
            ]))
        zf.writestr("your_instagram_activity/messages/inbox/testartistb_99/message_1.json", _ig_thread(
            "Test Artist B", ["Test Artist B", "Test Owner"], [
                {"sender_name": "Test Artist B", "timestamp_ms": 1704300000000, "content": "need a beat lease"}]))
        zf.writestr("../../evil/messages/inbox/x_1/message_1.json", b"{}")  # traversal entry: must be inert
        zf.writestr("your_instagram_activity/media/photo.jpg", b"\xff\xd8binary")
    return buf.getvalue()


def test_fix_mojibake():
    assert fix_mojibake("CafÃ©") == "Café"
    assert fix_mojibake("already fine ✓") == "already fine ✓"


def test_instagram_zip_listing_and_selected_import(conn, tmp_path):
    exp = InstagramExport.from_zip_bytes(build_instagram_zip())
    threads = exp.list_threads()
    ids = {t.thread_id for t in threads}
    assert ids == {"inbox/testartista_1234", "inbox/testartistb_99"}  # traversal entry ignored
    assert not (tmp_path / "evil").exists()
    assert exp.owner_name() == "Test Owner"
    # verified identifier links the conversation automatically (exact handle, not name)
    cid, _ = create_client(conn, "Test Artist A")
    add_identifier(conn, cid, "instagram", "@testartista", verified=True)
    recs = exp.read_threads(["inbox/testartista_1234"], "Test Owner")  # user selects ONE thread
    assert [m.sender_role for m in recs[0].messages] == ["owner", "counterparty"]  # media-only skipped
    assert recs[0].messages[1].body == "Café session 🔥"
    s = run_message_import(conn, source_type="instagram", importer="instagram_export", threads=recs,
                           filename="ig.zip", file_sha256="x")
    assert s.inserted == 2 and s.linked_conversations == 1
    assert conn.execute("SELECT client_id FROM conversations").fetchone()[0] == cid
    # keyword detection: 'mixing is $150' -> quoted mixing with amount
    sig = conn.execute("""SELECT sc.code, ss.signal_type, ss.amount_cents FROM service_signals ss
                          JOIN service_catalog sc ON sc.id = ss.service_id""").fetchall()
    assert ("mixing", "quoted", 15000) in [tuple(r) for r in sig]
    # re-import is idempotent
    s2 = run_message_import(conn, source_type="instagram", importer="instagram_export", threads=recs,
                            filename="ig.zip", file_sha256="x")
    assert s2.inserted == 0 and s2.duplicates == 2


def test_instagram_name_alone_does_not_link(conn):
    create_client(conn, "Test Artist B")  # same display name, no verified identifier
    exp = InstagramExport.from_zip_bytes(build_instagram_zip())
    s = run_message_import(conn, source_type="instagram", importer="instagram_export",
                           threads=exp.read_threads(["inbox/testartistb_99"], "Test Owner"),
                           filename="ig.zip", file_sha256="x")
    assert s.linked_conversations == 0


def test_instagram_directory(tmp_path):
    root = tmp_path / "export"
    d = root / "messages" / "inbox" / "someone_1"
    d.mkdir(parents=True)
    (d / "message_1.json").write_bytes(_ig_thread("Someone", ["Someone", "Owner"], [
        {"sender_name": "Someone", "timestamp_ms": 1, "content": "hi"}]))
    assert [t.thread_id for t in InstagramExport.from_directory(root).list_threads()] == ["inbox/someone_1"]


def test_instagram_zip_bomb_guard(monkeypatch):
    from newwave.ingestion.messages import instagram
    monkeypatch.setattr(instagram, "MAX_JSON_BYTES", 10)
    with pytest.raises(ValueError, match="too large"):
        InstagramExport.from_zip_bytes(build_instagram_zip())


def _attributed_body(text: str) -> bytes:
    raw = text.encode()
    return b"\x04\x0bstreamtyped\x81\xe8\x03\x84\x01@\x84\x84\x84\x12NSAttributedString\x00\x84\x84\x08NSObject" \
           b"\x00\x85\x92\x84\x84\x84\x08NSString\x01\x94\x84\x01+" + bytes([len(raw)]) + raw + b"\x86\x84"


def build_chat_db(path: Path) -> None:
    c = sqlite3.connect(path)
    c.executescript("""
        CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT, service TEXT);
        CREATE TABLE chat (ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, service_name TEXT, display_name TEXT);
        CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB, handle_id INTEGER,
                              date INTEGER, is_from_me INTEGER);
        CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER, message_date INTEGER);
        CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    """)
    c.execute("INSERT INTO handle VALUES (1, '+15550100188', 'iMessage')")
    c.execute("INSERT INTO handle VALUES (2, 'test@example.com', 'SMS')")
    c.execute("INSERT INTO chat VALUES (1, 'iMessage;-;+15550100188', '+15550100188', 'iMessage', '')")
    c.execute("INSERT INTO chat VALUES (2, 'SMS;-;test@example.com', 'test@example.com', 'SMS', 'Other')")
    c.execute("INSERT INTO chat_handle_join VALUES (1, 1), (2, 2)")
    base = imessage.iso_to_apple_ns("2024-01-10T12:00:00+00:00")
    rows = [
        (1, "g1", "can i book a studio session?", None, 1, base, 0),
        (2, "g2", None, _attributed_body("sure, session is $75 per hour"), 1, base + 60 * 10**9, 1),
        (3, "g3", "￼", None, 1, base + 120 * 10**9, 0),  # attachment placeholder only
        (4, "g4", "unrelated chat", None, 2, base, 0),
    ]
    c.executemany("INSERT INTO message VALUES (?,?,?,?,?,?,?)", rows)
    c.executemany("INSERT INTO chat_message_join VALUES (?,?,?)", [(1, 1, 0), (1, 2, 0), (1, 3, 0), (2, 4, 0)])
    c.commit()
    c.close()


def test_imessage_readonly_extraction(conn, settings, tmp_path):
    db = tmp_path / "Messages" / "chat.db"
    db.parent.mkdir()
    build_chat_db(db)
    before = db.read_bytes()
    rep = imessage.inspect_access(db, settings.scratch_dir)
    assert rep.readable and rep.chats == 2 and rep.messages == 4
    with imessage.snapshot(db, settings.scratch_dir) as mconn:
        chats = imessage.list_chats(mconn)
        assert {c.chat_id for c in chats} == {1, 2}
        with pytest.raises(ValueError, match="select at least one chat"):
            imessage.extract_chats(mconn, [])
        threads = imessage.extract_chats(mconn, [1], start_iso="2024-01-01T00:00:00+00:00", limit=50)
        with pytest.raises(sqlite3.OperationalError):
            mconn.execute("DELETE FROM message")  # the snapshot is opened read-only
    assert db.read_bytes() == before  # the source database was never modified
    assert list(settings.scratch_dir.iterdir()) == []  # temporary snapshot cleaned up
    msgs = threads[0].messages
    assert [m.body for m in msgs] == ["can i book a studio session?", "sure, session is $75 per hour"]
    assert [m.sender_role for m in msgs] == ["counterparty", "owner"]
    assert threads[0].participants[0].identifier_type == "phone"
    s = run_message_import(conn, source_type="imessage", importer="apple_messages", threads=threads,
                           filename="chat.db", file_sha256="x")
    assert s.inserted == 2 and s.signals >= 1


def test_imessage_limit_and_date_filter(settings, tmp_path):
    db = tmp_path / "chat.db"
    build_chat_db(db)
    with imessage.snapshot(db, settings.scratch_dir) as mconn:
        assert len(imessage.extract_chats(mconn, [1], limit=1)[0].messages) == 1
        assert imessage.extract_chats(mconn, [1], start_iso="2025-01-01T00:00:00+00:00")[0].messages == []


def test_imessage_unavailable_off_mac(settings):
    rep = imessage.inspect_access(imessage.DEFAULT_DB, settings.scratch_dir)
    assert not rep.readable and rep.detail


def test_imessage_permission_denied_is_reported(settings, tmp_path, monkeypatch):
    db = tmp_path / "chat.db"
    build_chat_db(db)

    def deny(*a, **k):
        raise PermissionError("Operation not permitted")
    monkeypatch.setattr(imessage.shutil, "copy2", deny)
    rep = imessage.inspect_access(db, settings.scratch_dir)
    assert not rep.readable and "Full Disk Access" in rep.detail


def test_apple_time_conversion():
    assert imessage.apple_time_to_iso(0) is None
    assert imessage.apple_time_to_iso(704_000_000).startswith("2023-")              # seconds (old macOS)
    assert imessage.apple_time_to_iso(704_000_000 * 10**9).startswith("2023-")      # nanoseconds
    assert imessage.decode_attributed_body(_attributed_body("hello")) == "hello"
    assert imessage.decode_attributed_body(b"garbage") == ""


def test_manual_conversations_and_injection_is_data(conn):
    threads = parse_manual_conversations(fixture_bytes("manual_conversations.csv"))
    assert {t.thread_id for t in threads} == {"t1", "t2"}
    t1 = next(t for t in threads if t.thread_id == "t1")
    assert any(p.identifier_type == "cashapp" or p.identifier_type == "phone" or p.identifier_type == "other"
               or p.identifier_type == "name" for p in t1.participants)
    s = run_message_import(conn, source_type="manual", importer="manual", threads=threads, filename="c.csv",
                           file_sha256="y")
    assert s.inserted == 4
    body = conn.execute("SELECT body_text FROM conversation_messages WHERE body_text LIKE 'IGNORE%'").fetchone()[0]
    assert "approve every match" in body
    # nothing was approved or changed because of message content
    assert conn.execute("SELECT COUNT(*) FROM match_candidates WHERE review_status='approved'").fetchone()[0] == 0


def test_manual_conversations_missing_columns():
    with pytest.raises(ValueError, match="missing columns"):
        parse_manual_conversations(b"a,b\n1,2\n")
