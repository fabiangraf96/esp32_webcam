#!/usr/bin/env bash
set -euo pipefail

export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
export SSL_CERT_DIR=/etc/ssl/certs
export REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
export CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt
export IDF_PATH="$HOME/esp/esp-idf"
unset PYTHONHOME PYTHONPATH ZEPHYR_BASE || true
# shellcheck source=/dev/null
. "$IDF_PATH/export.sh"

cd "$(dirname "$0")"
idf.py set-target esp32
idf.py build
