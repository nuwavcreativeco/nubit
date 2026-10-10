import csv
import io
import json
import uuid
from datetime import date

import pandas as pd
import streamlit as st

from ...catalog import list_services
from ...ingestion.base import preview, run_transaction_import, sha256_bytes
from ...ingestion.messages import imessage
from ...ingestion.messages.base import run_message_import
from ...ingestion.messages.instagram import InstagramExport
from ...ingestion.messages.manual import parse_manual_conversations
from ...ingestion.payments import (
    BUILTIN_PROFILES, MAPPABLE_FIELDS, CashAppImporter, ManualCashImporter, VenmoImporter, mapped_importer_for,
    suggest_mapping,
)
from ...ingestion.tabular import FileRejected, read_csv_table, read_json_table
from ...money import format_cents
from ...records import set_transaction_fields
from ...security.paths import ensure_within, safe_filename
from ...security.permissions import make_private_file
from ..common import conn, run_action, settings

SOURCES = {
    "cashapp": "Cash App statement CSV",
    "venmo": "Venmo statement CSV",
    "bank": "Bank statement CSV (incl. Zelle lines)",
    "zelle": "Zelle activity export",
    "manual": "Manual cash / offline payments (template)",
    "other": "Other CSV / JSON (custom mapping)",
}


def _profiles_dir():
    return settings().workspace / "config"


def _saved_profiles() -> dict[str, dict]:
    out = {}
    d = _profiles_dir()
    if d.is_dir():
        for p in sorted(d.glob("profile_*.json")):
            try:
                out[p.stem[len("profile_"):]] = json.loads(p.read_text())
            except (OSError, json.JSONDecodeError):
                continue
    return out


def _mapping_ui(data: bytes, source: str, fname: str) -> dict | None:
    builtin = {k: v for k, v in BUILTIN_PROFILES.items() if v["source_type"] == source or source == "other"}
    saved = {f"saved: {k}": v for k, v in _saved_profiles().items()}
    choices = ["Custom mapping"] + [f"built-in: {k}" for k in builtin] + list(saved)
    choice = st.selectbox("Column mapping profile", choices)
    if choice.startswith("built-in: "):
        return dict(builtin[choice[len("built-in: "):]]["options"])
    if choice in saved:
        return dict(saved[choice]["options"])
    is_json = fname.lower().endswith(".json")
    opts: dict = {"format": "json" if is_json else "csv"}
    try:
        if is_json:
            opts["json_records_path"] = st.text_input("JSON path to the list of records (e.g. data.items)", "")
            table = read_json_table(data, opts["json_records_path"])
        else:
            table = read_csv_table(data)
    except (FileRejected, ValueError) as exc:
        st.error(f"Could not read the file: {exc}")
        return None
    st.caption(f"Detected columns: {', '.join(table.headers)}")
    guess = suggest_mapping(table.headers)
    mode = st.radio("Amounts are given as", ["signed", "debit_credit", "direction_column"], horizontal=True,
                    format_func={"signed": "One signed amount column", "debit_credit": "Separate debit / credit",
                                 "direction_column": "Amount + direction column"}.get)
    opts["amount_mode"] = mode
    mapping = {}
    cols = st.columns(3)
    for i, (fld, desc) in enumerate(MAPPABLE_FIELDS.items()):
        options = ["—"] + table.headers
        default = guess.get(fld)
        sel = cols[i % 3].selectbox(desc, options, index=options.index(default) if default in options else 0,
                                    key=f"map_{fld}")
        if sel != "—":
            mapping[fld] = sel
    opts["mapping"] = mapping
    a, b, d = st.columns(3)
    if mode == "signed":
        opts["positive_is"] = a.radio("Positive amounts are", ["in", "out"],
                                      format_func={"in": "money IN", "out": "money OUT"}.get)
    if mode == "direction_column":
        opts["direction_in_values"] = [v.strip() for v in a.text_input(
            "Direction values meaning money IN (comma-separated)", "received, credit, in").split(",")]
    opts["date_order"] = b.radio("Numeric dates are", ["MDY", "DMY"], format_func={"MDY": "Month first (US)",
                                                                                    "DMY": "Day first"}.get)
    opts["classify"] = d.radio("Classify descriptions as bank lines?", ["bank", "none"],
                               index=0 if source in ("bank", "zelle") else 1,
                               format_func={"bank": "Yes (Zelle/transfer/fee rules)", "none": "No"}.get)
    if source in ("bank", "zelle"):
        opts["payment_method"] = "zelle" if source == "zelle" else "bank"
    opts["account_label"] = st.text_input("Account label (e.g. 'Chase checking 1234')", "")
    with st.expander("Save this mapping for next time"):
        pname = st.text_input("Profile name")
        if st.button("Save profile") and pname:
            target = ensure_within(_profiles_dir(), f"profile_{safe_filename(pname)}.json")
            target.write_text(json.dumps({"source_type": source, "options": opts}, indent=2))
            make_private_file(target)
            st.toast("Profile saved")
    return opts


