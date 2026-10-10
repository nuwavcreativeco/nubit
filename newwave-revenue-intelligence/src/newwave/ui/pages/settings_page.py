import json

import pandas as pd
import streamlit as st

from ... import backup
from ...ai import adapter
from ...database import audit
from ...database.connection import new_id, transaction
from ...records import add_owner_account, set_expense_coverage
from ..common import client_options, conn, run_action, settings

CONSENT_TEXT = """
**Before enabling AI assistance, please confirm you understand:**

- When you press *Send*, a **redacted, pseudonymous** excerpt is sent to Anthropic's Claude API over the internet.
- Phone numbers, emails, addresses, payment handles, account numbers, URLs and known names are replaced with
  placeholders; customer and transaction IDs are replaced with temporary aliases (TXN_1, MSG_2 …).
- Only the minimum records for the task are sent — never raw files, complete statements, complete message
  histories, credentials or the database.
- Every request is shown to you first. Results are **suggestions only** and must be approved by you.
- Only a hash and metadata of each request are stored locally; the content is not logged.
- You can turn AI off at any time here, or set `NWRI_AI_DISABLED=1` to block it completely.
"""


def _ai_section(c):
    s = settings()
    ok, why = adapter.ai_status(c, s)
    (st.success if ok else st.info)(why)
    enabled = c.execute("SELECT value FROM app_settings WHERE key='ai_enabled'").fetchone()
    is_on = bool(enabled and enabled[0] == "1")
    if is_on:
        if st.button("⛔ Turn AI off now", type="primary"):
            adapter.set_ai_enabled(c, False)
            st.rerun()
    else:
        st.markdown(CONSENT_TEXT)
        agree = st.checkbox("I understand and consent to sending redacted excerpts when I explicitly approve each request")
        if st.button("Enable AI assistance", disabled=not agree or s.ai_kill_switch):
            adapter.record_consent(c)
            adapter.set_ai_enabled(c, True)
            st.rerun()
    st.caption(f"Model: `{s.ai_model}` (set NWRI_AI_MODEL to change). API key is read from the environment / "
               f"local .env file only. Refusal fallback: {'on' if s.ai_refusal_fallback else 'off'}.")
    if not ok:
        return
    st.markdown("#### Ask for suggestions")
    task = st.selectbox("Task", ["service_classification", "project_links", "client_summary"], format_func={
        "service_classification": "Identify services for verified payments (uses linked message excerpts)",
        "project_links": "Suggest which project each payment belongs to (one customer)",
        "client_summary": "Summarise a customer's purchase history & follow-up ideas"}.get)
    req = None
    if task == "service_classification":
        ids = [r[0] for r in c.execute(
            """SELECT id FROM transactions WHERE txn_type='payment_received' AND verification_status='verified'
               AND service_id IS NULL AND client_id IS NOT NULL ORDER BY transaction_date DESC LIMIT 10""")]
        st.caption(f"{len(ids)} verified payment(s) without a service (max 10 per request).")
        if ids and st.button("Prepare request"):
            req = adapter.prepare_service_classification(c, s, ids)
    else:
        opts = client_options(c)
        who = st.selectbox("Customer", list(opts), index=None)
        if who and st.button("Prepare request"):
            fn = adapter.prepare_project_links if task == "project_links" else adapter.prepare_client_summary
            req = fn(c, s, opts[who])
    if req is not None:
        st.session_state["ai_req"] = req
    req = st.session_state.get("ai_req")
    if req is None:
        return
    st.markdown("**Data categories that will be sent:**")
    for cat in req.data_categories:
        st.markdown(f"- {cat}")
    st.caption(f"{req.item_count} item(s); redactions applied: {json.dumps(req.redaction_counts)}")
    with st.expander("Exact redacted payload"):
        st.json(req.payload)
    if st.button("Send this request to Claude", type="primary"):
        try:
            res = adapter.send(c, s, req, adapter.default_provider(s), user_confirmed=True)
        except adapter.AIUnavailable as exc:
            st.error(str(exc))
            return
        st.session_state.pop("ai_req", None)
        if res["status"] == "succeeded":
            st.success(f"{res['created']} suggestion(s) added to Reconciliation → AI suggestions for your review.")
            if "summary" in res:
                st.text(res["summary"])
                for o in res.get("opportunities", []):
                    st.text(f"• {o['service_code']}: {o['rationale']}")
        else:
            st.warning(f"No suggestions created ({res['status']}). {res.get('error', '')}")
    log = pd.read_sql_query("SELECT created_at, task, model, status, item_count, suggestion_count, data_categories_json "
                            "FROM ai_requests ORDER BY created_at DESC LIMIT 50", c)
    if not log.empty:
        st.markdown("**Request log (metadata only)**")
        st.dataframe(log, hide_index=True, use_container_width=True)


