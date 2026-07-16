#!/usr/bin/env bash
# ============================================================================
# DEPO — Dağıtım ZIP'i üretir (Hostinger'a elle yükleme için).
#
# deploy.sh ile AYNI yerleşimi kurar, ama FTP yerine tek bir ZIP çıkarır:
#   public_html/depo_yonetimi/ içine açılacak düz paket.
#
# KULLANIM:
#   bash scripts/pack.sh                       → dist/depo_yonetimi_deploy.zip
#   OUT=/yol/paket.zip bash scripts/pack.sh    → özel çıktı yolu
#   CONFIG_PHP=/yol/config.php bash scripts/pack.sh
#       → hazır config.php'yi private/ içine gömer (gizli; git'e ASLA girmez).
#         Verilmezse yalnızca config.example.php konur (sunucuda elle doldurulur).
#
# ÖNEMLİ: .htaccess dosyaları (kök + private/ + private/src/) PAKETE GİRMELİDİR.
#   Kök .htaccess /api/* → index.php yönlendirmesini yapar; olmazsa TÜM sync
#   çağrıları 404 alır ("Eşitleme sorunu"). Bu yüzden zip nokta-dosyalarını
#   HARİÇ TUTMAZ; yalnızca işletim sistemi çöpünü (.DS_Store) atar.
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/dist/depo_yonetimi_deploy.zip}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "▸ Frontend build (web/)…"
( cd "$ROOT/web" && npm run build )

echo "▸ Paket hazırlanıyor: $STAGE"
# 1) Frontend build çıktısı → kök
cp -R "$ROOT/web/dist/." "$STAGE/"
# 2) PHP front controller + kök .htaccess (API yönlendirmesi) → kök
cp "$ROOT/api/public/index.php" "$STAGE/index.php"
cp "$ROOT/api/public/.htaccess" "$STAGE/.htaccess"
# 3) PHP kaynağı → private/src (web erişimine kapalı; kendi .htaccess'iyle gelir)
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
# 5) İsteğe bağlı: hazır config.php'yi göm (gizli — asla commit'lenmez)
if [ -n "${CONFIG_PHP:-}" ]; then
  [ -f "$CONFIG_PHP" ] || { echo "HATA: CONFIG_PHP bulunamadı: $CONFIG_PHP" >&2; exit 1; }
  cp "$CONFIG_PHP" "$STAGE/private/config.php"
  echo "  · config.php gömüldü (gizli)"
fi

# Bütünlük denetimi: kök .htaccess ile 3 .htaccess de yerinde mi?
test -f "$STAGE/.htaccess" || { echo "HATA: kök .htaccess eksik!" >&2; exit 1; }
htc=$(find "$STAGE" -name ".htaccess" | wc -l | tr -d ' ')
[ "$htc" -ge 3 ] || { echo "HATA: .htaccess sayısı beklenenden az ($htc<3)" >&2; exit 1; }

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
# Nokta-dosyaları DAHİL; yalnızca OS çöpünü hariç tut.
( cd "$STAGE" && zip -qr -X "$OUT" . -x '.DS_Store' -x '__MACOSX/*' )

echo "✓ Paket hazır: $OUT"
echo "  Doğrula: unzip -l \"$OUT\" | grep -E '\\.htaccess|config.php|index.php'"
