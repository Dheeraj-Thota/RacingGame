#!/usr/bin/env bash
# Redline: one-time setup on a fresh Debian 12 VM (e.g. Google Cloud e2-micro).
# Usage, on the VM:   sudo bash gcp-setup.sh your.domain.com
# Point the domain's A record at the VM's external IP first, so HTTPS can be issued.
# Re-running is safe: it updates the code and restarts the game.
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/Dheeraj-Thota/RacingGame.git}"
BRANCH="${BRANCH:-main}"
APP=/opt/redline
DATA=/var/lib/redline

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

echo "== Small swap file (the e2-micro has 1 GB RAM)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "== App user, code and data folder"
id redline >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin redline
mkdir -p "$DATA"; chown redline:redline "$DATA"; chmod 700 "$DATA"
if [[ -d "$APP/.git" ]]; then git -C "$APP" fetch --depth 1 origin "$BRANCH" && git -C "$APP" reset --hard "origin/$BRANCH"
else git clone --depth 1 --branch "$BRANCH" "$REPO" "$APP"; fi
chown -R redline:redline "$APP"
sudo -u redline bash -c "cd $APP && npm test"

echo "== Service (restarts on crash and on reboot)"
cat > /etc/systemd/system/redline.service <<EOF
[Unit]
Description=Redline daily racer
After=network.target

[Service]
User=redline
WorkingDirectory=$APP
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=DB_PATH=$DATA/redline.sqlite
Environment=COOKIE_SECURE=1
Environment=NODE_NO_WARNINGS=1
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=$DATA
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable redline
systemctl restart redline

echo "== HTTPS for $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "== Nightly database backup (keeps 14 days)"
cat > /etc/cron.daily/redline-backup <<EOF
#!/bin/sh
mkdir -p $DATA/backups
out=$DATA/backups/redline-\$(date +%F).sqlite
rm -f "\$out"
[ -f $DATA/redline.sqlite ] && NODE_NO_WARNINGS=1 node -e "new (require('node:sqlite').DatabaseSync)(process.argv[1]).exec(\\"VACUUM INTO '\$out'\\")" $DATA/redline.sqlite
find $DATA/backups -name 'redline-*.sqlite' -mtime +14 -delete
chown -R redline:redline $DATA/backups
EOF
chmod 755 /etc/cron.daily/redline-backup

sleep 2
systemctl --no-pager --lines=5 status redline || true
echo
echo "Done. Open https://$DOMAIN  (first HTTPS certificate can take a minute)."
echo "Update later with:  sudo bash $APP/deploy/gcp-setup.sh $DOMAIN"
