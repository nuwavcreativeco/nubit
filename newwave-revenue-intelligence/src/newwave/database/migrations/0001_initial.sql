-- New Wave Revenue Intelligence — initial schema.
--
-- Money convention: every *_cents column is a NON-NEGATIVE integer number of
-- minor units (cents) in the row's `currency`. The sign of a transaction comes
-- from `direction` ('in' = money received by the business, 'out' = money
-- leaving). Analytics derive signed amounts; storage never does.
--
-- Original evidence is immutable: the raw source row and source amount text of
-- a transaction cannot be changed after import (see triggers below). Analyst
-- corrections change classification columns only, and every change is written
-- to audit_log with before/after values so it can be reverted.

CREATE TABLE app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE import_jobs (
    id                  TEXT PRIMARY KEY,
    source_type         TEXT NOT NULL,
    importer            TEXT NOT NULL,
    original_filename   TEXT NOT NULL,
    stored_path         TEXT,
    file_sha256         TEXT NOT NULL,
    file_size_bytes     INTEGER NOT NULL DEFAULT 0,
    mapping_json        TEXT,
    status              TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','completed','completed_with_warnings','failed','duplicate_file')),
    record_count        INTEGER NOT NULL DEFAULT 0,
    success_count       INTEGER NOT NULL DEFAULT 0,
    skipped_count       INTEGER NOT NULL DEFAULT 0,
    duplicate_count     INTEGER NOT NULL DEFAULT 0,
    failed_count        INTEGER NOT NULL DEFAULT 0,
    warnings_json       TEXT NOT NULL DEFAULT '[]',
    is_demo             INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
    started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at         TEXT
);
CREATE INDEX idx_import_jobs_sha ON import_jobs(file_sha256);

