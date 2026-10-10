"""Deterministic transaction -> client / project matching.

Order of evidentiary strength (see confidence.py):
  1. exact verified identifier (phone/email/payment handle) or prior verified link
  2. exact unverified identifier
  3. amount + date + linked conversation evidence
  4. names (never conclusive)
All output is written as *pending* match_candidates for human review.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import date, timedelta

from ..database.connection import new_id
from .confidence import AMBIGUOUS_CEILING, NAME_ONLY_CEILING, RULE_SCORES, band

# identifier types that a transaction handle type can match
_COMPATIBLE = {
    "phone": ("phone", "zelle"),
    "email": ("email", "zelle"),
    "cashapp": ("cashapp",),
    "venmo": ("venmo",),
    "instagram": ("instagram",),
    "zelle": ("zelle", "phone", "email"),
}


@dataclass
class Proposal:
    client_id: str
    score: float
    method: str
    reasons: list[str] = field(default_factory=list)
    evidence_ids: list[str] = field(default_factory=list)


def insert_candidate(conn: sqlite3.Connection, *, key: str, candidate_type: str, method: str, score: float,
                     explanation: str, created_by: str = "deterministic", transaction_id: str | None = None,
                     related_transaction_id: str | None = None, proposed_client_id: str | None = None,
                     related_client_id: str | None = None, proposed_project_id: str | None = None,
                     proposed_value: str | None = None, proposed_amount_cents: int | None = None,
                     evidence_ids: list[str] | None = None, ai_request_id: str | None = None) -> str | None:
    """Insert a pending candidate unless one with the same key exists (idempotent)."""
    if conn.execute("SELECT 1 FROM match_candidates WHERE candidate_key = ?", (key,)).fetchone():
        return None
    cid = new_id("mc_")
    score = round(max(0.0, min(1.0, score)), 2)
    conn.execute(
        """INSERT INTO match_candidates(id, candidate_key, candidate_type, transaction_id, related_transaction_id,
               proposed_client_id, related_client_id, proposed_project_id, proposed_value, proposed_amount_cents,
               method, confidence_score, confidence_band, explanation, created_by, ai_request_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (cid, key, candidate_type, transaction_id, related_transaction_id, proposed_client_id, related_client_id,
         proposed_project_id, proposed_value, proposed_amount_cents, method, score, band(score), explanation,
         created_by, ai_request_id),
    )
    for evd in dict.fromkeys(evidence_ids or []):
        conn.execute("INSERT OR IGNORE INTO match_candidate_evidence(match_candidate_id, evidence_id) VALUES (?,?)",
                     (cid, evd))
    return cid


def _txn_evidence(conn: sqlite3.Connection, txn_id: str) -> list[str]:
    return [r["id"] for r in conn.execute("SELECT id FROM evidence WHERE transaction_id = ?", (txn_id,))]


def _add(props: dict[str, Proposal], client_id: str, score: float, method: str, reason: str,
         evidence: list[str] | None = None) -> None:
    p = props.get(client_id)
    if p is None:
        props[client_id] = Proposal(client_id, score, method, [reason], list(evidence or []))
        return
    p.reasons.append(reason)
    p.evidence_ids.extend(evidence or [])
    if score > p.score:
        p.score, p.method = score, method


