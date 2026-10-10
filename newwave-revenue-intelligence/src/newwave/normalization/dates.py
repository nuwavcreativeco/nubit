"""Date parsing that never guesses silently.

Ambiguous numeric dates (e.g. 03/04/2023) follow the import's declared
``date_order`` (default month-first, the US convention used by Cash App,
Venmo and US banks). Unparseable dates return None and are flagged.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timezone

_ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}")
_FORMATS_MDY = ["%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%m-%d-%y"]
_FORMATS_DMY = ["%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y"]
_FORMATS_TEXT = ["%b %d, %Y", "%B %d, %Y", "%d %b %Y", "%d %B %Y", "%b %d %Y"]
_TIME_SUFFIX = re.compile(r"[ T]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\s*(AM|PM|am|pm)?(\s*[A-Z]{2,4}|[+-]\d{2}:?\d{2}|Z)?$")


def parse_datetime(value: object, date_order: str = "MDY") -> tuple[str | None, str | None]:
    """Return (iso_date, iso_datetime_or_None)."""
    if value is None:
        return None, None
    s = str(value).strip()
    if not s:
        return None, None
    # ISO 8601 (Venmo uses 2023-01-05T14:03:22)
    if _ISO_RE.match(s):
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return dt.date().isoformat(), (dt.isoformat() if len(s) > 10 else None)
        except ValueError:
            pass
    # Cash App: "2023-01-05 14:03:22 PST" or "01/05/2023 2:03 PM"
    date_part = s
    time_part = None
    m = _TIME_SUFFIX.search(s)
    if m:
        date_part = s[: m.start()].strip().rstrip(",")
        time_part = s[m.start():].strip()
    formats = (_FORMATS_DMY if date_order == "DMY" else _FORMATS_MDY) + _FORMATS_TEXT + ["%Y-%m-%d", "%Y/%m/%d"]
    for fmt in formats:
        try:
            d = datetime.strptime(date_part, fmt).date()
        except ValueError:
            continue
        if not (date(1990, 1, 1) <= d <= date(2100, 1, 1)):
            return None, None
        iso_dt = None
        if time_part:
            iso_dt = f"{d.isoformat()} {time_part}"
        return d.isoformat(), iso_dt
    return None, None


def from_epoch_ms(ms: int | float) -> str:
    return datetime.fromtimestamp(float(ms) / 1000.0, tz=timezone.utc).isoformat()
