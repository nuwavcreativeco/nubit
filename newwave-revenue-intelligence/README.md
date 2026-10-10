# New Wave Music — Historical Revenue Intelligence

A **local-first** system that rebuilds New Wave Music's payment history from Cash App, Venmo, Zelle, bank
statements and cash records. It links payments to customers and projects using evidence from Instagram and
Messages conversations, reconciles everything, and serves a dashboard **on your Mac only**
(`http://127.0.0.1:8501`).

- No cloud database, no server, no public website, no telemetry.
- Works fully **without AI**. Claude assistance is optional, off by default, redacted, previewed, and never
  approves anything by itself.
- Original files and imported rows are never modified. Every correction is audit-logged and can be undone.
- Headline revenue counts **verified** records only. Unverified amounts are always shown separately.

> This is an evidence-backed ledger for professional review. It is **not** tax software and does not replace
> a bookkeeper or accountant.

---

## 1. Install (macOS)

Requirements: macOS with **Python 3.11+** (`python3 --version`; if older: `brew install python@3.12`).

```bash
cd newwave-revenue-intelligence
./scripts/setup_mac.sh            # creates .venv and installs pinned dependencies
```

### Create your private workspace (one time)

Real data lives in a **separate workspace folder outside the code**, by default `~/NewWaveRevenueData`:

```bash
.venv/bin/python scripts/nwri.py init
```

- The folder is created with owner-only permissions (`700`; files `600`).
- The tool **refuses** to create a real-data workspace inside a git repository unless that folder is git-ignored.
- To use a different location, set `NWRI_WORKSPACE` in `.env` (see `.env.example`).

### Launch the dashboard

```bash
./scripts/run_dashboard.sh
```

Then open <http://127.0.0.1:8501>. The server binds to `127.0.0.1` only and Streamlit usage statistics are
disabled (`.streamlit/config.toml`). Stop it with `Ctrl+C`.

### Try the synthetic demo first (optional)

```bash
NWRI_WORKSPACE=./demo_workspace .venv/bin/python scripts/nwri.py demo
NWRI_WORKSPACE=./demo_workspace ./scripts/run_dashboard.sh
```

The demo workspace is marked `demo` and shows a **DEMO** banner. Every name and number in it is fictional.
It never mixes with your real workspace.

---

## 2. Recommended first run with real data

1. **Settings → Owner accounts.** Add your own Cash App `$cashtag`, Venmo handle, phone, email and the name
   that appears on your exports. Money between your own accounts is then treated as an owner transfer.
2. **Imports → Payments.** Import one recent month from each source. Check the preview, then import.
3. **Customers.** Create your main customers and add the identifiers you are *sure* of (phone, `$cashtag`,
   `@instagram`). Mark an identifier **verified** only when you have confirmed it.
4. **Reconciliation → Run reconciliation checks.** Work through the queues: approve, reject or defer.
5. **Imports → Instagram / Apple Messages.** Import a **small sample** of conversations (a few threads). Check
   the results before importing more. Nothing imports the full archive automatically.
6. Repeat, widening the date range. Re-importing a file, or an overlapping export, never double-counts.

---

## 3. Importing data

| Source | How to get it | Importer |
|---|---|---|
| **Cash App** | Cash App → Activity → Statements → *Export CSV* (web: cash.app/account → Statements) | `Cash App statement CSV` |
| **Venmo** | venmo.com → Statements → choose period → *Download CSV* | `Venmo statement CSV` |
| **Zelle** | Zelle has no universal export. Zelle payments appear in your **bank statement** (description `Zelle payment from …`). Some banks offer a Zelle activity CSV. | `Bank statement CSV` or `Zelle activity export` |
| **Bank CSV** | Your bank's website → account activity → download CSV | Built-in profiles (Chase, Bank of America, generic debit/credit) or a custom mapping |
| **Cash** | Record in the dashboard (**Imports → Record cash**) or fill in the CSV template | Manual template |
| **Anything else** | CSV or JSON | `Other CSV / JSON` with the mapping step |

**Mapping & preview:** for unfamiliar layouts, map each field (date, amount *or* debit/credit, description,
counterparty, ID, status, fee …), choose the sign convention and date order (month-first vs day-first), and
review the preview before anything is saved. Save the mapping as a profile for next time.

**What each import records:** source type, original filename, SHA-256 hash, timestamps, record count,
inserted / duplicate / skipped / failed rows, validation warnings and status (**Imports → History**).
A read-only copy of each uploaded file is kept in `<workspace>/data/incoming/`. Originals are never moved,
renamed, modified or deleted.

**Duplicates:**
- Re-importing the same file is detected by its hash, and nothing is added.
- Overlapping exports are de-duplicated by the source's transaction ID.
- Rows without a source ID use a conservative content key. An identical row already imported is skipped
  *and flagged* in the import warnings so you can review a genuine repeat payment.
