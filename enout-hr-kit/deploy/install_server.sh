#!/usr/bin/env bash
# Enout HR: one-shot server install (Frappe HR v15 + ERPNext, production mode, Cloudflare Tunnel).
#
# Works on a fresh Ubuntu 22.04 / 24.04 server (x86 or ARM, e.g. Oracle Cloud "Always Free" Ampere VM).
# Run it as the normal login user (e.g. "ubuntu"), NOT as root:
#
#   curl -fsSLO https://raw.githubusercontent.com/<you>/<repo>/<branch>/enout-hr-kit/deploy/install_server.sh
#   bash install_server.sh hr.yourdomain.in <CLOUDFLARE_TUNNEL_TOKEN>
#
# The tunnel token comes from Cloudflare (see GO_LIVE.md step 1). No ports need to be opened:
# Cloudflare Tunnel connects outwards. Takes ~25-40 min (mostly compiling assets).
set -euo pipefail

DOMAIN="${1:?usage: bash install_server.sh <hr.yourdomain.in> [cloudflare-tunnel-token]}"
CF_TOKEN="${2:-}"
BENCH_DIR="$HOME/frappe-bench"
FRAPPE_BRANCH="version-15"
LOG="$HOME/enout_install.log"

say() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "run as your normal user (e.g. ubuntu), not root"
sudo -v || die "this user needs sudo"
. /etc/os-release
[[ "$ID" == "ubuntu" && ( "$VERSION_ID" == "22.04" || "$VERSION_ID" == "24.04" ) ]] || die "needs Ubuntu 22.04 or 24.04 (found $PRETTY_NAME)"
MEM_GB=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo)
[ "$MEM_GB" -ge 3 ] || die "needs at least 4 GB RAM (found ${MEM_GB} GB)"
exec > >(tee -a "$LOG") 2>&1

# passwords: generated once, kept in ~/enout_secrets.txt (chmod 600)
SECRETS="$HOME/enout_secrets.txt"
if [ ! -f "$SECRETS" ]; then
  umask 077
  {
    echo "DB_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
    echo "ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
  } > "$SECRETS"
fi
# shellcheck disable=SC1090
. "$SECRETS"

say "1/8 System packages"
sudo DEBIAN_FRONTEND=noninteractive apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git curl ca-certificates gnupg build-essential pkg-config \
  python3-dev python3-venv python3-pip pipx \
  redis-server mariadb-server mariadb-client libmariadb-dev \
  nginx supervisor cron xvfb libfontconfig1 fontconfig
# PDF payslips; not packaged on every Ubuntu release, so optional
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y wkhtmltopdf || echo "note: wkhtmltopdf not installed (PDF printing only)"

say "2/8 Swap (keeps asset builds from running out of memory)"
if ! swapon --show | grep -q .; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

say "3/8 Node.js 20 + yarn"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
command -v yarn >/dev/null || sudo npm install -g yarn

say "4/8 MariaDB (utf8mb4, root password)"
sudo tee /etc/mysql/mariadb.conf.d/99-frappe.cnf >/dev/null <<'EOF'
[mysqld]
character-set-client-handshake = FALSE
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
innodb_buffer_pool_size = 1G
[mysql]
default-character-set = utf8mb4
EOF
sudo systemctl restart mariadb
if sudo mysql -uroot -e "select 1" >/dev/null 2>&1; then   # fresh install: unix-socket root
  sudo mysql -uroot -e "ALTER USER 'root'@'localhost' IDENTIFIED VIA mysql_native_password USING PASSWORD('${DB_ROOT_PASSWORD}'); FLUSH PRIVILEGES;"
fi
mysql -uroot -p"${DB_ROOT_PASSWORD}" -e "select 1" >/dev/null || die "cannot log in to MariaDB as root"
sudo systemctl enable --now redis-server mariadb

say "5/8 frappe-bench"
pipx install frappe-bench >/dev/null 2>&1 || pipx upgrade frappe-bench
export PATH="$HOME/.local/bin:$PATH"
grep -q 'local/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"

say "6/8 Frappe HR ${FRAPPE_BRANCH} (the long step)"
if [ ! -d "$BENCH_DIR/apps/frappe" ]; then
  bench init --frappe-branch "$FRAPPE_BRANCH" "$BENCH_DIR"
fi
cd "$BENCH_DIR"
[ -d apps/erpnext ] || bench get-app --branch "$FRAPPE_BRANCH" https://github.com/frappe/erpnext
[ -d apps/hrms ] || bench get-app --branch "$FRAPPE_BRANCH" https://github.com/frappe/hrms
if [ ! -d "sites/$DOMAIN" ]; then
  bench new-site "$DOMAIN" --mariadb-root-password "$DB_ROOT_PASSWORD" --admin-password "$ADMIN_PASSWORD" \
    --install-app erpnext --install-app hrms
fi
bench use "$DOMAIN"
bench --site "$DOMAIN" enable-scheduler
bench --site "$DOMAIN" set-config host_name "https://$DOMAIN"
bench --site "$DOMAIN" set-maintenance-mode off

say "7/8 Production mode (nginx + supervisor, auto-start on reboot) + backups"
sudo env PATH="$PATH" bench setup production "$USER" --yes
bench setup backups
sudo systemctl enable nginx supervisor
curl -fsS -o /dev/null -H "Host: $DOMAIN" http://127.0.0.1/api/method/ping || die "site not answering on port 80 (see $LOG)"

say "8/8 Cloudflare Tunnel"
if ! command -v cloudflared >/dev/null; then
  ARCH=$(dpkg --print-architecture)
  curl -fsSL -o /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
  sudo dpkg -i /tmp/cloudflared.deb
fi
if [ -n "$CF_TOKEN" ]; then
  sudo cloudflared service uninstall >/dev/null 2>&1 || true
  sudo cloudflared service install "$CF_TOKEN"
  sudo systemctl enable --now cloudflared
else
  echo "No tunnel token given. Later run: sudo cloudflared service install <TOKEN>"
fi

cat <<EOF

=========================================================================
 Frappe HR is installed.
   Site:            https://$DOMAIN   (once the Cloudflare hostname is set)
   Admin login:     Administrator / ${ADMIN_PASSWORD}
   Passwords file:  $SECRETS   (keep it; it is only readable by you)
   Install log:     $LOG
 Next: GO_LIVE.md step 2 (admin API key) → step 4 (setup) → step 5 (tests).
=========================================================================
EOF
