"""Shared transaction-import pipeline.

Importers only *parse* rows into ``ParsedTransaction`` objects. This module
owns everything that touches the database: file hashing, idempotency,
duplicate detection, evidence rows, owner-transfer rules and import-job
bookkeeping. Imported rows are inserted, never updated.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Protocol

from ..database import audit
from ..database.connection import new_id, transaction, utcnow
from ..normalization.identifiers import normalize_name
from ..security.paths import ensure_within, safe_filename
from ..security.permissions import make_private_dir, make_private_file
from ..security.sanitize import clean_field, clean_text

TXN_TYPES = ("payment_received", "refund", "reversal", "processing_fee", "expense",
             "owner_transfer", "personal", "unknown")


@dataclass
class ParsedTransaction:
    row_number: int
    raw: dict
    source_amount_text: str
    direction: str
    gross_cents: int
    fee_cents: int = 0
    refund_cents: int = 0
    currency: str = "USD"
    transaction_date: str | None = None
    transaction_datetime: str | None = None
    source_record_id: str | None = None
    txn_type: str = "unknown"
    classification_reason: str = ""
    source_status: str = "unknown"
    source_status_raw: str = ""
    counterparty_raw: str = ""
    counterparty_handle: str = ""
    counterparty_handle_type: str = ""
    payment_method: str = "other"
    account_label: str = ""
    memo: str = ""
    verification_status: str = "unverified"
    warnings: list[str] = field(default_factory=list)

    @property
    def net_cents(self) -> int:
        if self.direction == "in":
            return self.gross_cents - self.fee_cents - self.refund_cents
        return self.gross_cents


@dataclass
class RowIssue:
    row_number: int
    message: str


@dataclass
class ParseResult:
    transactions: list[ParsedTransaction] = field(default_factory=list)
    failed: list[RowIssue] = field(default_factory=list)
    skipped: list[RowIssue] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    record_count: int = 0


class TransactionImporter(Protocol):
    name: str
    source_type: str
    label: str

    def parse(self, data: bytes, options: dict | None = None) -> ParseResult: ...


@dataclass
class ImportSummary:
    job_id: str
    status: str
    record_count: int
    inserted: int
    duplicates: int
    skipped: int
    failed: int
    warnings: list[str]
    failed_rows: list[RowIssue] = field(default_factory=list)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def compute_dedupe_keys(source_type: str, txns: list[ParsedTransaction]) -> list[tuple[str, bool]]:
    """Return (dedupe_key, has_stable_id) per transaction.

    With a stable source id the key is derived from it alone. Without one, the
    key is derived from the row's economic content plus its occurrence index
    among identical rows *in the same file*, so re-importing a file is
    idempotent while genuinely repeated identical rows in one file survive.
    """
    keys = []
    seen: dict[str, int] = {}
    for t in txns:
        if t.source_record_id:
            base = f"{source_type}|id|{t.source_record_id.strip()}"
            keys.append((hashlib.sha256(base.encode()).hexdigest(), True))
            continue
        content = "|".join([
            source_type, t.account_label.lower(), t.transaction_date or "", t.direction,
            str(t.gross_cents), normalize_name(t.counterparty_raw), normalize_name(t.memo)[:80],
        ])
        n = seen.get(content, 0)
        seen[content] = n + 1
        keys.append((hashlib.sha256(f"{content}|{n}".encode()).hexdigest(), False))
    return keys


def _store_source_copy(workspace_incoming: Path | None, filename: str, data: bytes, sha: str) -> str | None:
    """Keep a read-only copy of the uploaded original inside the workspace."""
    if workspace_incoming is None:
        return None
    make_private_dir(workspace_incoming)
    target = ensure_within(workspace_incoming, f"{sha[:12]}_{safe_filename(filename)}")
    if not target.exists():
        target.write_bytes(data)
        make_private_file(target, read_only=True)
    return str(target)


def apply_owner_rules(conn: sqlite3.Connection, t: ParsedTransaction) -> None:
    """Mark transfers to/from the owner's own accounts as owner_transfer."""
    candidates = []
    if t.counterparty_handle:
        candidates.append((t.counterparty_handle_type, t.counterparty_handle))
    name = normalize_name(t.counterparty_raw)
    if name:
        candidates.append(("name", name))
    for id_type, value in candidates:
        row = conn.execute(
            "SELECT label FROM owner_accounts WHERE identifier_type = ? AND normalized_value = ?",
            (id_type, value),
        ).fetchone()
        if row:
            t.txn_type = "owner_transfer"
            t.classification_reason = f"Counterparty matches owner account '{row['label']}'"
            return