- The same payment seen in two sources (for example the Zelle export and the bank statement) becomes a
  **duplicate candidate** for you to confirm. It is never removed automatically.

**Command line equivalents** (useful for big files):

```bash
.venv/bin/python scripts/nwri.py import cashapp_csv ~/Downloads/cash_app_report.csv
.venv/bin/python scripts/nwri.py import venmo_csv ~/Downloads/venmo_statement.csv
.venv/bin/python scripts/nwri.py import mapped_bank ~/Downloads/chase.csv --profile chase_checking
.venv/bin/python scripts/nwri.py reconcile
```

### Instagram messages

Request your data from Instagram (Settings → Accounts Center → *Your information and permissions* →
*Download your information*). Choose **JSON** format and include **Messages**. When the zip arrives:

- Dashboard: **Imports → Instagram**. Upload the zip, pick a few threads and import them.
- Terminal (large zips): `nwri.py instagram-list export.zip`, then
  `nwri.py instagram-import export.zip --thread inbox/name_123`.

Only message text is read. Media is ignored and the zip is never extracted to disk. Instagram's
mis-encoded characters are repaired. The thread folder's username is stored only as an *unverified*
handle. No scraping or unofficial API is used.

### Apple Messages (iMessage / SMS)

Messages are read from a **temporary read-only copy** of `~/Library/Messages/chat.db`. The live database is
never opened for writing.

1. Give the app running the dashboard (usually **Terminal**) **Full Disk Access**: System Settings → Privacy &
   Security → Full Disk Access → add Terminal, then restart Terminal. The tool never tries to bypass this.
2. **Imports → Apple Messages → Check access.** The report shows whether the database is readable, how many
   chats and messages are stored **on this Mac**, and the date range.
3. Select a few chats, an optional date range and a message limit (default 500), then import.

Terminal: `nwri.py messages-inspect`, `nwri.py messages-list-chats`,
`nwri.py messages-extract --chat 12 --since 2023-01-01 --limit 300`.

**Fallback:** if access is unavailable (no Full Disk Access, Messages not set up, or not on a Mac), copy
the relevant conversations into the conversation CSV template (**Imports → Manual conversations**).

---

## 4. Matching, review and corrections

The deterministic engine proposes matches in order of evidence strength:

1. Exact identifier already **verified** for a customer, or a payment handle a reviewer approved before → **high**
2. Exact identifier that is **not yet verified** → **medium**
3. A conversation with the customer quoting the **same amount** within 30 days before the payment → medium/low
4. **Name only** → always **low** (names are not unique, so a name is never conclusive)

When several customers have similar evidence, all of them are capped to *low* and marked ambiguous.
Confidence scores are fixed **rule scores**, not statistical probabilities (see `docs/METRICS.md`).

**Nothing is applied automatically.** Every proposal waits in the Reconciliation center, where you can
**approve**, **reject** or **defer** it, and later **undo** it from *History & undo*. Undo restores every
record the decision changed. Merging customers requires inspecting both profiles and confirming, and every
merge can be undone.

Other queues cover: unmatched payments, cross-source duplicates, owner-transfer pairs (for example a Cash App
cash-out arriving in the bank), likely refunds to previous payers, unknown transactions, unexplained bank
deposits, verified payments without a service, possible duplicate customers, AI suggestions, and data-quality
issues (missing dates, other currencies).

---

## 5. Optional AI assistance (Claude)

Off by default. To enable:

1. Put `ANTHROPIC_API_KEY=...` in `.env` (git-ignored, `chmod 600`). Never put keys in code.
2. **Settings → AI assistance:** read the notice, tick consent, then click *Enable*.
3. Choose a task. The **exact redacted payload** and the data categories are shown. Nothing is sent until
   you click *Send*.

What is sent: payment date, amount and method, plus short redacted message excerpts from conversations
already linked to that customer (±30 days), or project titles and values for **one** customer. Phone
numbers, emails, addresses, payment handles, @handles, account numbers, URLs and known names are replaced
with placeholders, and IDs with temporary aliases (`TXN_1`, `MSG_2`). Raw files, full histories, full
statements, credentials and the database are never sent.

Model output is validated against a strict schema. References the model invents are rejected. Valid
results become **pending suggestions** with medium confidence at most. The AI cannot change financial
records or approve anything. Only metadata and a hash of each request are stored. Imported text is
labelled as data for the model, and the app never acts on instructions found inside messages.

**Turn AI off instantly:** *Settings → Turn AI off now*, or set `NWRI_AI_DISABLED=1` (this overrides
everything). The default model is `claude-opus-5-5` (`NWRI_AI_MODEL` to change). Anthropic's server-side
refusal fallback is enabled by default (`NWRI_AI_NO_FALLBACK=1` to disable).