def proposals_for_transaction(conn: sqlite3.Connection, txn: sqlite3.Row) -> list[Proposal]:
    props: dict[str, Proposal] = {}
    handle, htype = txn["counterparty_handle"], txn["counterparty_handle_type"]
    name = txn["counterparty_name_norm"]

    # 1/2. exact identifiers
    if handle and htype in _COMPATIBLE:
        marks = ",".join("?" for _ in _COMPATIBLE[htype])
        for r in conn.execute(
            f"""SELECT ci.client_id, ci.verification_status, ci.identifier_type FROM client_identifiers ci
                JOIN clients c ON c.id = ci.client_id
                WHERE c.status = 'active' AND ci.normalized_value = ? AND ci.identifier_type IN ({marks})
                  AND ci.verification_status <> 'rejected'""",
            (handle, *_COMPATIBLE[htype]),
        ):
            if r["verification_status"] == "verified":
                _add(props, r["client_id"], RULE_SCORES["verified_identifier"], "verified_identifier",
                     f"Exact {htype} '{handle}' is a verified identifier of this client")
            else:
                _add(props, r["client_id"], RULE_SCORES["unverified_identifier"], "unverified_identifier",
                     f"Exact {htype} '{handle}' matches an UNVERIFIED identifier of this client")
        # prior approved transactions with the same handle
        for r in conn.execute(
            """SELECT DISTINCT t.client_id FROM transactions t JOIN clients c ON c.id = t.client_id
               JOIN match_candidates mc ON mc.transaction_id = t.id AND mc.candidate_type = 'txn_client'
                    AND mc.review_status = 'approved' AND mc.proposed_client_id = t.client_id
               WHERE c.status = 'active' AND t.counterparty_handle = ? AND t.counterparty_handle_type = ?
                 AND t.id <> ?""", (handle, htype, txn["id"]),
        ):
            _add(props, r["client_id"], RULE_SCORES["prior_verified_link"], "prior_verified_link",
                 f"A reviewer previously approved a payment from {htype} '{handle}' for this client")

    # 4. names (never conclusive)
    if name:
        for r in conn.execute(
            """SELECT DISTINCT c.id AS client_id FROM clients c
               LEFT JOIN client_identifiers ci ON ci.client_id = c.id AND ci.identifier_type IN ('name','bank_name')
                    AND ci.verification_status <> 'rejected'
               WHERE c.status = 'active' AND (ci.normalized_value = ? OR lower(c.display_name) = ?)""",
            (name, name),
        ):
            _add(props, r["client_id"], RULE_SCORES["name_only"], "name_only",
                 f"Counterparty name '{txn['counterparty_raw']}' matches this client's name (names are not unique)")
        for r in conn.execute(
            """SELECT DISTINCT t.client_id FROM transactions t JOIN clients c ON c.id = t.client_id
               JOIN match_candidates mc ON mc.transaction_id = t.id AND mc.candidate_type = 'txn_client'
                    AND mc.review_status = 'approved'
               WHERE c.status = 'active' AND t.counterparty_name_norm = ? AND t.payment_method = ? AND t.id <> ?""",
            (name, txn["payment_method"], txn["id"]),
        ):
            _add(props, r["client_id"], RULE_SCORES["prior_link_same_name"], "prior_link_same_name",
                 f"A previously approved {txn['payment_method']} payment came from the same name")

    # 3. amount + date + conversation evidence
    if txn["transaction_date"] and txn["direction"] == "in":
        d = date.fromisoformat(txn["transaction_date"])
        lo, hi = (d - timedelta(days=30)).isoformat(), (d + timedelta(days=3)).isoformat() + "T23:59:59"
        for r in conn.execute(
            """SELECT cv.client_id, e.id AS evidence_id, ss.signal_type, cm.sent_at
               FROM service_signals ss
               JOIN conversation_messages cm ON cm.id = ss.conversation_message_id
               JOIN conversations cv ON cv.id = cm.conversation_id
               JOIN clients c ON c.id = cv.client_id AND c.status = 'active'
               LEFT JOIN evidence e ON e.conversation_message_id = cm.id
               WHERE ss.amount_cents = ? AND ss.signal_type IN ('quoted','booked','payment_mentioned')
                 AND cm.sent_at >= ? AND cm.sent_at <= ?""",
            (txn["gross_amount_cents"], lo, hi),
        ):
            ev = [r["evidence_id"]] if r["evidence_id"] else []
            existing = props.get(r["client_id"])
            if existing and existing.method in ("name_only", "prior_link_same_name"):
                _add(props, r["client_id"], RULE_SCORES["name_and_conversation"], "name_and_conversation",
                     f"Conversation on {str(r['sent_at'])[:10]} mentions the same amount ({r['signal_type']})", ev)
            elif existing and existing.score >= RULE_SCORES["unverified_identifier"]:
                existing.reasons.append(f"Conversation on {str(r['sent_at'])[:10]} mentions the same amount")
                existing.evidence_ids.extend(ev)
            else:
                _add(props, r["client_id"], RULE_SCORES["conversation_amount_date"], "conversation_amount_date",
                     f"Conversation on {str(r['sent_at'])[:10]} with this client mentions the same amount "
                     f"({r['signal_type']}) within 30 days before the payment", ev)

    out = list(props.values())
    for p in out:
        if p.method == "name_only":
            p.score = min(p.score, NAME_ONLY_CEILING)
    out.sort(key=lambda p: p.score, reverse=True)
    if len(out) >= 2 and out[0].score - out[1].score < 0.10:
        for p in out:
            p.score = min(p.score, AMBIGUOUS_CEILING)
            p.reasons.append(f"Ambiguous: {len(out)} clients have similar evidence")
    return out


