"""Manually prepared conversation files (CSV or JSON).

CSV columns: thread_id, timestamp, sender, text, and optionally is_owner
(1/0/true/false), contact (phone/email/@handle of the counterparty), title.
JSON: a list of objects with the same keys.
"""
from __future__ import annotations

from ...normalization.dates import parse_datetime
from ...normalization.identifiers import detect_contact, normalize_instagram
from ..tabular import read_csv_table, read_json_table
from .base import MessageRecord, ThreadRecord, participant


def parse_manual_conversations(data: bytes, fmt: str = "csv", owner_names: tuple[str, ...] = ()) -> list[ThreadRecord]:
    table = read_json_table(data) if fmt == "json" else read_csv_table(data, ("thread_id", "timestamp", "sender", "text"))
    required = {"thread_id", "timestamp", "sender", "text"}
    if not required <= set(table.headers):
        raise ValueError(f"missing columns: {sorted(required - set(table.headers))}")
    owners = {o.casefold() for o in owner_names}
    threads: dict[str, ThreadRecord] = {}
    for i, row in enumerate(table.rows, start=1):
        tid = row["thread_id"].strip() or "unthreaded"
        th = threads.setdefault(tid, ThreadRecord(thread_id=tid, title=row.get("title") or tid))
        flag = (row.get("is_owner") or "").strip().lower()
        is_owner = flag in ("1", "true", "yes") or row["sender"].casefold() in owners
        role = "owner" if is_owner else ("counterparty" if flag in ("0", "false", "no") or owners else "unknown")
        d, dt = parse_datetime(row["timestamp"])
        th.messages.append(MessageRecord(thread_id=tid, sent_at=dt or d, sender_label=row["sender"],
                                         sender_role=role, body=row["text"], source_message_id=row.get("message_id") or None))
        contact = (row.get("contact") or "").strip()
        if contact and not is_owner and not any(p.identifier_value for p in th.participants if not p.is_owner and p.identifier_type != "name"):
            c = detect_contact(contact)
            if c:
                th.participants.append(participant(row["sender"], c[0], c[1]))
            elif contact.startswith("@") and normalize_instagram(contact):
                th.participants.append(participant(row["sender"], "instagram", contact))
        if not any(p.label == row["sender"] for p in th.participants):
            th.participants.append(participant(row["sender"], "name", row["sender"], is_owner))
    return list(threads.values())
