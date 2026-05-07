#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
CERT_DIR="$ROOT_DIR/deploy/nginx/certs"
COMMON_NAME="${HTTPS_COMMON_NAME:-localhost}"
ALT_NAMES="${HTTPS_ALT_NAMES:-DNS:localhost,IP:127.0.0.1}"

mkdir -p "$CERT_DIR"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl غير مثبت. ثبته أولاً أو ضع شهادتك يدوياً داخل deploy/nginx/certs" >&2
  exit 1
fi

cat > "$CERT_DIR/openssl.cnf" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = ${COMMON_NAME}

[v3_req]
subjectAltName = ${ALT_NAMES}
EOF

openssl req \
  -x509 \
  -nodes \
  -days "${HTTPS_CERT_DAYS:-365}" \
  -newkey rsa:2048 \
  -keyout "$CERT_DIR/privkey.pem" \
  -out "$CERT_DIR/fullchain.pem" \
  -config "$CERT_DIR/openssl.cnf"

chmod 600 "$CERT_DIR/privkey.pem"
chmod 644 "$CERT_DIR/fullchain.pem"

cat <<EOF
تم إنشاء شهادة HTTPS داخلية:
  $CERT_DIR/fullchain.pem
  $CERT_DIR/privkey.pem

للتشغيل:
  docker compose -f docker-compose.yml -f docker-compose.https.yml up -d --build

ملاحظة: هذه شهادة self-signed، لذلك سيعرض المتصفح تحذيراً حتى تثق بالشهادة أو تستبدلها بشهادة رسمية.
EOF
