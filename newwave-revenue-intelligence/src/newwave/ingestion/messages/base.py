"""Shared conversation-import pipeline.

Messages are stored as sanitised plain text for local search and evidence.
They are evidence only: nothing in a message is ever executed or obeyed.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass, field

from ...catalog import detect_services
from ...database import audit
from ...database.connection import new_id, transaction, utcnow
from ...normalization.identifiers import normalize_identifier
from ...security.sanitize import clean_field, clean_text


@dataclass
class Participant:
    label: str
    identifier_type: str | None = None   # phone/email/instagram/name
    identifier_value: str | None = None  # normalized
    is_owner: bool = False


@dataclass
class MessageRecord:
    thread_id: str
    sent_at: str | None
    sender_label: str
    sender_role: str      # owner/counterparty/unknown
    body: str
    source_message_id: str | None = None


@dataclass
class ThreadRecord:
    thread_id: str
    title: str
    participants: list[Participant] = field(default_factory=list)
    messages: list[MessageRecord] = field(default_factory=list)


@dataclass
class MessageImportSummary:
    job_id: str
    status: str
    threads: int
    inserted: int
    duplicates: int
    signals: int
    linked_conversations: int
    warnings: list[str]


def _msg_key(source_type: str, m: MessageRecord) -> str:
    if m.source_message_id:
        base = f"{source_type}|{m.thread_id}|id|{m.source_message_id}"
    else:
        body_hash = hashlib.sha256(m.body.encode()).hexdigest()
        base = f"{source_type}|{m.thread_id}|{m.sent_at}|{m.sender_label}|{body_hash}"
    return hashlib.sha256(base.encode()).hexdigest()


def _verified_client_for(conn: sqlite3.Connection, participants: list[Participant]) -> str | None:
    """Link a conversation only via a *verified* exact identifier (never by name)."""
    client_ids = set()
    for p in participants:
        if p.is_owner or not p.identifier_type or p.identifier_type == "name" or not p.identifier_value:
            continue
        row = conn.execute(
            """SELECT ci.client_id FROM client_identifiers ci JOIN clients c ON c.id = ci.client_id
               WHERE ci.identifier_type = ? AND ci.normalized_value = ?
                 AND ci.verification_status = 'verified' AND c.status = 'active'""",
            (p.identifier_type, p.identifier_value),
        ).fetchone()
        if row:
            client_ids.add(row["client_id"])
    return client_ids.pop() if len(client_ids) == 1 else None


def run_message_import(
    conn: sqlite3.Connection,
    *,
    source_type: str,
    importer: str,
    threads: list[ThreadRecord],
    filename: str,
    file_sha256: str,
    file_size: int = 0,
    options: dict | None = None,
    is_demo: bool = False,
    actor: str = "user",
) -> MessageImportSummary:
    job_id = new_id("job_")
    inserted = duplicates = signals = linked = 0
    warnings: list[str] = []
    with transaction(conn):
        conn.execute(
            """INSERT INTO import_jobs(id, source_type, importer, original_filename, file_sha256,
                   file_size_bytes, mapping_json, is_demo) VALUES (?,?,?,?,?,?,?,?)""",
            (job_id, source_type, importer, clean_field(filename), file_sha256, file_size,
             json.dumps(options or {}, sort_keys=True, default=str), int(is_demo)),
        )
        for th in threads:
            conv = conn.execute(
                "SELECT id, client_id FROM conversations WHERE source_type = ? AND source_thread_id = ?",
                (source_type, th.thread_id),
            ).fetchone()
            participants_json = json.dumps(
                [{"label": clean_field(p.label), "type": p.identifier_type, "value": p.identifier_value,
                  "owner": p.is_owner} for p in th.participants], ensure_ascii=False)
            if conv is None:
                conv_id = new_id("conv_")
                conn.execute(
                    """INSERT INTO conversations(id, import_job_id, source_type, source_thread_id, title,
                           participants_json, is_demo) VALUES (?,?,?,?,?,?,?)""",
                    (conv_id, job_id, source_type, th.thread_id, clean_field(th.title), participants_json,
                     int(is_demo)),
                )
                client_id = None
            else:
                conv_id, client_id = conv["id"], conv["client_id"]
            if client_id is None:
                cid = _verified_client_for(conn, th.participants)
                if cid:
                    audit.update_with_audit(conn, "conversations", conv_id, {"client_id": cid},
                                            actor="system", action="link_conversation_verified_identifier",
                                            reason="participant matches a verified client identifier")
                    linked += 1
            for m in th.messages:
                body = clean_text(m.body)
                key = _msg_key(source_type, MessageRecord(th.thread_id, m.sent_at, m.sender_label,
                                                          m.sender_role, body, m.source_message_id))
                if conn.execute("SELECT 1 FROM conversation_messages WHERE dedupe_key = ?", (key,)).fetchone():
                    duplicates += 1
                    continue
                msg_id = new_id("msg_")
                conn.execute(
                    """INSERT INTO conversation_messages(id, conversation_id, import_job_id, dedupe_key,
                           source_message_id, sent_at, sender_role, sender_label, body_text)
                       VALUES (?,?,?,?,?,?,?,?,?)""",
                    (msg_id, conv_id, job_id, key, m.source_message_id, m.sent_at, m.sender_role,
                     clean_field(m.sender_label), body),
                )
                inserted += 1
                hits = detect_services(conn, body)
                if hits:
                    evd = new_id("evd_")
                    conn.execute(
                        """INSERT INTO evidence(id, evidence_type, import_job_id, source_filename,
                               source_record_id, conversation_message_id, occurred_at, excerpt)
                           VALUES (?,?,?,?,?,?,?,?)""",
                        (evd, "message_excerpt", job_id, clean_field(filename),
                         m.source_message_id or f"{th.thread_id}@{m.sent_at}", msg_id, m.sent_at,
                         clean_text(body, 280)),
                    )
                for h in hits:
                    conn.execute(
                        """INSERT OR IGNORE INTO service_signals(id, conversation_message_id, service_id,
                               signal_type, amount_cents, detected_by) VALUES (?,?,?,?,?,'keyword')""",
                        (new_id("sig_"), msg_id, h.service_id, h.signal_type, h.amount_cents),
                    )
                    signals += 1
            conn.execute(
                """UPDATE conversations SET
                       message_count = (SELECT COUNT(*) FROM conversation_messages WHERE conversation_id = ?),
                       first_message_at = (SELECT MIN(sent_at) FROM conversation_messages WHERE conversation_id = ?),
                       last_message_at = (SELECT MAX(sent_at) FROM conversation_messages WHERE conversation_id = ?)
                   WHERE id = ?""", (conv_id, conv_id, conv_id, conv_id))
        status = "completed_with_warnings" if warnings else "completed"
        conn.execute(
            """UPDATE import_jobs SET status=?, finished_at=?, record_count=?, success_count=?,
                   duplicate_count=?, warnings_json=? WHERE id=?""",
            (status, utcnow(), inserted + duplicates, inserted, duplicates, json.dumps(warnings), job_id),
        )
        audit.record(conn, actor=actor, action="import_messages", entity_type="import_jobs", entity_id=job_id,
                     after={"importer": importer, "threads": len(threads), "inserted": inserted})
    return MessageImportSummary(job_id, status, len(threads), inserted, duplicates, signals, linked, warnings)


def participant(label: str, id_type: str | None, raw_value: str | None, is_owner: bool = False) -> Participant:
    value = normalize_identifier(id_type, raw_value) if id_type and raw_value else None
    return Participant(label=label, identifier_type=id_type if value else None,
                       identifier_value=value, is_owner=is_owner)
