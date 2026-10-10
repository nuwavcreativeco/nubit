"""Revenue analytics.

Definitions (also in docs/METRICS.md):

* Eligible ledger row: not a confirmed duplicate, not excluded, source status
  'completed', in the reporting currency, with a valid date.
* Verified: verification_status = 'verified' (a reviewer approved it).
  Headline figures use verified rows ONLY. Unverified amounts are reported
  separately and never mixed into headline totals.
* Gross payments  = sum(gross) of verified payment_received.
* Refunds         = sum(amount) of verified refund rows; reversals likewise.
* Net collected   = gross payments - refunds - reversals.
* Fees            = fees on verified payments + verified processing_fee rows.
* Expenses        = verified expense rows (gross).
* Profit          = net collected - fees - expenses, shown ONLY when every
                    month in the range is marked "expense records complete".
* Owner transfers and personal transactions are never revenue or expense.

All arithmetic is in integer cents.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import date

import pandas as pd

LEDGER_SQL = """
SELECT t.id, t.transaction_date, substr(t.transaction_date, 1, 7) AS month,
       substr(t.transaction_date, 1, 4) AS year, t.direction, t.txn_type, t.payment_method, t.source_type,
       t.verification_status, t.classification_source, t.source_status, t.currency,
       t.gross_amount_cents, t.fee_amount_cents, t.refund_amount_cents, t.net_amount_cents,
       t.client_id, c.display_name AS client_name, t.service_id, t.counterparty_raw, t.memo,
       t.source_record_id, t.import_job_id, t.duplicate_of_id, t.is_demo
FROM transactions t
LEFT JOIN clients c ON c.id = t.client_id
WHERE t.duplicate_of_id IS NULL
  AND t.verification_status <> 'excluded'
  AND t.source_status = 'completed'
  AND t.currency = ?
  AND t.transaction_date IS NOT NULL
