"""Payment-source importers.

Each importer turns rows into ParsedTransaction objects and assigns a
*conservative* initial classification with a human-readable reason. Nothing
here decides that money is verified revenue — that requires review.
"""
from __future__ import annotations

import re
from typing import Callable

from ..money import MoneyParseError, parse_amount, to_cents
from ..normalization.dates import parse_datetime
from ..normalization.identifiers import (
    detect_contact, normalize_cashtag, normalize_instagram, normalize_venmo,
)
from ..security.sanitize import clean_field
from .base import ParsedTransaction, ParseResult, RowIssue
from .tabular import Table, read_csv_table, read_json_table, resolve_columns

STATUS_MAP = {
    "complete": "completed", "completed": "completed", "paid": "completed", "issued": "completed",
    "posted": "completed", "settled": "completed", "success": "completed", "successful": "completed",
    "sent": "completed", "received": "completed", "deposited": "completed",
    "pending": "pending", "processing": "pending", "in progress": "pending", "scheduled": "pending",
    "failed": "failed", "payment failed": "failed", "declined": "failed", "returned": "failed",
    "canceled": "cancelled", "cancelled": "cancelled", "payment canceled": "cancelled",
    "refunded": "refunded", "payment refunded": "refunded",
}


def map_status(raw: str, default: str = "unknown") -> str:
    return STATUS_MAP.get((raw or "").strip().lower(), default)


def _amount(row_number: int, text: str, result: ParseResult) -> tuple[int, int, str | None] | None:
    """Return (abs_cents, sign, currency) or record a failure."""
    try:
        value, cur = parse_amount(text)
    except MoneyParseError as exc:
        result.failed.append(RowIssue(row_number, str(exc)))
        return None
    cents = to_cents(value)
    return abs(cents), (1 if cents >= 0 else -1), cur


def _fee(text: str) -> int:
    if not text or not text.strip():
        return 0
    try:
        value, _ = parse_amount(text)
    except MoneyParseError:
        return 0
    return abs(to_cents(value))


def _date(row_number: int, text: str, t: ParsedTransaction, date_order: str = "MDY") -> None:
    d, dt = parse_datetime(text, date_order)
    t.transaction_date, t.transaction_datetime = d, dt
    if d is None:
        t.warnings.append(f"missing or invalid date {text!r}; excluded from dated reports until fixed")
        t.verification_status = "needs_review"


def _currency_check(t: ParsedTransaction, base_currency: str) -> None:
    if t.currency != base_currency:
        t.warnings.append(f"currency {t.currency} differs from reporting currency {base_currency}")
        t.verification_status = "needs_review"


# --------------------------------------------------------------------------- Cash App

