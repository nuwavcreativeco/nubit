"""Test fixtures. Every test gets its own temporary workspace + database —
tests never touch a real workspace (NWRI_WORKSPACE is overridden)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from newwave.config import load_settings  # noqa: E402
from newwave.database.connection import open_database  # noqa: E402
from newwave.workspace import init_workspace  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(autouse=True)
def _isolate_env(monkeypatch, tmp_path):
    monkeypatch.setenv("NWRI_WORKSPACE", str(tmp_path / "ws"))
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("NWRI_AI_DISABLED", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))


@pytest.fixture
def workspace(tmp_path):
    return init_workspace(tmp_path / "ws", kind="test")


@pytest.fixture
def settings(workspace):
    return load_settings(workspace)


@pytest.fixture
def conn(settings):
    c = open_database(settings.database_path)
    yield c
    c.close()


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()
