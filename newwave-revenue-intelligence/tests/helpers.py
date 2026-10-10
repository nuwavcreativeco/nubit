"""Small synthetic-data builders shared by tests."""
from newwave.ingestion.base import run_transaction_import
from newwave.ingestion.payments import CashAppImporter

HEADER = "Transaction ID,Date,Transaction Type,Currency,Amount,Fee,Status,Notes,Name of sender/receiver\n"


def cashapp(conn, rows, name="t.csv"):
    """rows: (id, date, amount_str, name_or_tag[, notes[, type[, status]]])"""
    lines = [HEADER]
    for r in rows:
        rid, d, amt, who = r[:4]
        notes = r[4] if len(r) > 4 else ""
        typ = r[5] if len(r) > 5 else "P2P"
        status = r[6] if len(r) > 6 else "COMPLETE"
        lines.append(f"{rid},{d},{typ},USD,{amt},$0,{status},{notes},{who}\n")
    return run_transaction_import(conn, CashAppImporter(), "".join(lines).encode(), name)


def txn_id(conn, source_record_id):
    return conn.execute("SELECT id FROM transactions WHERE source_record_id = ?", (source_record_id,)).fetchone()[0]


def candidates(conn, ctype=None, txn=None):
    sql, p = "SELECT * FROM match_candidates WHERE 1=1", []
    if ctype:
        sql += " AND candidate_type = ?"
        p.append(ctype)
    if txn:
        sql += " AND transaction_id = ?"
        p.append(txn)
    return conn.execute(sql + " ORDER BY confidence_score DESC", p).fetchall()