def propose_client_matches(conn: sqlite3.Connection, transaction_ids: list[str] | None = None) -> int:
    sql = """SELECT * FROM transactions WHERE client_id IS NULL AND duplicate_of_id IS NULL
             AND verification_status <> 'excluded'
             AND txn_type IN ('payment_received','refund','reversal','unknown')"""
    params: list = []
    if transaction_ids:
        sql += f" AND id IN ({','.join('?' for _ in transaction_ids)})"
        params = list(transaction_ids)
    created = 0
    for txn in conn.execute(sql, params).fetchall():
        for p in proposals_for_transaction(conn, txn):
            cid = insert_candidate(
                conn, key=f"txn_client|{txn['id']}|{p.client_id}", candidate_type="txn_client",
                method=p.method, score=p.score, explanation="; ".join(dict.fromkeys(p.reasons)),
                transaction_id=txn["id"], proposed_client_id=p.client_id,
                evidence_ids=_txn_evidence(conn, txn["id"]) + p.evidence_ids,
            )
            created += bool(cid)
    return created


def unallocated_cents(conn: sqlite3.Connection, txn_id: str) -> int:
    r = conn.execute(
        """SELECT t.net_amount_cents - COALESCE((SELECT SUM(amount_cents) FROM transaction_allocations
               WHERE transaction_id = t.id AND status = 'active'), 0) AS rem FROM transactions t WHERE t.id = ?""",
        (txn_id,)).fetchone()
    return int(r["rem"]) if r else 0


def project_outstanding_cents(conn: sqlite3.Connection, project_id: str) -> int | None:
    r = conn.execute(
        """SELECT p.project_value_cents AS v,
                  COALESCE((SELECT SUM(CASE WHEN a.allocation_type = 'refund' THEN -a.amount_cents ELSE a.amount_cents END)
                            FROM transaction_allocations a WHERE a.project_id = p.id AND a.status = 'active'), 0) AS paid
           FROM projects p WHERE p.id = ?""", (project_id,)).fetchone()
    if r is None or r["v"] is None:
        return None
    return int(r["v"]) - int(r["paid"])


def propose_project_allocations(conn: sqlite3.Connection) -> int:
    created = 0
    txns = conn.execute(
        """SELECT * FROM transactions WHERE client_id IS NOT NULL AND txn_type = 'payment_received'
           AND duplicate_of_id IS NULL AND verification_status = 'verified'""").fetchall()
    for txn in txns:
        remaining = unallocated_cents(conn, txn["id"])
        if remaining <= 0:
            continue
        projects = conn.execute(
            """SELECT * FROM projects WHERE client_id = ? AND stage IN ('quoted','booked','in_progress','delivered')""",
            (txn["client_id"],)).fetchall()
        open_projects = []
        for p in projects:
            outstanding = project_outstanding_cents(conn, p["id"])
            if outstanding is not None and outstanding <= 0:
                continue
            start = p["quoted_at"] or p["booked_at"] or p["discussed_at"]
            if start and txn["transaction_date"] and txn["transaction_date"] < (
                    date.fromisoformat(start[:10]) - timedelta(days=30)).isoformat():
                continue
            open_projects.append((p, outstanding))
        for p, outstanding in open_projects:
            amount = remaining if outstanding is None else min(remaining, outstanding)
            score = 0.75 if len(open_projects) == 1 else 0.50
            reasons = [f"Client has {len(open_projects)} open project(s)"]
            if outstanding is not None and remaining == outstanding:
                score += 0.05
                reasons.append("payment equals the remaining balance")
            elif p["quoted_amount_cents"] and p["quoted_amount_cents"] == txn["gross_amount_cents"]:
                score += 0.05
                reasons.append("payment equals the quoted amount")
            if outstanding is not None and remaining > outstanding:
                reasons.append("payment exceeds the remaining balance; only the balance is proposed")
            cid = insert_candidate(
                conn, key=f"txn_project|{txn['id']}|{p['id']}", candidate_type="txn_project",
                method="client_open_project", score=min(score, 0.84), explanation="; ".join(reasons),
                transaction_id=txn["id"], proposed_client_id=txn["client_id"], proposed_project_id=p["id"],
                proposed_amount_cents=amount, evidence_ids=_txn_evidence(conn, txn["id"]),
            )
            created += bool(cid)
    return created


