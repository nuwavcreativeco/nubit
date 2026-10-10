import pytest

from helpers import candidates, cashapp, txn_id
from newwave.matching.confidence import band
from newwave.matching.engine import propose_client_matches, propose_client_merges, propose_project_allocations
from newwave.records import (
    RecordError, add_identifier, allocate, bulk_set_transactions, create_client, create_project, merge_clients,
    set_transaction_fields, undo_action, undo_merge,
)
from newwave.reconciliation import review
from newwave.reconciliation.runner import run_reconciliation


def test_confidence_bands():
    assert band(0.95) == "high" and band(0.85) == "high"
    assert band(0.84) == "medium" and band(0.60) == "medium"
    assert band(0.59) == "low"


def test_verified_handle_is_high_but_still_pending(conn):
    cid, _ = create_client(conn, "Test Artist A")
    add_identifier(conn, cid, "cashapp", "$testartista", verified=True)
    cashapp(conn, [("A1", "2024-01-05", "$150.00", "$testartista")])
    propose_client_matches(conn)
    c = candidates(conn, "txn_client")[0]
    assert c["proposed_client_id"] == cid and c["confidence_band"] == "high"
    assert c["method"] == "verified_identifier" and c["review_status"] == "pending"
    t = conn.execute("SELECT client_id, verification_status FROM transactions").fetchone()
    assert t["client_id"] is None and t["verification_status"] == "unverified"  # nothing auto-approved


def test_unverified_identifier_is_medium(conn):
    cid, _ = create_client(conn, "Test Artist A")
    add_identifier(conn, cid, "cashapp", "$testartista", verified=False)
    cashapp(conn, [("A1", "2024-01-05", "$150.00", "$testartista")])
    propose_client_matches(conn)
    assert candidates(conn, "txn_client")[0]["confidence_band"] == "medium"


def test_name_only_never_leaves_low_band(conn):
    create_client(conn, "Test Person")
    cashapp(conn, [("A1", "2024-01-05", "$150.00", "Test Person")])
    propose_client_matches(conn)
    c = candidates(conn, "txn_client")[0]
    assert c["method"] == "name_only" and c["confidence_band"] == "low" and c["confidence_score"] <= 0.59
    assert "not unique" in c["explanation"]


def test_ambiguous_candidates_are_capped(conn):
    a, _ = create_client(conn, "Test Twin")
    b, _ = create_client(conn, "Test Twin")
    cashapp(conn, [("A1", "2024-01-05", "$150.00", "Test Twin")])
    propose_client_matches(conn)
    cs = candidates(conn, "txn_client")
    assert {c["proposed_client_id"] for c in cs} == {a, b}
    assert all(c["confidence_band"] == "low" and "Ambiguous" in c["explanation"] for c in cs)
    # and the two same-named clients are flagged for (manual) merge review, never merged automatically
    assert propose_client_merges(conn) == 1
    assert conn.execute("SELECT COUNT(*) FROM clients WHERE status='active'").fetchone()[0] == 2


def test_matching_is_idempotent(conn):
    cid, _ = create_client(conn, "Test Artist A")
    add_identifier(conn, cid, "cashapp", "$testartista", verified=True)
    cashapp(conn, [("A1", "2024-01-05", "$150.00", "$testartista")])
    assert propose_client_matches(conn) == 1
    assert propose_client_matches(conn) == 0