def _payments_tab(c):
    s = settings()
    source = st.selectbox("Source type", list(SOURCES), format_func=SOURCES.get)
    if source == "manual":
        buf = io.StringIO()
        csv.writer(buf).writerow(ManualCashImporter.TEMPLATE_HEADERS)
        st.download_button("Download the manual-entry CSV template", buf.getvalue(), "manual_payments_template.csv")
    up = st.file_uploader("Choose an export file", type=["csv", "json", "txt"], key=f"up_{source}")
    if not up:
        st.caption("Files are read locally. A read-only copy is kept in your workspace; the original is never "
                   "moved or modified.")
        return
    data = up.getvalue()
    opts: dict | None = {"base_currency": s.base_currency}
    if source == "cashapp":
        importer = CashAppImporter()
    elif source == "venmo":
        importer = VenmoImporter()
    elif source == "manual":
        importer = ManualCashImporter()
    else:
        importer = mapped_importer_for(source)
        mapped = _mapping_ui(data, source, up.name)
        if mapped is None:
            return
        opts.update(mapped)
    try:
        res = preview(importer, data, opts, limit=200)
    except (FileRejected, ValueError) as exc:
        st.error(f"Preview failed: {exc}")
        return
    st.markdown(f"**Preview** — {res.record_count} record(s), {len(res.failed)} failed, {len(res.skipped)} skipped. "
                "Nothing has been saved yet.")
    rows = [{"row": t.row_number, "date": t.transaction_date or "INVALID", "direction": t.direction,
             "amount": format_cents(t.gross_cents, t.currency), "fee": format_cents(t.fee_cents),
             "type": t.txn_type, "status": t.source_status, "counterparty": t.counterparty_raw,
             "source id": t.source_record_id or "(none — duplicate detection is conservative)",
             "why": t.classification_reason} for t in res.transactions]
    st.dataframe(pd.DataFrame(rows), hide_index=True, use_container_width=True)
    if res.failed:
        st.warning("Rows that will fail:\n" + "\n".join(f"- row {i.row_number}: {i.message}" for i in res.failed[:20]))
    warns = [f"row {t.row_number}: {w}" for t in res.transactions for w in t.warnings]
    if warns:
        st.warning("Validation warnings:\n" + "\n".join(f"- {w}" for w in warns[:20]))
    if st.button("Import these records", type="primary"):
        summary = run_transaction_import(c, importer, data, up.name, options=opts, incoming_dir=s.incoming_dir)
        if summary.status == "failed":
            st.error("Import failed: " + "; ".join(summary.warnings))
        elif summary.status == "duplicate_file":
            st.info(summary.warnings[0])
        else:
            st.success(f"Imported {summary.inserted} new record(s); {summary.duplicates} already present; "
                       f"{summary.failed} failed. Run reconciliation checks next.")


