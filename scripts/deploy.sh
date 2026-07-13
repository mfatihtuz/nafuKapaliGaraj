#!/usr/bin/env bash
# ============================================================================
# DEPO — Hostinger'a dağıtım (build + FTP yükleme).
#
# KULLANIM (kendi makinenden — FTP erişimi olan yerden):
#   export FTP_HOST=145.14.156.26
#   export FTP_USER='u398313596.nafuhome.mftyazilim.com'
#   export FTP_PASS='********'          # parolayı burada TUT, script'e YAZMA
#   bash scripts/deploy.sh
#
# Gerekli: node/npm, lftp  (Ubuntu: sudo apt install lftp)
#
# Sunucu yerleşimi (public_html'e kilitli FTP):
#   public_html/depo_yonetimi/           ← index.php, .htaccess, index.html, assets/, ikonlar
#   public_html/depo_yonetimi/private/   ← src/, config.php (web erişimine kapalı)
#
# NOT: config.php'yi bu script YÜKLEMEZ (gizli). İlk kurulumda sunucuda bir kez
#      private/config.example.php → private/config.php kopyalayıp doldur.
# ============================================================================
set -euo pipefail

REMOTE_DIR="${REMOTE_DIR:-public_html/depo_yonetimi}"
: "${FTP_HOST:?FTP_HOST tanımlı değil}"
: "${FTP_USER:?FTP_USER tanımlı değil}"
: "${FTP_PASS:?FTP_PASS tanımlı değil}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "▸ Frontend build (web/)…"
( cd "$ROOT/web" && npm ci && npm run build )

echo "▸ Yükleme paketi hazırlanıyor: $STAGE"
# 1) Frontend build çıktısı → kök
cp -R "$ROOT/web/dist/." "$STAGE/"
# 2) PHP front controller + .htaccess → kök
cp "$ROOT/api/public/index.php" "$STAGE/index.php"
cp "$ROOT/api/public/.htaccess" "$STAGE/.htaccess"
# 3) PHP kaynağı → private/src (web erişimine kapalı)
mkdir -p "$STAGE/private/src"
cp -R "$ROOT/api/src/." "$STAGE/private/src/"
cp "$ROOT/api/config.example.php" "$STAGE/private/config.example.php"
# 4) private/ için deny-all .htaccess
cat > "$STAGE/private/.htaccess" <<'HT'
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Order deny,allow
    Deny from all
</IfModule>
HT

echo "▸ FTP yükleme → $FTP_HOST:$REMOTE_DIR"
# --delete YOK: sunucudaki config.php ve storage/ korunur.
lftp -u "$FTP_USER","$FTP_PASS" "ftp://$FTP_HOST" <<LFTP
set ftp:ssl-allow true
set ssl:verify-certificate no
set net:max-retries 3
set net:timeout 20
mirror -R --verbose --exclude-glob config.php "$STAGE" "$REMOTE_DIR"
bye
LFTP

echo "✓ Yükleme tamam."
echo "  Doğrula:  curl -s https://nafuhome.mftyazilim.com/depo_yonetimi/api/health"
echo "  Beklenen: {\"ok\":true,\"db\":true,...}"
