#!/usr/bin/env bash
#
# One-time provisioning for a fresh Hetzner CX22 (Ubuntu 24.04).
# Run as root on the VPS:  bash provision.sh
#
# Idempotent — safe to re-run. It installs Docker, hardens SSH + firewall,
# adds swap, clones the repo, and installs the systemd unit. It deliberately
# does NOT start the stack: apps/api/.env must be filled in first (33 vars).

set -euo pipefail

REPO_URL="${REPO_URL:-git@github.com:darshil320/TOPAZ-CRM.git}"
APP_DIR="/opt/topaz"
DEPLOY_USER="${DEPLOY_USER:-topaz}"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "run as root"

log "Updating base system"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq ca-certificates curl git ufw fail2ban unattended-upgrades

# A Chromium PDF render spikes ~1GB above steady state. Swap converts a hard
# OOM-kill (lost task, 500 to the customer) into a slow render.
#
# Sized against real RAM: on a 2GB CPX12 the spike is a much larger fraction of
# the box, so it needs 4GB of swap; on 4GB+ two is enough. SWAP_GB overrides.
mem_gb=$(( $(awk '/^MemTotal:/{print $2}' /proc/meminfo) / 1024 / 1024 ))
if (( mem_gb <= 2 )); then SWAP_GB="${SWAP_GB:-4}"; else SWAP_GB="${SWAP_GB:-2}"; fi

log "Configuring ${SWAP_GB}GB swap (detected ${mem_gb}GB RAM)"
if [[ ! -f /swapfile ]]; then
  fallocate -l "${SWAP_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Prefer reclaiming page cache over swapping app memory; 10 keeps latency sane.
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
else
  echo "swapfile already present, skipping"
fi

log "Installing Docker Engine + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  echo "docker already installed, skipping"
fi

log "Creating deploy user '$DEPLOY_USER'"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"

log "Configuring firewall (allow 22/80/443 only)"
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp   >/dev/null   # SSH
ufw allow 80/tcp   >/dev/null   # HTTP -> Caddy ACME challenge + redirect
ufw allow 443/tcp  >/dev/null   # HTTPS -> Caddy
ufw --force enable >/dev/null
ufw status verbose

log "Hardening SSH (key-only auth)"
# Only disables password auth if an authorized_keys already exists — otherwise
# this would lock you out of the box permanently.
if [[ -s /root/.ssh/authorized_keys ]]; then
  sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
  systemctl reload ssh
else
  echo "WARNING: no /root/.ssh/authorized_keys found — leaving password auth ON."
  echo "         Add your key, then re-run this script to harden SSH."
fi

systemctl enable --now fail2ban

log "Enabling automatic security updates"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

log "Fetching application to $APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" pull --ff-only || echo "pull skipped (check deploy key)"
else
  git clone "$REPO_URL" "$APP_DIR" \
    || fail "clone failed — add this box's SSH key as a GitHub deploy key first (ssh-keygen -t ed25519, then cat ~/.ssh/id_ed25519.pub)"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

log "Installing systemd unit"
install -m 0644 "$APP_DIR/infra/hetzner/topaz.service" /etc/systemd/system/topaz.service
systemctl daemon-reload
systemctl enable topaz.service   # enable = start on boot; NOT started now.

cat <<'NEXT'

============================================================
Provisioning complete. The stack is NOT running yet.

Remaining steps (in order):

  1. Fill the app environment (33 vars):
       cp /opt/topaz/apps/api/.env.example /opt/topaz/apps/api/.env
       nano /opt/topaz/apps/api/.env
     REDIS_URL must be:  redis://redis:6379/0
     (service name, not localhost — Redis is not host-published.)

  2. Set the public domain for TLS:
       echo 'API_DOMAIN=api.yourdomain.com' > /opt/topaz/infra/hetzner/.env
     Point that domain's A record at this VPS BEFORE step 3, or Caddy's
     certificate request will fail.

  3. Build and start (first build pulls Chromium, ~5-10 min):
       systemctl start topaz

  4. Verify:
       docker compose -f /opt/topaz/infra/hetzner/docker-compose.prod.yml ps
       curl https://api.yourdomain.com/api/health

  5. Repoint the Meta WhatsApp webhook and the Vercel dashboard's
     TOPAZ_API_URL at the new domain.
============================================================

NEXT
