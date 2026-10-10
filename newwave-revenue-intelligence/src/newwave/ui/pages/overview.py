import streamlit as st

from ...analytics import metrics
from .. import charts
from ..common import conn, filter_bar, money


def render():
    c = conn()
    st.title("Overview")
    st.caption("Headline figures count **verified** records only. Unverified and unexplained amounts are shown "
               "separately below and are never mixed into the headline.")
    f = filter_bar(c, "ov", with_dims=False)
    o = metrics.overview(c, f)

    st.subheader("Verified collected revenue")
    k = st.columns(4)
    k[0].metric("Net collected sales", money(o.net_collected_cents),
                help="Verified payments − verified refunds − verified reversals.")
    k[1].metric("Gross payments", money(o.gross_payments_cents))
    k[2].metric("Refunds & reversals", money(o.refunds_cents + o.reversals_cents))
    k[3].metric("Processing fees", money(o.fees_cents), help="Fees on verified payments + verified fee rows.")
    k = st.columns(4)
    k[0].metric("Unique verified customers", o.unique_customers)
    k[1].metric("Repeat-customer rate", f"{o.repeat_rate:.0%}" if o.repeat_rate is not None else "—",
                help="Customers with 2+ purchase occasions (an allocated project, or a calendar month of "
                     "unallocated payments) ÷ unique verified customers.")
    k[2].metric("Avg net revenue / customer", money(o.avg_revenue_per_customer_cents))
    k[3].metric("Verified expenses", money(o.expenses_cents),
                help=f"Unverified expenses not counted: {money(o.expenses_unverified_cents)}")
    if o.profit_cents is not None:
        st.metric("Profit", money(o.profit_cents), help=o.profit_note)
    else:
        st.info(o.profit_note, icon=":material/info:")
    if o.verified_without_client_cents:
        st.caption(f"Includes {money(o.verified_without_client_cents)} of verified payments not yet linked to a customer.")

    m = metrics.monthly_series(c, f)
    if not m.empty:
        st.plotly_chart(charts.monthly_trend(m), use_container_width=True, config={"displaylogo": False})

    st.subheader("Not included in headline totals")
    k = st.columns(4)
    k[0].metric("Unverified candidate payments", money(o.unverified_payments_cents),
                help=f"{o.unverified_payments_count} payment(s) awaiting review.")
    k[1].metric("Unexplained inflows", money(o.unknown_inflows_cents),
                help=f"{o.unknown_inflows_count} deposit(s)/inflow(s) of unknown origin — not assumed to be revenue.")
    k[2].metric("Owner transfers (never revenue)", money(o.owner_transfers_cents))
    k[3].metric("Items awaiting review", o.pending_reviews)
    if o.coverage_ratio is not None:
        st.progress(min(o.coverage_ratio, 1.0),
                    text=f"Reconciliation coverage: {o.coverage_ratio:.0%} of incoming money (by amount) has been reviewed")
    with st.expander("What is excluded from these figures?"):
        st.markdown("- Owner transfers and personal transactions are never revenue or expense.\n"
                    "- Unverified rows are reported separately until a reviewer approves them.\n"
                    "- Profit is only shown when expense records are confirmed complete for every month in range.")
        for n in o.excluded_notes:
            st.markdown(f"- {n}")
    c.close()