class CashAppImporter:
    name = "cashapp_csv"
    source_type = "cashapp"
    label = "Cash App statement export (CSV)"

    COLUMNS = {
        "id": ("Transaction ID", "ID"),
        "date": ("Date", "Date (UTC)", "Transaction Date"),
        "type": ("Transaction Type", "Type"),
        "currency": ("Currency",),
        "amount": ("Amount", "Net Amount"),
        "fee": ("Fee",),
        "status": ("Status",),
        "notes": ("Notes", "Note", "Description"),
        "name": ("Name of sender/receiver", "Name of sender / receiver", "Sender/Receiver", "Name"),
        "account": ("Account",),
        "asset_type": ("Asset Type",),
    }
    HINTS = ("transaction id", "date", "transaction type", "amount", "status")

    def parse(self, data: bytes, options: dict | None = None) -> ParseResult:
        options = options or {}
        table = read_csv_table(data, self.HINTS)
        cols = resolve_columns(table.headers, self.COLUMNS)
        if not cols["date"] or not cols["amount"]:
            raise ValueError("not a Cash App export: missing Date/Amount columns")
        result = ParseResult(record_count=len(table.rows))
        base_currency = options.get("base_currency", "USD")
        for i, row in enumerate(table.rows, start=1):
            g = lambda k: row.get(cols[k], "") if cols[k] else ""  # noqa: E731
            amt = _amount(i, g("amount"), result)
            if amt is None:
                continue
            cents, sign, cur = amt
            ttype = g("type").strip()
            t = ParsedTransaction(
                row_number=i, raw=row, source_amount_text=g("amount"),
                direction="in" if sign > 0 else "out", gross_cents=cents,
                currency=(g("currency") or cur or base_currency).upper(),
                source_record_id=g("id") or None, payment_method="cashapp",
                source_status_raw=g("status"), source_status=map_status(g("status")),
                counterparty_raw=clean_field(g("name")), memo=g("notes"),
                account_label=g("account") or "Cash App",
            )
            if t.direction == "in":
                t.fee_cents = min(_fee(g("fee")), cents)
            else:
                t.fee_cents = _fee(g("fee"))
            tag = normalize_cashtag(g("name")) if g("name").strip().startswith("$") else None
            if tag:
                t.counterparty_handle, t.counterparty_handle_type = tag, "cashapp"
            _date(i, g("date"), t)
            _currency_check(t, base_currency)
            self._classify(t, ttype, g("asset_type"))
            result.transactions.append(t)
        return result

    @staticmethod
    def _classify(t: ParsedTransaction, ttype: str, asset_type: str) -> None:
        low = ttype.lower()
        if asset_type and asset_type.upper() not in ("", "USD"):
            t.txn_type, t.classification_reason = "personal", f"Investment/asset activity ({asset_type})"
        elif any(k in low for k in ("bitcoin", "stock", "btc")):
            t.txn_type, t.classification_reason = "personal", f"Investment activity ({ttype})"
        elif any(k in low for k in ("cash out", "transfer", "withdraw", "cash in", "deposit", "add cash")):
            t.txn_type = "owner_transfer"
            t.classification_reason = f"Cash App '{ttype}' moves money between the owner's own accounts"
        elif "refund" in low:
            t.txn_type = "refund" if t.direction == "out" else "unknown"
            t.classification_reason = f"Cash App type '{ttype}'"
        elif "p2p" in low or low in ("payment", "received", "sent"):
            if t.direction == "in":
                t.txn_type = "payment_received"
                t.classification_reason = "Incoming person-to-person payment (candidate revenue, needs review)"
            else:
                t.txn_type = "unknown"
                t.classification_reason = "Outgoing P2P payment: could be a refund, expense or personal — review"
        elif "card" in low:
            t.txn_type = "unknown"
            t.classification_reason = "Cash Card purchase: could be a business expense or personal — review"
        else:
            t.txn_type = "unknown"
            t.classification_reason = f"Unrecognised Cash App type '{ttype}'"


# --------------------------------------------------------------------------- Venmo

class VenmoImporter:
    name = "venmo_csv"
    source_type = "venmo"
    label = "Venmo statement export (CSV)"

    COLUMNS = {
        "id": ("ID",),
        "datetime": ("Datetime", "Date"),
        "type": ("Type",),
        "status": ("Status",),
        "note": ("Note",),
        "from": ("From",),
        "to": ("To",),
        "amount": ("Amount (total)", "Amount"),
        "fee": ("Amount (fee)", "Fee"),
        "funding": ("Funding Source",),
        "destination": ("Destination",),
    }
    HINTS = ("id", "datetime", "type", "status", "amount (total)", "from", "to")

    def parse(self, data: bytes, options: dict | None = None) -> ParseResult:
        options = options or {}
        table = read_csv_table(data, self.HINTS)
        cols = resolve_columns(table.headers, self.COLUMNS)
        if not cols["amount"] or not cols["datetime"]:
            raise ValueError("not a Venmo export: missing Datetime/Amount columns")
        result = ParseResult()
        base_currency = options.get("base_currency", "USD")
        handle = self._statement_handle(table)
        for i, row in enumerate(table.rows, start=1):
            g = lambda k: row.get(cols[k], "") if cols[k] else ""  # noqa: E731
            if not g("id") and not g("type"):
                result.skipped.append(RowIssue(i, "balance/summary row"))
                continue
            result.record_count += 1
            amt = _amount(i, g("amount"), result)
            if amt is None:
                continue
            cents, sign, cur = amt
            direction = "in" if sign > 0 else "out"
            counterparty = g("from") if direction == "in" else g("to")
            t = ParsedTransaction(
                row_number=i, raw=row, source_amount_text=g("amount"), direction=direction,
                gross_cents=cents, currency=(cur or base_currency), source_record_id=g("id") or None,
                payment_method="venmo", source_status_raw=g("status"),
                source_status=map_status(g("status")), counterparty_raw=clean_field(counterparty),
                memo=g("note"), account_label=f"Venmo @{handle}" if handle else "Venmo",
            )
            fee = _fee(g("fee"))
            t.fee_cents = min(fee, cents) if direction == "in" else fee
            _date(i, g("datetime"), t)
            _currency_check(t, base_currency)
            self._classify(t, g("type"))
            result.transactions.append(t)
        return result

    @staticmethod
    def _statement_handle(table: Table) -> str | None:
        for row in table.preamble:
            for cell in row:
                m = re.search(r"\(@([A-Za-z0-9_-]+)\)", cell or "")
                if m:
                    return normalize_venmo(m.group(1))
        return None

    @staticmethod
    def _classify(t: ParsedTransaction, ttype: str) -> None:
        low = (ttype or "").lower()
        if "transfer" in low or "add funds" in low:
            t.txn_type = "owner_transfer"
            t.classification_reason = f"Venmo '{ttype}' moves money between the owner's own accounts"
        elif "refund" in low:
            t.txn_type = "refund" if t.direction == "out" else "unknown"
            t.classification_reason = f"Venmo type '{ttype}'"
        elif low in ("payment", "charge"):
            if t.direction == "in":
                t.txn_type = "payment_received"
                t.classification_reason = f"Incoming Venmo {low} (candidate revenue, needs review)"
            else:
                t.txn_type = "unknown"
                t.classification_reason = "Outgoing Venmo payment: refund, expense or personal — review"
        else:
            t.txn_type = "unknown"
            t.classification_reason = f"Venmo type '{ttype}'"


