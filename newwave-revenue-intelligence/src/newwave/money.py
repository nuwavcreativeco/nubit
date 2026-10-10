"""Decimal-safe money parsing.

Storage convention: integer minor units (cents), always non-negative; the sign
lives in the transaction's ``direction``. Floats are never used for money.
"""
from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

_CURRENCY_SYMBOLS = {"$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY"}
_CLEAN_RE = re.compile(r"\s")
_GROUPED_RE = re.compile(r"\d{1,3}(,\d{3})+(\.\d{1,4})?")


class MoneyParseError(ValueError):
    pass


def parse_amount(text: object) -> tuple[Decimal, str | None]:
    """Parse a source amount string into a signed Decimal.

    Handles ``$1,234.56``, ``-$20.00``, ``+ $50.00``, ``(45.00)`` (accounting
    negative), ``1.234,56`` is NOT supported (ambiguous) and raises.
    Returns (amount, currency_symbol_currency_or_None).
    """
    if text is None:
        raise MoneyParseError("missing amount")
    s = str(text).strip()
    if not s:
        raise MoneyParseError("empty amount")
    currency = None
    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative = True
        s = s[1:-1].strip()
    s = _CLEAN_RE.sub("", s)
    # leading sign may come before or after the currency symbol
    for _ in range(2):
        if s and s[0] in "+-":
            negative = negative or s[0] == "-"
            s = s[1:]
        if s[:1] in _CURRENCY_SYMBOLS:
            currency = _CURRENCY_SYMBOLS[s[0]]
            s = s[1:]
    for code in ("USD", "EUR", "GBP", "CAD"):
        if s.upper().endswith(code):
            currency = code
            s = s[: -len(code)]
    if s.endswith("-"):  # trailing minus used by some banks
        negative = True
        s = s[:-1]
    if "," in s:
        if not _GROUPED_RE.fullmatch(s):
            raise MoneyParseError(f"unrecognised amount format: {text!r}")
        s = s.replace(",", "")
    if not re.fullmatch(r"\d+(\.\d{1,4})?|\.\d{1,4}", s):
        raise MoneyParseError(f"unrecognised amount format: {text!r}")
    try:
        value = Decimal(s)
    except InvalidOperation as exc:  # pragma: no cover - regex guards this
        raise MoneyParseError(str(exc)) from exc
    return (-value if negative else value), currency


def to_cents(amount: Decimal) -> int:
    """Convert a Decimal to integer cents, rounding half-up (banker-safe for 2dp input)."""
    return int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def cents_to_decimal(cents: int | None) -> Decimal:
    return (Decimal(int(cents or 0)) / Decimal(100)).quantize(Decimal("0.01"))


def format_cents(cents: int | None, currency: str = "USD") -> str:
    value = cents_to_decimal(cents)
    sign = "-" if value < 0 else ""
    symbol = "$" if currency == "USD" else f"{currency} "
    return f"{sign}{symbol}{abs(value):,.2f}"
