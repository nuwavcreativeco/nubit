"""Path validation to prevent traversal outside allowed roots."""
from __future__ import annotations

import re
from pathlib import Path


class UnsafePathError(ValueError):
    pass


def ensure_within(root: Path, candidate: str | Path) -> Path:
    """Resolve *candidate* and require that it lies inside *root*."""
    root_r = Path(root).resolve()
    cand = Path(candidate)
    if not cand.is_absolute():
        cand = root_r / cand
    resolved = cand.resolve()
    if resolved != root_r and root_r not in resolved.parents:
        raise UnsafePathError(f"path escapes allowed directory: {candidate}")
    return resolved


_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._ -]+")


def safe_filename(name: str, max_len: int = 120) -> str:
    """Reduce an uploaded filename to a safe basename (no directories)."""
    base = Path(str(name).replace("\\", "/")).name
    base = _SAFE_NAME_RE.sub("_", base).strip(" .")
    if not base:
        base = "upload"
    return base[:max_len]
