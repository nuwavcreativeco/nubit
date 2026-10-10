import pandas as pd
import streamlit as st

from ...money import format_cents
from ...normalization.identifiers import normalize_identifier
from ...records import add_identifier, bulk_set_transactions, create_client, set_transaction_fields
from ...reconciliation import queue, review
from ...reconciliation.runner import run_reconciliation
from ..common import TXN_TYPE_LABELS, client_options, conn, money_df, run_action

BAND_ICON = {"high": "🟢 high", "medium": "🟡 medium", "low": "🟠 low"}
CANDIDATE_LABEL = {
    "txn_client": "Payment → customer", "txn_project": "Payment → project", "duplicate_txn": "Duplicate transaction",
    "owner_transfer": "Owner transfer", "txn_classification": "Reclassify transaction",
    "client_merge": "Possible same customer", "service_classification": "Service for payment",
}


def _describe(r) -> str:
    amt = format_cents(int(r["gross_amount_cents"])) if pd.notna(r["gross_amount_cents"]) else ""
    if r["candidate_type"] == "client_merge":
        return f"{r['related_client']} ⇢ {r['proposed_client']}"
    parts = [x for x in (r["transaction_date"] if pd.notna(r["transaction_date"]) else "no date", amt,
                         r["direction"], r["payment_method"]) if isinstance(x, str) and x]
    if isinstance(r["counterparty_raw"], str) and r["counterparty_raw"]:
        parts.append(f"from/to “{r['counterparty_raw']}”")
    target = next((x for x in (r["proposed_client"], r["proposed_project"], r["proposed_value"])
                   if isinstance(x, str) and x), "")
    if r["proposed_project"]:
        pa = r["proposed_amount_cents"]
        target = f"project “{r['proposed_project']}” ({format_cents(int(pa)) if pd.notna(pa) else '—'})"
    return " · ".join(parts) + (f"  →  {target}" if target else "")


def _candidate_cards(c, df, key):
    if df.empty:
        st.success("Nothing to review here.")
        return
    st.caption(f"{len(df)} item(s). Confidence bands are rule-based evidence strength, not probabilities. "
               "Nothing is applied until you approve it.")
    for r in df.head(50).to_dict("records"):
        with st.container(border=True):
            top = st.columns([6, 2])
            top[0].markdown(f"**{CANDIDATE_LABEL[r['candidate_type']]}** · {BAND_ICON[r['confidence_band']]} "
                            f"({r['confidence_score']:.2f}) · `{r['method']}`"
                            + (" · 🤖 AI suggestion" if r["created_by"] == "ai" else "")
                            + (" · ⏸ deferred" if r["review_status"] == "deferred" else ""))
            st.text(_describe(r))
            st.text("Why: " + r["explanation"])
            with st.expander("Evidence"):
                ev = queue.candidate_evidence(c, r["id"])
                st.dataframe(ev.drop(columns=["id"]), hide_index=True, use_container_width=True)
            a, b, d, opt = st.columns([1, 1, 1, 3])
            kwargs = {}
            if r["candidate_type"] == "txn_client":
                kwargs["verify_identifier"] = opt.checkbox("Also verify this payment handle for the customer",
                                                           key=f"vi_{r['id']}")
            if r["candidate_type"] == "client_merge":
                kwargs["confirm_merge"] = opt.checkbox("I inspected both customers — same person",
                                                       key=f"cm_{r['id']}")
            if a.button("Approve", key=f"ap_{key}_{r['id']}", type="primary"):
                if run_action(review.approve, c, r["id"], success="Approved", **kwargs):
                    st.rerun()
            if b.button("Reject", key=f"rj_{key}_{r['id']}"):
                run_action(review.reject, c, r["id"], success="Rejected")
                st.rerun()
            if r["review_status"] == "pending" and d.button("Defer", key=f"df_{key}_{r['id']}"):
                run_action(review.defer, c, r["id"], success="Deferred")
                st.rerun()
    if len(df) > 50:
        st.caption(f"Showing the first 50 of {len(df)}.")


