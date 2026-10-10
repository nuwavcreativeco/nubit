"""Restrictive file permissions for private data (best effort on POSIX)."""
from __future__ import annotations

import os
import stat
from pathlib import Path

PRIVATE_DIR_MODE = 0o700
PRIVATE_FILE_MODE = 0o600
READ_ONLY_FILE_MODE = 0o400


def set_private_umask() -> None:
    os.umask(0o077)


def make_private_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, PRIVATE_DIR_MODE)
    except OSError:
        pass
    return path


def make_private_file(path: Path, read_only: bool = False) -> None:
    try:
        os.chmod(path, READ_ONLY_FILE_MODE if read_only else PRIVATE_FILE_MODE)
    except OSError:
        pass


def is_private(path: Path) -> bool:
    try:
        mode = path.stat().st_mode
    except OSError:
        return False
    return not (mode & (stat.S_IRWXG | stat.S_IRWXO))
