#!/usr/bin/env python3
"""New Wave Revenue Intelligence — command line.

Examples:
  python scripts/nwri.py init                              # create ~/NewWaveRevenueData
  python scripts/nwri.py import cashapp_csv ~/Downloads/cash_app_report.csv
  python scripts/nwri.py import mapped_bank statement.csv --profile chase_checking
  python scripts/nwri.py reconcile
  python scripts/nwri.py messages-inspect
  python scripts/nwri.py messages-list-chats
  python scripts/nwri.py messages-extract --chat 12 --chat 40 --since 2023-01-01 --limit 300
  python scripts/nwri.py instagram-list ~/Downloads/instagram-export.zip
  python scripts/nwri.py instagram-import ~/Downloads/instagram-export.zip --thread inbox/someone_123
  python scripts/nwri.py backup
  python scripts/nwri.py restore <backup-file> --yes
  python scripts/nwri.py demo --workspace ./demo_workspace
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from newwave import backup as backup_mod  # noqa: E402
from newwave.config import load_settings  # noqa: E402
from newwave.database.connection import open_database  # noqa: E402
from newwave.ingestion.base import run_transaction_import, sha256_bytes  # noqa: E402
from newwave.ingestion.messages import imessage  # noqa: E402
from newwave.ingestion.messages.base import run_message_import  # noqa: E402
from newwave.ingestion.messages.instagram import InstagramExport  # noqa: E402
from newwave.ingestion.messages.manual import parse_manual_conversations  # noqa: E402
from newwave.ingestion.payments import BUILTIN_PROFILES, IMPORTERS, get_importer  # noqa: E402
from newwave.reconciliation.runner import run_reconciliation  # noqa: E402
from newwave.workspace import WorkspaceError, init_workspace, require_workspace  # noqa: E402


def _open(args):
    settings = load_settings(args.workspace)
    require_workspace(settings.workspace)
    return settings, open_database(settings.database_path)


def cmd_init(args):
    root = init_workspace(load_settings(args.workspace).workspace, kind=args.kind,
                          allow_inside_git=args.allow_inside_git)
    print(f"Initialised {args.kind} workspace at {root}")


def cmd_import(args):
    settings, conn = _open(args)
    path = Path(args.file).expanduser()
    data = path.read_bytes()
    options = {"base_currency": settings.base_currency}
    if args.profile:
        options.update(BUILTIN_PROFILES[args.profile]["options"])
    if args.options:
        options.update(json.loads(Path(args.options).read_text()))
    s = run_transaction_import(conn, get_importer(args.importer), data, path.name, options=options,
                               incoming_dir=settings.incoming_dir)
    print(json.dumps({"job": s.job_id, "status": s.status, "records": s.record_count, "inserted": s.inserted,
                      "duplicates": s.duplicates, "skipped": s.skipped, "failed": s.failed,
                      "warnings": s.warnings[:20]}, indent=2))


def cmd_reconcile(args):
    _, conn = _open(args)
    print(json.dumps(run_reconciliation(conn), indent=2))


def cmd_messages_inspect(args):
    settings = load_settings(args.workspace)
    rep = imessage.inspect_access(Path(args.db) if args.db else imessage.DEFAULT_DB, settings.scratch_dir)
    print(json.dumps(rep.__dict__, indent=2))


def cmd_messages_list(args):
    settings, _ = _open(args)
    db = Path(args.db) if args.db else imessage.DEFAULT_DB
    with imessage.snapshot(db, settings.scratch_dir) as mconn:
        for c in imessage.list_chats(mconn, args.max):
            print(f"{c.chat_id:>6}  {c.service:<9} {c.message_count:>6} msgs  last {c.last_message_at or '-':<26} "
                  f"{c.display_name or c.identifier}")


def cmd_messages_extract(args):
    settings, conn = _open(args)
    if not args.chat:
        sys.exit("Select chats with --chat (see messages-list-chats). Full-archive import is never automatic.")
    db = Path(args.db) if args.db else imessage.DEFAULT_DB
    with imessage.snapshot(db, settings.scratch_dir) as mconn:
        threads = imessage.extract_chats(mconn, args.chat, start_iso=args.since, end_iso=args.until, limit=args.limit)
    for stype in ("imessage", "sms"):
        group = [t for t in threads if (t.thread_id.startswith("sms:") == (stype == "sms"))]
        if group:
            s = run_message_import(conn, source_type=stype, importer="apple_messages", threads=group,
                                   filename="Messages chat.db (read-only snapshot)", file_sha256="live-snapshot",
                                   options={"chats": args.chat, "since": args.since, "until": args.until,
                                            "limit": args.limit})
            print(f"{stype}: {s.inserted} new messages, {s.duplicates} already imported, {s.signals} service mentions")


def cmd_instagram_list(args):
    exp = _ig(args.path)
    owner = exp.owner_name(load_settings(args.workspace).owner_display_names)
    print(f"Detected owner: {owner or 'unknown (set NWRI_OWNER_NAMES)'}")
    for t in exp.list_threads():
        print(f"{t.thread_id:<50} {t.message_count:>6} msgs  last {t.last_message_at or '-'}  {t.title}")


def _ig(path):
    p = Path(path).expanduser()
    return InstagramExport.from_zip_bytes(p.read_bytes()) if p.suffix == ".zip" else InstagramExport.from_directory(p)


def cmd_instagram_import(args):
    settings, conn = _open(args)
    if not args.thread:
        sys.exit("Select threads with --thread (see instagram-list). Full-archive import is never automatic.")
    exp = _ig(args.path)
    owner = exp.owner_name(settings.owner_display_names)
    threads = exp.read_threads(args.thread, owner)
    p = Path(args.path).expanduser()
    sha = sha256_bytes(p.read_bytes()) if p.is_file() else "directory"
    s = run_message_import(conn, source_type="instagram", importer="instagram_export", threads=threads,
                           filename=p.name, file_sha256=sha, options={"threads": args.thread})
    print(f"{s.inserted} new messages, {s.duplicates} already imported, {s.signals} service mentions, "
          f"{s.linked_conversations} conversation(s) linked via verified identifiers")


def cmd_conversations_import(args):
    settings, conn = _open(args)
    p = Path(args.file).expanduser()
    data = p.read_bytes()
    threads = parse_manual_conversations(data, "json" if p.suffix == ".json" else "csv", settings.owner_display_names)
    s = run_message_import(conn, source_type="manual", importer="manual_conversations", threads=threads,
                           filename=p.name, file_sha256=sha256_bytes(data))
    print(f"{s.inserted} new messages, {s.duplicates} already imported, {s.signals} service mentions")


def cmd_backup(args):
    settings, conn = _open(args)
    conn.close()
    print(backup_mod.backup(settings))


def cmd_restore(args):
    settings = load_settings(args.workspace)
    if not args.yes:
        sys.exit("Restoring replaces the current database (a safety copy is kept). Re-run with --yes to confirm.")
    print(backup_mod.restore(settings, Path(args.file)))


def cmd_demo(args):
    from newwave.demo import build_demo
    settings = load_settings(args.workspace)
    root = init_workspace(settings.workspace, kind="demo", allow_inside_git=True)
    conn = open_database(settings.database_path)
    print(json.dumps(build_demo(conn, root), indent=2))


def main(argv=None):
    p = argparse.ArgumentParser(description="New Wave Revenue Intelligence")
    p.add_argument("--workspace", help="workspace folder (default: $NWRI_WORKSPACE or ~/NewWaveRevenueData)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("init")
    s.add_argument("--kind", default="production", choices=["production", "demo"])
    s.add_argument("--allow-inside-git", action="store_true")
    s.set_defaults(fn=cmd_init)
    s = sub.add_parser("import")
    s.add_argument("importer", choices=sorted(IMPORTERS))
    s.add_argument("file")
    s.add_argument("--profile", choices=sorted(BUILTIN_PROFILES))
    s.add_argument("--options", help="JSON file with mapping options")
    s.set_defaults(fn=cmd_import)
    sub.add_parser("reconcile").set_defaults(fn=cmd_reconcile)
    s = sub.add_parser("messages-inspect")
    s.add_argument("--db")
    s.set_defaults(fn=cmd_messages_inspect)
    s = sub.add_parser("messages-list-chats")
    s.add_argument("--db")
    s.add_argument("--max", type=int, default=200)
    s.set_defaults(fn=cmd_messages_list)
    s = sub.add_parser("messages-extract")
    s.add_argument("--db")
    s.add_argument("--chat", type=int, action="append")
    s.add_argument("--since")
    s.add_argument("--until")
    s.add_argument("--limit", type=int, default=imessage.DEFAULT_MESSAGE_LIMIT)
    s.set_defaults(fn=cmd_messages_extract)
    s = sub.add_parser("instagram-list")
    s.add_argument("path")
    s.set_defaults(fn=cmd_instagram_list)
    s = sub.add_parser("instagram-import")
    s.add_argument("path")
    s.add_argument("--thread", action="append")
    s.set_defaults(fn=cmd_instagram_import)
    s = sub.add_parser("conversations-import")
    s.add_argument("file")
    s.set_defaults(fn=cmd_conversations_import)
    sub.add_parser("backup").set_defaults(fn=cmd_backup)
    s = sub.add_parser("restore")
    s.add_argument("file")
    s.add_argument("--yes", action="store_true")
    s.set_defaults(fn=cmd_restore)
    sub.add_parser("demo").set_defaults(fn=cmd_demo)
    args = p.parse_args(argv)
    try:
        args.fn(args)
    except WorkspaceError as exc:
        sys.exit(f"Workspace error: {exc}")


if __name__ == "__main__":
    main()