CREATE TABLE service_catalog (
    id              TEXT PRIMARY KEY,
    code            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    aliases_json    TEXT NOT NULL DEFAULT '[]',
    keywords_json   TEXT NOT NULL DEFAULT '[]',
    active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
    sort_order      INTEGER NOT NULL DEFAULT 100,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE clients (
    id              TEXT PRIMARY KEY,
    display_name    TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','archived')),
    merged_into_id  TEXT REFERENCES clients(id),
    notes           TEXT NOT NULL DEFAULT '',
    is_demo         INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    CHECK ((status = 'merged') = (merged_into_id IS NOT NULL))
);

CREATE TABLE client_identifiers (
    id                  TEXT PRIMARY KEY,
    client_id           TEXT NOT NULL REFERENCES clients(id),
    identifier_type     TEXT NOT NULL
                        CHECK (identifier_type IN ('phone','email','instagram','cashapp','venmo','zelle','name','bank_name','other')),
    raw_value           TEXT NOT NULL,
    normalized_value    TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'unverified'
                        CHECK (verification_status IN ('verified','unverified','rejected')),
    source_evidence_id  TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (client_id, identifier_type, normalized_value)
);
CREATE INDEX idx_client_identifiers_lookup ON client_identifiers(identifier_type, normalized_value);
-- A verified, non-name identifier can belong to only one client at a time.
CREATE UNIQUE INDEX uq_verified_identifier
    ON client_identifiers(identifier_type, normalized_value)
    WHERE verification_status = 'verified' AND identifier_type NOT IN ('name','bank_name');

-- The owner's own accounts/handles. Money moving between these is a transfer,
-- never revenue or expense.
CREATE TABLE owner_accounts (
    id                  TEXT PRIMARY KEY,
    label               TEXT NOT NULL,
    identifier_type     TEXT NOT NULL,
    normalized_value    TEXT NOT NULL,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (identifier_type, normalized_value)
);

CREATE TABLE projects (
    id                  TEXT PRIMARY KEY,
    client_id           TEXT NOT NULL REFERENCES clients(id),
    title               TEXT NOT NULL,
    service_id          TEXT REFERENCES service_catalog(id),
    stage               TEXT NOT NULL DEFAULT 'discussed'
                        CHECK (stage IN ('discussed','quoted','booked','in_progress','delivered','cancelled')),
    quoted_amount_cents INTEGER CHECK (quoted_amount_cents IS NULL OR quoted_amount_cents >= 0),
    project_value_cents INTEGER CHECK (project_value_cents IS NULL OR project_value_cents >= 0),
    currency            TEXT NOT NULL DEFAULT 'USD',
    discussed_at        TEXT,
    quoted_at           TEXT,
    booked_at           TEXT,
    delivered_at        TEXT,
    notes               TEXT NOT NULL DEFAULT '',
    verification_status TEXT NOT NULL DEFAULT 'unverified'
                        CHECK (verification_status IN ('verified','unverified')),
    is_demo             INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_projects_client ON projects(client_id);

CREATE TABLE transactions (
    id                      TEXT PRIMARY KEY,
    import_job_id           TEXT REFERENCES import_jobs(id),
    source_type             TEXT NOT NULL,
    source_record_id        TEXT,
    source_row_number       INTEGER,
    dedupe_key              TEXT NOT NULL UNIQUE,
    has_stable_source_id    INTEGER NOT NULL DEFAULT 0 CHECK (has_stable_source_id IN (0,1)),
    payment_method          TEXT NOT NULL DEFAULT 'other'
                            CHECK (payment_method IN ('cashapp','venmo','zelle','bank','cash','card','check','other')),
    account_label           TEXT NOT NULL DEFAULT '',
    transaction_date        TEXT,           -- ISO date YYYY-MM-DD; NULL when invalid/missing
    transaction_datetime    TEXT,           -- ISO datetime when the source has one
    direction               TEXT NOT NULL CHECK (direction IN ('in','out')),
    txn_type                TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (txn_type IN ('payment_received','refund','reversal','processing_fee',
                                                'expense','owner_transfer','personal','unknown')),
    classification_source   TEXT NOT NULL DEFAULT 'importer_rule'
                            CHECK (classification_source IN ('importer_rule','user','reconciliation','ai_approved')),
    classification_reason   TEXT NOT NULL DEFAULT '',
    source_amount_text      TEXT NOT NULL,  -- exactly as it appeared in the source
    currency                TEXT NOT NULL DEFAULT 'USD',
    gross_amount_cents      INTEGER NOT NULL CHECK (gross_amount_cents >= 0),
    fee_amount_cents        INTEGER NOT NULL DEFAULT 0 CHECK (fee_amount_cents >= 0),
    refund_amount_cents     INTEGER NOT NULL DEFAULT 0 CHECK (refund_amount_cents >= 0),
    net_amount_cents        INTEGER NOT NULL CHECK (net_amount_cents >= 0),
    source_status           TEXT NOT NULL DEFAULT 'unknown'
                            CHECK (source_status IN ('completed','pending','failed','cancelled','refunded','unknown')),
    source_status_raw       TEXT NOT NULL DEFAULT '',
    counterparty_raw        TEXT NOT NULL DEFAULT '',
    counterparty_name_norm  TEXT NOT NULL DEFAULT '',
    counterparty_handle     TEXT NOT NULL DEFAULT '',  -- normalized handle/phone/email when present
    counterparty_handle_type TEXT NOT NULL DEFAULT '',
    memo                    TEXT NOT NULL DEFAULT '',
    raw_json                TEXT NOT NULL,  -- original source row; immutable
    client_id               TEXT REFERENCES clients(id),
    service_id              TEXT REFERENCES service_catalog(id),
    verification_status     TEXT NOT NULL DEFAULT 'unverified'
                            CHECK (verification_status IN ('verified','unverified','needs_review','excluded')),
    duplicate_of_id         TEXT REFERENCES transactions(id),
    transfer_pair_id        TEXT REFERENCES transactions(id),
    is_demo                 INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    -- Inflows: net = gross - fee - inline refund. Outflows: net = principal sent
    -- (gross); any fee charged on an outflow is held in fee_amount_cents.
    CHECK ((direction = 'in'  AND net_amount_cents = gross_amount_cents - fee_amount_cents - refund_amount_cents)
        OR (direction = 'out' AND net_amount_cents = gross_amount_cents)),
    CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id)
);
CREATE INDEX idx_txn_date ON transactions(transaction_date);
CREATE INDEX idx_txn_client ON transactions(client_id);
CREATE INDEX idx_txn_type ON transactions(txn_type, verification_status);
CREATE INDEX idx_txn_handle ON transactions(counterparty_handle_type, counterparty_handle);
CREATE INDEX idx_txn_amount_date ON transactions(gross_amount_cents, transaction_date);

CREATE TRIGGER trg_transactions_immutable_source
BEFORE UPDATE OF raw_json, source_amount_text, import_job_id, source_record_id, dedupe_key,
                 source_type, gross_amount_cents, fee_amount_cents, refund_amount_cents,
                 net_amount_cents, direction, transaction_date, currency
ON transactions
WHEN OLD.raw_json IS NOT NEW.raw_json
  OR OLD.source_amount_text IS NOT NEW.source_amount_text
  OR OLD.import_job_id IS NOT NEW.import_job_id
  OR OLD.source_record_id IS NOT NEW.source_record_id
  OR OLD.dedupe_key IS NOT NEW.dedupe_key
  OR OLD.source_type IS NOT NEW.source_type
  OR OLD.gross_amount_cents IS NOT NEW.gross_amount_cents
  OR OLD.fee_amount_cents IS NOT NEW.fee_amount_cents
  OR OLD.refund_amount_cents IS NOT NEW.refund_amount_cents
  OR OLD.net_amount_cents IS NOT NEW.net_amount_cents
  OR OLD.direction IS NOT NEW.direction
  OR OLD.transaction_date IS NOT NEW.transaction_date
  OR OLD.currency IS NOT NEW.currency
BEGIN
    SELECT RAISE(ABORT, 'imported source fields are immutable');
END;

CREATE TRIGGER trg_transactions_no_delete
BEFORE DELETE ON transactions
BEGIN
    SELECT RAISE(ABORT, 'transactions cannot be deleted; mark them excluded instead');
END;

CREATE TABLE transaction_allocations (
    id              TEXT PRIMARY KEY,
    transaction_id  TEXT NOT NULL REFERENCES transactions(id),
    project_id      TEXT NOT NULL REFERENCES projects(id),
    amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
    allocation_type TEXT NOT NULL DEFAULT 'full_payment'
                    CHECK (allocation_type IN ('deposit','installment','final_payment','full_payment','refund','other')),
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reversed')),
    notes           TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_alloc_txn ON transaction_allocations(transaction_id);
CREATE INDEX idx_alloc_project ON transaction_allocations(project_id);

-- Allocations may never exceed the transaction's net amount.
CREATE TRIGGER trg_alloc_not_over_net_insert
BEFORE INSERT ON transaction_allocations
WHEN NEW.status = 'active' AND (
    COALESCE((SELECT SUM(amount_cents) FROM transaction_allocations
              WHERE transaction_id = NEW.transaction_id AND status = 'active'), 0) + NEW.amount_cents
    > (SELECT net_amount_cents FROM transactions WHERE id = NEW.transaction_id))
BEGIN
    SELECT RAISE(ABORT, 'allocations exceed transaction net amount');
END;

CREATE TRIGGER trg_alloc_not_over_net_update
BEFORE UPDATE OF status, amount_cents ON transaction_allocations
WHEN NEW.status = 'active' AND (
    COALESCE((SELECT SUM(amount_cents) FROM transaction_allocations
              WHERE transaction_id = NEW.transaction_id AND status = 'active' AND id <> NEW.id), 0) + NEW.amount_cents
    > (SELECT net_amount_cents FROM transactions WHERE id = NEW.transaction_id))
BEGIN
    SELECT RAISE(ABORT, 'allocations exceed transaction net amount');
END;

CREATE TABLE conversations (
    id                  TEXT PRIMARY KEY,
    import_job_id       TEXT REFERENCES import_jobs(id),
    source_type         TEXT NOT NULL CHECK (source_type IN ('instagram','imessage','sms','manual')),
    source_thread_id    TEXT NOT NULL,
    title               TEXT NOT NULL DEFAULT '',
    participants_json   TEXT NOT NULL DEFAULT '[]',   -- normalized handles/names (not message content)
    client_id           TEXT REFERENCES clients(id),
    first_message_at    TEXT,
    last_message_at     TEXT,
    message_count       INTEGER NOT NULL DEFAULT 0,
    is_demo             INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (source_type, source_thread_id)
);
CREATE INDEX idx_conversations_client ON conversations(client_id);

CREATE TABLE conversation_messages (
    id                  TEXT PRIMARY KEY,
    conversation_id     TEXT NOT NULL REFERENCES conversations(id),
    import_job_id       TEXT REFERENCES import_jobs(id),
    dedupe_key          TEXT NOT NULL UNIQUE,
    source_message_id   TEXT,
    sent_at             TEXT,
    sender_role         TEXT NOT NULL DEFAULT 'unknown' CHECK (sender_role IN ('owner','counterparty','unknown')),
    sender_label        TEXT NOT NULL DEFAULT '',
    body_text           TEXT NOT NULL DEFAULT '',     -- sanitized plain text
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_messages_conv_time ON conversation_messages(conversation_id, sent_at);

-- Service mentions detected in messages. A mention is evidence of discussion,
-- never proof of a sale.
CREATE TABLE service_signals (
    id                      TEXT PRIMARY KEY,
    conversation_message_id TEXT NOT NULL REFERENCES conversation_messages(id),
    service_id              TEXT NOT NULL REFERENCES service_catalog(id),
    signal_type             TEXT NOT NULL
                            CHECK (signal_type IN ('discussed','quoted','booked','payment_mentioned','delivered','refund_mentioned')),
    amount_cents            INTEGER CHECK (amount_cents IS NULL OR amount_cents >= 0),
    detected_by             TEXT NOT NULL DEFAULT 'keyword' CHECK (detected_by IN ('keyword','ai','user')),
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (conversation_message_id, service_id, signal_type)
);

CREATE TABLE evidence (
    id                      TEXT PRIMARY KEY,
    evidence_type           TEXT NOT NULL
                            CHECK (evidence_type IN ('transaction_row','message_excerpt','manual_note','receipt','reconciliation')),
    import_job_id           TEXT REFERENCES import_jobs(id),
    source_filename         TEXT NOT NULL DEFAULT '',
    source_record_id        TEXT NOT NULL DEFAULT '',
    transaction_id          TEXT REFERENCES transactions(id),
    conversation_message_id TEXT REFERENCES conversation_messages(id),
    occurred_at             TEXT,
    excerpt                 TEXT NOT NULL DEFAULT '',  -- short, sanitized
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_evidence_txn ON evidence(transaction_id);
CREATE INDEX idx_evidence_msg ON evidence(conversation_message_id);

CREATE TABLE ai_requests (
    id                  TEXT PRIMARY KEY,
    task                TEXT NOT NULL,
    provider            TEXT NOT NULL,
    model               TEXT NOT NULL,
    data_categories_json TEXT NOT NULL DEFAULT '[]',
    item_count          INTEGER NOT NULL DEFAULT 0,
    payload_sha256      TEXT NOT NULL,     -- hash only; the payload itself is never stored
    redaction_counts_json TEXT NOT NULL DEFAULT '{}',
    status              TEXT NOT NULL CHECK (status IN ('sent','succeeded','invalid_response','refused','error','blocked')),
    suggestion_count    INTEGER NOT NULL DEFAULT 0,
    error_summary       TEXT NOT NULL DEFAULT '',
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE match_candidates (
    id                      TEXT PRIMARY KEY,
    candidate_key           TEXT NOT NULL UNIQUE,  -- makes candidate generation idempotent
    candidate_type          TEXT NOT NULL
                            CHECK (candidate_type IN ('txn_client','txn_project','duplicate_txn','owner_transfer',
                                                      'txn_classification','client_merge','service_classification')),
    transaction_id          TEXT REFERENCES transactions(id),
    related_transaction_id  TEXT REFERENCES transactions(id),
    proposed_client_id      TEXT REFERENCES clients(id),
    related_client_id       TEXT REFERENCES clients(id),
    proposed_project_id     TEXT REFERENCES projects(id),
    proposed_value          TEXT,           -- e.g. txn_type or service code
    proposed_amount_cents   INTEGER,
    method                  TEXT NOT NULL,
    confidence_score        REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    confidence_band         TEXT NOT NULL CHECK (confidence_band IN ('high','medium','low')),
    explanation             TEXT NOT NULL,
    created_by              TEXT NOT NULL CHECK (created_by IN ('deterministic','ai','user')),
    ai_request_id           TEXT REFERENCES ai_requests(id),
    review_status           TEXT NOT NULL DEFAULT 'pending'
                            CHECK (review_status IN ('pending','approved','rejected','deferred','reverted','superseded')),
    reviewed_at             TEXT,
    reviewer_note           TEXT NOT NULL DEFAULT '',
    created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_candidates_status ON match_candidates(review_status, candidate_type);
CREATE INDEX idx_candidates_txn ON match_candidates(transaction_id);

CREATE TABLE match_candidate_evidence (
    match_candidate_id  TEXT NOT NULL REFERENCES match_candidates(id),
    evidence_id         TEXT NOT NULL REFERENCES evidence(id),
    PRIMARY KEY (match_candidate_id, evidence_id)
);

CREATE TABLE client_merges (
    id                  TEXT PRIMARY KEY,
    source_client_id    TEXT NOT NULL REFERENCES clients(id),
    target_client_id    TEXT NOT NULL REFERENCES clients(id),
    moved_json          TEXT NOT NULL,      -- ids of rows re-pointed, for exact undo
    status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','undone')),
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    undone_at           TEXT,
    CHECK (source_client_id <> target_client_id)
);

CREATE TABLE reconciliation_runs (
    id              TEXT PRIMARY KEY,
    started_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    finished_at     TEXT,
    status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
    stats_json      TEXT NOT NULL DEFAULT '{}'
);

-- Months for which the owner has confirmed that expense records are complete.
-- Profit is only reported for ranges fully covered here.
CREATE TABLE expense_coverage (
    month           TEXT PRIMARY KEY CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
    confirmed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    note            TEXT NOT NULL DEFAULT ''
);

CREATE TABLE audit_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    actor               TEXT NOT NULL,
    action              TEXT NOT NULL,
    entity_type         TEXT NOT NULL,
    entity_id           TEXT NOT NULL,
    before_json         TEXT,
    after_json          TEXT,
    reason              TEXT NOT NULL DEFAULT '',
    group_id            TEXT,               -- ties together the rows of one user action
    reverts_group_id    TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_group ON audit_log(group_id);

CREATE TRIGGER trg_audit_append_only_update
BEFORE UPDATE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;

CREATE TRIGGER trg_audit_append_only_delete
BEFORE DELETE ON audit_log
BEGIN
    SELECT RAISE(ABORT, 'audit_log is append-only');
END;
