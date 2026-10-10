"""Redaction and pseudonymisation applied before ANY external model call.

* Real IDs are replaced with per-request pseudonyms (TXN_1, CLIENT_1, MSG_1…);
  the mapping lives only in memory for the duration of the request.
* Phone numbers, emails, URLs, payment handles ($cashtags, @handles), street
  addresses, long digit runs (account/card numbers) and known personal names
  are replaced with typed placeholders.
* Dollar amounts are kept — they are needed to link payments to quotes.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("url", re.compile(r"\b(?:https?://|www\.)\S+", re.I)),
    ("phone", re.compile(r"(?<![\w$])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)")),
    ("account_number", re.compile(r"(?<![\d$.,])\d{8,}(?!\d)(?![.,]\d)")),
    ("payment_handle", re.compile(r"(?<![\w])\$[A-Za-z][A-Za-z0-9_-]{1,30}")),
    ("social_handle", re.compile(r"(?<![\w@])@[A-Za-z0-9_.]{2,30}")),
    ("street_address", re.compile(
        r"\b\d{1,6}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|"
        r"Way|Pl|Place|Pkwy|Parkway|Ter|Terrace)\b\.?(?:\s*(?:Apt|Unit|#)\s*\w+)?", re.I)),
]


@dataclass
class Redactor:
    known_names: list[str] = field(default_factory=list)
    counts: Counter = field(default_factory=Counter)

    def __post_init__(self) -> None:
        names = sorted({n.strip() for n in self.known_names if n and len(n.strip()) >= 2}, key=len, reverse=True)
        parts = set()
        for n in names:
            parts.add(n)
            # also redact individual name tokens of multi-word names (e.g. a first name used alone)
            for tok in n.split():
                if len(tok) >= 3 and tok[0].isupper():
                    parts.add(tok)
        self._name_re = (re.compile(r"(?<!\w)(" + "|".join(re.escape(p) for p in sorted(parts, key=len, reverse=True))
                                    + r")(?!\w)", re.I) if parts else None)

    def redact(self, text: str | None) -> str:
        if not text:
            return ""
        out = text
        for label, pat in _PATTERNS:
            out, n = pat.subn(f"[{label.upper()}]", out)
            self.counts[label] += n
        if self._name_re:
            out, n = self._name_re.subn("[NAME]", out)
            self.counts["name"] += n
        return out


class Pseudonymizer:
    def __init__(self) -> None:
        self._fwd: dict[tuple[str, str], str] = {}
        self._rev: dict[str, str] = {}
        self._n: Counter = Counter()

    def ref(self, kind: str, real_id: str) -> str:
        key = (kind, real_id)
        if key not in self._fwd:
            self._n[kind] += 1
            alias = f"{kind}_{self._n[kind]}"
            self._fwd[key] = alias
            self._rev[alias] = real_id
        return self._fwd[key]

    def resolve(self, alias: str) -> str | None:
        return self._rev.get(alias)

    def aliases(self, kind: str) -> set[str]:
        return {a for (k, _), a in self._fwd.items() if k == kind}
