#!/usr/bin/env bash
# Installs the Market77 totem agent on Ubuntu. Run as root, from the extracted release folder:
#   curl -fsSL -H "Authorization: Bearer <token>" https://servidor/api/agent/releases/<versao> -o agent.tgz
#   mkdir agent && tar -xzf agent.tgz -C agent && cd agent && sudo ./install.sh https://servidor <token>
set -euo pipefail

SERVER="${1:-}"
TOKEN="${2:-}"
[ -n "$SERVER" ] && [ -n "$TOKEN" ] || { echo "usage: install.sh <server-url> <token>" >&2; exit 1; }
SERVER="${SERVER%/}"
[[ "$SERVER" =~ ^https://[A-Za-z0-9._:/-]+$ ]] || { echo "the server url must be https://..." >&2; exit 1; }
[[ "$TOKEN" =~ ^[A-Za-z0-9_-]{20,100}$ ]] || { echo "malformed token" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE=/opt/market77
[ -f "$SRC/main.ts" ] && [ -f "$SRC/VERSION" ] || { echo "run it from the extracted release folder" >&2; exit 1; }
VERSION="$(tr -d '[:space:]' < "$SRC/VERSION")"
[[ "$VERSION" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ ]] || { echo "bad VERSION" >&2; exit 1; }

# Node 22.18+ runs .ts files directly: the agent has no build step.
if ! command -v node >/dev/null 2>&1 \
  || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y chromium-browser
node "$SRC/main.ts" --check >/dev/null
NODE_BIN="$(command -v node)"

id kiosk >/dev/null 2>&1 || useradd -m -s /bin/bash kiosk
KIOSK_UID="$(id -u kiosk)"

mkdir -p "$BASE/releases"
rm -rf "$BASE/releases/$VERSION"
cp -r "$SRC" "$BASE/releases/$VERSION"
# A stale marker from an earlier update would make the watchdog roll the fresh install back.
rm -f "$BASE/pending-update"
ln -sfn "releases/$VERSION" "$BASE/current"
TMP="$(umask 077; mktemp)"
printf '{"serverUrl":"%s","token":"%s"}\n' "$SERVER" "$TOKEN" > "$TMP"
install -m 600 -o kiosk -g kiosk "$TMP" "$BASE/config.json"
rm -f "$TMP"
chown -R kiosk:kiosk "$BASE"

# The watchdog runs as root and lives outside the releases the agent can replace.
install -m 755 -o root -g root "$SRC/watchdog.sh" /usr/local/sbin/market77-watchdog

# The kiosk user may reboot the machine, and nothing else.
SUDOERS_TMP="$(umask 077; mktemp)"
echo 'kiosk ALL=(root) NOPASSWD: /usr/bin/systemctl reboot' > "$SUDOERS_TMP"
visudo -cf "$SUDOERS_TMP" >/dev/null || { rm -f "$SUDOERS_TMP"; echo "invalid sudoers rule" >&2; exit 1; }
install -m 440 -o root -g root "$SUDOERS_TMP" /etc/sudoers.d/market77
rm -f "$SUDOERS_TMP"

# Ubuntu defaults to Wayland; the kiosk needs an X11 autologin session.
if [ -f /etc/gdm3/custom.conf ]; then
  grep -q '^\[daemon\]' /etc/gdm3/custom.conf || printf '\n[daemon]\n' >> /etc/gdm3/custom.conf
  sed -i '/^AutomaticLoginEnable=/d;/^AutomaticLogin=/d;/^WaylandEnable=/d' /etc/gdm3/custom.conf
  sed -i '/^\[daemon\]/a AutomaticLoginEnable=true\nAutomaticLogin=kiosk\nWaylandEnable=false' /etc/gdm3/custom.conf
else
  echo "warning: /etc/gdm3/custom.conf not found; configure autologin for 'kiosk' on X11 by hand" >&2
fi

cat > /etc/systemd/system/market77-agent.service <<EOF
[Unit]
Description=Market77 totem agent
After=network-online.target graphical.target
Wants=network-online.target

[Service]
User=kiosk
Environment=DISPLAY=:0
Environment=XAUTHORITY=/run/user/$KIOSK_UID/gdm/Xauthority
ExecStart=$NODE_BIN /opt/market77/current/main.ts
Restart=always
RestartSec=5

[Install]
WantedBy=graphical.target
EOF

cat > /etc/systemd/system/market77-watchdog.service <<'EOF'
[Unit]
Description=Market77 agent update watchdog

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/market77-watchdog
EOF

cat > /etc/systemd/system/market77-watchdog.timer <<'EOF'
[Unit]
Description=Market77 agent update watchdog

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable market77-agent
systemctl enable --now market77-watchdog.timer
echo "Agente $VERSION instalado. Reinicie o mini PC para entrar no modo kiosk."
