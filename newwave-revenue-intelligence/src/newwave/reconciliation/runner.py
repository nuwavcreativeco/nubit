"""Run all deterministic checks and record a reconciliation run."""
from __future__ import annotations

import json
import sqlite3

from ..database.connection import new_id, transaction, utcnow
from ..matching.engine import (
    propose_client_matches, propose_client_merges, propose_project_allocations, propose_service_classifications,
)
from . import checks


def run_reconciliation(conn: sqlite3.Connection) -> dict:
    run_id = new_id("rec_")
    with transaction(conn):
        conn.execute("INSERT INTO reconciliation_runs(id) VALUES (?)", (run_id,))
    stats: dict[str, int] = {}
    try:
        with transaction(conn):
            stats["owner_counterparties"] = checks.find_owner_counterparties(conn)
            stats["transfer_pairs"] = checks.find_transfer_pairs(conn)
            stats["cross_source_duplicates"] = checks.find_cross_source_duplicates(conn)
            stats["refund_candidates"] = checks.find_refunds(conn)
            stats["client_matches"] = propose_client_matches(conn)
            stats["project_allocations"] = propose_project_allocations(conn)
            stats["client_merges"] = propose_client_merges(conn)
            stats["service_suggestions"] = propose_service_classifications(conn)
        status = "completed"
    except Exception:
        status = "failed"
        raise
    finally:
        with transaction(conn):
            conn.execute("UPDATE reconciliation_runs SET status=?, finished_at=?, stats_json=? WHERE id=?",
                         (status, utcnow(), json.dumps(stats), run_id))
    stats["run_id"] = run_id  # type: ignore[assignment]
    return stats