---

## 6. Privacy & security

- Dashboard bound to `127.0.0.1`; no remote access, no telemetry, no automatic uploads.
- Workspace folder `700`, database and copies `600`, uploaded originals `400` (read-only).
- **Local storage is not encrypted by this app.** Turn on **FileVault** (System Settings → Privacy &
  Security → FileVault) and keep backups on an encrypted drive. A local folder is not private by itself:
  check that it is not inside iCloud Drive, Dropbox or similar sync folders unless you intend that.
- Git ignores `.env`, databases, workspaces, exports, backups and zips. Real records must never be committed.
- All SQL is parameterised. Imported text is sanitised (control and bidirectional characters removed,
  length capped) and displayed as plain text. Exports neutralise spreadsheet formulas.
- Bulk edits, merges, restores and undo require explicit confirmation.

More detail: `docs/PRIVACY_AND_SECURITY.md`.

---

## 7. Backups and recovery

```bash
.venv/bin/python scripts/nwri.py backup                 # consistent snapshot → <workspace>/backups/
.venv/bin/python scripts/nwri.py restore <file> --yes   # stop the dashboard first
```

- Backups use SQLite's online backup API, so they are safe while the app runs. Each is integrity-checked.
- A restore verifies the backup first and saves the current database as a safety backup before replacing it.
- Copy `<workspace>/backups/` (or the whole workspace) to an **encrypted** external drive regularly. Time
  Machine with encryption enabled also works.
- Your original source files remain the ultimate evidence. The database can always be rebuilt by
  re-importing them, though review decisions would need to be redone, so back up the database too.

---

## 8. Reports & exports

**Exports** produces a filtered ledger CSV (verified rows only by default). Including unverified rows adds a
`verification_label` column and `UNVERIFIED-INCLUDED` in the file name. Payment memos are opt-in, and
conversation content is never exported. The page also produces a Markdown summary report that lists
exactly what each figure includes and excludes. Files are saved to `<workspace>/exports` and `/reports`
and never overwrite earlier files.

Metric definitions are in **`docs/METRICS.md`**.

---

## 9. Development

```bash
.venv/bin/python -m pytest          # 122 tests, synthetic fixtures only, isolated temp workspaces
```

CI: `.github/workflows/newwave-revenue-intelligence.yml` (repo root) runs the suite on Python 3.11 and 3.13
for pull requests and pushes to `main` that touch this folder. AI calls are disabled in CI.

Layout:

```
app.py                      Streamlit entry (navigation only)
config/service_catalog.json editable services, aliases, keywords
scripts/                    nwri.py CLI, setup_mac.sh, run_dashboard.sh
src/newwave/
  database/                 connection, migrations/*.sql, append-only audit log
  ingestion/                tabular reader, pipeline (dedupe/idempotency), payments, messages/
  normalization/            identifiers, dates
  matching/                 deterministic engine, confidence rules
  reconciliation/           integrity checks, review workflow, queues, runner
  analytics/                metrics, exports
  ai/                       redaction, strict schemas, opt-in adapter
  security/                 path validation, permissions, sanitisation
  records.py                customers, identifiers, projects, allocations, merges, corrections
  ui/                       dashboard pages (no business logic)
tests/                      unit, integration, dashboard and end-to-end tests
docs/                       metrics, privacy & security, architecture
```

Business logic has no Streamlit dependency. The CLI and tests use it directly, and the SQLite schema can be
read by any tool.

---

## 10. Known limitations

- **Not verified against your real exports yet.** Importers follow the published Cash App and Venmo CSV
  layouts and common bank formats, and are tested on synthetic files. Column names change over time: if an
  import fails or looks wrong, use the mapping step and save a profile.
- **Apple Messages** reading was tested against a synthetic `chat.db` with the same schema, not on your Mac.
  Text stored only in `attributedBody` (newer macOS) is decoded best-effort. Messages that live only in
  iCloud and are not downloaded to the Mac are invisible. Attachments are not read.
- **Instagram** exports must be in JSON format. HTML exports are not supported yet.
- **Zelle** has no standard export. It is covered through bank statements or a bank-specific Zelle CSV.
- **Currencies:** amounts in a currency other than USD are flagged and excluded from totals. No conversion is
  assumed.
- **Revenue recognition** is not inferred. The app reports cash collected, keeps project value separately,
  and leaves accounting treatment to your bookkeeper.
- **Profit** is shown only for months you confirm as having complete expense records.
- **AI adapter:** request building, redaction, validation and the review flow are tested with a fake model.
  A live call to the Claude API has not been made from this environment, so test one small request after
  adding your key.
- The Streamlit upload limit is 200 MB. Use the CLI for larger files.
