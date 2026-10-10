import json

import pytest

from conftest import fixture_bytes
from newwave.ingestion.base import compute_dedupe_keys, preview, run_transaction_import
from newwave.ingestion.payments import (
    BUILTIN_PROFILES, CashAppImporter, ManualCashImporter, MappedImporter, VenmoImporter, mapped_importer_for,
    suggest_mapping,
)
from newwave.ingestion.tabular import FileRejected, read_csv_table
from newwave.records import add_owner_account
from newwave.reconciliation.checks import find_cross_source_duplicates


def txns(conn, source=None):
    sql = "SELECT * FROM transactions"
    if source:
        sql += f" WHERE source_type = '{source}'"
    return {r["source_record_id"] or r["id"]: dict(r) for r in conn.execute(sql + " ORDER BY source_row_number")}


def test_cashapp_import_classifies_conservatively(conn, settings):
    s = run_transaction_import(conn, CashAppImporter(), fixture_bytes("cashapp_sample.csv"), "cash.csv",
                               incoming_dir=settings.incoming_dir)
    assert s.record_count == 9
    assert s.inserted == 8 and s.failed == 1  # bad amount row fails, others import
    assert s.status == "completed_with_warnings"
    t = txns(conn, "cashapp")
    assert t["TEST-CA-1"]["txn_type"] == "payment_received" and t["TEST-CA-1"]["verification_status"] == "unverified"
    assert t["TEST-CA-1"]["counterparty_handle"] == "testartista"
    assert t["TEST-CA-2"]["fee_amount_cents"] == 206 and t["TEST-CA-2"]["net_amount_cents"] == 7294
    assert t["TEST-CA-3"]["direction"] == "out" and t["TEST-CA-3"]["txn_type"] == "unknown"
    assert t["TEST-CA-4"]["txn_type"] == "owner_transfer"
    assert t["TEST-CA-5"]["source_status"] == "refunded"
    assert t["TEST-CA-6"]["source_status"] == "failed"
    assert t["TEST-CA-7"]["transaction_date"] is None and t["TEST-CA-7"]["verification_status"] == "needs_review"
    assert t["TEST-CA-9"]["txn_type"] == "personal"
    # original row is preserved verbatim and a read-only copy of the file is kept
    assert json.loads(t["TEST-CA-1"]["raw_json"])["Amount"] == "$150.00"
    stored = list(settings.incoming_dir.iterdir())
    assert len(stored) == 1 and stored[0].read_bytes() == fixture_bytes("cashapp_sample.csv")
    job = conn.execute("SELECT * FROM import_jobs WHERE id = ?", (s.job_id,)).fetchone()
    assert job["file_sha256"] and job["record_count"] == 9 and job["failed_count"] == 1
    # every imported transaction has evidence
    assert conn.execute("SELECT COUNT(*) FROM evidence WHERE evidence_type='transaction_row'").fetchone()[0] == 8


def test_reimport_same_file_is_idempotent(conn):
    data = fixture_bytes("cashapp_sample.csv")
    run_transaction_import(conn, CashAppImporter(), data, "cash.csv")
    again = run_transaction_import(conn, CashAppImporter(), data, "cash-copy.csv")
    assert again.status == "duplicate_file" and again.inserted == 0
    assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 8


def test_overlapping_export_dedupes_by_source_id(conn):
    data = fixture_bytes("cashapp_sample.csv")
    run_transaction_import(conn, CashAppImporter(), data, "cash.csv")
    lines = data.decode().splitlines()
    overlap = "\n".join(lines[:3] + ["TEST-CA-10,2024-03-01 12:00:00 PST,P2P,USD,$80.00,$0,$80.00,,,,COMPLETE,mix,$testartistb,Cash App"])
    s = run_transaction_import(conn, CashAppImporter(), overlap.encode(), "cash-2.csv")
    assert s.inserted == 1 and s.duplicates == 2


def test_venmo_import(conn):
    s = run_transaction_import(conn, VenmoImporter(), fixture_bytes("venmo_sample.csv"), "venmo.csv")
    assert s.inserted == 4
    t = txns(conn, "venmo")
    assert t["TEST-V-1"]["direction"] == "in" and t["TEST-V-1"]["txn_type"] == "payment_received"
    assert t["TEST-V-1"]["counterparty_raw"] == "Test Person Venmo"
    assert t["TEST-V-1"]["account_label"] == "Venmo @test-newwave"
    assert t["TEST-V-2"]["direction"] == "out" and t["TEST-V-2"]["counterparty_raw"] == "Test Friend"
    assert t["TEST-V-3"]["txn_type"] == "owner_transfer"
    assert t["TEST-V-4"]["fee_amount_cents"] == 90 and t["TEST-V-4"]["net_amount_cents"] == 2910


