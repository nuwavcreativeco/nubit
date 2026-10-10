import streamlit as st

from ...analytics.exports import export_ledger, summary_report_markdown, write_export
from ..common import conn, filter_bar, settings


def render():
    c = conn()
    s = settings()
    st.title("Exports & reports")
    st.caption("Default exports contain verified records only. Private conversation content is never exported. "
               "Files are saved to your workspace exports folder and never overwrite existing files.")
    f = filter_bar(c, "exp")
    a, b = st.columns(2)
    include_unverified = a.checkbox("Include unverified records (clearly labelled)")
    include_memos = b.checkbox("Include payment notes/memos (may contain personal details)")
    name, data = export_ledger(c, f, include_unverified=include_unverified, include_memos=include_memos,
                               base_currency=s.base_currency)
    rows = data.decode().count("\n") - 1
    st.markdown(f"**Ledger CSV** — {rows} row(s)" + (" · ⚠️ contains UNVERIFIED rows" if include_unverified else ""))
    x, y = st.columns(2)
    x.download_button("Download ledger CSV", data, file_name=name, mime="text/csv", type="primary")
    if y.button("Save copy to workspace exports folder"):
        p = write_export(s.exports_dir, name, data)
        st.success(f"Saved {p.name}")
    st.divider()
    report = summary_report_markdown(c, f, s.base_currency)
    st.markdown("**Summary report**")
    with st.container(border=True):
        st.markdown(report)
    rname = f"summary-{f.start}-{f.end}.md"
    x, y = st.columns(2)
    x.download_button("Download report (Markdown)", report, file_name=rname, mime="text/markdown")
    if y.button("Save report to workspace reports folder"):
        p = write_export(s.reports_dir, rname, report.encode())
        st.success(f"Saved {p.name}")
    c.close()
