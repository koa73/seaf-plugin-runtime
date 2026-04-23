#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${ROOT_DIR}/release/out"
STAGE_DIR="${OUT_DIR}/stage"
ASSET_NAME="seaf-plugin-runtime.tar.gz"

rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/seaf_plugin" "${OUT_DIR}"

cp "${ROOT_DIR}/plugin/seaf.plugin.js" "${STAGE_DIR}/seaf.plugin.js"
cp -r "${ROOT_DIR}/conf" "${STAGE_DIR}/seaf_plugin/conf"
cp -r "${ROOT_DIR}/python" "${STAGE_DIR}/seaf_plugin/python"
cp -r "${ROOT_DIR}/runtime" "${STAGE_DIR}/seaf_plugin/runtime"
cp -r "${ROOT_DIR}/keys" "${STAGE_DIR}/seaf_plugin/keys"

shopt -s nullglob
for script in "${STAGE_DIR}/seaf_plugin/python/scripts/"*.py "${STAGE_DIR}/seaf_plugin/python/scripts/examples/"*.py
do
	chmod +x "${script}"
done
shopt -u nullglob

tar -C "${STAGE_DIR}" -czf "${OUT_DIR}/${ASSET_NAME}" .
sha256sum "${OUT_DIR}/${ASSET_NAME}" > "${OUT_DIR}/checksums.txt"

echo "Built ${OUT_DIR}/${ASSET_NAME}"
