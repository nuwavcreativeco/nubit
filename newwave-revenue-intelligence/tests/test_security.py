import os
import stat
import subprocess

import pytest

from newwave.security.paths import UnsafePathError, ensure_within, safe_filename
from newwave.security.sanitize import clean_text, csv_safe, escape_html
from newwave.workspace import WorkspaceError, init_workspace, require_workspace, workspace_kind


def test_path_traversal_blocked(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    assert ensure_within(root, "a/b.csv") == (root / "a/b.csv").resolve()
    for bad in ("../x", "/etc/passwd", "a/../../x"):
        with pytest.raises(UnsafePathError):
            ensure_within(root, bad)


def test_safe_filename():
    assert safe_filename("../../etc/passwd") == "passwd"
    assert safe_filename("..\\..\\win.ini") == "win.ini"
    assert safe_filename("my file;rm -rf.csv") == "my file_rm -rf.csv"
    assert safe_filename("") == "upload"


def test_sanitisers():
    assert clean_text("a\x00b‮c") == "abc"
    assert len(clean_text("x" * 10000)) == 4000
    assert escape_html("<script>") == "&lt;script&gt;"
    assert csv_safe("=1+1") == "'=1+1" and csv_safe("@SUM(A1)") == "'@SUM(A1)"
    assert csv_safe("-12.50") == "-12.50" and csv_safe(5) == 5


def test_workspace_is_private_and_typed(tmp_path):
    ws = init_workspace(tmp_path / "w", kind="test")
    assert workspace_kind(ws) == "test" and require_workspace(ws) == "test"
    mode = stat.S_IMODE(os.stat(ws).st_mode)
    assert mode == 0o700
    db = ws / "database" / "newwave.sqlite3"
    assert stat.S_IMODE(os.stat(db).st_mode) & 0o077 == 0
    with pytest.raises(WorkspaceError, match="already a 'test'"):
        init_workspace(ws, kind="production", allow_inside_git=True)
    with pytest.raises(WorkspaceError, match="No initialised workspace"):
        require_workspace(tmp_path / "nothing")


def test_production_workspace_refused_inside_git_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    with pytest.raises(WorkspaceError, match="not git-ignored"):
        init_workspace(repo / "data", kind="production")
    (repo / ".gitignore").write_text("data/\n")
    init_workspace(repo / "data", kind="production")  # ignored folder is accepted


def test_nonempty_folder_refused(tmp_path):
    d = tmp_path / "busy"
    d.mkdir()
    (d / "file.txt").write_text("x")
    with pytest.raises(WorkspaceError, match="not empty"):
        init_workspace(d, kind="test")


def test_streamlit_config_binds_localhost_without_telemetry():
    from pathlib import Path
    cfg = (Path(__file__).resolve().parents[1] / ".streamlit" / "config.toml").read_text()
    assert 'address = "127.0.0.1"' in cfg and "gatherUsageStats = false" in cfg


def test_backup_and_restore(conn, settings):
    from newwave import backup
    from newwave.records import create_client
    create_client(conn, "Before Backup")
    b = backup.backup(settings)
    assert stat.S_IMODE(os.stat(b).st_mode) & 0o077 == 0
    create_client(conn, "After Backup")
    conn.close()
    msg = backup.restore(settings, b)
    assert "Restored" in msg
    from newwave.database.connection import open_database
    c2 = open_database(settings.database_path)
    names = {r[0] for r in c2.execute("SELECT display_name FROM clients")}
    assert names == {"Before Backup"}
    assert len(list(settings.backups_dir.iterdir())) == 2  # original backup + safety copy
