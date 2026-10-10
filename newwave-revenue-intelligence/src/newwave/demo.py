"""Synthetic demo data — clearly fictional, only ever written to a 'demo' workspace.

The demo exercises the real import pipeline (Cash App, Venmo, bank, manual
and conversation importers) with invented people and numbers. Every row is
flagged is_demo=1 and the dashboard shows a DEMO banner.
"""
from __future__ import annotations

import json
import random
import sqlite3
from datetime import date, timedelta

from .catalog import service_id_for_code
from .ingestion.base import run_transaction_import
from .ingestion.messages.base import run_message_import
from .ingestion.messages.manual import parse_manual_conversations
from .ingestion.payments import BUILTIN_PROFILES, CashAppImporter, ManualCashImporter, VenmoImporter, mapped_importer_for
from .reconciliation import review
from .reconciliation.runner import run_reconciliation
from .records import add_identifier, add_owner_account, create_client, create_project, set_expense_coverage
from .workspace import workspace_kind

FICTIONAL = [
    ("Demo Artist Nova", "cashapp", "$demonova", "+15550100101"),
    ("Demo Artist Blaze", "venmo", "@demo-blaze", "+15550100102"),
    ("Demo Artist Kairo", "cashapp", "$demokairo", "+15550100103"),
    ("Demo Artist Luma", "venmo", "@demo-luma", "+15550100104"),
    ("Demo Artist Reign", "zelle", "demo.reign@example.com", "+15550100105"),
    ("Demo Artist Sol", "cashapp", "$demosol", "+15550100106"),
]
SERVICES = [("recording_session", 7500, "studio session"), ("mixing", 15000, "mix"), ("mastering", 5000, "master"),
            ("beat_lease", 3000, "beat lease"), ("exclusive_beat", 40000, "exclusive beat"),
            ("music_video", 60000, "music video")]


def _csv(rows: list[list[str]]) -> bytes:
    import csv
    import io
    buf = io.StringIO()
    csv.writer(buf, lineterminator="\n").writerows(rows)
    return buf.getvalue().encode()


