import pandas as pd
import streamlit as st

from ...analytics import metrics
from ...catalog import list_services
from ...money import parse_amount, to_cents
from ...records import (
    add_identifier, create_client, create_project, merge_clients, undo_merge, verify_identifier,
)
from ..common import client_options, conn, money, money_df, run_action

ID_TYPES = ["phone", "email", "instagram", "cashapp", "venmo", "zelle", "name", "bank_name", "other"]


def _profile_frames(c, cid):
    idents = pd.read_sql_query(
        "SELECT id, identifier_type, raw_value, normalized_value, verification_status FROM client_identifiers "
        "WHERE client_id = ? ORDER BY identifier_type", c, params=(cid,))
    txns = pd.read_sql_query(
        """SELECT t.id, t.transaction_date, t.txn_type, t.payment_method, t.gross_amount_cents, t.verification_status,
                  t.source_type, t.source_record_id FROM transactions t WHERE t.client_id = ?
           ORDER BY t.transaction_date DESC""", c, params=(cid,))
    projects = pd.read_sql_query(
        """SELECT p.id, p.title, s.name AS service, p.stage, p.project_value_cents,
                  COALESCE((SELECT SUM(amount_cents) FROM transaction_allocations a
                            WHERE a.project_id = p.id AND a.status='active' AND a.allocation_type <> 'refund'), 0) AS collected_cents
           FROM projects p LEFT JOIN service_catalog s ON s.id = p.service_id WHERE p.client_id = ?""",
        c, params=(cid,))
    convs = pd.read_sql_query(
        "SELECT id, source_type, message_count, first_message_at, last_message_at FROM conversations WHERE client_id = ?",
        c, params=(cid,))
    return idents, txns, projects, convs