def test_bank_profile_import_and_classification(conn):
    opts = BUILTIN_PROFILES["chase_checking"]["options"]
    s = run_transaction_import(conn, mapped_importer_for("bank"), fixture_bytes("bank_chase_sample.csv"), "bank.csv",
                               options=opts)
    assert s.inserted == 6
    rows = list(txns(conn, "bank").values())
    by_desc = {r["memo"]: r for r in rows}
    z = by_desc["Zelle payment from TEST ZELLE PAYER Conf# ZX123456"]
    assert z["payment_method"] == "zelle" and z["txn_type"] == "payment_received"
    assert z["counterparty_raw"] == "TEST ZELLE PAYER" and z["source_record_id"] == "zelle:ZX123456"
    assert by_desc["CASH APP*CASH OUT"]["txn_type"] == "owner_transfer"
    assert by_desc["ATM DEPOSIT"]["txn_type"] == "unknown"  # a deposit is NOT assumed to be revenue
    assert by_desc["MONTHLY SERVICE FEE"]["txn_type"] == "expense"
    assert by_desc["TEST GEAR STORE"]["txn_type"] == "unknown"
    assert by_desc["Zelle payment to TEST LANDLORD Conf# ZX999999"]["direction"] == "out"


def test_zelle_export_and_cross_source_duplicate(conn):
    run_transaction_import(conn, mapped_importer_for("bank"), fixture_bytes("bank_chase_sample.csv"), "bank.csv",
                           options=BUILTIN_PROFILES["chase_checking"]["options"])
    s = run_transaction_import(conn, mapped_importer_for("zelle"), fixture_bytes("zelle_sample.csv"), "zelle.csv",
                               options=BUILTIN_PROFILES["zelle_activity"]["options"])
    assert s.inserted == 2
    z = conn.execute("SELECT * FROM transactions WHERE source_type='zelle' AND source_record_id='ZX123456'").fetchone()
    assert z["counterparty_handle"] == "+15550100199" and z["txn_type"] == "payment_received"
    assert find_cross_source_duplicates(conn) == 1
    cand = conn.execute("SELECT * FROM match_candidates WHERE candidate_type='duplicate_txn'").fetchone()
    # the richer Zelle-export record is kept; the bank line is proposed as the duplicate
    dropped = conn.execute("SELECT source_type FROM transactions WHERE id=?", (cand["transaction_id"],)).fetchone()[0]
    assert dropped == "bank" and cand["review_status"] == "pending"
    assert find_cross_source_duplicates(conn) == 0  # idempotent


def test_manual_cash_import(conn):
    s = run_transaction_import(conn, ManualCashImporter(), fixture_bytes("manual_cash_sample.csv"), "cash.csv")
    assert s.inserted == 2
    t = txns(conn, "manual")
    assert t["CASH-1"]["payment_method"] == "cash" and t["CASH-1"]["counterparty_handle"] == "+15550100150"
    assert t["CASH-1"]["verification_status"] == "unverified"
    assert t["CASH-2"]["txn_type"] == "expense" and t["CASH-2"]["direction"] == "out"


def test_generic_json_mapping(conn):
    data = json.dumps({"export": {"items": [
        {"when": "2024-05-01", "value": "-45.00", "who": "Test Vendor", "ref": "J-1"},
        {"when": "2024-05-02", "value": "99.99", "who": "Test Payer", "ref": "J-2", "extra": {"nested": True}},
    ]}}).encode()
    imp = mapped_importer_for("other")
    opts = {"format": "json", "json_records_path": "export.items", "mapping": {
        "date": "when", "amount": "value", "counterparty": "who", "id": "ref"}, "amount_mode": "signed"}
    s = run_transaction_import(conn, imp, data, "x.json", options=opts)
    assert s.inserted == 2
    t = txns(conn, "other")
    assert t["J-1"]["direction"] == "out" and t["J-2"]["gross_amount_cents"] == 9999
    assert t["J-2"]["txn_type"] == "unknown"  # mapped imports never assume revenue by default


