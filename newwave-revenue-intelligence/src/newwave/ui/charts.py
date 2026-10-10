"""Plotly figure builders.

Palette: the validated reference categorical palette, dark-mode steps,
checked against the dashboard surface (#0F1117) with the dataviz validator.
Slot order is fixed; colors follow the series, never its rank. Unverified
amounts use a neutral dashed line so they never look like headline revenue.
"""
from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go

SURFACE = "#0F1117"
TEXT = "#E6E8EF"
TEXT_SECONDARY = "#c3c2b7"
MUTED = "#898781"
GRID = "#2c2c2a"
SERIES = {"primary": "#3987e5", "secondary": "#199e70", "refund": "#d95926"}
UNVERIFIED = "#898781"


def _layout(fig: go.Figure, title: str, y_title: str = "", height: int = 360) -> go.Figure:
    fig.update_layout(
        title=dict(text=title, font=dict(size=15, color=TEXT), x=0, xanchor="left"),
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", height=height,
        font=dict(color=TEXT_SECONDARY, size=12), margin=dict(l=8, r=8, t=48, b=8),
        legend=dict(orientation="h", yanchor="bottom", y=1.0, xanchor="right", x=1, bgcolor="rgba(0,0,0,0)"),
        hovermode="x unified", bargap=0.25, barcornerradius=4,
        hoverlabel=dict(bgcolor="#181B25", font_color=TEXT, bordercolor=GRID),
    )
    fig.update_xaxes(showgrid=False, linecolor=GRID, tickfont=dict(color=MUTED))
    fig.update_yaxes(gridcolor=GRID, gridwidth=1, zeroline=True, zerolinecolor=GRID, tickprefix="$",
                     tickformat=",.0f", title_text=y_title, tickfont=dict(color=MUTED))
    return fig


def _dollars(s: pd.Series) -> pd.Series:
    return s.astype("int64") / 100.0


def monthly_trend(m: pd.DataFrame) -> go.Figure:
    fig = go.Figure()
    fig.add_bar(x=m["month"], y=_dollars(m["verified_net"]), name="Verified net collected",
                marker_color=SERIES["primary"], marker_line_width=0,
                hovertemplate="%{y:$,.2f}<extra>Verified net</extra>")
    if (m["unverified_payments"] > 0).any():
        fig.add_scatter(x=m["month"], y=_dollars(m["unverified_payments"]), name="Unverified (not in totals)",
                        mode="lines+markers", line=dict(color=UNVERIFIED, width=2, dash="dash"),
                        marker=dict(size=8, line=dict(color=SURFACE, width=2)),
                        hovertemplate="%{y:$,.2f}<extra>Unverified</extra>")
    return _layout(fig, "Monthly verified net collected")


def payments_refunds(m: pd.DataFrame) -> go.Figure:
    fig = go.Figure()
    fig.add_scatter(x=m["month"], y=_dollars(m["verified_gross"]), name="Payments", mode="lines+markers",
                    line=dict(color=SERIES["primary"], width=2), marker=dict(size=8, line=dict(color=SURFACE, width=2)),
                    hovertemplate="%{y:$,.2f}<extra>Payments</extra>")
    fig.add_scatter(x=m["month"], y=_dollars(m["verified_refunds"]), name="Refunds & reversals",
                    mode="lines+markers", line=dict(color=SERIES["refund"], width=2),
                    marker=dict(size=8, line=dict(color=SURFACE, width=2)),
                    hovertemplate="%{y:$,.2f}<extra>Refunds</extra>")
    return _layout(fig, "Verified payments and refunds")


def new_vs_repeat(df: pd.DataFrame) -> go.Figure:
    fig = go.Figure()
    fig.add_bar(x=df["month"], y=_dollars(df["new_customer_cents"]), name="First-time customers",
                marker_color=SERIES["primary"], marker_line=dict(color=SURFACE, width=2),
                hovertemplate="%{y:$,.2f}<extra>First-time</extra>")
    fig.add_bar(x=df["month"], y=_dollars(df["repeat_customer_cents"]), name="Returning customers",
                marker_color=SERIES["secondary"], marker_line=dict(color=SURFACE, width=2),
                hovertemplate="%{y:$,.2f}<extra>Returning</extra>")
    fig.update_layout(barmode="stack")
    return _layout(fig, "Verified revenue: first-time vs returning customers")


def ranked_bars(df: pd.DataFrame, label_col: str, title: str) -> go.Figure:
    """Single-series magnitude: one hue, sorted, horizontal, direct labels."""
    d = df.sort_values("net_cents")
    fig = go.Figure(go.Bar(
        y=d[label_col], x=_dollars(d["net_cents"]), orientation="h", marker_color=SERIES["primary"],
        text=[f"${v:,.0f}" for v in _dollars(d["net_cents"])], textposition="outside",
        textfont=dict(color=TEXT_SECONDARY), cliponaxis=False,
        customdata=d["transactions"], hovertemplate="%{y}: %{x:$,.2f} · %{customdata} txns<extra></extra>"))
    fig = _layout(fig, title, height=max(240, 44 * len(d) + 80))
    fig.update_layout(hovermode="closest", showlegend=False)
    fig.update_xaxes(tickprefix="$", tickformat=",.0f", gridcolor=GRID, showgrid=True)
    fig.update_yaxes(showgrid=False, tickprefix="", tickfont=dict(color=TEXT_SECONDARY))
    return fig
