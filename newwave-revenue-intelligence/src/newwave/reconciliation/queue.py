"""Read-side queries for the reconciliation center."""
from __future__ import annotations

import sqlite3

import pandas as pd

QUEUES = {
    "ambiguous_client": "Client match suggestions",
    "unmatched": "Unmatched payments (no client)",
    "duplicates": "Potential duplicate transactions",
    "transfers": "Possible owner transfers",
    "classification": "Refund / classification suggestions",
    "unknown": "Unknown transactions & counterparties",
    "deposits": "Bank deposits not reconciled",
    "services": "Service suggestions",
    "unclassified_service": "Verified payments without a service",
    "merges": "Possible duplicate clients",
    "ai": "AI suggestions awaiting review",
    "data_quality": "Missing dates / currency mismatches",
}

CANDIDATE_TYPES = {
    "ambiguous_client": ("txn_client", "txn_project"),
    "duplicates": ("duplicate_txn",),
    "transfers": ("owner_transfer",),
    "classification": ("txn_classification",),
    "merges": ("client_merge",),
    "services": ("service_classification",),
}


def candidates(conn: sqlite3.Connection, queue: str, include_deferred: bool = True) -> pd.DataFrame:
    statuses = ["pending", "deferred"] if include_deferred else ["pending"]
    params: list = list(statuses)
    sql = f"""SELECT mc.*, t.transaction_date, t.gross_amount_cents, t.direction, t.counterparty_raw,
                    t.payment_method, t.source_type, t.memo, t.txn_type,
                    c.display_name AS proposed_client, rc.display_name AS related_client,
                    p.title AS proposed_project
             FROM match_candidates mc
             LEFT JOIN transactions t ON t.id = mc.transaction_id
             LEFT JOIN clients c ON c.id = mc.proposed_client_id
             LEFT JOIN clients rc ON rc.id = mc.related_client_id
             LEFT JOIN projects p ON p.id = mc.proposed_project_id
             WHERE mc.review_status IN ({','.join('?' for _ in statuses)})"""
    if queue == "ai":
        sql += " AND mc.created_by = 'ai'"
    else:
        types = CANDIDATE_TYPES[queue]
        sql += f" AND mc.created_by <> 'ai' AND mc.candidate_type IN ({','.join('?' for _ in types)})"
        params += list(types)
    sql += " ORDER BY mc.confidence_score DESC, t.transaction_date"
    return pd.read_sql_query(sql, conn, params=params)


def transactions_queue(conn: sqlite3.Connection, queue: str, limit: int = 500) -> pd.DataFrame:
    base = """SELECT t.id, t.transaction_date, t.direction, t.txn_type, t.payment_method, t.source_type,
                     t.gross_amount_cents, t.currency, t.counterparty_raw, t.counterparty_handle,
                     t.counterparty_handle_type, t.memo, t.verification_status, t.classification_reason,
                     t.source_status
              FROM transactions t WHERE t.duplicate_of_id IS NULL AND t.verification_status <> 'excluded' """
    where = {
        "unmatched": """AND t.client_id IS NULL AND t.txn_type IN ('payment_received','refund','reversal')
                        AND NOT EXISTS (SELECT 1 FROM match_candidates mc WHERE mc.transaction_id = t.id
                                        AND mc.candidate_type = 'txn_client' AND mc.review_status IN ('pending','deferred'))""",
        "unknown": "AND t.txn_type = 'unknown' AND t.classification_source = 'importer_rule'",
        "deposits": """AND t.source_type = 'bank' AND t.direction = 'in' AND t.txn_type = 'unknown'
                       AND t.classification_source = 'importer_rule'""",
        "unclassified_service": """AND t.txn_type = 'payment_received' AND t.verification_status = 'verified'
                                   AND t.service_id IS NULL AND NOT EXISTS (
                                     SELECT 1 FROM transaction_allocations a JOIN projects p ON p.id = a.project_id
                                     WHERE a.transaction_id = t.id AND a.status = 'active' AND p.service_id IS NOT NULL)""",
        "data_quality": "AND (t.transaction_date IS NULL OR t.verification_status = 'needs_review')",
    }[queue]
    return pd.read_sql_query(base + where + " ORDER BY t.transaction_date DESC LIMIT ?", conn, params=(limit,))


def queue_counts(conn: sqlite3.Connection) -> dict[str, int]:
    out = {}
    for q in QUEUES:
        if q in CANDIDATE_TYPES or q == "ai":
            out[q] = len(candidates(conn, q))
        else:
            out[q] = len(transactions_queue(conn, q, limit=100000))
    return out


def candidate_evidence(conn: sqlite3.Connection, candidate_id: str) -> pd.DataFrame:
    return pd.read_sql_query(
        """SELECT e.id, e.evidence_type, e.source_filename, e.source_record_id, e.occurred_at, e.excerpt
           FROM match_candidate_evidence mce JOIN evidence e ON e.id = mce.evidence_id
           WHERE mce.match_candidate_id = ? ORDER BY e.occurred_at""", conn, params=(candidate_id,))


def decided_candidates(conn: sqlite3.Connection, limit: int = 200) -> pd.DataFrame:
    return pd.read_sql_query(
        """SELECT mc.id, mc.candidate_type, mc.review_status, mc.reviewed_at, mc.method, mc.confidence_band,
                  mc.explanation, mc.created_by, t.transaction_date, t.gross_amount_cents, t.counterparty_raw,
                  c.display_name AS proposed_client
           FROM match_candidates mc LEFT JOIN transactions t ON t.id = mc.transaction_id
           LEFT JOIN clients c ON c.id = mc.proposed_client_id
           WHERE mc.review_status IN ('approved','rejected','deferred','superseded')
           ORDER BY mc.reviewed_at DESC LIMIT ?""", conn, params=(limit,))
