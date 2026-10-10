#!/usr/bin/env bash
# One-time setup on macOS: create the virtual environment and install pinned dependencies.
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3}"
"$PY" -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ required (brew install python@3.12)"'
"$PY" -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
[ -f .env ] || cp .env.example .env
chmod 600 .env
echo
echo "Setup complete. Next:"
echo "  .venv/bin/python scripts/nwri.py init        # creates ~/NewWaveRevenueData (private)"
echo "  ./scripts/run_dashboard.sh                     # opens http://127.0.0.1:8501"