def _transaction_queue(c, q):
    df = queue.transactions_queue(c, q)
    if df.empty:
        st.success("Nothing in this queue.")
        return
    st.dataframe(money_df(df, ["gross_amount_cents"]).drop(columns=["id"]), hide_index=True, use_container_width=True)
    pick = st.selectbox("Work on transaction", df["id"], key=f"pick_{q}", format_func=lambda i: " · ".join(
        str(x) for x in df.set_index("id").loc[i, ["transaction_date", "gross_amount_cents", "counterparty_raw"]]))
    row = df.set_index("id").loc[pick]
    a, b = st.columns(2)
    with a.container(border=True):
        st.markdown("**Classify**")
        new_type = st.selectbox("Transaction type", list(TXN_TYPE_LABELS), format_func=TXN_TYPE_LABELS.get,
                                index=list(TXN_TYPE_LABELS).index(row["txn_type"]), key=f"type_{q}")
        status = st.selectbox("Verification", ["verified", "unverified", "needs_review", "excluded"],
                              index=["verified", "unverified", "needs_review", "excluded"].index(row["verification_status"]),
                              key=f"ver_{q}")
        reason = st.text_input("Reason (kept in the audit log)", key=f"reason_{q}")
        if st.button("Save classification", key=f"save_{q}"):
            run_action(set_transaction_fields, c, pick, {"txn_type": new_type, "verification_status": status},
                       reason=reason, success="Saved")
            st.rerun()
    with b.container(border=True):
        st.markdown("**Link to a customer**")
        opts = client_options(c)
        existing = st.selectbox("Existing customer", list(opts), index=None, key=f"cl_{q}")
        new_name = st.text_input("…or create a new customer named", value=row["counterparty_raw"] or "", key=f"nn_{q}")
        add_handle = bool(row["counterparty_handle"]) and st.checkbox(
            f"Save {row['counterparty_handle_type']} '{row['counterparty_handle']}' as a VERIFIED identifier",
            key=f"ah_{q}")
        verify = st.checkbox("Mark this transaction verified", value=row["txn_type"] == "payment_received",
                             key=f"vt_{q}")
        if st.button("Link", key=f"link_{q}", type="primary"):
            cid = opts.get(existing) if existing else None
            if cid is None:
                res = run_action(create_client, c, new_name, success="Customer created")
                cid = res[0] if res else None
            if cid:
                changes = {"client_id": cid}
                if verify:
                    changes["verification_status"] = "verified"
                run_action(set_transaction_fields, c, pick, changes, reason="manual link", success="Linked")
                if add_handle and normalize_identifier(row["counterparty_handle_type"], row["counterparty_handle"]):
                    run_action(add_identifier, c, cid, row["counterparty_handle_type"], row["counterparty_handle"],
                               verified=True, success="Identifier saved")
                st.rerun()
    with st.expander("Bulk action on every row in this queue"):
        bulk_type = st.selectbox("Set type", list(TXN_TYPE_LABELS), format_func=TXN_TYPE_LABELS.get, key=f"bt_{q}")
        sure = st.checkbox(f"I confirm changing {len(df)} transaction(s)", key=f"bs_{q}")
        if st.button("Apply bulk change", disabled=not sure, key=f"ba_{q}"):
            run_action(bulk_set_transactions, c, df["id"].tolist(), {"txn_type": bulk_type}, confirm=sure,
                       reason="bulk change from reconciliation center", success="Bulk change applied (undo in History)")
            st.rerun()


def render():
    c = conn()
    st.title("Reconciliation center")
    top = st.columns([3, 1])
    top[0].caption("Every decision is audit-logged and can be undone from the History tab.")
    if top[1].button("Run reconciliation checks", type="primary", use_container_width=True):
        stats = run_reconciliation(c)
        st.toast("Checks complete: " + ", ".join(f"{k} {v}" for k, v in stats.items() if k != "run_id" and v))
    counts = queue.queue_counts(c)
    names = list(queue.QUEUES) + ["history"]
    labels = [f"{queue.QUEUES[q]} ({counts[q]})" for q in queue.QUEUES] + ["History & undo"]
    choice = st.radio("Queue", names, format_func=lambda q: labels[names.index(q)], horizontal=False,
                      label_visibility="collapsed", key="recon_queue")
    st.divider()
    if choice == "history":
        hist = queue.decided_candidates(c)
        st.dataframe(money_df(hist, ["gross_amount_cents"]).drop(columns=["id"]), hide_index=True,
                     use_container_width=True)
        if not hist.empty:
            pick = st.selectbox("Decision to undo", hist["id"], format_func=lambda i: " · ".join(
                str(x) for x in hist.set_index("id").loc[i, ["candidate_type", "review_status", "reviewed_at"]]))
            sure = st.checkbox("Confirm undo (restores the previous state of every record this decision changed)")
            if st.button("Undo decision", disabled=not sure):
                run_action(review.undo_review, c, pick, confirm=sure, success="Undone")
                st.rerun()
    elif choice in queue.CANDIDATE_TYPES or choice == "ai":
        _candidate_cards(c, queue.candidates(c, choice), choice)
    else:
        _transaction_queue(c, choice)
    c.close()
