"""Shared dashboard helpers. Imported content is always rendered as plain
text (st.text / dataframes), never as HTML or markdown."""
from __future__ import annotations

import re
import sqlite3
from datetime import date

import pandas as pd
import streamlit as st

from ..analytics.metrics import Filters
from ..config import Settings, load_settings
from ..database.connection import open_database
from ..money import format_cents
from ..records import RecordError

_MD_SPECIAL = re.compile(r"([\\`*_{}\[\]()#+\-.!|<>~$])")


def md_escape(text: object) -> str:
    """Escape imported text before it is placed inside markdown."""
    return _MD_SPECIAL.sub(r"\\\1", str(text or ""))


def settings() -> Settings:
    return load_settings()


def conn() -> sqlite3.Connection:
    """A fresh connection per script run (SQLite connections are thread-bound)."""
    return open_database(settings().database_path)


def money(cents: int | None) -> str:
    return "—" if cents is None else format_cents(cents)


def money_df(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    out = df.copy()
    for c in cols:
        if c in out:
            out[c] = out[c].map(lambda v: format_cents(int(v)) if pd.notna(v) else "")
    return out


def data_bounds(c: sqlite3.Connection) -> tuple[date, date]:
    r = c.execute("SELECT MIN(transaction_date), MAX(transaction_date) FROM transactions "
                  "WHERE transaction_date IS NOT NULL").fetchone()
    if not r[0]:
        today = date.today()
        return date(today.year, 1, 1), today
    return date.fromisoformat(r[0]), date.fromisoformat(r[1])


def filter_bar(c: sqlite3.Connection, key: str, with_dims: bool = True) -> Filters:
    """Filters in one row above the charts."""
    lo, hi = data_bounds(c)
    cols = st.columns([2, 2, 2] if with_dims else [2, 4])
    rng = cols[0].date_input("Date range", value=(lo, hi), key=f"{key}_dates", format="YYYY-MM-DD")
    start, end = (rng if isinstance(rng, (tuple, list)) and len(rng) == 2 else (lo, hi))
    methods, services = [], []
    if with_dims:
        all_methods = [r[0] for r in c.execute("SELECT DISTINCT payment_method FROM transactions ORDER BY 1")]
        methods = cols[1].multiselect("Payment method", all_methods, key=f"{key}_methods",
                                      placeholder="All methods")
        svc = [(r["code"], r["name"]) for r in c.execute("SELECT code, name FROM service_catalog ORDER BY sort_order")]
        picked = cols[2].multiselect("Service", [n for _, n in svc], key=f"{key}_svc", placeholder="All services")
        services = [code for code, n in svc if n in picked]
    return Filters(start=start.isoformat(), end=end.isoformat(), payment_methods=methods, service_codes=services)


def run_action(fn, *args, success: str = "Done.", **kwargs):
    """Execute a write action, surfacing validation errors instead of crashing."""
    try:
        result = fn(*args, **kwargs)
    except (RecordError, ValueError, KeyError) as exc:
        st.error(str(exc))
        return None
    st.toast(success)
    return result


def client_options(c: sqlite3.Connection) -> dict[str, str]:
    rows = c.execute("SELECT id, display_name FROM clients WHERE status='active' ORDER BY display_name").fetchall()
    return {f"{r['display_name']} · {r['id'][-6:]}": r["id"] for r in rows}


TXN_TYPE_LABELS = {
    "payment_received": "Payment received", "refund": "Refund", "reversal": "Payment reversal",
    "processing_fee": "Processing fee", "expense": "Expense", "owner_transfer": "Owner transfer",
    "personal": "Personal", "unknown": "Unknown",
}