# --------------------------------------------------------------------------- Bank / Zelle / generic mapped

ZELLE_IN_RE = re.compile(
    r"zelle\s+(?:payment\s+|transfer\s+)?from\s+(?P<name>.+?)(?:\s+(?:on\s+\d|conf(?:irmation)?\s*#?|ref(?:erence)?\s*#?|id:?)\s*(?P<ref>[A-Za-z0-9]+)?.*)?$",
    re.I)
ZELLE_OUT_RE = re.compile(
    r"zelle\s+(?:payment\s+|transfer\s+)?to\s+(?P<name>.+?)(?:\s+(?:on\s+\d|conf(?:irmation)?\s*#?|ref(?:erence)?\s*#?|id:?)\s*(?P<ref>[A-Za-z0-9]+)?.*)?$",
    re.I)
CONF_RE = re.compile(r"conf(?:irmation)?\s*#?\s*:?\s*([A-Za-z0-9]{6,})", re.I)
PAYMENT_APP_TRANSFER_RE = re.compile(
    r"(cash\s*app\*?\s*(cash\s*out|add\s*cash|transfer)|square\s+inc|venmo\s*\*?\s*(cashout|cash\s*out|transfer|add\s*funds)"
    r"|paypal\s+transfer|apple\s+cash\s+transfer|online\s+transfer\s+(to|from)|transfer\s+(to|from)\s+(chk|sav|checking|savings)"
    r"|internal\s+transfer)", re.I)
CASH_DEPOSIT_RE = re.compile(r"\b(atm\s+deposit|cash\s+deposit|mobile\s+deposit|branch\s+deposit|deposit)\b", re.I)
BANK_FEE_RE = re.compile(r"\b(service\s+fee|monthly\s+fee|overdraft|nsf\s+fee|wire\s+fee|atm\s+fee)\b", re.I)


def classify_bank_description(t: ParsedTransaction, description: str) -> None:
    desc = description or ""
    m_in = ZELLE_IN_RE.search(desc)
    m_out = ZELLE_OUT_RE.search(desc)
    conf = CONF_RE.search(desc)
    if (m_in or m_out) and conf and not t.source_record_id:
        t.source_record_id = f"zelle:{conf.group(1)}"
    if m_in and t.direction == "in":
        t.payment_method = "zelle"
        t.counterparty_raw = clean_field(m_in.group("name"))
        t.txn_type = "payment_received"
        t.classification_reason = "Incoming Zelle payment on bank statement (candidate revenue, needs review)"
    elif m_out and t.direction == "out":
        t.payment_method = "zelle"
        t.counterparty_raw = clean_field(m_out.group("name"))
        t.txn_type = "unknown"
        t.classification_reason = "Outgoing Zelle payment: refund, expense or personal — review"
    elif PAYMENT_APP_TRANSFER_RE.search(desc):
        t.txn_type = "owner_transfer"
        t.classification_reason = "Bank line looks like a transfer between the owner's accounts/payment apps"
    elif BANK_FEE_RE.search(desc) and t.direction == "out":
        t.txn_type = "expense"
        t.classification_reason = "Bank fee"
    elif CASH_DEPOSIT_RE.search(desc) and t.direction == "in":
        t.txn_type = "unknown"
        t.classification_reason = ("Deposit without an identified payer — may contain cash payments that are "
                                   "recorded elsewhere; reconcile before counting")
    else:
        t.txn_type = "unknown"
        t.classification_reason = ("Bank deposit of unknown origin — not assumed to be revenue" if t.direction == "in"
                                   else "Bank debit — expense or personal? Review")
    contact = detect_contact(t.counterparty_raw)
    if contact:
        t.counterparty_handle_type, t.counterparty_handle = contact


