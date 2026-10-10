"""Clients, identifiers, projects, allocations and analyst corrections.

Every function writes audit rows inside a single DB transaction and returns
the audit *group id*, so any action can be undone from the audit trail.
"""
from __future__ import annotations

import json
import sqlite3

from .database import audit
from .database.connection import new_id, transaction, utcnow
from .ingestion.base import TXN_TYPES
from .normalization.identifiers import normalize_identifier
from .security.sanitize import clean_field, clean_text


class RecordError(ValueError):
    pass


# ----------------------------------------------------------------- clients

def create_client(conn: sqlite3.Connection, display_name: str, *, notes: str = "", is_demo: bool = False,
                  actor: str = "user", group_id: str | None = None) -> tuple[str, str]:
    name = clean_field(display_name)
    if not name:
        raise RecordError("client name is required")
    cid = new_id("cli_")
    with transaction(conn):
        gid = audit.insert_with_audit(conn, "clients", {"id": cid, "display_name": name,
                                                        "notes": clean_text(notes, 1000), "is_demo": int(is_demo)},
                                      actor=actor, action="create_client", group_id=group_id)
        from .normalization.identifiers import normalize_name
        if normalize_name(name):
            audit.insert_with_audit(conn, "client_identifiers", {
                "id": new_id("cid_"), "client_id": cid, "identifier_type": "name", "raw_value": name,
                "normalized_value": normalize_name(name), "verification_status": "unverified",
            }, actor=actor, action="add_identifier", group_id=gid)
    return cid, gid


def add_identifier(conn: sqlite3.Connection, client_id: str, identifier_type: str, raw_value: str, *,
                   verified: bool = False, actor: str = "user", group_id: str | None = None,
                   source_evidence_id: str | None = None) -> tuple[str, str]:
    norm = normalize_identifier(identifier_type, raw_value)
    if not norm:
        raise RecordError(f"'{raw_value}' is not a valid {identifier_type}")
    status = "verified" if verified else "unverified"
    with transaction(conn):
        existing = conn.execute(
            "SELECT id FROM client_identifiers WHERE client_id=? AND identifier_type=? AND normalized_value=?",
            (client_id, identifier_type, norm)).fetchone()
        if existing:
            if verified:
                gid = verify_identifier(conn, existing["id"], actor=actor, group_id=group_id)
                return existing["id"], gid
            return existing["id"], group_id or ""
        if verified and identifier_type not in ("name", "bank_name"):
            clash = conn.execute(
                """SELECT client_id FROM client_identifiers WHERE identifier_type=? AND normalized_value=?
                   AND verification_status='verified'""", (identifier_type, norm)).fetchone()
            if clash:
                raise RecordError(f"{identifier_type} '{norm}' is already verified for another client "
                                  f"({clash['client_id']}); review a merge instead")
        iid = new_id("cid_")
        gid = audit.insert_with_audit(conn, "client_identifiers", {
            "id": iid, "client_id": client_id, "identifier_type": identifier_type,
            "raw_value": clean_field(raw_value), "normalized_value": norm, "verification_status": status,
            "source_evidence_id": source_evidence_id,
        }, actor=actor, action="add_identifier", group_id=group_id)
    return iid, gid


def verify_identifier(conn: sqlite3.Connection, identifier_id: str, *, actor: str = "user",
                      group_id: str | None = None) -> str:
    with transaction(conn):
        row = conn.execute("SELECT * FROM client_identifiers WHERE id=?", (identifier_id,)).fetchone()
        if row is None:
            raise RecordError("identifier not found")
        if row["identifier_type"] not in ("name", "bank_name"):
            clash = conn.execute(
                """SELECT client_id FROM client_identifiers WHERE identifier_type=? AND normalized_value=?
                   AND verification_status='verified' AND id<>?""",
                (row["identifier_type"], row["normalized_value"], identifier_id)).fetchone()
            if clash:
                raise RecordError("already verified for another client; merge or correct first")
        return audit.update_with_audit(conn, "client_identifiers", identifier_id,
                                       {"verification_status": "verified"}, actor=actor,
                                       action="verify_identifier", group_id=group_id)