def _catalog_section(c):
    df = pd.read_sql_query("SELECT id, code, name, aliases_json, keywords_json, active FROM service_catalog "
                           "ORDER BY sort_order", c)
    df["aliases"] = df.pop("aliases_json").map(lambda v: ", ".join(json.loads(v)))
    df["keywords"] = df.pop("keywords_json").map(lambda v: ", ".join(json.loads(v)))
    df["active"] = df["active"].astype(bool)
    edited = st.data_editor(df, hide_index=True, use_container_width=True, disabled=["id", "code"],
                            num_rows="fixed", key="catalog_editor")
    if st.button("Save catalog changes"):
        gid = new_id("grp_")
        with transaction(c):
            for r in edited.to_dict("records"):
                changes = {"name": r["name"].strip() or r["code"],
                           "aliases_json": json.dumps([a.strip() for a in str(r["aliases"]).split(",") if a.strip()]),
                           "keywords_json": json.dumps([k.strip() for k in str(r["keywords"]).split(",") if k.strip()]),
                           "active": int(bool(r["active"]))}
                cur = c.execute("SELECT name, aliases_json, keywords_json, active FROM service_catalog WHERE id=?",
                                (r["id"],)).fetchone()
                if dict(cur) != changes:
                    audit.update_with_audit(c, "service_catalog", r["id"], changes, actor="user",
                                            action="edit_service", group_id=gid)
        st.toast("Catalog saved")
    with st.form("new_service", clear_on_submit=True):
        a, b = st.columns(2)
        code = a.text_input("New service code (lowercase, e.g. podcast_editing)")
        name = b.text_input("Display name")
        if st.form_submit_button("Add service") and code.strip() and name.strip():
            import re
            if not re.fullmatch(r"[a-z][a-z0-9_]{1,40}", code.strip()):
                st.error("Code must be lowercase letters, digits and underscores")
            else:
                with transaction(c):
                    audit.insert_with_audit(c, "service_catalog", {"id": new_id("svc_"), "code": code.strip(),
                                                                   "name": name.strip(), "sort_order": 50},
                                            actor="user", action="add_service")
                st.rerun()


def render():
    c = conn()
    s = settings()
    st.title("Settings")
    t_ai, t_owner, t_cat, t_exp, t_ws, t_audit = st.tabs(
        ["AI assistance", "Owner accounts", "Service catalog", "Expense coverage", "Workspace & backups", "Audit log"])
    with t_ai:
        _ai_section(c)
    with t_owner:
        st.caption("Your own accounts and names. Money moving between these is an owner transfer — never revenue "
                   "or expense. Re-run reconciliation after adding one.")
        st.dataframe(pd.read_sql_query("SELECT label, identifier_type, normalized_value FROM owner_accounts", c),
                     hide_index=True, use_container_width=True)
        with st.form("owner", clear_on_submit=True):
            a, b, d = st.columns(3)
            label = a.text_input("Label (e.g. 'My Cash App')")
            t = b.selectbox("Type", ["cashapp", "venmo", "phone", "email", "name", "other"])
            v = d.text_input("Value")
            if st.form_submit_button("Add owner account"):
                run_action(add_owner_account, c, label, t, v, success="Owner account added")
    with t_cat:
        _catalog_section(c)
    with t_exp:
        st.caption("Profit is only reported for date ranges where every month is confirmed here as having "
                   "complete, verified expense records.")
        st.dataframe(pd.read_sql_query("SELECT month, confirmed_at, note FROM expense_coverage ORDER BY month", c),
                     hide_index=True)
        with st.form("cov", clear_on_submit=True):
            month = st.text_input("Month (YYYY-MM)")
            note = st.text_input("Note")
            sure = st.checkbox("All business expenses for this month are imported and verified")
            if st.form_submit_button("Confirm coverage") and sure:
                run_action(set_expense_coverage, c, month.strip(), note=note, success="Coverage confirmed")
    with t_ws:
        st.markdown(f"**Workspace:** `{s.workspace}`  \n**Database:** `{s.database_path}`")
        st.warning("Local files are not encrypted by this app. Turn on FileVault (System Settings → Privacy & "
                   "Security → FileVault) and keep backups on an encrypted drive.")
        if st.button("Create backup now"):
            p = backup.backup(s)
            st.success(f"Backup saved: {p.name}")
        backups = sorted(s.backups_dir.glob("*.sqlite3"), reverse=True) if s.backups_dir.exists() else []
        st.caption(f"{len(backups)} backup(s) in {s.backups_dir}. Restore from the terminal: "
                   "`python scripts/nwri.py restore <file> --yes` (stop the dashboard first).")
    with t_audit:
        log = pd.read_sql_query("SELECT id, occurred_at, actor, action, entity_type, entity_id, reason, group_id "
                                "FROM audit_log ORDER BY id DESC LIMIT 500", c)
        st.dataframe(log, hide_index=True, use_container_width=True)
    c.close()
