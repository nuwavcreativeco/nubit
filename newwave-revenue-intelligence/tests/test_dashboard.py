"""Headless rendering of every dashboard page against a synthetic demo workspace."""
import pytest
from streamlit.testing.v1 import AppTest

from newwave.database.connection import open_database
from newwave.demo import build_demo
from newwave.workspace import init_workspace

PAGES = ["overview", "revenue", "customers", "reconciliation", "imports", "evidence", "exports", "settings_page"]


@pytest.fixture
def demo_ws(tmp_path, monkeypatch):
    ws = init_workspace(tmp_path / "demo", kind="demo", allow_inside_git=True)
    c = open_database(ws / "database" / "newwave.sqlite3")
    build_demo(c, ws)
    c.close()
    monkeypatch.setenv("NWRI_WORKSPACE", str(ws))
    return ws


@pytest.mark.parametrize("page", PAGES)
def test_page_renders_without_errors(demo_ws, page):
    script = (f"PAGE = {page!r}\nimport importlib, sys\nsys.path.insert(0, 'src')\n"
              "importlib.import_module(f'newwave.ui.pages.{PAGE}').render()\n")
    at = AppTest.from_string(script, default_timeout=60).run()
    assert not at.exception, [e.value for e in at.exception]


def test_app_shell_requires_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("NWRI_WORKSPACE", str(tmp_path / "missing"))
    at = AppTest.from_file("app.py", default_timeout=60).run()
    assert not at.exception
    assert any("No initialised workspace" in e.value for e in at.error)


def test_app_shell_with_demo(demo_ws):
    at = AppTest.from_file("app.py", default_timeout=60).run()
    assert not at.exception
    assert any("DEMO" in w.value for w in at.sidebar.warning)
