# Metric definitions

All amounts are stored as **integer cents** (no floating point). Each transaction stores *non-negative*
amounts plus a `direction` (`in` = money received, `out` = money paid). Sign comes only from direction.

| Column | Inflow (`in`) | Outflow (`out`) |
|---|---|---|
| `gross_amount_cents` | amount paid by the customer | principal sent |
| `fee_amount_cents` | processor fee deducted | fee charged on the send |
| `refund_amount_cents` | refund shown inline on the same row (rare) | — |
| `net_amount_cents` | gross − fee − inline refund (DB-enforced) | = gross (DB-enforced) |

`source_amount_text` keeps the amount exactly as it appeared in the file. Source amounts and normalised
reporting amounts are kept separately.

## Which rows are eligible

A row counts toward any figure only if **all** of these hold:

- it is not a confirmed duplicate (`duplicate_of_id` is empty) and not excluded by a reviewer
- its source status is `completed` (pending, failed, cancelled and refunded-at-source are excluded)
- its currency is the reporting currency (USD by default)
- it has a valid date

## Headline (verified only)

| Metric | Definition |
|---|---|
| Gross payments | Σ gross of verified `payment_received` |
| Refunds | Σ gross of verified `refund` |
| Reversals | Σ gross of verified `reversal` |
| **Net collected sales** | gross payments − refunds − reversals |
| Processing fees | fees on verified payments + verified `processing_fee` rows |
| Net after fees | net collected − fees |
| Expenses | Σ gross of verified `expense` |
| Profit | net collected − fees − expenses, **only** if every month in range is confirmed as having complete expense records (Settings → Expense coverage) and no unverified expenses remain in range; otherwise not shown, with the reason |
| Unique verified customers | distinct customers with ≥1 verified payment in range |
| Repeat customers | customers with ≥2 *purchase occasions*. An occasion is one allocated project, or (for payments not allocated to a project) one calendar month with a verified payment. This keeps a deposit + balance for one project from counting as "repeat". |
| Repeat-customer rate | repeat customers ÷ unique verified customers |
| Avg net revenue / customer | Σ(customer payments − customer refunds/reversals) ÷ unique verified customers |

**Verified** means a reviewer approved it: approving a customer match on a completed payment or refund,
approving a classification, recording cash with the attestation box ticked, or setting it directly in the
reconciliation queue.

## Reported separately (never in headline)

- **Unverified candidate payments:** `payment_received` rows not yet verified.
- **Unexplained inflows:** incoming `unknown` rows (for example bank deposits of unknown origin). A positive
  bank deposit is never assumed to be revenue.
- **Owner transfers:** money between your own accounts. Never revenue or expense, and both sides are excluded.
- **Personal transactions.**
- **Reconciliation coverage:** share of eligible incoming money (excluding owner transfers), *by amount*,
  that a person has reviewed (verified, or reclassified by a user or reconciliation decision).

## Services

A payment's service comes from the project it is allocated to (largest allocation if split), otherwise the
service approved on the payment itself, otherwise *Unknown / unclassified*. A service mentioned in a
conversation is recorded as a **signal** (discussed / quoted / booked / payment mentioned / delivered /
refund mentioned) and is never treated as proof of a sale.

## Projects

Project value (agreed price), cash collected (sum of allocations) and recognised sales are distinct.
Allocations let one payment cover several projects, or several payments (deposit, installments, final
payment) cover one project. The database prevents allocating more than a payment's net amount, and approving
an allocation that would exceed a project's remaining balance is refused. Revenue recognition timing is
**not** inferred.

## Confidence bands (matching)

| Band | Score | Evidence |
|---|---|---|
| high | ≥ 0.85 | exact identifier verified for that customer (0.95), or a handle a reviewer previously approved (0.90) |
| medium | 0.60–0.84 | exact but unverified identifier (0.70); name + same-amount conversation (0.70); open-project allocation (0.75–0.80); AI "strong"/"moderate" (0.75/0.62) |
| low | < 0.60 | same-amount conversation alone (0.55); prior link with same name (0.50); **name only (0.40, capped at 0.59)**; ambiguous ties (capped at 0.59) |

These are fixed rule scores that express *kind of evidence*. They are not calibrated probabilities. The
rules are pinned by tests in `tests/test_matching_review.py`. No band is ever auto-approved.
