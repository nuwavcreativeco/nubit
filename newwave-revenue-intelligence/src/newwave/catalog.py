"""Service catalog: seeding from config and conservative keyword detection."""
from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from decimal import Decimal

from .config import CONFIG_DIR
from .database.connection import new_id
from .money import to_cents

CATALOG_FILE = CONFIG_DIR / "service_catalog.json"


def seed_service_catalog(conn: sqlite3.Connection) -> int:
    """Insert catalog entries that do not exist yet. Never overwrites user edits."""
    if not CATALOG_FILE.is_file():
        return 0
    data = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
    added = 0
    for order, svc in enumerate(data.get("services", [])):
        exists = conn.execute("SELECT 1 FROM service_catalog WHERE code = ?", (svc["code"],)).fetchone()
        if exists:
            continue
        conn.execute(
            """INSERT INTO service_catalog(id, code, name, aliases_json, keywords_json, sort_order)
               VALUES (?,?,?,?,?,?)""",
            (new_id("svc_"), svc["code"], svc["name"], json.dumps(svc.get("aliases", [])),
             json.dumps(svc.get("keywords", [])), order),
        )
        added += 1
    return added


def list_services(conn: sqlite3.Connection, active_only: bool = True) -> list[sqlite3.Row]:
    sql = "SELECT * FROM service_catalog"
    if active_only:
        sql += " WHERE active = 1"
    return conn.execute(sql + " ORDER BY sort_order, name").fetchall()


def service_id_for_code(conn: sqlite3.Connection, code: str) -> str | None:
    row = conn.execute("SELECT id FROM service_catalog WHERE code = ?", (code,)).fetchone()
    return row["id"] if row else None


@dataclass
class ServiceHit:
    service_code: str
    service_id: str
    signal_type: str
    amount_cents: int | None
    matched_term: str


_PRICE_RE = re.compile(r"\$\s?(\d{1,5}(?:,\d{3})*(?:\.\d{2})?)")
_QUOTE_WORDS = re.compile(r"\b(i charge|it'?s|is|are|costs?|price|rate|for|total|quote|deposit|runs?)\b", re.I)
_BOOKED_WORDS = re.compile(r"\b(booked|locked in|confirmed|see you (on|at)|scheduled)\b", re.I)
_PAID_WORDS = re.compile(r"\b(sent( it)?|paid|cash ?app(ed)?|venmo(ed)?|zelle(d)?)\b", re.I)
_DELIVERED_WORDS = re.compile(r"\b(here'?s (your|the) (mix|master|beat|file)s?|final (mix|master|files?)|delivered)\b", re.I)
_REFUND_WORDS = re.compile(r"\b(refund(ed)?|send (it|the money) back)\b", re.I)


def detect_services(conn: sqlite3.Connection, text: str) -> list[ServiceHit]:
    """Keyword-based service detection. Returns at most one hit per service.

    Signal types are conservative: 'discussed' by default; 'quoted' only when a
    dollar amount appears near pricing words; 'booked'/'payment_mentioned'/
    'delivered'/'refund_mentioned' only for explicit phrases.
    """
    if not text:
        return []
    lowered = text.lower()
    prices = [to_cents(Decimal(p.replace(",", ""))) for p in _PRICE_RE.findall(text)]
    if _REFUND_WORDS.search(text):
        signal = "refund_mentioned"
    elif _DELIVERED_WORDS.search(text):
        signal = "delivered"
    elif _PAID_WORDS.search(text) and prices:
        signal = "payment_mentioned"
    elif _BOOKED_WORDS.search(text):
        signal = "booked"
    elif prices and _QUOTE_WORDS.search(text):
        signal = "quoted"
    else:
        signal = "discussed"
    hits: list[ServiceHit] = []
    for svc in list_services(conn):
        terms = json.loads(svc["keywords_json"]) + json.loads(svc["aliases_json"])
        # longest terms first so 'exclusive rights' beats 'exclusive'
        for term in sorted({t.lower() for t in terms if t}, key=len, reverse=True):
            if re.search(r"(?<![a-z])" + re.escape(term) + r"(?![a-z])", lowered):
                hits.append(ServiceHit(svc["code"], svc["id"], signal,
                                       prices[0] if prices and signal != "discussed" else None, term))
                break
    # 'exclusive' should not also count as a lease when only exclusive terms matched
    codes = {h.service_code for h in hits}
    if "exclusive_beat" in codes and "beat_lease" in codes:
        lease_hit = next(h for h in hits if h.service_code == "beat_lease")
        if lease_hit.matched_term in {"license", "licence"}:
            hits = [h for h in hits if h.service_code != "beat_lease"]
    return hits
