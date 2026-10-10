"""SQLite connection handling and the migration runner."""
from __future__ import annotations

import hashlib
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from importlib import resources
from pathlib import Path
from typing import Iterator

from ..security.permissions import make_private_dir, make_private_file

MIGRATIONS_PACKAGE = "newwave.database.migrations"


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex}"


def utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def connect(db_path: str | Path) -> sqlite3.Connection:
    """Open the database with safe defaults (FKs on, WAL, row factory)."""
    db_path = Path(db_path)
    if str(db_path) != ":memory:":
        make_private_dir(db_path.parent)
    conn = sqlite3.connect(str(db_path), detect_types=0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    if str(db_path) != ":memory:":
        conn.execute("PRAGMA journal_mode = WAL")
        make_private_file(db_path)
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Explicit BEGIN/COMMIT; rolls back on any exception. Nested calls use savepoints."""
    if conn.in_transaction:
        sp = f"sp_{uuid.uuid4().hex[:8]}"
        conn.execute(f"SAVEPOINT {sp}")
        try:
            yield conn
        except BaseException:
            conn.execute(f"ROLLBACK TO {sp}")
            conn.execute(f"RELEASE {sp}")
            raise
        conn.execute(f"RELEASE {sp}")
        return
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def _migration_files() -> list[tuple[int, str, str]]:
    out = []
    for entry in resources.files(MIGRATIONS_PACKAGE).iterdir():
        name = entry.name
        if name.endswith(".sql") and name[:4].isdigit():
            out.append((int(name[:4]), name, entry.read_text(encoding="utf-8")))
    return sorted(out)


def migrate(conn: sqlite3.Connection) -> list[str]:
    """Apply pending migrations in order. Verifies checksums of applied ones."""
    conn.execute(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
               version INTEGER PRIMARY KEY,
               name TEXT NOT NULL,
               checksum TEXT NOT NULL,
               applied_at TEXT NOT NULL)"""
    )
    applied = {
        r["version"]: r["checksum"]
        for r in conn.execute("SELECT version, checksum FROM schema_migrations")
    }
    done = []
    for version, name, sql in _migration_files():
        checksum = hashlib.sha256(sql.encode()).hexdigest()
        if version in applied:
            if applied[version] != checksum:
                raise RuntimeError(
                    f"migration {name} changed after being applied; create a new migration instead"
                )
            continue
        conn.execute("BEGIN IMMEDIATE")
        try:
            # executescript would COMMIT implicitly; run statements one by one instead.
            for stmt in _split_sql(sql):
                conn.execute(stmt)
            conn.execute(
                "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?,?,?,?)",
                (version, name, checksum, utcnow()),
            )
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        done.append(name)
    return done


def _split_sql(sql: str) -> list[str]:
    """Split a migration into statements, keeping trigger bodies intact."""
    statements, buf = [], []
    for line in sql.splitlines():
        stripped = line.strip()
        if stripped.startswith("--") and not buf:
            continue
        buf.append(line)
        chunk = "\n".join(buf)
        if sqlite3.complete_statement(chunk):
            if chunk.strip():
                statements.append(chunk)
            buf = []
    if "\n".join(buf).strip():
        raise RuntimeError("incomplete SQL statement at end of migration")
    return statements


def schema_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT MAX(version) AS v FROM schema_migrations").fetchone()
    return int(row["v"] or 0)


def open_database(db_path: str | Path) -> sqlite3.Connection:
    """Connect, migrate and seed reference data. The usual entry point."""
    conn = connect(db_path)
    migrate(conn)
    from ..catalog import seed_service_catalog

    seed_service_catalog(conn)
    return conn