def test_debit_credit_mapping_and_preview():
    csv_data = b"Date,Desc,Debit,Credit\n01/02/2024,Coffee,4.50,\n01/03/2024,Zelle from TEST A,,40.00\n01/04/2024,Both,1.00,2.00\n"
    imp = MappedImporter()
    headers = read_csv_table(csv_data).headers
    guess = suggest_mapping(headers)
    assert guess["date"] == "Date" and guess["debit"] == "Debit" and guess["credit"] == "Credit"
    res = preview(imp, csv_data, {"mapping": {"date": "Date", "description": "Desc", "debit": "Debit", "credit": "Credit"},
                                  "amount_mode": "debit_credit"})
    assert [t.direction for t in res.transactions] == ["out", "in"]
    assert len(res.failed) == 1 and "both debit and credit" in res.failed[0].message


def test_mapping_errors_are_reported():
    imp = MappedImporter()
    with pytest.raises(ValueError, match="not found"):
        imp.parse(b"a,b\n1,2\n", {"mapping": {"date": "Date", "amount": "b"}})
    with pytest.raises(ValueError, match="date column"):
        imp.parse(b"a,b\n1,2\n", {"mapping": {"amount": "b"}})


def test_no_stable_id_dedupe_keeps_genuine_repeats(conn):
    data = b"Date,Description,Amount\n01/05/2024,Zelle payment from TEST PAYER,50.00\n01/05/2024,Zelle payment from TEST PAYER,50.00\n"
    opts = BUILTIN_PROFILES["bank_of_america"]["options"]
    s1 = run_transaction_import(conn, mapped_importer_for("bank"), data, "a.csv", options=opts)
    assert s1.inserted == 2  # two identical rows in one file are both kept
    # an overlapping export with the same two rows plus one more re-imports only the new one
    data2 = data + b"01/06/2024,Zelle payment from TEST PAYER,50.00\n"
    s2 = run_transaction_import(conn, mapped_importer_for("bank"), data2, "b.csv", options=opts)
    assert s2.inserted == 1 and s2.duplicates == 2
    assert any("likely duplicate" in w for w in s2.warnings)


def test_dedupe_keys_stable():
    imp = CashAppImporter()
    r = imp.parse(fixture_bytes("cashapp_sample.csv"))
    k1 = compute_dedupe_keys("cashapp", r.transactions)
    k2 = compute_dedupe_keys("cashapp", imp.parse(fixture_bytes("cashapp_sample.csv")).transactions)
    assert k1 == k2 and len(set(k1)) == len(k1)


def test_owner_account_rule_marks_transfers(conn):
    add_owner_account(conn, "My other Cash App", "cashapp", "$testartistb")
    run_transaction_import(conn, CashAppImporter(), fixture_bytes("cashapp_sample.csv"), "cash.csv")
    assert txns(conn)["TEST-CA-2"]["txn_type"] == "owner_transfer"


def test_currency_mismatch_flagged(conn):
    data = b"Transaction ID,Date,Transaction Type,Currency,Amount,Fee,Status,Name of sender/receiver\nEU-1,2024-01-01,P2P,EUR,10.00,0,COMPLETE,$x1\n"
    s = run_transaction_import(conn, CashAppImporter(), data, "eur.csv")
    t = txns(conn)["EU-1"]
    assert t["currency"] == "EUR" and t["verification_status"] == "needs_review"
    assert any("currency" in w for w in s.warnings)


@pytest.mark.parametrize("payload", [b"\x00\x01binary", b"", b"just one column\nvalue\n"])
def test_malformed_files_rejected(conn, payload):
    s = run_transaction_import(conn, CashAppImporter(), payload, "bad.csv")
    assert s.status == "failed" and s.inserted == 0
    with pytest.raises((FileRejected, ValueError)):
        CashAppImporter().parse(payload)


def test_adversarial_csv_content_is_inert(conn):
    data = ("Transaction ID,Date,Transaction Type,Currency,Amount,Fee,Status,Notes,Name of sender/receiver\n"
            "X-1,2024-01-01,P2P,USD,$10.00,0,COMPLETE,\"=HYPERLINK(\"\"http://evil\"\")'; DROP TABLE transactions;--\","
            "\"<script>alert(1)</script>‮\"\n").encode()
    s = run_transaction_import(conn, CashAppImporter(), data, "../../etc/passwd")
    assert s.inserted == 1
    t = txns(conn)["X-1"]
    assert "DROP TABLE" in t["memo"]  # stored as plain text...
    assert conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 1  # ...never executed
    assert "‮" not in t["counterparty_raw"]  # bidi override stripped
    job = conn.execute("SELECT original_filename FROM import_jobs").fetchone()[0]
    assert job == "../../etc/passwd"  # recorded as metadata only; never used as a path