def run_transaction_import(
    conn: sqlite3.Connection,
    importer: TransactionImporter,
    data: bytes,
    filename: str,
    *,
    options: dict | None = None,
    incoming_dir: Path | None = None,
    is_demo: bool = False,
    actor: str = "user",
) -> ImportSummary:
    sha = sha256_bytes(data)
    job_id = new_id("job_")
    prior = conn.execute(
        """SELECT id FROM import_jobs WHERE file_sha256 = ? AND importer = ?
           AND status IN ('completed','completed_with_warnings')""",
        (sha, importer.name),
    ).fetchone()
    stored = _store_source_copy(incoming_dir, filename, data, sha)
    with transaction(conn):
        conn.execute(
            """INSERT INTO import_jobs(id, source_type, importer, original_filename, stored_path,
                   file_sha256, file_size_bytes, mapping_json, is_demo)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (job_id, importer.source_type, importer.name, clean_field(filename), stored, sha,
             len(data), json.dumps(options or {}, sort_keys=True), int(is_demo)),
        )
    if prior:
        msg = f"Identical file already imported (job {prior['id']}); nothing re-imported."
        with transaction(conn):
            conn.execute(
                """UPDATE import_jobs SET status='duplicate_file', finished_at=?, warnings_json=?
                   WHERE id=?""", (utcnow(), json.dumps([msg]), job_id))
        return ImportSummary(job_id, "duplicate_file", 0, 0, 0, 0, 0, [msg])

    try:
        result = importer.parse(data, options or {})
    except Exception as exc:  # parsing failed as a whole: record and surface
        with transaction(conn):
            conn.execute(
                "UPDATE import_jobs SET status='failed', finished_at=?, warnings_json=? WHERE id=?",
                (utcnow(), json.dumps([f"{type(exc).__name__}: {clean_field(exc)}"]), job_id),
            )
        return ImportSummary(job_id, "failed", 0, 0, 0, 0, 0, [clean_field(exc)])

    keys = compute_dedupe_keys(importer.source_type, result.transactions)
    inserted = duplicates = 0
    warnings = list(result.warnings)
    with transaction(conn):
        for t, (key, stable) in zip(result.transactions, keys):
            if conn.execute("SELECT 1 FROM transactions WHERE dedupe_key = ?", (key,)).fetchone():
                duplicates += 1
                if not stable:
                    warnings.append(
                        f"Row {t.row_number}: identical to an already-imported row without a source ID; "
                        "skipped as a likely duplicate (review if this was a genuine repeat payment).")
                continue
            if t.txn_type not in ("owner_transfer",):
                apply_owner_rules(conn, t)
            txn_id = new_id("txn_")
            conn.execute(
                """INSERT INTO transactions(
                     id, import_job_id, source_type, source_record_id, source_row_number, dedupe_key,
                     has_stable_source_id, payment_method, account_label, transaction_date,
                     transaction_datetime, direction, txn_type, classification_source,
                     classification_reason, source_amount_text, currency, gross_amount_cents,
                     fee_amount_cents, refund_amount_cents, net_amount_cents, source_status,
                     source_status_raw, counterparty_raw, counterparty_name_norm, counterparty_handle,
                     counterparty_handle_type, memo, raw_json, verification_status, is_demo)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'importer_rule',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (txn_id, job_id, importer.source_type, t.source_record_id, t.row_number, key,
                 int(stable), t.payment_method, clean_field(t.account_label), t.transaction_date,
                 t.transaction_datetime, t.direction, t.txn_type, t.classification_reason,
                 clean_field(t.source_amount_text), t.currency, t.gross_cents, t.fee_cents,
                 t.refund_cents, t.net_cents, t.source_status, clean_field(t.source_status_raw),
                 clean_field(t.counterparty_raw), normalize_name(t.counterparty_raw),
                 t.counterparty_handle, t.counterparty_handle_type, clean_text(t.memo, 500),
                 json.dumps(t.raw, ensure_ascii=False, sort_keys=True),
                 t.verification_status, int(is_demo)),
            )
            conn.execute(
                """INSERT INTO evidence(id, evidence_type, import_job_id, source_filename, source_record_id,
                       transaction_id, occurred_at, excerpt)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (new_id("evd_"), "transaction_row", job_id, clean_field(filename),
                 t.source_record_id or f"row {t.row_number}", txn_id, t.transaction_date,
                 clean_text(f"{t.source_amount_text} · {t.counterparty_raw} · {t.memo}", 300)),
            )
            for w in t.warnings:
                warnings.append(f"Row {t.row_number}: {w}")
            inserted += 1
        failed = len(result.failed)
        skipped = len(result.skipped)
        status = "completed_with_warnings" if (warnings or failed) else "completed"
        conn.execute(
            """UPDATE import_jobs SET status=?, finished_at=?, record_count=?, success_count=?,
                   skipped_count=?, duplicate_count=?, failed_count=?, warnings_json=? WHERE id=?""",
            (status, utcnow(), result.record_count, inserted, skipped, duplicates, failed,
             json.dumps(warnings[:500] + [f"Row {i.row_number} failed: {i.message}" for i in result.failed[:200]]
                        + [f"Row {i.row_number} skipped: {i.message}" for i in result.skipped[:200]]),
             job_id),
        )
        audit.record(conn, actor=actor, action="import_transactions", entity_type="import_jobs",
                     entity_id=job_id, after={"importer": importer.name, "inserted": inserted,
                                              "duplicates": duplicates, "failed": failed})
    return ImportSummary(job_id, status, result.record_count, inserted, duplicates, skipped, failed,
                         warnings, result.failed)


def preview(importer: TransactionImporter, data: bytes, options: dict | None = None,
            limit: int = 50) -> ParseResult:
    """Parse without writing anything — for the mapping/preview step."""
    result = importer.parse(data, options or {})
    result.transactions = result.transactions[:limit]
    return result


RowParser = Callable[[int, dict], ParsedTransaction | None]
