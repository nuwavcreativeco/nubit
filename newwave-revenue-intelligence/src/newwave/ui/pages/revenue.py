import streamlit as st

from ...analytics import metrics
from .. import charts
from ..common import conn, filter_bar, money_df

CFG = {"displaylogo": False}


def render():
    c = conn()
    st.title("Revenue analytics")
    st.caption("All charts use verified records only, except the dashed 'unverified' line, which is shown for "
               "context and is not part of any total.")
    f = filter_bar(c, "rev")
    m = metrics.monthly_series(c, f)
    if m.empty:
        st.info("No transactions match these filters yet. Import data on the Imports page.")
        c.close()
        return
    tab_trend, tab_mix, tab_cust, tab_tables = st.tabs(["Trends", "Methods & services", "New vs returning", "Tables"])
    with tab_trend:
        st.plotly_chart(charts.monthly_trend(m), use_container_width=True, config=CFG)
        st.plotly_chart(charts.payments_refunds(m), use_container_width=True, config=CFG)
    with tab_mix:
        a, b = st.columns(2)
        pm = metrics.breakdown(c, "payment_method", f)
        sv = metrics.breakdown(c, "service_name", f)
        if not pm.empty:
            a.plotly_chart(charts.ranked_bars(pm, "payment_method", "Verified net by payment method"),
                           use_container_width=True, config=CFG)
        if not sv.empty:
            b.plotly_chart(charts.ranked_bars(sv, "service_name", "Verified net by service"),
                           use_container_width=True, config=CFG)
        st.caption("Service comes from the project a payment is allocated to, else the service approved on the "
                   "payment itself; anything else is 'Unknown / unclassified'.")
    with tab_cust:
        nvr = metrics.new_vs_repeat(c, f)
        if nvr.empty:
            st.info("No verified customer payments in range.")
        else:
            st.plotly_chart(charts.new_vs_repeat(nvr), use_container_width=True, config=CFG)
            st.caption("'First-time' is judged against all verified history, not just the selected range.")
    with tab_tables:
        st.markdown("**Monthly**")
        st.dataframe(money_df(m, ["verified_gross", "verified_refunds", "verified_net", "unverified_payments"]),
                     hide_index=True, use_container_width=True)
        st.markdown("**Annual**")
        y = metrics.annual_series(c, f)
        st.dataframe(money_df(y, ["verified_gross", "verified_refunds", "verified_net", "unverified_payments"]),
                     hide_index=True, use_container_width=True)
    c.close()
