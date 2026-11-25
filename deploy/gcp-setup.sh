#!/usr/bin/env bash
# Hyzoom: one-time setup on a fresh Debian 12 VM (e.g. Google Cloud e2-micro).
# Usage, on the VM:   sudo bash gcp-setup.sh your.domain.com
# Point the domain's A record at the VM's external IP first, so HTTPS can be issued.
# Re-running is safe: it updates the code and restarts the game.
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/Dheeraj-Thota/RacingGame.git}"
BRANCH="${BRANCH:-main}"
APP=/opt/hyzoom
DATA=/var/lib/hyzoom

if [[ $EUID -ne 0 ]]; then echo "Run with sudo."; exit 1; fi
if [[ -z "$DOMAIN" ]]; then echo "Usage: sudo bash gcp-setup.sh your.domain.com"; exit 1; fi

echo "== Packages"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

echo "== Node.js 22"
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "== Caddy (HTTPS reverse proxy)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "== Automatic security updates"
apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== Small swap file (the e2-micro has 1 GB RAM)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== App user, code and data folder"
id hyzoom >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin hyzoom
mkdir -p "$DATA"; chown hyzoom:hyzoom "$DATA"; chmod 700 "$DATA"
if [[ -d "$APP/.git" ]]; then git -C "$APP" fetch --depth 1 origin "$BRANCH" && git -C "$APP" reset --hard "origin/$BRANCH"
else git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP"; fi
chown -R hyzoom:hyzoom "$APP"
sudo -u hyzoom bash -c "cd $APP && npm test"

echo "== Service (restarts on crash and on reboot)"
cat > /etc/systemd/system/hyzoom.service <<EOF
[Unit]
Description=Hyzoom daily racer
After=network.target

[Service]
User=hyzoom
WorkingDirectory=$APP
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=DB_PATH=$DATA/hyzoom.sqlite
Environment=COOKIE_SECURE=1
Environment=TRUST_PROXY=1
Environment=NODE_NO_WARNINGS=1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
SystemCallArchitectures=native
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable hyzoom
systemctl restart hyzoom

echo "== HTTPS for $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  request_body {
    max_size 1MB
  }
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "== Nightly database backup (keeps 14 days)"
cat > /etc/cron.daily/hyzoom-backup <<EOF
#!/bin/sh
mkdir -p $DATA/backups
out=$DATA/backups/hyzoom-\$(date +%F).sqlite
rm -f "\$out"
[ -f $DATA/hyzoom.sqlite ] && NODE_NO_WARNINGS=1 node -e "new (require('node:sqlite').DatabaseSync)(process.argv[1]).exec(\\"VACUUM INTO '\$out'\\")" $DATA/hyzoom.sqlite
find $DATA/backups -name 'hyzoom-*.sqlite' -mtime +14 -delete
chown -R hyzoom:hyzoom $DATA/backups
EOF
chmod 755 /etc/cron.daily/hyzoom-backup

sleep 2
systemctl --no-pager --lines=5 status hyzoom || true
echo
echo "Done. Open https://$DOMAIN  (first HTTPS certificate can take a minute)."
echo "Update later with:  sudo bash $APP/deploy/gcp-setup.sh $DOMAIN"
