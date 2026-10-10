"""Human review of candidates: approve / reject / defer / undo.

Approval applies the candidate's effect and marks it approved in ONE audit
group, so undo restores exactly the prior state. AI-created candidates follow
the same path — nothing is ever approved automatically.
"""
from __future__ import annotations

import sqlite3

from ..database import audit
from ..database.connection import new_id, transaction, utcnow
from ..matching.engine import project_outstanding_cents
from ..records import RecordError, add_identifier, allocate, merge_clients, undo_merge
from ..security.sanitize import clean_text


def _candidate(conn: sqlite3.Connection, candidate_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM match_candidates WHERE id = ?", (candidate_id,)).fetchone()
    if row is None:
        raise RecordError("candidate not found")
    return row


def _mark(conn, cand, status, note, actor, gid) -> None:
    audit.update_with_audit(conn, "match_candidates", cand["id"],
                            {"review_status": status, "reviewed_at": utcnow(), "reviewer_note": clean_text(note, 500)},
                            actor=actor, action=f"{status}_candidate", group_id=gid)


def approve(conn: sqlite3.Connection, candidate_id: str, *, actor: str = "user", note: str = "",
            verify_identifier: bool = False, amount_cents: int | None = None, confirm_merge: bool = False) -> str:
    gid = new_id("grp_")
    with transaction(conn):
        c = _candidate(conn, candidate_id)
        if c["review_status"] not in ("pending", "deferred"):
            raise RecordError(f"candidate is already {c['review_status']}")
        ctype = c["candidate_type"]
        txn = conn.execute("SELECT * FROM transactions WHERE id = ?", (c["transaction_id"],)).fetchone() \
            if c["transaction_id"] else None

        if ctype == "txn_client":
            if txn["client_id"] and txn["client_id"] != c["proposed_client_id"]:
                raise RecordError("transaction is already linked to another client; undo that first")
            changes = {"client_id": c["proposed_client_id"]}
            if txn["txn_type"] in ("payment_received", "refund", "reversal") and txn["source_status"] == "completed":
                changes["verification_status"] = "verified"
            audit.update_with_audit(conn, "transactions", txn["id"], changes, actor=actor,
                                    action="approve_client_link", group_id=gid)
            if verify_identifier and txn["counterparty_handle"]:
                add_identifier(conn, c["proposed_client_id"], txn["counterparty_handle_type"],
                               txn["counterparty_handle"], verified=True, actor=actor, group_id=gid)
            for other in conn.execute(
                """SELECT * FROM match_candidates WHERE transaction_id = ? AND candidate_type = 'txn_client'
                   AND id <> ? AND review_status IN ('pending','deferred')""", (txn["id"], c["id"])).fetchall():
                _mark(conn, other, "superseded", "another client was approved", actor, gid)

        elif ctype == "txn_project":
            amount = amount_cents or c["proposed_amount_cents"]
            outstanding = project_outstanding_cents(conn, c["proposed_project_id"])
            if outstanding is not None and amount > outstanding:
                raise RecordError(f"allocation of {amount} cents exceeds the project's remaining balance "
                                  f"({max(outstanding, 0)} cents); adjust the amount or the project value")
            if txn["client_id"] is None:
                prj = conn.execute("SELECT client_id FROM projects WHERE id = ?", (c["proposed_project_id"],)).fetchone()
                audit.update_with_audit(conn, "transactions", txn["id"], {"client_id": prj["client_id"]},
                                        actor=actor, action="approve_client_link", group_id=gid)
            allocate(conn, txn["id"], c["proposed_project_id"], int(amount), actor=actor, group_id=gid,
                     allocation_type="installment" if amount < txn["net_amount_cents"] else "full_payment")

        elif ctype == "duplicate_txn":
            audit.update_with_audit(conn, "transactions", txn["id"],
                                    {"duplicate_of_id": c["related_transaction_id"], "verification_status": "excluded"},
                                    actor=actor, action="mark_duplicate", group_id=gid)

        elif ctype == "owner_transfer":
            audit.update_with_audit(conn, "transactions", txn["id"],
                                    {"txn_type": "owner_transfer", "classification_source": "reconciliation",
                                     "transfer_pair_id": c["related_transaction_id"]},
                                    actor=actor, action="mark_owner_transfer", group_id=gid)
            if c["related_transaction_id"]:
                audit.update_with_audit(conn, "transactions", c["related_transaction_id"],
                                        {"transfer_pair_id": txn["id"]}, actor=actor,
                                        action="mark_owner_transfer", group_id=gid)

        elif ctype == "txn_classification":
            changes = {"txn_type": c["proposed_value"],
                       "classification_source": "ai_approved" if c["created_by"] == "ai" else "reconciliation"}
            client_id = c["proposed_client_id"]
            if not client_id and c["related_transaction_id"]:
                client_id = conn.execute("SELECT client_id FROM transactions WHERE id = ?",
                                         (c["related_transaction_id"],)).fetchone()[0]
            if client_id and not txn["client_id"]:
                changes["client_id"] = client_id
            if txn["source_status"] == "completed" and c["proposed_value"] in ("refund", "reversal", "payment_received"):
                changes["verification_status"] = "verified"
            audit.update_with_audit(conn, "transactions", txn["id"], changes, actor=actor,
                                    action="approve_classification", group_id=gid)

        elif ctype == "service_classification":
            svc = conn.execute("SELECT id FROM service_catalog WHERE code = ?", (c["proposed_value"],)).fetchone()
            if svc is None:
                raise RecordError("unknown service code")
            if c["proposed_project_id"]:
                audit.update_with_audit(conn, "projects", c["proposed_project_id"], {"service_id": svc["id"]},
                                        actor=actor, action="approve_service", group_id=gid)
            else:
                audit.update_with_audit(conn, "transactions", txn["id"], {"service_id": svc["id"]},
                                        actor=actor, action="approve_service", group_id=gid)

        elif ctype == "client_merge":
            if not confirm_merge:
                raise RecordError("merging clients requires explicit confirmation")
            merge_clients(conn, c["related_client_id"], c["proposed_client_id"], confirm=True, actor=actor,
                          reason=f"approved candidate {c['id']}", group_id=gid)
        else:  # pragma: no cover
            raise RecordError(f"unsupported candidate type {ctype}")

        _mark(conn, c, "approved", note, actor, gid)
    return gid


def reject(conn: sqlite3.Connection, candidate_id: str, *, actor: str = "user", note: str = "") -> str:
    with transaction(conn):
        c = _candidate(conn, candidate_id)
        if c["review_status"] not in ("pending", "deferred"):
            raise RecordError(f"candidate is already {c['review_status']}")
        gid = new_id("grp_")
        _mark(conn, c, "rejected", note, actor, gid)
    return gid


def defer(conn: sqlite3.Connection, candidate_id: str, *, actor: str = "user", note: str = "") -> str:
    with transaction(conn):
        c = _candidate(conn, candidate_id)
        if c["review_status"] != "pending":
            raise RecordError(f"candidate is already {c['review_status']}")
        gid = new_id("grp_")
        _mark(conn, c, "deferred", note, actor, gid)
    return gid


def undo_review(conn: sqlite3.Connection, candidate_id: str, *, confirm: bool, actor: str = "user",
                reason: str = "") -> str:
    """Revert the most recent decision on a candidate and everything it changed."""
    if not confirm:
        raise RecordError("undo requires explicit confirmation")
    with transaction(conn):
        c = _candidate(conn, candidate_id)
        row = conn.execute(
            """SELECT group_id FROM audit_log WHERE entity_type = 'match_candidates' AND entity_id = ?
               AND action IN ('approved_candidate','rejected_candidate','deferred_candidate')
               AND group_id NOT IN (SELECT reverts_group_id FROM audit_log WHERE reverts_group_id IS NOT NULL)
               ORDER BY id DESC LIMIT 1""", (candidate_id,)).fetchone()
        if row is None:
            raise RecordError("no decision to undo")
        if c["candidate_type"] == "client_merge" and c["review_status"] == "approved":
            merge = conn.execute(
                """SELECT id FROM client_merges WHERE source_client_id = ? AND target_client_id = ? AND status='active'
                   ORDER BY created_at DESC LIMIT 1""", (c["related_client_id"], c["proposed_client_id"])).fetchone()
            if merge:
                undo_merge(conn, merge["id"], confirm=True, actor=actor)
            # restore the candidate status only
            return audit.update_with_audit(conn, "match_candidates", candidate_id,
                                           {"review_status": "pending", "reviewed_at": None}, actor=actor,
                                           action="undo_review", reason=reason)
        return audit.revert_group(conn, row["group_id"], actor=actor, reason=reason)
