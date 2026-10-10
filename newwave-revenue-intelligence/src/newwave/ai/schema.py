"""Strict validation of model output. Anything unexpected is rejected."""
from __future__ import annotations

from typing import Any


class SchemaError(ValueError):
    pass


STRENGTHS = ("strong", "moderate", "weak")
SIGNALS = ("discussed", "quoted", "booked", "payment_mentioned", "delivered", "refund_mentioned")


def service_suggestion_schema(service_codes: list[str]) -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["suggestions"],
        "properties": {"suggestions": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["transaction_ref", "service_code", "signal", "evidence_refs", "rationale", "strength",
                         "quoted_amount"],
            "properties": {
                "transaction_ref": {"type": "string"},
                "service_code": {"type": "string", "enum": service_codes},
                "signal": {"type": "string", "enum": list(SIGNALS)},
                "evidence_refs": {"type": "array", "items": {"type": "string"}},
                "rationale": {"type": "string"},
                "strength": {"type": "string", "enum": list(STRENGTHS)},
                "quoted_amount": {"type": ["number", "null"]},
            }}}},
    }


def project_link_schema() -> dict:
    return {
        "type": "object", "additionalProperties": False, "required": ["suggestions"],
        "properties": {"suggestions": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "required": ["transaction_ref", "project_ref", "evidence_refs", "rationale", "strength"],
            "properties": {
                "transaction_ref": {"type": "string"}, "project_ref": {"type": "string"},
                "evidence_refs": {"type": "array", "items": {"type": "string"}},
                "rationale": {"type": "string"}, "strength": {"type": "string", "enum": list(STRENGTHS)},
            }}}},
    }


def summary_schema(service_codes: list[str]) -> dict:
    return {
        "type": "object", "additionalProperties": False, "required": ["summary", "opportunities"],
        "properties": {
            "summary": {"type": "string"},
            "opportunities": {"type": "array", "items": {
                "type": "object", "additionalProperties": False,
                "required": ["service_code", "rationale", "evidence_refs"],
                "properties": {"service_code": {"type": "string", "enum": service_codes},
                               "rationale": {"type": "string"},
                               "evidence_refs": {"type": "array", "items": {"type": "string"}}}}},
        },
    }


def validate(value: Any, schema: dict, path: str = "$") -> None:
    """Minimal strict JSON-schema validator for the subset used above."""
    t = schema.get("type")
    types = t if isinstance(t, list) else [t]
    ok = False
    for typ in types:
        if typ == "object" and isinstance(value, dict):
            ok = True
        elif typ == "array" and isinstance(value, list):
            ok = True
        elif typ == "string" and isinstance(value, str):
            ok = True
        elif typ == "number" and isinstance(value, (int, float)) and not isinstance(value, bool):
            ok = True
        elif typ == "null" and value is None:
            ok = True
    if not ok:
        raise SchemaError(f"{path}: expected {t}")
    if "enum" in schema and value not in schema["enum"]:
        raise SchemaError(f"{path}: value not allowed")
    if isinstance(value, str) and len(value) > 1000:
        raise SchemaError(f"{path}: string too long")
    if isinstance(value, dict):
        props = schema.get("properties", {})
        missing = [k for k in schema.get("required", []) if k not in value]
        if missing:
            raise SchemaError(f"{path}: missing {missing}")
        if schema.get("additionalProperties") is False:
            extra = set(value) - set(props)
            if extra:
                raise SchemaError(f"{path}: unexpected keys {sorted(extra)}")
        for k, v in value.items():
            validate(v, props[k], f"{path}.{k}")
    if isinstance(value, list):
        if len(value) > 200:
            raise SchemaError(f"{path}: too many items")
        for i, item in enumerate(value):
            validate(item, schema["items"], f"{path}[{i}]")
