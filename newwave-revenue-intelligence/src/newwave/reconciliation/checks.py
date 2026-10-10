"""Financial-integrity checks that generate reviewable candidates.

Nothing here changes a transaction. Each finding becomes a pending
match_candidate (idempotent by candidate_key) for a human to approve.
"""
from __future__ import annotations

import sqlite3

from ..matching.engine import insert_candidate

APP_SOURCES = ("cashapp", "venmo", "zelle", "manual")
SOURCE_PRIORITY = {"cashapp": 0, "venmo": 0, "zelle": 1, "manual": 2, "bank": 3, "other": 4, "receipts": 4}


def _evidence(conn: sqlite3.Connection, *txn_ids: str) -> list[str]:
    out = []
    for t in txn_ids:
        out += [r["id"] for r in conn.execute("SELECT id FROM evidence WHERE transaction_id = ?", (t,))]
    return out


def find_cross_source_duplicates(conn: sqlite3.Connection, window_days: int = 3) -> int:
    """Same money seen in two exports (e.g. a Zelle export and the bank statement)."""
    rows = conn.execute(
        """SELECT a.id AS a_id, a.source_type AS a_src, a.counterparty_name_norm AS a_name,
                  a.payment_method AS a_pm, a.transaction_date AS a_date, a.import_job_id AS a_job,
                  b.id AS b_id, b.source_type AS b_src, b.counterparty_name_norm AS b_name,
                  b.payment_method AS b_pm, b.transaction_date AS b_date, b.import_job_id AS b_job,
                  a.gross_amount_cents AS cents, a.txn_type AS a_type, b.txn_type AS b_type
           FROM transactions a JOIN transactions b
             ON a.gross_amount_cents = b.gross_amount_cents AND a.direction = b.direction AND a.id < b.id
            AND a.currency = b.currency
            AND ABS(julianday(a.transaction_date) - julianday(b.transaction_date)) <= ?
           WHERE a.duplicate_of_id IS NULL AND b.duplicate_of_id IS NULL
             AND a.verification_status <> 'excluded' AND b.verification_status <> 'excluded'
             AND a.import_job_id IS NOT b.import_job_id
             AND a.txn_type <> 'owner_transfer' AND b.txn_type <> 'owner_transfer'""",
        (window_days,)).fetchall()
    created = 0
    for r in rows:
        same_source = r["a_src"] == r["b_src"]
        names_match = bool(r["a_name"]) and r["a_name"] == r["b_name"]
        names_differ = bool(r["a_name"]) and bool(r["b_name"]) and not names_match
        zelle_pair = "zelle" in (r["a_pm"], r["b_pm"]) and bool({r["a_src"], r["b_src"]} & {"bank", "zelle"}) \
            and r["a_pm"] == r["b_pm"]
        if names_differ:
            continue  # two different named payers: separate payments
        if same_source and not names_match:
            continue
        if not (names_match or zelle_pair or "bank" in (r["a_src"], r["b_src"])):
            continue
        if names_match:
            score = 0.90 if r["a_date"] == r["b_date"] else 0.80
        elif zelle_pair:
            score = 0.75
        else:
            score = 0.45  # amount/date coincidence only (e.g. a bank line with no payer name)
        # keep the record from the more specific source; propose excluding the other
        a_first = SOURCE_PRIORITY.get(r["a_src"], 5) <= SOURCE_PRIORITY.get(r["b_src"], 5)
        keep, drop = (r["a_id"], r["b_id"]) if a_first else (r["b_id"], r["a_id"])
        why = [f"Same amount and direction within {window_days} days in two different imports "
               f"({r['a_src']} {r['a_date']} / {r['b_src']} {r['b_date']})"]
        if names_match:
            why.append("counterparty names match")
        if same_source:
            why.append("same source type without a shared stable ID (overlapping exports?)")
        cid = insert_candidate(
            conn, key=f"duplicate_txn|{drop}|{keep}", candidate_type="duplicate_txn", method="amount_date_window",
            score=score, explanation="; ".join(why), transaction_id=drop, related_transaction_id=keep,
            evidence_ids=_evidence(conn, drop, keep))
        created += bool(cid)
    return created


