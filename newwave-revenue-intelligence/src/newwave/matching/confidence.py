"""Explainable confidence bands.

Scores are *rule-based evidence-strength scores*, not statistical
probabilities. Each matching rule has a fixed base score chosen so that the
band reflects the kind of evidence involved:

  high   (>= 0.85)  exact stable identifier already verified for the client
  medium (0.60-0.85) exact but unverified identifier, or amount+date+conversation
                     evidence combined with another signal
  low    (< 0.60)  name-only or circumstantial evidence; never sufficient alone

No band is ever auto-approved. Tests in tests/test_matching.py pin these
rules so changes are deliberate.
"""
from __future__ import annotations

HIGH = 0.85
MEDIUM = 0.60

RULE_SCORES = {
    "verified_identifier": 0.95,
    "prior_verified_link": 0.90,
    "unverified_identifier": 0.70,
    "conversation_amount_date": 0.55,
    "name_and_conversation": 0.70,
    "prior_link_same_name": 0.50,
    "name_only": 0.40,
}
NAME_ONLY_CEILING = 0.59     # name evidence alone can never leave the low band
AMBIGUOUS_CEILING = 0.59     # competing candidates force review in the low band


def band(score: float) -> str:
    if score >= HIGH:
        return "high"
    if score >= MEDIUM:
        return "medium"
    return "low"
