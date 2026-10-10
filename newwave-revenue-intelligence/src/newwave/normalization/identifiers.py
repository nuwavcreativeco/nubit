"""Identifier normalisation.

Normalised values are used for exact matching only. Names are normalised for
*candidate generation*; a name match is never conclusive on its own.
"""
from __future__ import annotations

import re
import unicodedata

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
_HANDLE_RE = re.compile(r"^[a-z0-9._-]{1,40}$")


def normalize_phone(value: str | None, default_country: str = "1") -> str | None:
    """Return E.164-like '+<digits>' or None. Assumes NANP for 10-digit numbers."""
    if not value:
        return None
    s = str(value).strip()
    if "@" in s:
        return None
    digits = re.sub(r"\D", "", s)
    if s.startswith("+"):
        return "+" + digits if 8 <= len(digits) <= 15 else None
    if len(digits) == 10:
        return f"+{default_country}{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return None


def normalize_email(value: str | None) -> str | None:
    if not value:
        return None
    s = str(value).strip().lower()
    if s.startswith("mailto:"):
        s = s[7:]
    return s if _EMAIL_RE.match(s) else None


def _strip_handle(value: str, prefixes: tuple[str, ...], url_hosts: tuple[str, ...]) -> str | None:
    s = str(value).strip().lower()
    for host in url_hosts:
        m = re.search(re.escape(host) + r"/+([^/?#\s]+)", s)
        if m:
            s = m.group(1)
            break
    while s[:1] in prefixes:
        s = s[1:]
    s = s.strip().rstrip("/")
    return s if _HANDLE_RE.match(s) else None


def normalize_instagram(value: str | None) -> str | None:
    if not value:
        return None
    return _strip_handle(value, ("@",), ("instagram.com",))


def normalize_cashtag(value: str | None) -> str | None:
    if not value:
        return None
    return _strip_handle(value, ("$",), ("cash.app", "cash.me"))


def normalize_venmo(value: str | None) -> str | None:
    if not value:
        return None
    return _strip_handle(value, ("@",), ("venmo.com",))


def normalize_name(value: str | None) -> str:
    """Casefold, strip accents/punctuation, collapse whitespace."""
    if not value:
        return ""
    s = unicodedata.normalize("NFKD", str(value))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^\w\s]", " ", s.casefold())
    s = re.sub(r"_", " ", s)
    return re.sub(r"\s+", " ", s).strip()


NORMALIZERS = {
    "phone": normalize_phone,
    "email": normalize_email,
    "instagram": normalize_instagram,
    "cashapp": normalize_cashtag,
    "venmo": normalize_venmo,
    "zelle": lambda v: normalize_email(v) or normalize_phone(v),
    "name": lambda v: normalize_name(v) or None,
    "bank_name": lambda v: normalize_name(v) or None,
    "other": lambda v: (str(v).strip().lower() or None) if v else None,
}


def normalize_identifier(identifier_type: str, value: str | None) -> str | None:
    try:
        fn = NORMALIZERS[identifier_type]
    except KeyError as exc:
        raise ValueError(f"unknown identifier type {identifier_type}") from exc
    return fn(value)


def detect_contact(value: str | None) -> tuple[str, str] | None:
    """Guess whether a free-form value is an email or phone; returns (type, normalized)."""
    if not value:
        return None
    email = normalize_email(value)
    if email:
        return "email", email
    phone = normalize_phone(value)
    if phone:
        return "phone", phone
    return None
