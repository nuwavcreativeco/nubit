import pandas as pd
import streamlit as st

from ...money import format_cents
from ..common import conn

EXCERPT_CHARS = 300


def render():
    c = conn()
    st.title("Evidence viewer")
    st.caption("Shows the source file, record ID, date and a short excerpt behind each record. Imported text is "
               "displayed as plain text; full conversations are not shown — only the minimum context you request.")
    tab_t, tab_m = st.tabs(["Transactions", "Message excerpts"])
    with tab_t:
        q = st.text_input("Search by transaction ID, source record ID, counterparty or amount (e.g. 150.00)")
        if q:
            like = f"%{q.strip()}%"
            cents = None
            try:
                cents = int(round(float(q.replace("$", "").replace(",", "")) * 100))
            except ValueError:
                pass
            df = pd.read_sql_query(
                """SELECT t.id, t.transaction_date, t.source_type, t.source_record_id, t.direction, t.txn_type,
                          t.gross_amount_cents, t.counterparty_raw, t.verification_status, j.original_filename
                   FROM transactions t LEFT JOIN import_jobs j ON j.id = t.import_job_id
                   WHERE t.id LIKE ? OR t.source_record_id LIKE ? OR t.counterparty_raw LIKE ? OR t.gross_amount_cents = ?
                   ORDER BY t.transaction_date DESC LIMIT 100""", c, params=(like, like, like, cents if cents is not None else -1))
            if df.empty:
                st.info("No matching transactions.")
            else:
                df["amount"] = df.pop("gross_amount_cents").map(format_cents)
                st.dataframe(df, hide_index=True, use_container_width=True)
                tid = st.selectbox("Inspect", df["id"])
                t = c.execute("SELECT * FROM transactions WHERE id = ?", (tid,)).fetchone()
                a, b = st.columns(2)
                a.markdown("**Normalised record**")
                a.dataframe(pd.DataFrame({"field": ["date", "type", "direction", "gross", "fee", "net", "status",
                                                    "verification", "classification reason", "duplicate of",
                                                    "transfer pair"],
                                          "value": [t["transaction_date"], t["txn_type"], t["direction"],
                                                    format_cents(t["gross_amount_cents"]), format_cents(t["fee_amount_cents"]),
                                                    format_cents(t["net_amount_cents"]), t["source_status"],
                                                    t["verification_status"], t["classification_reason"],
                                                    t["duplicate_of_id"] or "", t["transfer_pair_id"] or ""]}),
                            hide_index=True, use_container_width=True)
                b.markdown("**Original source row (unchanged)**")
                b.json(t["raw_json"], expanded=True)
                ev = pd.read_sql_query("SELECT evidence_type, source_filename, source_record_id, occurred_at, excerpt "
                                       "FROM evidence WHERE transaction_id = ?", c, params=(tid,))
                st.markdown("**Evidence rows**")
                st.dataframe(ev, hide_index=True, use_container_width=True)
                hist = pd.read_sql_query("SELECT occurred_at, actor, action, before_json, after_json, reason "
                                         "FROM audit_log WHERE entity_type='transactions' AND entity_id = ? ORDER BY id",
                                         c, params=(tid,))
                if not hist.empty:
                    st.markdown("**Change history**")
                    st.dataframe(hist, hide_index=True, use_container_width=True)
    with tab_m:
        q = st.text_input("Search message text (min. 3 characters)")
        if q and len(q.strip()) >= 3:
            df = pd.read_sql_query(
                """SELECT m.id, m.sent_at, m.sender_role, cv.source_type, COALESCE(c.display_name, '') AS customer,
                          substr(m.body_text, 1, ?) AS excerpt
                   FROM conversation_messages m JOIN conversations cv ON cv.id = m.conversation_id
                   LEFT JOIN clients c ON c.id = cv.client_id
                   WHERE m.body_text LIKE ? ORDER BY m.sent_at DESC LIMIT 50""",
                c, params=(EXCERPT_CHARS, f"%{q.strip()}%"))
            st.dataframe(df.drop(columns=["id"]), hide_index=True, use_container_width=True)
            if not df.empty:
                mid = st.selectbox("Show surrounding context for", df["id"], format_func=lambda i: " · ".join(
                    str(x) for x in df.set_index("id").loc[i, ["sent_at", "excerpt"]])[:120])
                n = st.slider("Messages before/after", 0, 5, 2)
                m = c.execute("SELECT conversation_id, sent_at FROM conversation_messages WHERE id = ?", (mid,)).fetchone()
                ctx = pd.read_sql_query(
                    """SELECT sent_at, sender_role, substr(body_text, 1, ?) AS text FROM (
                         SELECT * FROM conversation_messages WHERE conversation_id = ? AND sent_at <= ?
                         ORDER BY sent_at DESC LIMIT ?) UNION ALL SELECT sent_at, sender_role, substr(body_text, 1, ?) FROM (
                         SELECT * FROM conversation_messages WHERE conversation_id = ? AND sent_at > ?
                         ORDER BY sent_at LIMIT ?) ORDER BY sent_at""",
                    c, params=(EXCERPT_CHARS, m["conversation_id"], m["sent_at"], n + 1,
                               EXCERPT_CHARS, m["conversation_id"], m["sent_at"], n))
                for r in ctx.itertuples():
                    st.text(f"[{r.sent_at}] {r.sender_role}: {r.text}")
    c.close()