def test_approve_reject_defer_and_undo(conn):
    a, _ = create_client(conn, "Test A")
    b, _ = create_client(conn, "Test B")
    add_identifier(conn, a, "cashapp", "$ta", verified=False)
    add_identifier(conn, b, "cashapp", "$ta", verified=False)
    cashapp(conn, [("A1", "2024-01-05", "$150.00", "$ta")])
    propose_client_matches(conn)
    ca, cb = sorted(candidates(conn, "txn_client"), key=lambda c: c["proposed_client_id"] != a)
    review.defer(conn, ca["id"], note="ask owner")
    assert conn.execute("SELECT review_status FROM match_candidates WHERE id=?", (ca["id"],)).fetchone()[0] == "deferred"
    review.approve(conn, ca["id"], verify_identifier=True)
    t = conn.execute("SELECT * FROM transactions").fetchone()
    assert t["client_id"] == a and t["verification_status"] == "verified"
    assert conn.execute("SELECT review_status FROM match_candidates WHERE id=?", (cb["id"],)).fetchone()[0] == "superseded"
    assert conn.execute("SELECT verification_status FROM client_identifiers WHERE client_id=? AND identifier_type='cashapp'",
                        (a,)).fetchone()[0] == "verified"
    with pytest.raises(RecordError):
        review.approve(conn, ca["id"])  # cannot approve twice
    with pytest.raises(RecordError):
        review.undo_review(conn, ca["id"], confirm=False)
    review.undo_review(conn, ca["id"], confirm=True, reason="mistake")
    t = conn.execute("SELECT * FROM transactions").fetchone()
    assert t["client_id"] is None and t["verification_status"] == "unverified"
    statuses = dict(conn.execute("SELECT id, review_status FROM match_candidates").fetchall())
    assert statuses[ca["id"]] == "deferred" and statuses[cb["id"]] == "pending"
    assert conn.execute("SELECT verification_status FROM client_identifiers WHERE client_id=? AND identifier_type='cashapp'",
                        (a,)).fetchone()[0] == "unverified"
    review.reject(conn, cb["id"], note="not them")
    review.undo_review(conn, cb["id"], confirm=True)
    assert conn.execute("SELECT review_status FROM match_candidates WHERE id=?", (cb["id"],)).fetchone()[0] == "pending"
    # every decision is in the audit log
    actions = [r[0] for r in conn.execute("SELECT action FROM audit_log WHERE entity_type='match_candidates'")]
    assert {"deferred_candidate", "approved_candidate", "rejected_candidate"} <= set(actions)
    assert any(a.startswith("undo:") for a in actions)


def test_merge_and_undo_merge(conn):
    a, _ = create_client(conn, "Test Nova")
    b, _ = create_client(conn, "T. Nova")
    add_identifier(conn, a, "phone", "555-010-0101", verified=True)
    add_identifier(conn, b, "instagram", "@testnova", verified=True)
    cashapp(conn, [("A1", "2024-01-05", "$100.00", "x")])
    set_transaction_fields(conn, txn_id(conn, "A1"), {"client_id": b})
    pid, _ = create_project(conn, b, "Test single")
    with pytest.raises(RecordError, match="confirmation"):
        merge_clients(conn, b, a, confirm=False)
    merge_clients(conn, b, a, confirm=True, reason="same person per owner")
    assert conn.execute("SELECT status, merged_into_id FROM clients WHERE id=?", (b,)).fetchone()[:] == ("merged", a)
    assert conn.execute("SELECT client_id FROM transactions").fetchone()[0] == a
    assert conn.execute("SELECT client_id FROM projects WHERE id=?", (pid,)).fetchone()[0] == a
    assert conn.execute("SELECT COUNT(*) FROM client_identifiers WHERE client_id=?", (a,)).fetchone()[0] == 4
    with pytest.raises(RecordError):
        merge_clients(conn, b, a, confirm=True)  # merged client is not active
    m = conn.execute("SELECT id FROM client_merges").fetchone()[0]
    undo_merge(conn, m, confirm=True)
    assert conn.execute("SELECT status FROM clients WHERE id=?", (b,)).fetchone()[0] == "active"
    assert conn.execute("SELECT client_id FROM transactions").fetchone()[0] == b
    assert conn.execute("SELECT client_id FROM projects WHERE id=?", (pid,)).fetchone()[0] == b
    assert conn.execute("SELECT client_id FROM client_identifiers WHERE identifier_type='instagram'").fetchone()[0] == b


def test_merge_via_candidate_requires_confirmation_and_undoes(conn):
    a, _ = create_client(conn, "Test Same")
    b, _ = create_client(conn, "Test Same")
    propose_client_merges(conn)
    c = candidates(conn, "client_merge")[0]
    with pytest.raises(RecordError, match="confirmation"):
        review.approve(conn, c["id"])
    review.approve(conn, c["id"], confirm_merge=True)
    assert conn.execute("SELECT COUNT(*) FROM clients WHERE status='merged'").fetchone()[0] == 1
    review.undo_review(conn, c["id"], confirm=True)
    assert conn.execute("SELECT COUNT(*) FROM clients WHERE status='active'").fetchone()[0] == 2


def test_refund_detection_and_approval(conn):
    a, _ = create_client(conn, "Test A")
    add_identifier(conn, a, "cashapp", "$ta", verified=True)
    cashapp(conn, [("P1", "2024-01-05", "$150.00", "$ta"), ("R1", "2024-01-20", "-$40.00", "$ta", "partial refund")])
    run_reconciliation(conn)
    review.approve(conn, candidates(conn, "txn_client", txn_id(conn, "P1"))[0]["id"])
    run_reconciliation(conn)
    ref = candidates(conn, "txn_classification")[0]
    assert ref["proposed_value"] == "refund" and ref["transaction_id"] == txn_id(conn, "R1")
    review.approve(conn, ref["id"])
    r = conn.execute("SELECT * FROM transactions WHERE source_record_id='R1'").fetchone()
    assert r["txn_type"] == "refund" and r["client_id"] == a and r["verification_status"] == "verified"