def render():
    c = conn()
    st.title("Customer intelligence")
    table = metrics.customer_table(c)
    with st.expander("➕ New customer"):
        with st.form("new_client", clear_on_submit=True):
            name = st.text_input("Display name")
            id_type = st.selectbox("First identifier (optional)", ["—"] + ID_TYPES)
            id_val = st.text_input("Identifier value")
            verified = st.checkbox("I have confirmed this identifier belongs to this customer")
            if st.form_submit_button("Create customer"):
                res = run_action(create_client, c, name, success="Customer created")
                if res and id_type != "—" and id_val:
                    run_action(add_identifier, c, res[0], id_type, id_val, verified=verified, success="Identifier added")

    if table.empty:
        st.info("No customers yet. Create one above, or from an unmatched payment in the Reconciliation center.")
        c.close()
        return
    show = money_df(table, ["verified_net_cents"]).rename(columns={
        "display_name": "Customer", "verified_net_cents": "Verified net collected", "payments": "Payments",
        "projects": "Projects", "services": "Services", "first_activity": "First verified",
        "last_activity": "Most recent verified", "purchase_occasions": "Purchase occasions", "repeat": "Repeat"})
    for col in ("First verified", "Most recent verified"):
        show[col] = show[col].fillna("—")
    st.dataframe(show.drop(columns=["client_id"]), hide_index=True, use_container_width=True)

    opts = client_options(c)
    label = st.selectbox("Open customer profile", list(opts), index=None, placeholder="Choose a customer")
    if label:
        cid = opts[label]
        row = table.set_index("client_id").loc[cid] if cid in set(table.client_id) else None
        st.subheader(label.split(" · ")[0])
        if row is not None:
            k = st.columns(4)
            k[0].metric("Verified lifetime net", money(int(row["verified_net_cents"])))
            k[1].metric("Verified payments", int(row["payments"]))
            k[2].metric("Projects", int(row["projects"]))
            k[3].metric("Most recent verified activity", row["last_activity"] or "—")
        idents, txns, projects, convs = _profile_frames(c, cid)
        t1, t2, t3, t4, t5 = st.tabs(["Identifiers", "Transactions", "Projects", "Opportunities", "Merge"])
        with t1:
            st.dataframe(idents.drop(columns=["id"]), hide_index=True, use_container_width=True)
            unv = idents[idents.verification_status == "unverified"]
            if not unv.empty:
                pick = st.selectbox("Verify an identifier", unv["id"], format_func=lambda i: " · ".join(
                    unv.set_index("id").loc[i, ["identifier_type", "raw_value"]].astype(str)))
                if st.button("Mark as verified (I confirmed it belongs to this customer)"):
                    run_action(verify_identifier, c, pick, success="Identifier verified")
                    st.rerun()
            with st.form(f"add_id_{cid}", clear_on_submit=True):
                a, b, v = st.columns([1, 2, 1])
                t = a.selectbox("Type", ID_TYPES)
                val = b.text_input("Value")
                ver = v.checkbox("Verified")
                if st.form_submit_button("Add identifier"):
                    run_action(add_identifier, c, cid, t, val, verified=ver, success="Identifier added")
                    st.rerun()
        with t2:
            st.dataframe(money_df(txns, ["gross_amount_cents"]), hide_index=True, use_container_width=True)
            st.caption("Open a transaction ID on the Evidence page to see its source file, row and excerpt.")
        with t3:
            st.dataframe(money_df(projects, ["project_value_cents", "collected_cents"]).drop(columns=["id"]),
                         hide_index=True, use_container_width=True)
            st.caption("Project value, cash collected and recognised sales are kept separate. Revenue recognition "
                       "is not inferred — confirm accounting treatment with your bookkeeper.")
            with st.form(f"new_project_{cid}", clear_on_submit=True):
                title = st.text_input("Project title")
                svcs = {s["name"]: s["id"] for s in list_services(c)}
                svc = st.selectbox("Service", list(svcs))
                stage = st.selectbox("Stage", ["discussed", "quoted", "booked", "in_progress", "delivered", "cancelled"],
                                     index=2)
                val = st.text_input("Agreed project value (optional, e.g. 600.00)")
                booked = st.date_input("Booked / start date", value=None)
                if st.form_submit_button("Create project"):
                    cents = None
                    if val.strip():
                        try:
                            cents = abs(to_cents(parse_amount(val)[0]))
                        except ValueError:
                            st.error("Project value is not a valid amount")
                            st.stop()
                    run_action(create_project, c, cid, title, service_id=svcs[svc], stage=stage,
                               project_value_cents=cents, booked_at=booked.isoformat() if booked else None,
                               success="Project created")
                    st.rerun()
        with t4:
            ops = metrics.cross_sell_opportunities(c, cid)
            st.caption("Based only on documented, verified purchases. These are prompts for follow-up, not predictions.")
            if ops:
                for o in ops:
                    st.markdown(f"- {o}")
            else:
                st.write("No evidence-backed opportunities yet (needs verified payments with services).")
            if not convs.empty:
                st.caption(f"{len(convs)} linked conversation(s), {int(convs.message_count.sum())} messages "
                           "(view excerpts on the Evidence page).")
        with t5:
            st.warning("Merging moves all transactions, projects, conversations and identifiers to the target. "
                       "Inspect both profiles first. Every merge can be undone.")
            others = {k: v for k, v in opts.items() if v != cid}
            target_label = st.selectbox("Merge THIS customer into…", list(others), index=None)
            if target_label:
                tid = others[target_label]
                a, b = st.columns(2)
                for col, (lbl, xid) in zip((a, b), ((label, cid), (target_label, tid))):
                    i, tx, pr, cv = _profile_frames(c, xid)
                    col.markdown(f"**{lbl.split(' · ')[0]}**")
                    col.dataframe(i[["identifier_type", "raw_value", "verification_status"]], hide_index=True)
                    col.caption(f"{len(tx)} transactions · {len(pr)} projects · {len(cv)} conversations")
                ok = st.checkbox("I have reviewed both profiles and they are the same person")
                if st.button("Merge customers", type="primary", disabled=not ok):
                    run_action(merge_clients, c, cid, tid, confirm=ok, reason="merged from customer profile",
                               success="Customers merged")
                    st.rerun()

    merges = pd.read_sql_query(
        """SELECT m.id, s.display_name AS merged_customer, t.display_name AS into_customer, m.created_at
           FROM client_merges m JOIN clients s ON s.id = m.source_client_id JOIN clients t ON t.id = m.target_client_id
           WHERE m.status = 'active' ORDER BY m.created_at DESC""", c)
    if not merges.empty:
        with st.expander(f"Merge history ({len(merges)}) — undo a mistaken merge"):
            st.dataframe(merges.drop(columns=["id"]), hide_index=True)
            mid = st.selectbox("Merge to undo", merges["id"], format_func=lambda i: " → ".join(
                merges.set_index("id").loc[i, ["merged_customer", "into_customer"]]))
            sure = st.checkbox("Confirm undo of this merge")
            if st.button("Undo merge", disabled=not sure):
                run_action(undo_merge, c, mid, confirm=sure, success="Merge undone")
                st.rerun()
    c.close()
