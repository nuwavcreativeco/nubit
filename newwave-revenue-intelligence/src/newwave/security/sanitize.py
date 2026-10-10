"""Sanitisation for imported (untrusted) content.

Imported text is evidence, never instructions. We normalise it, strip control
characters, cap its length, and escape it at display/export time.
"""
from __future__ import annotations

import html
import re
import unicodedata

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁦-⁩]")
MAX_TEXT_LEN = 4000
MAX_FIELD_LEN = 500


def clean_text(value: object, max_len: int = MAX_TEXT_LEN) -> str:
    """Return safe plain text: NFC-normalised, no control/bidi chars, length-capped."""
    if value is None:
        return ""
    s = unicodedata.normalize("NFC", str(value))
    s = _CONTROL_RE.sub("", s)
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    if len(s) > max_len:
        s = s[: max_len - 1] + "…"
    return s.strip()


def clean_field(value: object) -> str:
    return clean_text(value, MAX_FIELD_LEN).replace("\n", " ")


def escape_html(value: object) -> str:
    return html.escape(clean_text(value), quote=True)


_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value: object) -> object:
    """Neutralise spreadsheet formula injection in exported cells."""
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        # keep plain signed numbers usable
        if re.fullmatch(r"[+-]?\d+(\.\d+)?", value):
            return value
        return "'" + value
    return value
