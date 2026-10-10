"""Runtime configuration.

Everything comes from environment variables (optionally loaded from a local,
git-ignored ``.env`` file). Nothing secret is ever written to source code.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = PROJECT_ROOT / "config"
DEFAULT_WORKSPACE = Path.home() / "NewWaveRevenueData"


def _load_dotenv() -> None:
    env_file = PROJECT_ROOT / ".env"
    if env_file.is_file():
        try:
            from dotenv import load_dotenv

            load_dotenv(env_file, override=False)
        except ImportError:  # pragma: no cover - dependency is pinned
            pass


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    workspace: Path
    base_currency: str = "USD"
    owner_display_names: tuple[str, ...] = ()
    ai_kill_switch: bool = False
    ai_model: str = "claude-opus-5-5"
    ai_refusal_fallback: bool = True
    anthropic_api_key_present: bool = False

    @property
    def database_path(self) -> Path:
        return self.workspace / "database" / "newwave.sqlite3"

    @property
    def incoming_dir(self) -> Path:
        return self.workspace / "data" / "incoming"

    @property
    def exports_dir(self) -> Path:
        return self.workspace / "exports"

    @property
    def reports_dir(self) -> Path:
        return self.workspace / "reports"

    @property
    def logs_dir(self) -> Path:
        return self.workspace / "logs"

    @property
    def backups_dir(self) -> Path:
        return self.workspace / "backups"

    @property
    def scratch_dir(self) -> Path:
        return self.workspace / "scratch"


def load_settings(workspace: str | Path | None = None) -> Settings:
    _load_dotenv()
    ws = Path(workspace or os.environ.get("NWRI_WORKSPACE") or DEFAULT_WORKSPACE).expanduser().resolve()
    owners = tuple(
        n.strip() for n in os.environ.get("NWRI_OWNER_NAMES", "").split(",") if n.strip()
    )
    return Settings(
        workspace=ws,
        base_currency=os.environ.get("NWRI_BASE_CURRENCY", "USD").upper(),
        owner_display_names=owners,
        ai_kill_switch=_truthy(os.environ.get("NWRI_AI_DISABLED")),
        ai_model=os.environ.get("NWRI_AI_MODEL", "claude-opus-5-5"),
        ai_refusal_fallback=not _truthy(os.environ.get("NWRI_AI_NO_FALLBACK")),
        anthropic_api_key_present=bool(os.environ.get("ANTHROPIC_API_KEY")),
    )
