"""Reading CSV/JSON payloads into a header + rows table, defensively."""
from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, field

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_ROWS = 200_000
csv.field_size_limit(1_000_000)


class FileRejected(ValueError):
    pass


@dataclass
class Table:
    headers: list[str]
    rows: list[dict[str, str]]
    header_row_index: int = 0
    preamble: list[list[str]] = field(default_factory=list)


def decode_bytes(data: bytes) -> str:
    if len(data) > MAX_FILE_BYTES:
        raise FileRejected("file larger than 50 MB; split it before importing")
    if b"\x00" in data[:4096]:
        raise FileRejected("file looks binary, not CSV/JSON text")
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


def _norm_header(h: str) -> str:
    return " ".join(str(h or "").replace("﻿", "").strip().split())


def read_csv_table(data: bytes, header_hints: tuple[str, ...] = ()) -> Table:
    """Parse CSV text. If *header_hints* are given, the header row is the first
    row containing at least two of them (case-insensitive) — this skips the
    preamble lines some exports (e.g. Venmo statements) put above the header."""
    text = decode_bytes(data)
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    raw_rows = list(csv.reader(io.StringIO(text), dialect))
    if len(raw_rows) > MAX_ROWS:
        raise FileRejected(f"more than {MAX_ROWS} rows")
    header_idx = None
    hints = {h.lower() for h in header_hints}
    for i, row in enumerate(raw_rows[:50]):
        cells = {_norm_header(c).lower() for c in row if c and c.strip()}
        if hints:
            if len(cells & hints) >= min(2, len(hints)):
                header_idx = i
                break
        elif len(cells) >= 2:
            header_idx = i
            break
    if header_idx is None and hints:
        header_idx = next((i for i, row in enumerate(raw_rows[:50])
                           if len({c for c in row if c and c.strip()}) >= 2), None)
    if header_idx is None:
        raise FileRejected("could not find a header row")
    raw_headers = [_norm_header(h) for h in raw_rows[header_idx]]
    headers = []
    for i, h in enumerate(raw_headers):
        name = h or f"column_{i + 1}"
        while name in headers:
            name += "_dup"
        headers.append(name)
    rows = []
    for row in raw_rows[header_idx + 1:]:
        if not any(c.strip() for c in row):
            continue
        padded = list(row) + [""] * (len(headers) - len(row))
        rec = {headers[i]: (padded[i] or "").strip() for i in range(len(headers))}
        if len(row) > len(headers):
            rec["__extra__"] = ",".join(row[len(headers):])
        rows.append(rec)
    return Table(headers=headers, rows=rows, header_row_index=header_idx, preamble=raw_rows[:header_idx])


def read_json_table(data: bytes, records_path: str = "") -> Table:
    """Load a JSON array of flat objects (optionally nested under a dotted path)."""
    text = decode_bytes(data)
    try:
        obj = json.loads(text)
    except json.JSONDecodeError as exc:
        raise FileRejected(f"invalid JSON: {exc.msg}") from exc
    for part in [p for p in records_path.split(".") if p]:
        if not isinstance(obj, dict) or part not in obj:
            raise FileRejected(f"JSON path '{records_path}' not found")
        obj = obj[part]
    if not isinstance(obj, list):
        raise FileRejected("JSON must contain a list of records")
    if len(obj) > MAX_ROWS:
        raise FileRejected(f"more than {MAX_ROWS} records")
    headers: list[str] = []
    rows = []
    for rec in obj:
        if not isinstance(rec, dict):
            continue
        flat = {}
        for k, v in rec.items():
            key = _norm_header(k)
            if isinstance(v, (dict, list)):
                v = json.dumps(v, ensure_ascii=False)
            flat[key] = "" if v is None else str(v).strip()
            if key not in headers:
                headers.append(key)
        rows.append(flat)
    for r in rows:
        for h in headers:
            r.setdefault(h, "")
    return Table(headers=headers, rows=rows)


def resolve_columns(headers: list[str], spec: dict[str, tuple[str, ...]]) -> dict[str, str | None]:
    """Map logical field -> actual header using case-insensitive aliases."""
    lower = {h.lower(): h for h in headers}
    out: dict[str, str | None] = {}
    for fld, aliases in spec.items():
        out[fld] = next((lower[a.lower()] for a in aliases if a.lower() in lower), None)
    return out
