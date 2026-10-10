#!/usr/bin/env bash
# Launch the dashboard on this computer only (127.0.0.1). No telemetry.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -x .venv/bin/python ]; then
  echo "Virtual environment missing. Run ./scripts/setup_mac.sh first." >&2
  exit 1
fi
umask 077
exec .venv/bin/python -m streamlit run app.py \
  --server.address 127.0.0.1 --server.headless true --browser.gatherUsageStats false "$@"