MAPPABLE_FIELDS = {
    "date": "Transaction date (required)",
    "amount": "Signed amount (use this OR debit/credit)",
    "debit": "Debit / money out column",
    "credit": "Credit / money in column",
    "direction": "Direction column (e.g. Sent/Received, DEBIT/CREDIT)",
    "description": "Description / memo",
    "counterparty": "Counterparty name",
    "counterparty_handle": "Counterparty phone / email / handle",
    "id": "Stable transaction / confirmation ID",
    "status": "Status",
    "fee": "Fee",
    "refund": "Inline refunded amount",
    "currency": "Currency",
    "type": "Source transaction type",
    "account": "Account name",
}


class MappedImporter:
    """Importer driven by a column mapping — used for bank CSVs, Zelle
    exports and any unfamiliar CSV/JSON after the mapping/preview step.

    options:
      mapping: {field: column}
      amount_mode: 'signed' | 'debit_credit' | 'direction_column'
      positive_is: 'in' | 'out'            (for signed amounts; default 'in')
      direction_in_values: list[str]        (for direction_column)
      date_order: 'MDY' | 'DMY'
      payment_method: default method label
      classify: 'bank' | 'zelle' | 'none'
      json_records_path: dotted path when format == 'json'
      format: 'csv' | 'json'
    """

    def __init__(self, name: str = "mapped_csv", source_type: str = "bank", label: str = "Mapped CSV/JSON"):
        self.name = name
        self.source_type = source_type
        self.label = label

    def load_table(self, data: bytes, options: dict) -> Table:
        if options.get("format") == "json":
            return read_json_table(data, options.get("json_records_path", ""))
        return read_csv_table(data, tuple(c for c in (options.get("mapping") or {}).values() if c))

    def parse(self, data: bytes, options: dict | None = None) -> ParseResult:
        options = dict(options or {})
        mapping = options.get("mapping") or {}
        table = self.load_table(data, options)
        missing = [c for c in mapping.values() if c and c not in table.headers]
        if missing:
            raise ValueError(f"mapped columns not found in file: {missing}")
        if not mapping.get("date"):
            raise ValueError("a date column must be mapped")
        mode = options.get("amount_mode", "signed")
        if mode == "signed" and not mapping.get("amount"):
            raise ValueError("an amount column must be mapped")
        if mode == "debit_credit" and not (mapping.get("debit") and mapping.get("credit")):
            raise ValueError("both debit and credit columns must be mapped")
        if mode == "direction_column" and not (mapping.get("amount") and mapping.get("direction")):
            raise ValueError("amount and direction columns must be mapped")
        base_currency = options.get("base_currency", "USD")
        positive_is = options.get("positive_is", "in")
        dir_in_values = {v.lower() for v in options.get("direction_in_values", ["received", "credit", "in", "deposit"])}
        method = options.get("payment_method", "bank" if self.source_type == "bank" else "other")
        classify = options.get("classify", "bank" if self.source_type in ("bank", "zelle") else "none")
        result = ParseResult(record_count=len(table.rows))
        for i, row in enumerate(table.rows, start=1):
            g = lambda k: row.get(mapping[k], "") if mapping.get(k) else ""  # noqa: E731
            if mode == "debit_credit":
                debit, credit = g("debit").strip(), g("credit").strip()
                if debit and credit:
                    result.failed.append(RowIssue(i, "both debit and credit populated"))
                    continue
                text = credit or debit
                if not text:
                    result.skipped.append(RowIssue(i, "no amount"))
                    continue
                amt = _amount(i, text, result)
                if amt is None:
                    continue
                cents, _, cur = amt
                direction = "in" if credit else "out"
            else:
                text = g("amount")
                amt = _amount(i, text, result)
                if amt is None:
                    continue
                cents, sign, cur = amt
                if mode == "direction_column":
                    direction = "in" if g("direction").strip().lower() in dir_in_values else "out"
                else:
                    direction = ("in" if sign > 0 else "out") if positive_is == "in" else ("out" if sign > 0 else "in")
            if cents == 0:
                result.skipped.append(RowIssue(i, "zero amount"))
                continue
            t = ParsedTransaction(
                row_number=i, raw=row, source_amount_text=text, direction=direction, gross_cents=cents,
                currency=(g("currency") or cur or base_currency).upper(),
                source_record_id=g("id") or None, payment_method=method,
                source_status_raw=g("status"),
                source_status=map_status(g("status"), default="completed" if not mapping.get("status") else "unknown"),
                counterparty_raw=clean_field(g("counterparty")), memo=g("description"),
                account_label=g("account") or options.get("account_label", ""),
            )
            if direction == "in":
                t.fee_cents = min(_fee(g("fee")), cents)
                t.refund_cents = min(_fee(g("refund")), cents - t.fee_cents)
            else:
                t.fee_cents = _fee(g("fee"))
            handle = g("counterparty_handle")
            if handle:
                contact = detect_contact(handle)
                if contact:
                    t.counterparty_handle_type, t.counterparty_handle = contact
                elif handle.strip().startswith("$") and normalize_cashtag(handle):
                    t.counterparty_handle_type, t.counterparty_handle = "cashapp", normalize_cashtag(handle)
                elif handle.strip().startswith("@") and normalize_instagram(handle):
                    t.counterparty_handle_type, t.counterparty_handle = "venmo" if method == "venmo" else "instagram", normalize_instagram(handle)
            _date(i, g("date"), t, options.get("date_order", "MDY"))
            _currency_check(t, base_currency)
            if classify == "bank":
                classify_bank_description(t, " ".join(x for x in (g("description"), g("type"), g("counterparty")) if x))
                if self.source_type == "zelle":
                    t.payment_method = "zelle"
                    if t.txn_type == "unknown" and t.direction == "in":
                        t.txn_type = "payment_received"
                        t.classification_reason = "Incoming Zelle payment (candidate revenue, needs review)"
            else:
                default_in = options.get("default_inflow_type", "unknown")
                t.txn_type = default_in if direction == "in" else options.get("default_outflow_type", "unknown")
                t.classification_reason = "Mapped import; classification set by import options"
            result.transactions.append(t)
        return result


