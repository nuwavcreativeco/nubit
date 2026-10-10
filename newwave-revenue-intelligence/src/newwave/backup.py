"""Consistent online backups and safe restore of the SQLite database."""
from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

from .config import Settings
from .database.connection import connect, migrate, schema_version
from .security.permissions import make_private_dir, make_private_file


def backup(settings: Settings) -> Path:
    make_private_dir(settings.backups_dir)
    target = settings.backups_dir / f"newwave-{datetime.now().strftime('%Y%m%d-%H%M%S')}.sqlite3"
    n = 1
    while target.exists():
        target = target.with_name(f"{target.stem}-{n}.sqlite3")
        n += 1
    src = sqlite3.connect(str(settings.database_path))
    dst = sqlite3.connect(str(target))
    try:
        src.backup(dst)  # consistent even while the app is running
        dst.execute("PRAGMA journal_mode = DELETE")  # self-contained single-file backup
    finally:
        src.close()
        dst.close()
    make_private_file(target)
    verify(target)
    return target


def verify(path: Path) -> int:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError(f"integrity check failed for {path}")
        return conn.execute("SELECT MAX(version) FROM schema_migrations").fetchone()[0]
    finally:
        conn.close()


def restore(settings: Settings, backup_file: Path) -> str:
    """Replace the live DB with a verified backup. The current DB is kept as a safety copy."""
    backup_file = Path(backup_file).expanduser().resolve()
    verify(backup_file)
    live = settings.database_path
    safety = None
    if live.exists():
        safety = backup(settings)
    for suffix in ("-wal", "-shm"):
        side = Path(str(live) + suffix)
        if side.exists():
            side.unlink()  # belongs to the DB being replaced (already captured in the safety backup)
    shutil.copy2(backup_file, live)
    make_private_file(live)
    conn = connect(live)
    migrate(conn)
    v = schema_version(conn)
    conn.close()
    return f"Restored {backup_file.name} (schema v{v}). Previous database saved as {safety}."
