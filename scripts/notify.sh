#!/usr/bin/env bash
# One-shot phone notification via ntfy.sh. No state.
# Usage: ./notify.sh "title" "message"
# Requires bash, curl, and python3. Reads topic from ../config.json (outboundTopic).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOPIC="$(python3 - "$ROOT/config.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as handle:
    value = json.load(handle).get("outboundTopic", "")
if not value or value.startswith("REPLACE"):
    raise SystemExit("Fill in config.json first.")
print(value)
PY
)"
if [[ "$TOPIC" == REPLACE* ]]; then echo "Fill in config.json first." >&2; exit 1; fi
TITLE="${1:-hello}"; MSG="${2:-it works}"
curl -sS --fail-with-body --max-time 20 \
  --data-urlencode "topic=$TOPIC" \
  --data-urlencode "title=$TITLE" \
  --data-urlencode "message=$MSG" \
  https://ntfy.sh > /dev/null
echo "OK: notification accepted '$TITLE'"