def _instagram_tab(c):
    s = settings()
    st.markdown("Use Instagram's **Download your information** export (JSON format). Upload the .zip; only "
                "message threads are read, media is ignored. Larger archives: use "
                "`python scripts/nwri.py instagram-list <zip>` from the terminal.")
    up = st.file_uploader("Instagram export (.zip)", type=["zip"], key="ig")
    if not up:
        return
    try:
        exp = InstagramExport.from_zip_bytes(up.getvalue())
        threads = exp.list_threads()
    except ValueError as exc:
        st.error(str(exc))
        return
    if not threads:
        st.warning("No message threads found. Make sure the export was requested in JSON format and includes Messages.")
        return
    owner = st.text_input("Your name as it appears in the export", exp.owner_name(s.owner_display_names) or "")
    df = pd.DataFrame([{"thread": t.thread_id, "title": t.title, "messages": t.message_count,
                        "last message": t.last_message_at} for t in threads])
    st.dataframe(df, hide_index=True, use_container_width=True)
    st.info("Start with a small sample of threads, check the results, then import more.")
    picked = st.multiselect("Threads to import", df["thread"].tolist(), max_selections=25)
    if picked and st.button("Import selected threads", type="primary"):
        recs = exp.read_threads(picked, owner or None)
        sm = run_message_import(c, source_type="instagram", importer="instagram_export", threads=recs,
                                filename=up.name, file_sha256=sha256_bytes(up.getvalue()),
                                options={"threads": picked})
        st.success(f"{sm.inserted} new messages, {sm.duplicates} already imported, {sm.signals} service mentions, "
                   f"{sm.linked_conversations} conversation(s) linked via verified identifiers.")


def _apple_tab(c):
    s = settings()
    st.markdown("Reads a **temporary read-only copy** of `~/Library/Messages/chat.db`. The live database is never "
                "modified. macOS requires **Full Disk Access** for the app running this dashboard (usually Terminal).")
    if st.button("Check access"):
        st.session_state["im_report"] = imessage.inspect_access(imessage.DEFAULT_DB, s.scratch_dir).__dict__
    rep = st.session_state.get("im_report")
    if not rep:
        return
    st.json(rep)
    if not rep["readable"]:
        st.info("Fallback: export conversations manually (copy into the CSV template on the "
                "'Manual conversations' tab) and import them there.")
        return
    with imessage.snapshot(imessage.DEFAULT_DB, s.scratch_dir) as mconn:
        chats = imessage.list_chats(mconn, 300)
    df = pd.DataFrame([{"chat_id": ch.chat_id, "contact / name": ch.display_name or ch.identifier,
                        "service": ch.service, "messages": ch.message_count, "last": ch.last_message_at}
                       for ch in chats])
    st.dataframe(df, hide_index=True, use_container_width=True)
    picked = st.multiselect("Chats to import (start with a few)", df["chat_id"].tolist(), max_selections=20)
    a, b, d = st.columns(3)
    since = a.date_input("From", value=None)
    until = b.date_input("Until", value=None)
    limit = d.number_input("Max messages", 10, 5000, imessage.DEFAULT_MESSAGE_LIMIT, step=50)
    if picked and st.button("Import selected chats", type="primary"):
        with imessage.snapshot(imessage.DEFAULT_DB, s.scratch_dir) as mconn:
            threads = imessage.extract_chats(mconn, picked, start_iso=since.isoformat() if since else None,
                                             end_iso=until.isoformat() if until else None, limit=int(limit))
        for stype in ("imessage", "sms"):
            group = [t for t in threads if t.thread_id.startswith("sms:") == (stype == "sms")]
            if group:
                sm = run_message_import(c, source_type=stype, importer="apple_messages", threads=group,
                                        filename="Messages (read-only snapshot)", file_sha256="snapshot",
                                        options={"chats": picked, "limit": int(limit)})
                st.success(f"{stype}: {sm.inserted} new messages, {sm.signals} service mentions")


