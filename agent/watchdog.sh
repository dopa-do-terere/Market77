#!/usr/bin/env bash
# Rolls back a failed agent update. Run every minute by market77-watchdog.timer, as root.
# agent/update.ts writes "<previous-version> <deadline-epoch>" to $BASE/pending-update before it switches the
# "current" symlink, and the new agent deletes that file after its first successful heartbeat. If the file is
# still there after the deadline, the new version never came up: go back to the previous one.
set -euo pipefail

BASE="${M77_BASE:-/opt/market77}"
SYSTEMCTL="${M77_SYSTEMCTL:-systemctl}"
MARKER="$BASE/pending-update"

[ -f "$MARKER" ] || exit 0
read -r from deadline < "$MARKER" || true
[[ "${deadline:-}" =~ ^[0-9]+$ ]] || { rm -f "$MARKER"; exit 0; }
[ "$(date +%s)" -ge "$deadline" ] || exit 0

[[ "${from:-}" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ ]] || { rm -f "$MARKER"; exit 0; }
[ -d "$BASE/releases/$from" ] || { rm -f "$MARKER"; exit 0; }
ln -sfn "releases/$from" "$BASE/current"
"$SYSTEMCTL" restart market77-agent
# Marker goes last so a power loss mid-rollback just repeats it on the next run.
rm -f "$MARKER"