def propose_client_merges(conn: sqlite3.Connection) -> int:
    """Clients that share a normalised name or any identifier -> review (never auto-merge)."""
    created = 0
    rows = conn.execute(
        """SELECT a.client_id AS a, b.client_id AS b, a.identifier_type AS t, a.normalized_value AS v
           FROM client_identifiers a JOIN client_identifiers b
             ON a.identifier_type = b.identifier_type AND a.normalized_value = b.normalized_value
            AND a.client_id < b.client_id
           JOIN clients ca ON ca.id = a.client_id AND ca.status = 'active'
           JOIN clients cb ON cb.id = b.client_id AND cb.status = 'active'
           WHERE a.verification_status <> 'rejected' AND b.verification_status <> 'rejected'""").fetchall()
    for r in rows:
        is_name = r["t"] in ("name", "bank_name")
        score = 0.45 if is_name else 0.70
        cid = insert_candidate(
            conn, key=f"client_merge|{r['a']}|{r['b']}|{r['t']}", candidate_type="client_merge",
            method="shared_name" if is_name else "shared_identifier", score=score,
            explanation=(f"Both clients have {r['t']} '{r['v']}'" +
                         (" — names alone do not prove they are the same person" if is_name else "")),
            proposed_client_id=r["a"], related_client_id=r["b"],
        )
        created += bool(cid)
    return created


def propose_service_classifications(conn: sqlite3.Connection) -> int:
    """Service suggestions for verified payments that have none yet.

    Evidence sources (deterministic):
      * keywords in the payment note itself (e.g. Cash App note "mix")
      * a quote/booking of the SAME amount, with a detected service, in a
        conversation linked to the same client within 30 days before payment
    """
    from ..catalog import detect_services

    created = 0
    txns = conn.execute(
        """SELECT * FROM transactions t WHERE t.txn_type = 'payment_received' AND t.verification_status = 'verified'
           AND t.service_id IS NULL AND t.duplicate_of_id IS NULL AND NOT EXISTS (
               SELECT 1 FROM transaction_allocations a JOIN projects p ON p.id = a.project_id
               WHERE a.transaction_id = t.id AND a.status = 'active' AND p.service_id IS NOT NULL)""").fetchall()
    for txn in txns:
        hits = detect_services(conn, txn["memo"]) if txn["memo"] else []
        if len(hits) == 1:
            h = hits[0]
            created += bool(insert_candidate(
                conn, key=f"service_classification|{txn['id']}|{h.service_code}|note", method="payment_note_keyword",
                candidate_type="service_classification", score=0.65, transaction_id=txn["id"],
                proposed_value=h.service_code, evidence_ids=_txn_evidence(conn, txn["id"]),
                explanation=f"Payment note contains '{h.matched_term}'"))
        if not txn["client_id"] or not txn["transaction_date"]:
            continue
        d = date.fromisoformat(txn["transaction_date"])
        rows = conn.execute(
            """SELECT DISTINCT sc.code, e.id AS evidence_id, cm.sent_at, ss.signal_type
               FROM service_signals ss JOIN service_catalog sc ON sc.id = ss.service_id
               JOIN conversation_messages cm ON cm.id = ss.conversation_message_id
               JOIN conversations cv ON cv.id = cm.conversation_id
               LEFT JOIN evidence e ON e.conversation_message_id = cm.id
               WHERE cv.client_id = ? AND ss.amount_cents = ? AND ss.signal_type IN ('quoted','booked','payment_mentioned')
                 AND cm.sent_at >= ? AND cm.sent_at <= ?""",
            (txn["client_id"], txn["gross_amount_cents"], (d - timedelta(days=30)).isoformat(),
             (d + timedelta(days=1)).isoformat() + "T23:59:59")).fetchall()
        codes = {r["code"] for r in rows}
        for r in rows:
            score = 0.70 if len(codes) == 1 else 0.50
            created += bool(insert_candidate(
                conn, key=f"service_classification|{txn['id']}|{r['code']}|conversation",
                candidate_type="service_classification", method="conversation_quote_same_amount", score=score,
                transaction_id=txn["id"], proposed_value=r["code"],
                evidence_ids=_txn_evidence(conn, txn["id"]) + ([r["evidence_id"]] if r["evidence_id"] else []),
                explanation=(f"Client's conversation on {str(r['sent_at'])[:10]} {r['signal_type']} this service for "
                             f"the same amount" + ("" if len(codes) == 1 else f"; {len(codes)} services conflict"))))
    return created
