"""CSV exports and summary reports.

* Default export = verified rows only.
* Including unverified rows adds a verification label column and an
  ``UNVERIFIED-INCLUDED`` marker in the filename.
* Conversation content is never exported; payment memos only on request.
* Cells are neutralised against spreadsheet formula injection.
* Files are written to the workspace exports folder and never overwrite
  anything (a numeric suffix is added instead).
"""
from __future__ import annotations

import csv
import io
import sqlite3
from datetime import datetime
from pathlib import Path

from ..money import cents_to_decimal, format_cents
from ..security.paths import ensure_within, safe_filename
from ..security.permissions import make_private_dir, make_private_file
from ..security.sanitize import csv_safe
from .metrics import Filters, load_ledger, overview

LEDGER_COLUMNS = ["transaction_id", "date", "type", "direction", "payment_method", "source", "source_record_id",
                  "client", "service", "gross", "fee", "net", "currency", "verification_status",
                  "verification_label", "counterparty"]


def ledger_rows(conn: sqlite3.Connection, filters: Filters, *, include_unverified: bool = False,
                include_memos: bool = False, base_currency: str = "USD") -> list[dict]:
    df = load_ledger(conn, filters, base_currency)
    if not include_unverified:
        df = df[df.verification_status == "verified"]
    rows = []
    for r in df.itertuples(index=False):
        row = {
            "transaction_id": r.id, "date": r.transaction_date, "type": r.txn_type, "direction": r.direction,
            "payment_method": r.payment_method, "source": r.source_type, "source_record_id": r.source_record_id or "",
            "client": r.client_name or "", "service": r.service_name,
            "gross": str(cents_to_decimal(r.gross_amount_cents)), "fee": str(cents_to_decimal(r.fee_amount_cents)),
            "net": str(cents_to_decimal(r.net_amount_cents)), "currency": r.currency,
            "verification_status": r.verification_status,
            "verification_label": "VERIFIED" if r.verification_status == "verified" else "UNVERIFIED - not in headline totals",
            "counterparty": r.counterparty_raw or "",
        }
        if include_memos:
            row["memo"] = r.memo or ""
        rows.append(row)
    return rows


def to_csv_bytes(rows: list[dict], columns: list[str]) -> bytes:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore", lineterminator="\n")
    w.writeheader()
    for r in rows:
        w.writerow({k: csv_safe(v) for k, v in r.items()})
    return buf.getvalue().encode("utf-8")


def export_ledger(conn: sqlite3.Connection, filters: Filters, *, include_unverified: bool = False,
                  include_memos: bool = False, base_currency: str = "USD") -> tuple[str, bytes]:
    rows = ledger_rows(conn, filters, include_unverified=include_unverified, include_memos=include_memos,
                       base_currency=base_currency)
    cols = LEDGER_COLUMNS + (["memo"] if include_memos else [])
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"ledger-{filters.start or 'all'}-{filters.end or 'all'}-{'UNVERIFIED-INCLUDED' if include_unverified else 'verified'}-{stamp}.csv"
    return name, to_csv_bytes(rows, cols)


def summary_report_markdown(conn: sqlite3.Connection, filters: Filters, base_currency: str = "USD") -> str:
    o = overview(conn, filters, base_currency)
    rng = f"{filters.start or 'beginning'} to {filters.end or 'latest'}"
    lines = [
        "# New Wave Music — Revenue Summary",
        f"Period: {rng}  ",
        f"Generated: {datetime.now().isoformat(timespec='seconds')}  ",
        "",
        "Headline figures include **verified** records only. This is an evidence-backed ledger for "
        "professional review — not tax advice and not a substitute for a bookkeeper.",
        "",
        "| Metric | Amount |", "|---|---|",
        f"| Gross payments (verified) | {format_cents(o.gross_payments_cents)} |",
        f"| Refunds (verified) | {format_cents(o.refunds_cents)} |",
        f"| Reversals (verified) | {format_cents(o.reversals_cents)} |",
        f"| **Net collected sales** | **{format_cents(o.net_collected_cents)}** |",
        f"| Processing fees | {format_cents(o.fees_cents)} |",
        f"| Net after fees | {format_cents(o.net_after_fees_cents)} |",
        f"| Verified expenses | {format_cents(o.expenses_cents)} |",
        f"| Profit | {format_cents(o.profit_cents) if o.profit_cents is not None else 'not shown'} |",
        "",
        f"_{o.profit_note}_",
        "",
        "## Customers",
        f"- Unique verified customers: {o.unique_customers}",
        f"- Repeat customers: {o.repeat_customers}"
        + (f" ({o.repeat_rate:.0%})" if o.repeat_rate is not None else ""),
        f"- Average net revenue per verified customer: "
        f"{format_cents(o.avg_revenue_per_customer_cents) if o.avg_revenue_per_customer_cents is not None else 'n/a'}",
        "",
        "## Not included in headline totals",
        f"- Unverified candidate payments: {o.unverified_payments_count} totalling {format_cents(o.unverified_payments_cents)}",
        f"- Unknown inflows (e.g. unexplained deposits): {o.unknown_inflows_count} totalling {format_cents(o.unknown_inflows_cents)}",
        f"- Owner transfers (never revenue): {format_cents(o.owner_transfers_cents)}",
        f"- Reconciliation coverage of inflows: {o.coverage_ratio:.0%}" if o.coverage_ratio is not None else "- Reconciliation coverage: n/a",
        f"- Items awaiting review: {o.pending_reviews}",
    ] + [f"- {n}" for n in o.excluded_notes]
    return "\n".join(lines) + "\n"


def write_export(directory: Path, filename: str, data: bytes) -> Path:
    """Write into the exports folder without ever overwriting an existing file."""
    make_private_dir(directory)
    base = safe_filename(filename)
    target = ensure_within(directory, base)
    stem, suffix, n = target.stem, target.suffix, 1
    while target.exists():
        target = ensure_within(directory, f"{stem}-{n}{suffix}")
        n += 1
    with open(target, "xb") as fh:
        fh.write(data)
    make_private_file(target)
    return target