def find_transfer_pairs(conn: sqlite3.Connection, window_days: int = 5) -> int:
    """Payment-app cash-outs that land in the bank (or bank-funded top-ups).

    If one side is classified owner_transfer and the other isn't, propose
    reclassifying the other side so neither is counted as revenue/expense."""
    rows = conn.execute(
        """SELECT a.id AS a_id, a.txn_type AS a_type, a.source_type AS a_src, a.direction AS a_dir,
                  b.id AS b_id, b.txn_type AS b_type, b.source_type AS b_src, a.gross_amount_cents AS cents,
                  a.transaction_date AS a_date, b.transaction_date AS b_date, a.transfer_pair_id AS a_pair
           FROM transactions a JOIN transactions b
             ON a.gross_amount_cents = b.gross_amount_cents AND a.direction <> b.direction
            AND a.source_type <> b.source_type
            AND ABS(julianday(a.transaction_date) - julianday(b.transaction_date)) <= ?
           WHERE a.txn_type = 'owner_transfer' AND a.duplicate_of_id IS NULL AND b.duplicate_of_id IS NULL
             AND a.verification_status <> 'excluded' AND b.verification_status <> 'excluded'
             AND (b.txn_type <> 'owner_transfer' OR (a.transfer_pair_id IS NULL AND a.id < b.id))""",
        (window_days,)).fetchall()
    created = 0
    for r in rows:
        if r["b_type"] == "owner_transfer":
            score, why = 0.90, "Both sides already look like owner transfers; link them as one transfer"
        else:
            score = 0.80 if r["b_src"] == "bank" or r["a_src"] == "bank" else 0.65
            why = (f"Matches owner transfer of the same amount in {r['a_src']} ({r['a_date']}); counting this "
                   f"{r['b_type']} line as well would double-count the same money")
        cid = insert_candidate(
            conn, key=f"owner_transfer|{r['b_id']}|{r['a_id']}", candidate_type="owner_transfer",
            method="transfer_pair", score=score, explanation=why, transaction_id=r["b_id"],
            related_transaction_id=r["a_id"], proposed_value="owner_transfer",
            evidence_ids=_evidence(conn, r["a_id"], r["b_id"]))
        created += bool(cid)
    return created


def find_owner_counterparties(conn: sqlite3.Connection) -> int:
    """Transactions imported before an owner account was registered."""
    rows = conn.execute(
        """SELECT t.id, o.label FROM transactions t JOIN owner_accounts o
             ON (o.identifier_type = t.counterparty_handle_type AND o.normalized_value = t.counterparty_handle)
             OR (o.identifier_type = 'name' AND o.normalized_value = t.counterparty_name_norm)
           WHERE t.txn_type <> 'owner_transfer' AND t.duplicate_of_id IS NULL""").fetchall()
    created = 0
    for r in rows:
        cid = insert_candidate(
            conn, key=f"owner_transfer|{r['id']}|owner", candidate_type="owner_transfer", method="owner_account",
            score=0.85, explanation=f"Counterparty matches owner account '{r['label']}'", transaction_id=r["id"],
            proposed_value="owner_transfer", evidence_ids=_evidence(conn, r["id"]))
        created += bool(cid)
    return created


def find_refunds(conn: sqlite3.Connection, window_days: int = 90) -> int:
    """Outgoing payments to someone who previously paid us -> possible refund."""
    rows = conn.execute(
        """SELECT o.id AS out_id, p.id AS pay_id, p.client_id, o.gross_amount_cents AS out_cents,
                  p.gross_amount_cents AS pay_cents, p.transaction_date AS pay_date, o.transaction_date AS out_date,
                  (o.counterparty_handle <> '' AND o.counterparty_handle = p.counterparty_handle) AS handle_match
           FROM transactions o JOIN transactions p
             ON p.direction = 'in' AND p.txn_type = 'payment_received' AND p.duplicate_of_id IS NULL
            AND o.gross_amount_cents <= p.gross_amount_cents
            AND julianday(o.transaction_date) - julianday(p.transaction_date) BETWEEN 0 AND ?
            AND ((o.counterparty_handle <> '' AND o.counterparty_handle = p.counterparty_handle)
                 OR (o.counterparty_name_norm <> '' AND o.counterparty_name_norm = p.counterparty_name_norm))
           WHERE o.direction = 'out' AND o.txn_type = 'unknown' AND o.duplicate_of_id IS NULL""",
        (window_days,)).fetchall()
    created = 0
    for r in rows:
        score = 0.70 if r["handle_match"] else 0.55
        if r["out_cents"] == r["pay_cents"]:
            score += 0.05
        cid = insert_candidate(
            conn, key=f"txn_classification|{r['out_id']}|refund|{r['pay_id']}", candidate_type="txn_classification",
            method="refund_to_prior_payer", score=score,
            explanation=(f"Outgoing payment on {r['out_date']} goes to the same "
                         f"{'handle' if r['handle_match'] else 'name'} that paid us on {r['pay_date']}; "
                         "possibly a refund (could also be unrelated)"),
            transaction_id=r["out_id"], related_transaction_id=r["pay_id"], proposed_client_id=r["client_id"],
            proposed_value="refund", evidence_ids=_evidence(conn, r["out_id"], r["pay_id"]))
        created += bool(cid)
    return created
