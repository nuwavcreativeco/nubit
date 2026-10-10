"""Append-only audit log helpers.

Every user-visible change goes through ``record`` with before/after snapshots.
A *group* bundles the rows written by one action so it can be undone as a unit.
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from .connection import new_id


def snapshot(conn: sqlite3.Connection, table: str, row_id: str) -> dict[str, Any] | None:
    _check_table(table)
    row = conn.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()
    return dict(row) if row else None


_AUDITED_TABLES = {
    "transactions", "clients", "client_identifiers", "projects", "transaction_allocations",
    "match_candidates", "service_catalog", "owner_accounts", "client_merges", "conversations",
    "expense_coverage", "app_settings", "import_jobs",
}


def _check_table(table: str) -> None:
    if table not in _AUDITED_TABLES:
        raise ValueError(f"table not auditable: {table}")


def record(
    conn: sqlite3.Connection,
    *,
    actor: str,
    action: str,
    entity_type: str,
    entity_id: str,
    before: dict | None = None,
    after: dict | None = None,
    reason: str = "",
    group_id: str | None = None,
    reverts_group_id: str | None = None,
) -> str:
    group_id = group_id or new_id("grp_")
    conn.execute(
        """INSERT INTO audit_log(actor, action, entity_type, entity_id, before_json, after_json,
                                 reason, group_id, reverts_group_id)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (
            actor, action, entity_type, entity_id,
            json.dumps(before, default=str, sort_keys=True) if before is not None else None,
            json.dumps(after, default=str, sort_keys=True) if after is not None else None,
            reason, group_id, reverts_group_id,
        ),
    )
    return group_id


def update_with_audit(
    conn: sqlite3.Connection,
    table: str,
    row_id: str,
    changes: dict[str, Any],
    *,
    actor: str,
    action: str,
    reason: str = "",
    group_id: str | None = None,
) -> str:
    """Apply column changes to one row and audit them (columns are whitelisted by name)."""
    _check_table(table)
    before = snapshot(conn, table, row_id)
    if before is None:
        raise KeyError(f"{table} {row_id} not found")
    for col in changes:
        if col not in before:
            raise ValueError(f"unknown column {col} on {table}")
    sets = ", ".join(f"{c} = ?" for c in changes)
    params = list(changes.values())
    if "updated_at" in before and "updated_at" not in changes:
        sets += ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    conn.execute(f"UPDATE {table} SET {sets} WHERE id = ?", (*params, row_id))
    after = snapshot(conn, table, row_id)
    return record(
        conn, actor=actor, action=action, entity_type=table, entity_id=row_id,
        before={k: before[k] for k in changes}, after={k: after[k] for k in changes},
        reason=reason, group_id=group_id,
    )


def insert_with_audit(
    conn: sqlite3.Connection,
    table: str,
    values: dict[str, Any],
    *,
    actor: str,
    action: str,
    reason: str = "",
    group_id: str | None = None,
) -> str:
    _check_table(table)
    cols = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(values.values()))
    row_id = values.get("id") or values.get("month") or values.get("key")
    return record(
        conn, actor=actor, action=action, entity_type=table, entity_id=str(row_id),
        before=None, after=values, reason=reason, group_id=group_id,
    )


def revert_group(conn: sqlite3.Connection, group_id: str, *, actor: str, reason: str) -> str:
    """Undo every field change / insert recorded under *group_id*, newest first.

    Updates are reverted by restoring the 'before' values; inserts of
    allocations are reversed by status, other inserts by deletion where the
    schema allows. Returns the new group id of the revert.
    """
    rows = conn.execute(
        "SELECT * FROM audit_log WHERE group_id = ? ORDER BY id DESC", (group_id,)
    ).fetchall()
    if not rows:
        raise KeyError(f"no audit entries for group {group_id}")
    already = conn.execute(
        "SELECT 1 FROM audit_log WHERE reverts_group_id = ? LIMIT 1", (group_id,)
    ).fetchone()
    if already:
        raise ValueError("this action has already been undone")
    revert_gid = new_id("grp_")
    for row in rows:
        table = row["entity_type"]
        _check_table(table)
        before = json.loads(row["before_json"]) if row["before_json"] else None
        after = json.loads(row["after_json"]) if row["after_json"] else None
        key_col = "month" if table == "expense_coverage" else ("key" if table == "app_settings" else "id")
        if before is not None:  # field update -> restore
            current = conn.execute(
                f"SELECT * FROM {table} WHERE {key_col} = ?", (row["entity_id"],)
            ).fetchone()
            if current is None:
                continue
            sets = ", ".join(f"{c} = ?" for c in before)
            conn.execute(
                f"UPDATE {table} SET {sets} WHERE {key_col} = ?",
                (*before.values(), row["entity_id"]),
            )
            record(conn, actor=actor, action=f"undo:{row['action']}", entity_type=table,
                   entity_id=row["entity_id"], before={c: current[c] for c in before},
                   after=before, reason=reason, group_id=revert_gid, reverts_group_id=group_id)
        elif after is not None:  # insert -> reverse
            if table == "transaction_allocations":
                conn.execute("UPDATE transaction_allocations SET status = 'reversed' WHERE id = ?",
                             (row["entity_id"],))
                record(conn, actor=actor, action=f"undo:{row['action']}", entity_type=table,
                       entity_id=row["entity_id"], before={"status": "active"},
                       after={"status": "reversed"}, reason=reason, group_id=revert_gid,
                       reverts_group_id=group_id)
            elif table in {"client_identifiers", "owner_accounts", "expense_coverage", "projects", "clients"}:
                current = conn.execute(
                    f"SELECT * FROM {table} WHERE {key_col} = ?", (row["entity_id"],)
                ).fetchone()
                if current is None:
                    continue
                conn.execute(f"DELETE FROM {table} WHERE {key_col} = ?", (row["entity_id"],))
                record(conn, actor=actor, action=f"undo:{row['action']}", entity_type=table,
                       entity_id=row["entity_id"], before=dict(current), after=None,
                       reason=reason, group_id=revert_gid, reverts_group_id=group_id)
    return revert_gid
