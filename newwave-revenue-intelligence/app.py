"""New Wave Music — Historical Revenue Intelligence (local dashboard).

Launch with:  ./scripts/run_dashboard.sh   (binds to 127.0.0.1 only)
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

import streamlit as st  # noqa: E402

from newwave.ai.adapter import ai_status  # noqa: E402
from newwave.config import load_settings  # noqa: E402
from newwave.database.connection import open_database  # noqa: E402
from newwave.security.permissions import set_private_umask  # noqa: E402
from newwave.ui.pages import customers, evidence, exports, imports, overview, reconciliation, revenue, settings_page  # noqa: E402
from newwave.workspace import WorkspaceError, require_workspace  # noqa: E402

set_private_umask()
st.set_page_config(page_title="New Wave Revenue Intelligence", page_icon="🎛️", layout="wide")

settings = load_settings()
try:
    kind = require_workspace(settings.workspace)
except WorkspaceError as exc:
    st.title("New Wave Revenue Intelligence")
    st.error(str(exc))
    st.markdown("Create your private workspace (outside this code folder) from the terminal:\n\n"
                "```\npython scripts/nwri.py init\n```\n\nor try the synthetic demo:\n\n"
                "```\nNWRI_WORKSPACE=./demo_workspace python scripts/nwri.py demo\n"
                "NWRI_WORKSPACE=./demo_workspace ./scripts/run_dashboard.sh\n```")
    st.stop()

with st.sidebar:
    st.markdown("### 🎛️ New Wave Music")
    st.caption("Historical revenue intelligence · local only")
    if kind == "demo":
        st.warning("DEMO workspace — all data is synthetic.")
    elif kind == "test":
        st.warning("TEST workspace")
    c = open_database(settings.database_path)
    ok, why = ai_status(c, settings)
    c.close()
    st.caption(("🟢 AI assist enabled" if ok else "⚪ AI assist off") + " — core features never need AI.")

pages = [
    st.Page(overview.render, title="Overview", icon=":material/dashboard:", default=True),
    st.Page(revenue.render, title="Revenue", icon=":material/monitoring:", url_path="revenue"),
    st.Page(customers.render, title="Customers", icon=":material/group:", url_path="customers"),
    st.Page(reconciliation.render, title="Reconciliation", icon=":material/fact_check:", url_path="reconciliation"),
    st.Page(imports.render, title="Imports", icon=":material/upload_file:", url_path="imports"),
    st.Page(evidence.render, title="Evidence", icon=":material/find_in_page:", url_path="evidence"),
    st.Page(exports.render, title="Exports", icon=":material/download:", url_path="exports"),
    st.Page(settings_page.render, title="Settings", icon=":material/settings:", url_path="settings"),
]
st.navigation(pages).run()
