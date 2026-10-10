import sqlite3

import pytest

from newwave.database import audit
from newwave.database.connection import connect, migrate, new_id, open_database, schema_version

EXPECTED_TABLES = {
    "clients", "client_identifiers", "transactions", "projects", "transaction_allocations", "conversations",
    "conversation_messages", "service_catalog", "evidence", "match_candidates", "import_jobs",
    "reconciliation_runs", "audit_log", "schema_migrations", "owner_accounts", "client_merges", "ai_requests",
    "service_signals", "expense_coverage", "app_settings", "match_candidate_evidence",
}


def test_migrations_create_schema(conn):
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert EXPECTED_TABLES <= tables
    assert schema_version(conn) >= 1
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    assert conn.execute("SELECT COUNT(*) FROM service_catalog").fetchone()[0] >= 12


def test_migrate_is_idempotent(tmp_path):
    db = tmp_path / "x.sqlite3"
    c = open_database(db)
    assert migrate(c) == []
    c.close()
    c2 = open_database(db)
    assert schema_version(c2) >= 1


def test_changed_migration_is_detected(tmp_path):
    c = connect(tmp_path / "y.sqlite3")
    migrate(c)
    c.execute("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1")
    with pytest.raises(RuntimeError, match="changed after being applied"):
        migrate(c)


def _insert_txn(conn, **over):
    tid = new_id("txn_")
    vals = dict(id=tid, source_type="manual", dedupe_key=new_id(), direction="in", source_amount_text="10.00",
                gross_amount_cents=1000, net_amount_cents=1000, raw_json="{}")
    vals.update(over)
    conn.execute(f"INSERT INTO transactions ({','.join(vals)}) VALUES ({','.join('?' for _ in vals)})",
                 tuple(vals.values()))
    return tid


def test_source_fields_are_immutable(conn):
    tid = _insert_txn(conn)
    with pytest.raises(sqlite3.DatabaseError, match="immutable"):
        conn.execute("UPDATE transactions SET gross_amount_cents = 5 WHERE id = ?", (tid,))
    with pytest.raises(sqlite3.DatabaseError, match="immutable"):
        conn.execute("UPDATE transactions SET raw_json = '{\"x\":1}' WHERE id = ?", (tid,))
    conn.execute("UPDATE transactions SET txn_type = 'payment_received' WHERE id = ?", (tid,))  # allowed
    with pytest.raises(sqlite3.DatabaseError, match="cannot be deleted"):
        conn.execute("DELETE FROM transactions WHERE id = ?", (tid,))


def test_net_amount_constraint(conn):
    with pytest.raises(sqlite3.IntegrityError):
        _insert_txn(conn, gross_amount_cents=1000, fee_amount_cents=100, net_amount_cents=1000)
    _insert_txn(conn, gross_amount_cents=1000, fee_amount_cents=100, net_amount_cents=900)
    with pytest.raises(sqlite3.IntegrityError):
        _insert_txn(conn, gross_amount_cents=-5, net_amount_cents=-5)


def test_audit_log_is_append_only(conn):
    audit.record(conn, actor="test", action="x", entity_type="clients", entity_id="c1")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        conn.execute("UPDATE audit_log SET actor = 'evil'")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        conn.execute("DELETE FROM audit_log")


def test_verified_identifier_unique_across_clients(conn):
    for cid in ("c1", "c2"):
        conn.execute("INSERT INTO clients(id, display_name) VALUES (?, ?)", (cid, cid))
    conn.execute("""INSERT INTO client_identifiers(id, client_id, identifier_type, raw_value, normalized_value,
                    verification_status) VALUES ('i1','c1','phone','x','+15550100000','verified')""")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("""INSERT INTO client_identifiers(id, client_id, identifier_type, raw_value, normalized_value,
                        verification_status) VALUES ('i2','c2','phone','x','+15550100000','verified')""")
    # unverified duplicates are allowed (they become merge candidates)
    conn.execute("""INSERT INTO client_identifiers(id, client_id, identifier_type, raw_value, normalized_value,
                    verification_status) VALUES ('i3','c2','phone','x','+15550100000','unverified')""")