"""


@dataclass
class Filters:
    start: str | None = None          # ISO date inclusive
    end: str | None = None            # ISO date inclusive
    payment_methods: list[str] = field(default_factory=list)
    service_codes: list[str] = field(default_factory=list)
    include_demo: bool = True


def load_ledger(conn: sqlite3.Connection, filters: Filters | None = None, base_currency: str = "USD") -> pd.DataFrame:
    f = filters or Filters()
    sql = LEDGER_SQL
    params: list = [base_currency]
    if f.start:
        sql += " AND t.transaction_date >= ?"
        params.append(f.start)
    if f.end:
        sql += " AND t.transaction_date <= ?"
        params.append(f.end)
    if f.payment_methods:
        sql += f" AND t.payment_method IN ({','.join('?' for _ in f.payment_methods)})"
        params += f.payment_methods
    if not f.include_demo:
        sql += " AND t.is_demo = 0"
    df = pd.read_sql_query(sql + " ORDER BY t.transaction_date, t.id", conn, params=params)
    for col in ("gross_amount_cents", "fee_amount_cents", "refund_amount_cents", "net_amount_cents"):
        df[col] = df[col].astype("int64")
    df = attach_services(conn, df)
    if f.service_codes:
        df = df[df["service_code"].isin(f.service_codes)]
    return df


def attach_services(conn: sqlite3.Connection, df: pd.DataFrame) -> pd.DataFrame:
    """Service per transaction: allocated project's service, else the
    transaction's own service, else 'unclassified'. A transaction split across
    projects of different services takes the service of its largest allocation."""
    if df.empty:
        df["service_code"] = pd.Series(dtype=str)
        df["service_name"] = pd.Series(dtype=str)
        return df
    alloc = pd.read_sql_query(
        """SELECT a.transaction_id AS id, s.code, s.name, a.amount_cents FROM transaction_allocations a
           JOIN projects p ON p.id = a.project_id JOIN service_catalog s ON s.id = p.service_id
           WHERE a.status = 'active' ORDER BY a.amount_cents DESC""", conn)
    alloc = alloc.drop_duplicates("id")
    own = pd.read_sql_query("SELECT id AS service_id, code AS own_code, name AS own_name FROM service_catalog", conn)
    out = df.merge(alloc[["id", "code", "name"]], on="id", how="left").merge(own, on="service_id", how="left")
    out["service_code"] = out["code"].where(out["code"].notna(), out["own_code"]).where(
        lambda s: s.notna(), "unclassified").astype(str)
    out["service_name"] = out["name"].where(out["name"].notna(), out["own_name"]).where(
        lambda s: s.notna(), "Unknown / unclassified").astype(str)
    return out.drop(columns=["code", "name", "own_code", "own_name"])


def _sum(df: pd.DataFrame, mask, col: str = "gross_amount_cents") -> int:
    return int(df.loc[mask, col].sum()) if len(df) else 0


def months_in_range(start: str, end: str) -> list[str]:
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    out, y, m = [], s.year, s.month
    while (y, m) <= (e.year, e.month):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


@dataclass
class Overview:
    gross_payments_cents: int
    refunds_cents: int
    reversals_cents: int
    net_collected_cents: int
    fees_cents: int
    net_after_fees_cents: int
    expenses_cents: int
    expenses_unverified_cents: int
    profit_cents: int | None
    profit_note: str
    unique_customers: int
    repeat_customers: int
    repeat_rate: float | None
    avg_revenue_per_customer_cents: int | None
    verified_without_client_cents: int
    unverified_payments_cents: int
    unverified_payments_count: int
    unknown_inflows_cents: int
    unknown_inflows_count: int
    owner_transfers_cents: int
    coverage_ratio: float | None
    pending_reviews: int
    excluded_notes: list[str]


def purchase_occasions(conn: sqlite3.Connection, df: pd.DataFrame) -> pd.Series:
    """Occasions per client: each allocated project counts once; unallocated
    verified payments count once per calendar month."""
    pay = df[(df.txn_type == "payment_received") & (df.verification_status == "verified") & df.client_id.notna()]
    if pay.empty:
        return pd.Series(dtype=int)
    alloc = pd.read_sql_query(
        "SELECT transaction_id AS id, project_id FROM transaction_allocations WHERE status = 'active'", conn)
    merged = pay.merge(alloc, on="id", how="left")
    merged["occasion"] = merged["project_id"].where(merged["project_id"].notna(), "month:" + merged["month"])
    return merged.groupby("client_id")["occasion"].nunique()


def overview(conn: sqlite3.Connection, filters: Filters | None = None, base_currency: str = "USD") -> Overview:
    f = filters or Filters()
    df = load_ledger(conn, f, base_currency)
    v = df.verification_status == "verified"
    pay = df.txn_type == "payment_received"
    gross = _sum(df, v & pay)
    refunds = _sum(df, v & (df.txn_type == "refund"))
    reversals = _sum(df, v & (df.txn_type == "reversal"))
    net = gross - refunds - reversals
    fees = _sum(df, v & pay, "fee_amount_cents") + _sum(df, v & (df.txn_type == "processing_fee"))
    expenses = _sum(df, v & (df.txn_type == "expense"))
    expenses_unv = _sum(df, ~v & (df.txn_type == "expense"))
    # profit only with confirmed expense coverage for every month in range
    profit, note = None, ""
    if df.empty:
        note = "No transactions in range."
    else:
        start = f.start or df["transaction_date"].min()
        end = f.end or df["transaction_date"].max()
        months = months_in_range(start, end)
        covered = {r[0] for r in conn.execute("SELECT month FROM expense_coverage")}
        missing = [m for m in months if m not in covered]
        if missing:
            note = (f"Profit not shown: expense records not confirmed complete for {len(missing)} of "
                    f"{len(months)} month(s) (e.g. {missing[0]}). Confirm coverage in Settings.")
        elif expenses_unv:
            note = "Profit not shown: some expenses in range are still unverified."
        else:
            profit = net - fees - expenses
            note = "Profit = net collected − fees − verified expenses (expense coverage confirmed)."
    cust = df[v & pay & df.client_id.notna()]
    unique = int(cust.client_id.nunique())
    occ = purchase_occasions(conn, df)
    repeat = int((occ >= 2).sum())
    per_client_net = (
        cust.groupby("client_id")["gross_amount_cents"].sum()
        .sub(df[v & df.txn_type.isin(["refund", "reversal"]) & df.client_id.notna()]
             .groupby("client_id")["gross_amount_cents"].sum(), fill_value=0)
    )
    avg = int(round(per_client_net.sum() / unique)) if unique else None
    unv_pay = df[~v & pay]
    unknown_in = df[(df.txn_type == "unknown") & (df.direction == "in")]
    transfers = _sum(df, df.txn_type == "owner_transfer")
    inflows = df[(df.direction == "in") & (df.txn_type != "owner_transfer")]
    reviewed = inflows[(inflows.verification_status == "verified") | (inflows.classification_source != "importer_rule")]
    total_in = int(inflows.gross_amount_cents.sum())
    coverage = (int(reviewed.gross_amount_cents.sum()) / total_in) if total_in else None
    pending = conn.execute(
        "SELECT COUNT(*) FROM match_candidates WHERE review_status IN ('pending','deferred')").fetchone()[0]
    excluded = exclusion_counts(conn, base_currency)
    return Overview(
        gross_payments_cents=gross, refunds_cents=refunds, reversals_cents=reversals, net_collected_cents=net,
        fees_cents=fees, net_after_fees_cents=net - fees, expenses_cents=expenses,
        expenses_unverified_cents=expenses_unv, profit_cents=profit, profit_note=note,
        unique_customers=unique, repeat_customers=repeat, repeat_rate=(repeat / unique) if unique else None,
        avg_revenue_per_customer_cents=avg,
        verified_without_client_cents=_sum(df, v & pay & df.client_id.isna()),
        unverified_payments_cents=int(unv_pay.gross_amount_cents.sum()), unverified_payments_count=len(unv_pay),
        unknown_inflows_cents=int(unknown_in.gross_amount_cents.sum()), unknown_inflows_count=len(unknown_in),
        owner_transfers_cents=transfers, coverage_ratio=coverage, pending_reviews=int(pending),
        excluded_notes=excluded,
    )


def exclusion_counts(conn: sqlite3.Connection, base_currency: str = "USD") -> list[str]:
    q = lambda sql, *p: conn.execute(sql, p).fetchone()[0]  # noqa: E731
    notes = []
    n = q("SELECT COUNT(*) FROM transactions WHERE duplicate_of_id IS NOT NULL")
    if n:
        notes.append(f"{n} confirmed duplicate row(s) excluded")
    n = q("SELECT COUNT(*) FROM transactions WHERE source_status <> 'completed'")
    if n:
        notes.append(f"{n} pending/failed/cancelled/refunded-at-source row(s) excluded")
    n = q("SELECT COUNT(*) FROM transactions WHERE currency <> ?", base_currency)
    if n:
        notes.append(f"{n} row(s) in another currency excluded (no conversion is assumed)")
    n = q("SELECT COUNT(*) FROM transactions WHERE transaction_date IS NULL")
    if n:
        notes.append(f"{n} row(s) with missing/invalid dates excluded from dated totals")
    n = q("SELECT COUNT(*) FROM transactions WHERE verification_status = 'excluded' AND duplicate_of_id IS NULL")
    if n:
        notes.append(f"{n} row(s) excluded by a reviewer")
    return notes


def monthly_series(conn: sqlite3.Connection, filters: Filters | None = None, base_currency: str = "USD") -> pd.DataFrame:
    df = load_ledger(conn, filters, base_currency)
    cols = ["month", "verified_gross", "verified_refunds", "verified_net", "unverified_payments"]
    if df.empty:
        return pd.DataFrame(columns=cols)
    v = df.verification_status == "verified"
    g = lambda mask: df[mask].groupby("month")["gross_amount_cents"].sum()  # noqa: E731
    out = pd.DataFrame({
        "verified_gross": g(v & (df.txn_type == "payment_received")),
        "verified_refunds": g(v & df.txn_type.isin(["refund", "reversal"])),
        "unverified_payments": g(~v & (df.txn_type == "payment_received")),
    }).fillna(0).astype("int64")
    all_months = months_in_range(df.transaction_date.min(), df.transaction_date.max())
    out = out.reindex(all_months, fill_value=0)
    out["verified_net"] = out["verified_gross"] - out["verified_refunds"]
    out.index.name = "month"
    return out.reset_index()[cols]


def annual_series(conn: sqlite3.Connection, filters: Filters | None = None, base_currency: str = "USD") -> pd.DataFrame:
    m = monthly_series(conn, filters, base_currency)
    if m.empty:
        return pd.DataFrame(columns=["year", "verified_gross", "verified_refunds", "verified_net", "unverified_payments"])
    m["year"] = m["month"].str[:4]
    return m.drop(columns=["month"]).groupby("year", as_index=False).sum()


def breakdown(conn: sqlite3.Connection, by: str, filters: Filters | None = None,
              base_currency: str = "USD") -> pd.DataFrame:
    """Verified net collected by 'payment_method' or 'service_name'."""
    df = load_ledger(conn, filters, base_currency)
    df = df[(df.verification_status == "verified") & df.txn_type.isin(["payment_received", "refund", "reversal"])]
    if df.empty:
        return pd.DataFrame(columns=[by, "net_cents", "transactions"])
    df = df.assign(signed=df.gross_amount_cents.where(df.txn_type == "payment_received", -df.gross_amount_cents))
    out = df.groupby(by).agg(net_cents=("signed", "sum"), transactions=("id", "count")).reset_index()
    return out.sort_values("net_cents", ascending=False)


def new_vs_repeat(conn: sqlite3.Connection, filters: Filters | None = None, base_currency: str = "USD") -> pd.DataFrame:
    """Monthly verified revenue from first-time vs returning customers.
    'First time' is judged against ALL verified history, not just the filter range."""
    full = load_ledger(conn, Filters(), base_currency)
    full = full[(full.verification_status == "verified") & (full.txn_type == "payment_received") & full.client_id.notna()]
    cols = ["month", "new_customer_cents", "repeat_customer_cents", "new_customers"]
    if full.empty:
        return pd.DataFrame(columns=cols)
    first = full.groupby("client_id")["month"].min().rename("first_month")
    df = load_ledger(conn, filters, base_currency)
    df = df[(df.verification_status == "verified") & (df.txn_type == "payment_received") & df.client_id.notna()]
    if df.empty:
        return pd.DataFrame(columns=cols)
    df = df.join(first, on="client_id")
    df["is_new"] = df["month"] == df["first_month"]
    out = df.groupby("month").apply(lambda g: pd.Series({
        "new_customer_cents": int(g.loc[g.is_new, "gross_amount_cents"].sum()),
        "repeat_customer_cents": int(g.loc[~g.is_new, "gross_amount_cents"].sum()),
        "new_customers": int(g.loc[g.is_new, "client_id"].nunique()),
    }), include_groups=False).reset_index()
    return out[cols]


CROSS_SELL = {
    "recording_session": ["mixing", "mastering"],
    "mixing": ["mastering"],
    "music_production": ["mixing", "mastering"],
    "beat_lease": ["exclusive_beat", "mixing"],
    "exclusive_beat": ["mixing", "mastering"],
    "mastering": ["music_video", "social_content"],
}


def customer_table(conn: sqlite3.Connection, base_currency: str = "USD") -> pd.DataFrame:
    df = load_ledger(conn, Filters(), base_currency)
    clients = pd.read_sql_query("SELECT id AS client_id, display_name FROM clients WHERE status = 'active'", conn)
    cols = ["client_id", "display_name", "verified_net_cents", "payments", "projects", "services",
            "first_activity", "last_activity", "purchase_occasions", "repeat"]
    if clients.empty:
        return pd.DataFrame(columns=cols)
    vd = df[(df.verification_status == "verified") & df.client_id.notna()
            & df.txn_type.isin(["payment_received", "refund", "reversal"])]
    vd = vd.assign(signed=vd.gross_amount_cents.where(vd.txn_type == "payment_received", -vd.gross_amount_cents))
    agg = vd.groupby("client_id").agg(
        verified_net_cents=("signed", "sum"),
        payments=("txn_type", lambda s: int((s == "payment_received").sum())),
        first_activity=("transaction_date", "min"), last_activity=("transaction_date", "max"),
        services=("service_name", lambda s: ", ".join(sorted(set(x for x in s if x != "Unknown / unclassified")))),
    )
    projects = pd.read_sql_query("SELECT client_id, COUNT(*) AS projects FROM projects GROUP BY client_id", conn)
    occ = purchase_occasions(conn, df).rename("purchase_occasions")
    out = clients.merge(agg, left_on="client_id", right_index=True, how="left") \
                 .merge(projects, on="client_id", how="left").join(occ, on="client_id")
    for c in ("verified_net_cents", "payments", "projects", "purchase_occasions"):
        out[c] = pd.to_numeric(out[c], errors="coerce").fillna(0).astype("int64")
    out["services"] = out["services"].astype(object).where(out["services"].notna(), "")
    out["repeat"] = out["purchase_occasions"] >= 2
    return out[cols].sort_values("verified_net_cents", ascending=False)


def cross_sell_opportunities(conn: sqlite3.Connection, client_id: str, base_currency: str = "USD") -> list[str]:
    """Evidence-backed suggestions: complementary services NOT yet purchased.
    These are prompts for the owner, not predictions."""
    df = load_ledger(conn, Filters(), base_currency)
    bought = df[(df.client_id == client_id) & (df.verification_status == "verified")
                & (df.txn_type == "payment_received")]
    codes = bought.groupby("service_code")["id"].count().to_dict()
    names = {r["code"]: r["name"] for r in conn.execute("SELECT code, name FROM service_catalog")}
    out = []
    for code, n in codes.items():
        for nxt in CROSS_SELL.get(code, []):
            if nxt not in codes:
                out.append(f"Bought {names.get(code, code)} ({n} verified payment(s)) but no "
                           f"{names.get(nxt, nxt)} on record")
    return list(dict.fromkeys(out))