def active_client(conn: sqlite3.Connection, client_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM clients WHERE id=?", (client_id,)).fetchone()
    if row is None:
        raise RecordError("client not found")
    if row["status"] != "active":
        raise RecordError(f"client is {row['status']}")
    return row


# ----------------------------------------------------------------- merge / undo

def merge_clients(conn: sqlite3.Connection, source_id: str, target_id: str, *, confirm: bool,
                  actor: str = "user", reason: str = "", group_id: str | None = None) -> str:
    """Merge *source* into *target*. Requires explicit confirmation. Fully undoable."""
    if not confirm:
        raise RecordError("merge requires explicit confirmation")
    if source_id == target_id:
        raise RecordError("cannot merge a client into itself")
    with transaction(conn):
        active_client(conn, source_id)
        active_client(conn, target_id)
        gid = group_id or new_id("grp_")
        moved = {
            "transactions": [r["id"] for r in conn.execute("SELECT id FROM transactions WHERE client_id=?", (source_id,))],
            "projects": [r["id"] for r in conn.execute("SELECT id FROM projects WHERE client_id=?", (source_id,))],
            "conversations": [r["id"] for r in conn.execute("SELECT id FROM conversations WHERE client_id=?", (source_id,))],
            "identifiers": [],
            "identifiers_dropped": [],
        }
        for tbl in ("transactions", "projects", "conversations"):
            for rid in moved[tbl]:
                audit.update_with_audit(conn, tbl, rid, {"client_id": target_id}, actor=actor,
                                        action="merge_repoint", group_id=gid)
        for ident in conn.execute("SELECT * FROM client_identifiers WHERE client_id=?", (source_id,)).fetchall():
            dup = conn.execute(
                "SELECT id FROM client_identifiers WHERE client_id=? AND identifier_type=? AND normalized_value=?",
                (target_id, ident["identifier_type"], ident["normalized_value"])).fetchone()
            if dup:
                # target already has it: keep the source row on the merged client (history preserved)
                moved["identifiers_dropped"].append(ident["id"])
                continue
            audit.update_with_audit(conn, "client_identifiers", ident["id"], {"client_id": target_id},
                                    actor=actor, action="merge_repoint", group_id=gid)
            moved["identifiers"].append(ident["id"])
        audit.update_with_audit(conn, "clients", source_id, {"status": "merged", "merged_into_id": target_id},
                                actor=actor, action="merge_client", reason=reason, group_id=gid)
        merge_id = new_id("mrg_")
        audit.insert_with_audit(conn, "client_merges", {
            "id": merge_id, "source_client_id": source_id, "target_client_id": target_id,
            "moved_json": json.dumps({**moved, "audit_group": gid}),
        }, actor=actor, action="record_merge", group_id=gid)
    return gid


def undo_merge(conn: sqlite3.Connection, merge_id: str, *, confirm: bool, actor: str = "user") -> str:
    if not confirm:
        raise RecordError("undo requires explicit confirmation")
    with transaction(conn):
        m = conn.execute("SELECT * FROM client_merges WHERE id=?", (merge_id,)).fetchone()
        if m is None or m["status"] != "active":
            raise RecordError("merge not found or already undone")
        moved = json.loads(m["moved_json"])
        gid = new_id("grp_")
        for tbl in ("transactions", "projects", "conversations"):
            for rid in moved[tbl]:
                audit.update_with_audit(conn, tbl, rid, {"client_id": m["source_client_id"]}, actor=actor,
                                        action="undo_merge_repoint", group_id=gid)
        for iid in moved["identifiers"]:
            audit.update_with_audit(conn, "client_identifiers", iid, {"client_id": m["source_client_id"]},
                                    actor=actor, action="undo_merge_repoint", group_id=gid)
        audit.update_with_audit(conn, "clients", m["source_client_id"], {"status": "active", "merged_into_id": None},
                                actor=actor, action="undo_merge", group_id=gid)
        audit.update_with_audit(conn, "client_merges", merge_id, {"status": "undone", "undone_at": utcnow()},
                                actor=actor, action="undo_merge", group_id=gid)
    return gid


# ----------------------------------------------------------------- projects

def create_project(conn: sqlite3.Connection, client_id: str, title: str, *, service_id: str | None = None,
                   stage: str = "booked", project_value_cents: int | None = None,
                   quoted_amount_cents: int | None = None, booked_at: str | None = None,
                   is_demo: bool = False, actor: str = "user", group_id: str | None = None) -> tuple[str, str]:
    active_client(conn, client_id)
    if not clean_field(title):
        raise RecordError("project title is required")
    pid = new_id("prj_")
    with transaction(conn):
        gid = audit.insert_with_audit(conn, "projects", {
            "id": pid, "client_id": client_id, "title": clean_field(title), "service_id": service_id,
            "stage": stage, "project_value_cents": project_value_cents,
            "quoted_amount_cents": quoted_amount_cents, "booked_at": booked_at, "is_demo": int(is_demo),
        }, actor=actor, action="create_project", group_id=group_id)
    return pid, gid


def update_project(conn: sqlite3.Connection, project_id: str, changes: dict, *, actor: str = "user") -> str:
    allowed = {"title", "service_id", "stage", "project_value_cents", "quoted_amount_cents", "quoted_at",
               "booked_at", "delivered_at", "notes", "verification_status"}
    bad = set(changes) - allowed
    if bad:
        raise RecordError(f"cannot edit {sorted(bad)}")
    with transaction(conn):
        return audit.update_with_audit(conn, "projects", project_id, changes, actor=actor, action="update_project")


def allocate(conn: sqlite3.Connection, transaction_id: str, project_id: str, amount_cents: int, *,
             allocation_type: str = "full_payment", actor: str = "user", group_id: str | None = None,
             notes: str = "") -> tuple[str, str]:
    if amount_cents <= 0:
        raise RecordError("allocation must be positive")
    with transaction(conn):
        txn = conn.execute("SELECT * FROM transactions WHERE id=?", (transaction_id,)).fetchone()
        prj = conn.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
        if txn is None or prj is None:
            raise RecordError("transaction or project not found")
        if txn["txn_type"] not in ("payment_received", "refund", "reversal"):
            raise RecordError("only payments, refunds and reversals can be allocated to projects")
        if txn["client_id"] and txn["client_id"] != prj["client_id"]:
            raise RecordError("transaction belongs to a different client than the project")
        if txn["txn_type"] in ("refund", "reversal"):
            allocation_type = "refund"
        aid = new_id("alc_")
        try:
            gid = audit.insert_with_audit(conn, "transaction_allocations", {
                "id": aid, "transaction_id": transaction_id, "project_id": project_id,
                "amount_cents": int(amount_cents), "allocation_type": allocation_type, "notes": clean_text(notes, 300),
            }, actor=actor, action="allocate", group_id=group_id)
        except sqlite3.IntegrityError as exc:
            raise RecordError(str(exc)) from exc
    return aid, gid


def reverse_allocation(conn: sqlite3.Connection, allocation_id: str, *, actor: str = "user") -> str:
    with transaction(conn):
        return audit.update_with_audit(conn, "transaction_allocations", allocation_id, {"status": "reversed"},
                                       actor=actor, action="reverse_allocation")


# ----------------------------------------------------------------- transaction corrections

def set_transaction_fields(conn: sqlite3.Connection, transaction_id: str, changes: dict, *, actor: str = "user",
                           reason: str = "", group_id: str | None = None) -> str:
    """Analyst correction of classification fields only (source fields are immutable)."""
    allowed = {"txn_type", "verification_status", "client_id", "service_id", "duplicate_of_id",
               "transfer_pair_id", "classification_source", "classification_reason"}
    bad = set(changes) - allowed
    if bad:
        raise RecordError(f"cannot edit {sorted(bad)}; imported source fields are immutable")
    if "txn_type" in changes and changes["txn_type"] not in TXN_TYPES:
        raise RecordError("invalid transaction type")
    if "txn_type" in changes and "classification_source" not in changes:
        changes = {**changes, "classification_source": "user"}
    with transaction(conn):
        return audit.update_with_audit(conn, "transactions", transaction_id, changes, actor=actor,
                                       action="correct_transaction", reason=reason, group_id=group_id)


def bulk_set_transactions(conn: sqlite3.Connection, transaction_ids: list[str], changes: dict, *, confirm: bool,
                          actor: str = "user", reason: str = "") -> str:
    if not confirm:
        raise RecordError("bulk edits require explicit confirmation")
    gid = new_id("grp_")
    with transaction(conn):
        for tid in transaction_ids:
            set_transaction_fields(conn, tid, changes, actor=actor, reason=reason, group_id=gid)
    return gid


def add_owner_account(conn: sqlite3.Connection, label: str, identifier_type: str, value: str, *,
                      actor: str = "user") -> str:
    norm = normalize_identifier(identifier_type, value)
    if not norm:
        raise RecordError("invalid identifier")
    with transaction(conn):
        return audit.insert_with_audit(conn, "owner_accounts", {
            "id": new_id("own_"), "label": clean_field(label), "identifier_type": identifier_type,
            "normalized_value": norm}, actor=actor, action="add_owner_account")


def set_expense_coverage(conn: sqlite3.Connection, month: str, *, actor: str = "user", note: str = "") -> str:
    with transaction(conn):
        if conn.execute("SELECT 1 FROM expense_coverage WHERE month=?", (month,)).fetchone():
            return ""
        return audit.insert_with_audit(conn, "expense_coverage", {"month": month, "note": clean_text(note, 300)},
                                       actor=actor, action="confirm_expense_coverage")


def undo_action(conn: sqlite3.Connection, group_id: str, *, confirm: bool, actor: str = "user",
                reason: str = "") -> str:
    if not confirm:
        raise RecordError("undo requires explicit confirmation")
    with transaction(conn):
        return audit.revert_group(conn, group_id, actor=actor, reason=reason)