# Built-in profiles for common US bank / Zelle layouts. Users can save more.
BUILTIN_PROFILES: dict[str, dict] = {
    "chase_checking": {
        "label": "Chase checking/savings CSV",
        "source_type": "bank",
        "options": {"mapping": {"date": "Posting Date", "description": "Description", "amount": "Amount",
                                "type": "Type"},
                    "amount_mode": "signed", "positive_is": "in", "classify": "bank",
                    "payment_method": "bank", "account_label": "Chase"},
    },
    "bank_of_america": {
        "label": "Bank of America CSV",
        "source_type": "bank",
        "options": {"mapping": {"date": "Date", "description": "Description", "amount": "Amount"},
                    "amount_mode": "signed", "positive_is": "in", "classify": "bank",
                    "payment_method": "bank", "account_label": "Bank of America"},
    },
    "generic_debit_credit": {
        "label": "Generic bank CSV with Debit/Credit columns",
        "source_type": "bank",
        "options": {"mapping": {"date": "Date", "description": "Description", "debit": "Debit", "credit": "Credit"},
                    "amount_mode": "debit_credit", "classify": "bank", "payment_method": "bank"},
    },
    "zelle_activity": {
        "label": "Zelle activity export (Date, Name, Amount, Direction, Confirmation)",
        "source_type": "zelle",
        "options": {"mapping": {"date": "Date", "counterparty": "Name", "counterparty_handle": "Email/Phone",
                                "amount": "Amount", "direction": "Direction", "id": "Confirmation",
                                "status": "Status", "description": "Memo"},
                    "amount_mode": "direction_column", "direction_in_values": ["received", "in", "credit"],
                    "classify": "bank", "payment_method": "zelle"},
    },
}


# --------------------------------------------------------------------------- Manual cash

