import csv
import io

from helpers import candidates, cashapp, txn_id
from newwave.analytics import metrics
from newwave.analytics.exports import export_ledger, summary_report_markdown, write_export
from newwave.analytics.metrics import Filters
from newwave.records import add_identifier, create_client, set_expense_coverage, set_transaction_fields
from newwave.reconciliation import review
from newwave.reconciliation.runner import run_reconciliation


def seed(conn):
    a, _ = create_client(conn, "Test A")
    b, _ = create_client(conn, "Test B")
    add_identifier(conn, a, "cashapp", "$ta", verified=True)
    add_identifier(conn, b, "cashapp", "$tb", verified=True)
    cashapp(conn, [
        ("P1", "2024-01-05", "$100.00", "$ta", "mix"),
        ("P2", "2024-01-20", "$50.00", "$tb", "master"),
        ("P3", "2024-02-03", "$200.00", "$ta", "beat"),
        ("P4", "2024-02-10", "$999.00", "$stranger"),            # unverified, never in headline
        ("R1", "2024-02-15", "-$30.00", "$ta"),                  # refund once approved
        ("CO", "2024-02-20", "-$250.00", "", "", "Cash Out"),     # owner transfer
        ("F1", "2024-02-21", "$70.00", "$tb", "", "P2P", "FAILED"),
    ])
    run_reconciliation(conn)
    for c in candidates(conn, "txn_client"):
        if c["confidence_band"] == "high":
            review.approve(conn, c["id"])
    run_reconciliation(conn)
    for c in candidates(conn, "txn_classification"):
        review.approve(conn, c["id"])
    return a, b


def test_overview_headline_uses_verified_only(conn):
    a, b = seed(conn)
    o = metrics.overview(conn)
    assert o.gross_payments_cents == 35000
    assert o.refunds_cents == 3000
    assert o.net_collected_cents == 32000
    assert o.unverified_payments_cents == 99900 and o.unverified_payments_count == 1
    assert o.owner_transfers_cents == 25000  # reported separately, never revenue
    assert o.unique_customers == 2
    assert o.repeat_customers == 1 and o.repeat_rate == 0.5   # Test A paid in Jan and Feb
    assert o.avg_revenue_per_customer_cents == 16000          # (300-30 + 50) / 2
    assert o.profit_cents is None and "not confirmed" in o.profit_note
    assert any("pending/failed" in n for n in o.excluded_notes)


def test_monthly_and_annual_series(conn):
    seed(conn)
    m = metrics.monthly_series(conn).set_index("month")
    assert m.loc["2024-01", "verified_gross"] == 15000
    assert m.loc["2024-02", "verified_gross"] == 20000
    assert m.loc["2024-02", "verified_refunds"] == 3000
    assert m.loc["2024-02", "verified_net"] == 17000
    assert m.loc["2024-02", "unverified_payments"] == 99900
    y = metrics.annual_series(conn).set_index("year")
    assert y.loc["2024", "verified_net"] == 32000
    assert int(m["verified_net"].sum()) == metrics.overview(conn).net_collected_cents  # charts reconcile to headline


def test_filters_and_breakdowns(conn):
    seed(conn)
    jan = metrics.overview(conn, Filters(start="2024-01-01", end="2024-01-31"))
    assert jan.gross_payments_cents == 15000 and jan.refunds_cents == 0
    by_method = metrics.breakdown(conn, "payment_method")
    assert by_method.set_index("payment_method").loc["cashapp", "net_cents"] == 32000
    assert metrics.overview(conn, Filters(payment_methods=["venmo"])).gross_payments_cents == 0
    nvr = metrics.new_vs_repeat(conn).set_index("month")
    assert nvr.loc["2024-01", "new_customer_cents"] == 15000
    assert nvr.loc["2024-02", "repeat_customer_cents"] == 20000


def test_profit_requires_expense_coverage(conn):
    seed(conn)
    for m in ("2024-01", "2024-02"):
        set_expense_coverage(conn, m)
    o = metrics.overview(conn)
    assert o.profit_cents == o.net_collected_cents - o.fees_cents - o.expenses_cents


def test_customer_table_and_cross_sell(conn):
    a, b = seed(conn)
    svc = conn.execute("SELECT id FROM service_catalog WHERE code='mixing'").fetchone()[0]
    set_transaction_fields(conn, txn_id(conn, "P1"), {"service_id": svc})
    t = metrics.customer_table(conn).set_index("client_id")
    assert t.loc[a, "verified_net_cents"] == 27000 and bool(t.loc[a, "repeat"])
    assert t.loc[b, "payments"] == 1
    ops = metrics.cross_sell_opportunities(conn, a)
    assert any("Mastering" in o for o in ops)


def test_csv_export_integrity(conn, settings):
    seed(conn)
    name, data = export_ledger(conn, Filters())
    rows = list(csv.DictReader(io.StringIO(data.decode())))
    assert "verified" in name and "UNVERIFIED" not in name
    assert all(r["verification_status"] == "verified" for r in rows)
    total = sum(float(r["gross"]) * (1 if r["type"] == "payment_received" else -1)
                for r in rows if r["type"] in ("payment_received", "refund"))
    assert round(total, 2) == 320.00
    assert "memo" not in rows[0]  # memos/private text excluded by default
    name2, data2 = export_ledger(conn, Filters(), include_unverified=True)
    rows2 = list(csv.DictReader(io.StringIO(data2.decode())))
    assert "UNVERIFIED-INCLUDED" in name2
    unv = [r for r in rows2 if r["verification_status"] != "verified"]
    assert unv and all(r["verification_label"].startswith("UNVERIFIED") for r in unv)
    p1 = write_export(settings.exports_dir, name, data)
    p2 = write_export(settings.exports_dir, name, data)
    assert p1 != p2 and p1.read_bytes() == data  # never overwrites


def test_export_neutralises_formulas(conn):
    data = ("Transaction ID,Date,Transaction Type,Currency,Amount,Fee,Status,Notes,Name of sender/receiver\n"
            "X1,2024-01-01,P2P,USD,$10.00,0,COMPLETE,x,\"=cmd|' /C calc'!A0\"\n").encode()
    from newwave.ingestion.base import run_transaction_import
    from newwave.ingestion.payments import CashAppImporter
    run_transaction_import(conn, CashAppImporter(), data, "x.csv")
    _, out = export_ledger(conn, Filters(), include_unverified=True)
    row = list(csv.DictReader(io.StringIO(out.decode())))[0]
    assert row["counterparty"].startswith("'=")


def test_summary_report(conn):
    seed(conn)
    md = summary_report_markdown(conn, Filters())
    assert "$320.00" in md and "not tax advice" in md and "Unverified candidate payments: 1" in md


def test_empty_database_metrics(conn):
    o = metrics.overview(conn)
    assert o.gross_payments_cents == 0 and o.unique_customers == 0 and o.repeat_rate is None
    assert metrics.monthly_series(conn).empty and metrics.customer_table(conn).empty
