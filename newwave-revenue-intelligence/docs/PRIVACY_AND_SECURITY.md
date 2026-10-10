# Privacy & security model

## Data boundaries

| Data | Where it lives | Leaves the Mac? |
|---|---|---|
| Source files (exports, statements) | where you saved them, plus a read-only copy in `<workspace>/data/incoming` | No |
| Database (transactions, customers, message text) | `<workspace>/database/newwave.sqlite3` | No |
| Exports / reports | `<workspace>/exports`, `<workspace>/reports` | Only if you share them |
| AI requests | built in memory, redacted and pseudonymised | **Only** when AI is enabled, consented, and you press *Send* on a previewed request |
| API key | environment / `.env` (git-ignored, `600`) | Sent to Anthropic only as the API credential |

## Controls implemented

- **Network:** Streamlit binds to `127.0.0.1`, CORS/XSRF protection stays on, usage statistics are off. No
  remote access, telemetry, payment API or social-media write access.
- **Workspaces:** created explicitly, typed (`production` / `demo` / `test`) via a marker file, and refused
  inside an unignored git repository. Tests always use temporary workspaces.
- **Permissions:** `umask 077`; directories `700`; database, backups and exports `600`; stored originals `400`.
- **Immutability:** DB triggers block changes to imported source fields and deletion of transactions. The
  audit log is append-only (also trigger-enforced).
- **Traceability:** every write records actor, before/after values and reason, grouped per action so it can be
  undone as a unit.
- **Input handling:** parameterised SQL everywhere; table/column names in dynamic SQL come from code-side
  whitelists; file-size, row-count and zip-member limits; zip entries are read in memory and traversal
  entries are refused; path validation for every file the app writes; uploaded filenames reduced to safe
  basenames; control and bidirectional-override characters stripped; imported text rendered as plain text.
- **Exports:** formula-injection neutralisation; verified-only by default; unverified rows clearly labelled;
  no conversation content; memos opt-in; never overwrite.
- **Prompt injection:** message text is data. It is never executed, and nothing in the app acts on it. In AI
  requests, records are labelled as untrusted data, output is schema-validated, unknown references are
  rejected, and results are suggestions only.
- **AI logging:** only task, model, data categories, counts, redaction counts and a SHA-256 of the payload.

## Your responsibilities

- Turn on **FileVault**. This app does not encrypt files itself.
- Keep the workspace out of cloud-sync folders unless you have decided that is acceptable.
- Store backups on an encrypted drive.
- Grant Full Disk Access only while you import Messages, and remove it afterwards if you prefer.
- Do not commit `.env`, workspaces or exports. The `.gitignore` covers them, but check before pushing.

## Messages access

The Apple Messages reader copies `chat.db` (and its `-wal`/`-shm` files) into a private temporary folder
inside the workspace, opens the copy with a read-only SQLite URI, reads only the chats you selected (within
your date range and message limit), and deletes the copy. It never writes to the live database and never
reads attachments or other apps' data. If macOS denies access, it reports that and stops.
