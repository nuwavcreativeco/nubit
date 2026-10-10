"""End-to-end: import a synthetic transaction set, match a customer and a
project, process a refund, and verify dashboard totals."""
from conftest import fixture_bytes
from helpers import candidates, txn_id
from newwave.analytics import metrics
from newwave.analytics.exports import export_ledger
from newwave.analytics.metrics import Filters
from newwave.ingestion.base import run_transaction_import
from newwave.ingestion.messages.base import run_message_import
from newwave.ingestion.messages.manual import parse_manual_conversations
from newwave.ingestion.payments import BUILTIN_PROFILES, CashAppImporter, VenmoImporter, mapped_importer_for
from newwave.catalog import service_id_for_code
from newwave.records import add_identifier, add_owner_account, create_client, create_project
from newwave.reconciliation import review
from newwave.reconciliation.runner import run_reconciliation


def test_end_to_end(conn, settings):
    # 1. sources
    add_owner_account(conn, "Owner name", "name", "Test Owner")
    run_transaction_import(conn, CashAppImporter(), fixture_bytes("cashapp_sample.csv"), "cash.csv",
                           incoming_dir=settings.incoming_dir)
    run_transaction_import(conn, VenmoImporter(), fixture_bytes("venmo_sample.csv"), "venmo.csv")
    run_transaction_import(conn, mapped_importer_for("bank"), fixture_bytes("bank_chase_sample.csv"), "bank.csv",
                           options=BUILTIN_PROFILES["chase_checking"]["options"])
    run_transaction_import(conn, mapped_importer_for("zelle"), fixture_bytes("zelle_sample.csv"), "zelle.csv",
                           options=BUILTIN_PROFILES["zelle_activity"]["options"])
    # repeat import of everything must not double count
    assert run_transaction_import(conn, CashAppImporter(), fixture_bytes("cashapp_sample.csv"), "again.csv").inserted == 0
    threads = parse_manual_conversations(fixture_bytes("manual_conversations.csv"), owner_names=("Owner",))
    run_message_import(conn, source_type="manual", importer="manual", threads=threads, filename="c.csv",
                       file_sha256="c")

    # 2. a customer with a verified Cash App handle and a project
    a, _ = create_client(conn, "Test Artist A")
    add_identifier(conn, a, "cashapp", "$testartista", verified=True)
    z, _ = create_client(conn, "Test Zelle Payer")
    add_identifier(conn, z, "phone", "(555) 010-0199", verified=True)
    pid, _ = create_project(conn, a, "Single — mix", service_id=service_id_for_code(conn, "mixing"),
                            project_value_cents=15000, booked_at="2024-01-03")

    stats = run_reconciliation(conn)
    assert stats["cross_source_duplicates"] >= 1 and stats["transfer_pairs"] >= 1

    # 3. reviewer approves the customer matches
    for c in candidates(conn, "txn_client"):
        if c["confidence_band"] == "high":
            review.approve(conn, c["id"])
    # duplicate Zelle line on the bank statement and the Cash App -> bank cash-out
    for c in candidates(conn, "duplicate_txn") + candidates(conn, "owner_transfer"):
        review.approve(conn, c["id"])
    run_reconciliation(conn)
    # 4. project allocation and refund classification
    proj = [c for c in candidates(conn, "txn_project") if c["transaction_id"] == txn_id(conn, "TEST-CA-1")]
    review.approve(conn, proj[0]["id"])
    refund = [c for c in candidates(conn, "txn_classification") if c["transaction_id"] == txn_id(conn, "TEST-CA-3")]
    review.approve(conn, refund[0]["id"])

    # 5. dashboard totals
    o = metrics.overview(conn)
    # verified payments: CA-1 150 + Zelle ZX123456 200 (once, not twice) + Zelle ZX777777 100
    assert o.gross_payments_cents == 15000 + 20000 + 10000
    assert o.refunds_cents == 4000
    assert o.net_collected_cents == 41000
    assert o.unique_customers == 2
    # bank Zelle duplicate excluded, cash-out never revenue, refunded/failed rows excluded
    assert conn.execute("SELECT COUNT(*) FROM transactions WHERE duplicate_of_id IS NOT NULL").fetchone()[0] == 1
    assert o.owner_transfers_cents >= 10000
    assert o.unverified_payments_cents > 0  # unreviewed Venmo/Cash App payments stay out of headline
    m = metrics.monthly_series(conn)
    assert int(m["verified_net"].sum()) == o.net_collected_cents
    alloc = conn.execute("SELECT SUM(amount_cents) FROM transaction_allocations WHERE status='active'").fetchone()[0]
    assert alloc == 15000
    by_service = metrics.breakdown(conn, "service_name").set_index("service_name")
    assert by_service.loc["Mixing", "net_cents"] == 15000
    _, data = export_ledger(conn, Filters())
    assert data.decode().count("\n") == 1 + 4  # header + 3 payments + 1 refund
    # 6. every change is traceable
    assert conn.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0] > 10
