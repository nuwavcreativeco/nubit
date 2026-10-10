"""Workspaces keep real data apart from code, demo data and tests.

A workspace must be initialised explicitly (``scripts/nwri.py init``). Its
kind is recorded in a marker file and checked on every start so the demo or
test workspace can never be confused with the real one.
"""
from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from .database.connection import open_database
from .security.permissions import make_private_dir, make_private_file, set_private_umask

MARKER = ".nwri-workspace.json"
KINDS = ("production", "demo", "test")
SUBDIRS = ("data/incoming", "database", "exports", "reports", "logs", "backups", "scratch", "config")


class WorkspaceError(RuntimeError):
    pass


def git_exposure(path: Path) -> str | None:
    """Return a warning if *path* is inside a git work tree and NOT ignored."""
    probe = path if path.exists() else path.parent
    while not probe.exists():
        probe = probe.parent
    try:
        top = subprocess.run(["git", "-C", str(probe), "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return None
    if top.returncode != 0:
        return None
    for candidate in (str(path), str(path) + "/"):
        ignored = subprocess.run(["git", "-C", top.stdout.strip(), "check-ignore", "-q", candidate],
                                 capture_output=True, timeout=10)
        if ignored.returncode == 0:
            return None
    return f"{path} is inside git repository {top.stdout.strip()} and is not git-ignored"


def init_workspace(path: str | Path, kind: str = "production", allow_inside_git: bool = False) -> Path:
    if kind not in KINDS:
        raise WorkspaceError(f"kind must be one of {KINDS}")
    set_private_umask()
    root = Path(path).expanduser().resolve()
    marker = root / MARKER
    if marker.exists():
        existing = json.loads(marker.read_text())
        if existing.get("kind") != kind:
            raise WorkspaceError(f"{root} is already a '{existing.get('kind')}' workspace")
    elif root.exists() and any(root.iterdir()):
        raise WorkspaceError(f"{root} exists and is not empty; choose a new folder")
    if kind == "production" and not allow_inside_git:
        warn = git_exposure(root)
        if warn:
            raise WorkspaceError(warn + " — real financial data must not live in a repository. "
                                 "Choose a folder outside the repo (default ~/NewWaveRevenueData).")
    make_private_dir(root)
    for sub in SUBDIRS:
        make_private_dir(root / sub)
    if not marker.exists():
        marker.write_text(json.dumps({"kind": kind, "created_at": datetime.now(timezone.utc).isoformat(),
                                      "app": "newwave-revenue-intelligence"}, indent=2))
        make_private_file(marker)
    conn = open_database(root / "database" / "newwave.sqlite3")
    conn.close()
    return root


def workspace_kind(root: Path) -> str | None:
    marker = Path(root) / MARKER
    if not marker.is_file():
        return None
    try:
        return json.loads(marker.read_text()).get("kind")
    except (json.JSONDecodeError, OSError):
        return None


def require_workspace(root: Path) -> str:
    kind = workspace_kind(root)
    if kind is None:
        raise WorkspaceError(
            f"No initialised workspace at {root}. Run: python scripts/nwri.py init --workspace \"{root}\"")
    return kind