def _manual_conv_tab(c):
    s = settings()
    tmpl = "thread_id,timestamp,sender,text,is_owner,contact\nartist-1,2024-01-03T10:00:00,Artist,can you mix my song?,0,+15550100000\n"
    st.download_button("Download conversation template", tmpl, "conversations_template.csv")
    up = st.file_uploader("Conversation file (CSV or JSON)", type=["csv", "json"], key="mc")
    if up and st.button("Import conversations", type="primary"):
        try:
            threads = parse_manual_conversations(up.getvalue(), "json" if up.name.endswith(".json") else "csv",
                                                 s.owner_display_names)
        except (ValueError, FileRejected) as exc:
            st.error(str(exc))
            return
        sm = run_message_import(c, source_type="manual", importer="manual_conversations", threads=threads,
                                filename=up.name, file_sha256=sha256_bytes(up.getvalue()))
        st.success(f"{sm.inserted} new messages in {sm.threads} thread(s); {sm.signals} service mentions.")


def _cash_entry_tab(c):
    s = settings()
    svcs = [sv["code"] for sv in list_services(c)]
    with st.form("cash_entry", clear_on_submit=True):
        a, b, d = st.columns(3)
        when = a.date_input("Date", value=date.today())
        amount = b.text_input("Amount (e.g. 120.00)")
        typ = d.selectbox("Type", ["payment_received", "expense", "refund"])
        a, b, d = st.columns(3)
        method = a.selectbox("Method", ["cash", "check", "other"])
        payer = b.text_input("Payer / payee name")
        phone = d.text_input("Phone (optional)")
        a, b, d = st.columns(3)
        ig = a.text_input("Instagram (optional)")
        svc = b.selectbox("Service", [""] + svcs)
        receipt = d.text_input("Receipt reference (optional)")
        memo = st.text_input("Note")
        attest = st.checkbox("I confirm this record is accurate — mark it verified")
        if st.form_submit_button("Record entry"):
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(ManualCashImporter.TEMPLATE_HEADERS)
            entry_id = f"manual-{uuid.uuid4().hex[:12]}"
            w.writerow([entry_id, when.isoformat(), amount, typ, method, payer, phone, ig, "", svc, memo, receipt])
            sm = run_transaction_import(c, ManualCashImporter(), buf.getvalue().encode(), f"manual entry {entry_id}",
                                        options={"base_currency": s.base_currency})
            if sm.inserted != 1:
                reason = "; ".join(i.message for i in sm.failed_rows) or "; ".join(sm.warnings) or sm.status
                st.error(f"Entry not saved: {reason}")
                return
            if attest:
                tid = c.execute("SELECT id FROM transactions WHERE source_record_id = ?", (entry_id,)).fetchone()[0]
                run_action(set_transaction_fields, c, tid, {"verification_status": "verified"},
                           reason="owner attested manual entry", success="Saved and verified")
            else:
                st.success("Saved (unverified).")


def render():
    c = conn()
    st.title("Imports")
    tabs = st.tabs(["Payments", "Instagram", "Apple Messages", "Manual conversations", "Record cash", "History"])
    with tabs[0]:
        _payments_tab(c)
    with tabs[1]:
        _instagram_tab(c)
    with tabs[2]:
        _apple_tab(c)
    with tabs[3]:
        _manual_conv_tab(c)
    with tabs[4]:
        _cash_entry_tab(c)
    with tabs[5]:
        jobs = pd.read_sql_query(
            """SELECT started_at, importer, original_filename, status, record_count, success_count, duplicate_count,
                      skipped_count, failed_count, file_sha256, warnings_json FROM import_jobs ORDER BY started_at DESC""", c)
        jobs["file_sha256"] = jobs["file_sha256"].str[:12]
        jobs["warnings"] = jobs.pop("warnings_json").map(lambda w: len(json.loads(w or "[]")))
        st.dataframe(jobs, hide_index=True, use_container_width=True)
    c.close()