def build_demo(conn: sqlite3.Connection, workspace_root, seed: int = 7) -> dict:
    if workspace_kind(workspace_root) != "demo":
        raise RuntimeError("demo data can only be written to a workspace initialised with --kind demo")
    rnd = random.Random(seed)
    add_owner_account(conn, "Owner Cash App", "cashapp", "$demonewwave", actor="demo_script")
    add_owner_account(conn, "Owner name", "name", "Demo Owner", actor="demo_script")
    clients = {}
    for name, kind, handle, phone in FICTIONAL:
        cid, _ = create_client(conn, name, is_demo=True, actor="demo_script")
        add_identifier(conn, cid, "cashapp" if kind == "cashapp" else ("venmo" if kind == "venmo" else "email"),
                       handle, verified=True, actor="demo_script")
        add_identifier(conn, cid, "phone", phone, verified=True, actor="demo_script")
        clients[name] = (cid, kind, handle, phone)

    cash = [["Transaction ID", "Date", "Transaction Type", "Currency", "Amount", "Fee", "Net Amount", "Asset Type",
             "Asset Price", "Asset Amount", "Status", "Notes", "Name of sender/receiver", "Account"]]
    venmo = [["Account Statement - (@demo-newwave)"], ["", "ID", "Datetime", "Type", "Status", "Note", "From", "To",
              "Amount (total)", "Amount (fee)", "Funding Source", "Destination"]]
    bank = [["Details", "Posting Date", "Description", "Amount", "Type", "Balance", "Check or Slip #"]]
    convo = [["thread_id", "timestamp", "sender", "text", "is_owner", "contact"]]
    start = date(2023, 1, 9)
    n = 0
    for week in range(0, 100):
        day = start + timedelta(days=7 * week + rnd.randint(0, 4))
        name, (cid, kind, handle, phone) = rnd.choice(list(clients.items()))
        code, price, word = rnd.choice(SERVICES)
        price += rnd.choice([0, 0, 2500, -1000]) if price > 5000 else 0
        n += 1
        amt = f"{price / 100:.2f}"
        thread = f"demo-thread-{name.split()[-1].lower()}"
        convo.append([thread, (day - timedelta(days=2)).isoformat() + "T15:00:00", name,
                      f"hey can i get a {word} this week?", "0", phone])
        convo.append([thread, (day - timedelta(days=1)).isoformat() + "T15:05:00", "Demo Owner",
                      f"yes the {word} is ${amt}, booked for {day.isoformat()}", "1", ""])
        if kind == "cashapp":
            cash.append([f"DEMO-CA-{n:04d}", f"{day.isoformat()} 14:00:00 PST", "P2P", "USD", f"${amt}",
                         "$0", f"${amt}", "", "", "", "COMPLETE", word, handle, "Cash App"])
        elif kind == "venmo":
            venmo.append(["", f"DEMO-V-{n:04d}", f"{day.isoformat()}T14:00:00", "Payment", "Complete", word,
                          name, "Demo Owner", f"+ ${amt}", "0", "", "Venmo balance"])
        else:
            bank.append(["CREDIT", day.strftime("%m/%d/%Y"), f"Zelle payment from {name} Conf# DZ{n:06d}", amt,
                         "QUICKPAY_CREDIT", "", ""])
        if week % 9 == 4:  # monthly-ish owner cash-out from Cash App to the bank (a transfer, not revenue)
            co = f"{rnd.randint(200, 600)}.00"
            cash.append([f"DEMO-CA-CO{n:04d}", f"{day.isoformat()} 18:00:00 PST", "Cash Out", "USD", f"-${co}",
                         "$0", f"-${co}", "", "", "", "COMPLETE", "", "", "Visa Debit 0000"])
            bank.append(["CREDIT", (day + timedelta(days=1)).strftime("%m/%d/%Y"), "CASH APP*CASH OUT", co,
                         "ACH_CREDIT", "", ""])
        if week % 13 == 6:
            bank.append(["DEBIT", day.strftime("%m/%d/%Y"), "DEMO MUSIC SUPPLY CO", f"-{rnd.randint(40, 250)}.00",
                         "DEBIT_CARD", "", ""])
    # one refund to a prior payer
    refund_day = start + timedelta(days=200)
    cash.append(["DEMO-CA-RF1", f"{refund_day.isoformat()} 10:00:00 PST", "P2P", "USD", "-$30.00", "$0", "-$30.00",
                 "", "", "", "COMPLETE", "refund", "$demonova", "Cash App"])
    manual = [ManualCashImporter.TEMPLATE_HEADERS,
              ["DEMO-CASH-1", "2023-03-04", "100.00", "payment_received", "cash", "Demo Artist Sol", "+15550100106",
               "", "", "recording_session", "walk-in session", "R-001"],
              ["DEMO-CASH-2", "2023-08-19", "60.00", "payment_received", "cash", "Demo Walk-in", "", "", "",
               "mastering", "unknown walk-in", ""]]

    inc = None
    out = {}
    out["cashapp"] = run_transaction_import(conn, CashAppImporter(), _csv(cash), "demo-cashapp.csv",
                                            incoming_dir=inc, is_demo=True, actor="demo_script").inserted
    out["venmo"] = run_transaction_import(conn, VenmoImporter(), _csv(venmo), "demo-venmo.csv",
                                          incoming_dir=inc, is_demo=True, actor="demo_script").inserted
    prof = BUILTIN_PROFILES["chase_checking"]
    out["bank"] = run_transaction_import(conn, mapped_importer_for("bank"), _csv(bank), "demo-bank.csv",
                                         options=prof["options"], incoming_dir=inc, is_demo=True,
                                         actor="demo_script").inserted
    out["manual"] = run_transaction_import(conn, ManualCashImporter(), _csv(manual), "demo-cash.csv",
                                           incoming_dir=inc, is_demo=True, actor="demo_script").inserted
    threads = parse_manual_conversations(_csv(convo), owner_names=("Demo Owner",))
    out["messages"] = run_message_import(conn, source_type="manual", importer="manual_conversations",
                                         threads=threads, filename="demo-conversations.csv", file_sha256="demo",
                                         is_demo=True, actor="demo_script").inserted
    # a demo project with a deposit + balance pattern
    nova = clients["Demo Artist Nova"][0]
    create_project(conn, nova, "Demo EP — mix & master", service_id=service_id_for_code(conn, "mixing"),
                   stage="delivered", project_value_cents=60000, booked_at="2023-02-01", is_demo=True,
                   actor="demo_script")
    stats = run_reconciliation(conn)
    # Demo only: approve high-confidence deterministic suggestions so charts have verified data.
    approved = 0
    for r in conn.execute("""SELECT id FROM match_candidates WHERE review_status='pending' AND created_by='deterministic'
                             AND confidence_band='high' AND candidate_type IN ('txn_client','owner_transfer')""").fetchall():
        review.approve(conn, r["id"], actor="demo_script", note="demo auto-approval (synthetic data only)")
        approved += 1
    run_reconciliation(conn)  # second pass: service suggestions need verified payments
    for r in conn.execute("""SELECT id FROM match_candidates WHERE review_status='pending' AND created_by='deterministic'
                             AND candidate_type='service_classification' AND confidence_score >= 0.70""").fetchall():
        review.approve(conn, r["id"], actor="demo_script", note="demo auto-approval (synthetic data only)")
        approved += 1
    for m in ("2023-01", "2023-02", "2023-03"):
        set_expense_coverage(conn, m, actor="demo_script", note="demo")
    out["reconciliation"] = stats
    out["demo_approved"] = approved
    return json.loads(json.dumps(out, default=str))