class ManualCashImporter:
    """Owner-recorded cash (or other offline) payments from a CSV template.

    Columns: date, amount, payer_name, payer_phone, payer_instagram, payer_email,
    service, memo, receipt_ref, entry_id, type (payment_received|expense|refund),
    method (cash|check|other).
    """
    name = "manual_cash_csv"
    source_type = "manual"
    label = "Manual cash / offline payments (template CSV)"
    TEMPLATE_HEADERS = ["entry_id", "date", "amount", "type", "method", "payer_name", "payer_phone",
                        "payer_instagram", "payer_email", "service", "memo", "receipt_ref"]

    def parse(self, data: bytes, options: dict | None = None) -> ParseResult:
        options = options or {}
        table = read_csv_table(data, ("date", "amount", "payer_name"))
        if "date" not in table.headers or "amount" not in table.headers:
            raise ValueError("manual template must have 'date' and 'amount' columns")
        result = ParseResult(record_count=len(table.rows))
        for i, row in enumerate(table.rows, start=1):
            amt = _amount(i, row.get("amount", ""), result)
            if amt is None:
                continue
            cents, sign, cur = amt
            ttype = (row.get("type") or "payment_received").strip().lower()
            if ttype not in ("payment_received", "expense", "refund", "personal", "unknown"):
                result.failed.append(RowIssue(i, f"unsupported type {ttype!r}"))
                continue
            direction = "in" if ttype in ("payment_received", "unknown") and sign > 0 else "out"
            method = (row.get("method") or "cash").strip().lower()
            if method not in ("cash", "check", "other", "card"):
                method = "other"
            t = ParsedTransaction(
                row_number=i, raw=row, source_amount_text=row.get("amount", ""), direction=direction,
                gross_cents=cents, currency=(cur or options.get("base_currency", "USD")),
                source_record_id=(row.get("entry_id") or "").strip() or None, payment_method=method,
                source_status="completed", source_status_raw="recorded manually",
                counterparty_raw=clean_field(row.get("payer_name", "")),
                memo=" · ".join(x for x in (row.get("service", ""), row.get("memo", ""),
                                             f"receipt {row['receipt_ref']}" if row.get("receipt_ref") else "") if x),
                txn_type=ttype, classification_reason="Recorded manually by the owner",
                account_label="Cash on hand" if method == "cash" else method,
            )
            for id_type, key, fn in (("phone", "payer_phone", detect_contact),
                                     ("email", "payer_email", detect_contact)):
                if row.get(key):
                    c = fn(row[key])
                    if c:
                        t.counterparty_handle_type, t.counterparty_handle = c
                        break
            if not t.counterparty_handle and row.get("payer_instagram"):
                ig = normalize_instagram(row["payer_instagram"])
                if ig:
                    t.counterparty_handle_type, t.counterparty_handle = "instagram", ig
            _date(i, row.get("date", ""), t)
            result.transactions.append(t)
        return result


def mapped_importer_for(source_type: str) -> MappedImporter:
    labels = {"bank": "Bank statement CSV (mapped)", "zelle": "Zelle export (mapped)",
              "other": "Other CSV/JSON (mapped)", "receipts": "Receipts (mapped)"}
    return MappedImporter(name=f"mapped_{source_type}", source_type=source_type,
                          label=labels.get(source_type, "Mapped import"))


IMPORTERS: dict[str, Callable[[], object]] = {
    "cashapp_csv": CashAppImporter,
    "venmo_csv": VenmoImporter,
    "manual_cash_csv": ManualCashImporter,
    "mapped_bank": lambda: mapped_importer_for("bank"),
    "mapped_zelle": lambda: mapped_importer_for("zelle"),
    "mapped_other": lambda: mapped_importer_for("other"),
    "mapped_receipts": lambda: mapped_importer_for("receipts"),
}


def get_importer(name: str):
    try:
        return IMPORTERS[name]()
    except KeyError as exc:
        raise ValueError(f"unknown importer {name}") from exc


def suggest_mapping(headers: list[str]) -> dict[str, str]:
    """Best-effort initial mapping for the preview step (user confirms it)."""
    guesses = {
        "date": ("date", "posting date", "transaction date", "datetime", "posted date", "trans date"),
        "amount": ("amount", "amount (total)", "net amount", "value"),
        "debit": ("debit", "withdrawals", "money out", "debit amount"),
        "credit": ("credit", "deposits", "money in", "credit amount"),
        "description": ("description", "memo", "details", "narrative", "note", "notes"),
        "counterparty": ("name", "payee", "counterparty", "sender", "recipient", "from/to"),
        "counterparty_handle": ("email/phone", "email", "phone", "handle"),
        "id": ("id", "transaction id", "reference", "confirmation", "confirmation number", "check or slip #"),
        "status": ("status",),
        "fee": ("fee", "fees"),
        "currency": ("currency",),
        "type": ("type", "transaction type"),
        "direction": ("direction",),
    }
    found = resolve_columns(headers, guesses)
    return {k: v for k, v in found.items() if v}