def test_owner_transfer_pairing(conn):
    from newwave.ingestion.base import run_transaction_import
    from newwave.ingestion.payments import BUILTIN_PROFILES, mapped_importer_for
    cashapp(conn, [("CO1", "2024-02-10", "-$100.00", "", "", "Cash Out")])
    bank = b"Date,Description,Amount\n02/11/2024,ACH CREDIT SQUARE CASH,100.00\n"
    run_transaction_import(conn, mapped_importer_for("bank"), bank, "b.csv",
                           options=BUILTIN_PROFILES["bank_of_america"]["options"])
    stats = run_reconciliation(conn)
    assert stats["transfer_pairs"] == 1
    c = candidates(conn, "owner_transfer")[0]
    review.approve(conn, c["id"])
    rows = conn.execute("SELECT txn_type, transfer_pair_id FROM transactions").fetchall()
    assert all(r["txn_type"] == "owner_transfer" and r["transfer_pair_id"] for r in rows)


def test_partial_payments_allocations(conn):
    a, _ = create_client(conn, "Test A")
    add_identifier(conn, a, "cashapp", "$ta", verified=True)
    cashapp(conn, [("D1", "2024-01-05", "$200.00", "$ta"), ("D2", "2024-02-05", "$300.00", "$ta"),
                   ("D3", "2024-03-05", "$100.00", "$ta")])
    pid, _ = create_project(conn, a, "Test EP", project_value_cents=50000, booked_at="2024-01-01")
    run_reconciliation(conn)
    for c in candidates(conn, "txn_client"):
        review.approve(conn, c["id"])
    run_reconciliation(conn)
    proj = sorted(candidates(conn, "txn_project"), key=lambda c: c["transaction_id"])
    assert len(proj) == 3
    by_txn = {c["transaction_id"]: c for c in proj}
    review.approve(conn, by_txn[txn_id(conn, "D1")]["id"])
    review.approve(conn, by_txn[txn_id(conn, "D2")]["id"])
    allocs = conn.execute("SELECT amount_cents, allocation_type FROM transaction_allocations WHERE status='active'").fetchall()
    assert sorted(a[0] for a in allocs) == [20000, 30000]
    # project is now fully paid: approving the third would over-allocate the project balance => refused/skipped
    stale = candidates(conn, "txn_project", txn_id(conn, "D3"))[0]
    with pytest.raises(RecordError, match="remaining balance"):
        review.approve(conn, stale["id"])
    # over-allocating a single transaction is blocked by the database
    pid2, _ = create_project(conn, a, "Other")
    with pytest.raises(RecordError, match="exceed"):
        allocate(conn, txn_id(conn, "D3"), pid2, 10001)
    allocate(conn, txn_id(conn, "D3"), pid2, 6000, allocation_type="deposit")
    allocate(conn, txn_id(conn, "D3"), pid2, 4000, allocation_type="final_payment")
    with pytest.raises(RecordError):
        allocate(conn, txn_id(conn, "D3"), pid2, 1)


def test_bulk_edit_requires_confirmation_and_undo(conn):
    cashapp(conn, [("A1", "2024-01-05", "$10.00", "$x"), ("A2", "2024-01-06", "$20.00", "$y")])
    ids = [txn_id(conn, "A1"), txn_id(conn, "A2")]
    with pytest.raises(RecordError):
        bulk_set_transactions(conn, ids, {"txn_type": "personal"}, confirm=False)
    gid = bulk_set_transactions(conn, ids, {"txn_type": "personal"}, confirm=True, reason="friends paying me back")
    assert {r[0] for r in conn.execute("SELECT txn_type FROM transactions")} == {"personal"}
    undo_action(conn, gid, confirm=True)
    assert {r[0] for r in conn.execute("SELECT txn_type FROM transactions")} == {"payment_received"}
    with pytest.raises(ValueError, match="already been undone"):
        undo_action(conn, gid, confirm=True)


def test_source_fields_cannot_be_corrected(conn):
    cashapp(conn, [("A1", "2024-01-05", "$10.00", "$x")])
    with pytest.raises(RecordError, match="immutable"):
        set_transaction_fields(conn, txn_id(conn, "A1"), {"gross_amount_cents": 1})
