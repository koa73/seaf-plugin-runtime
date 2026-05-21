#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${ROOT_DIR}/release/out"
STAGE_DIR="${OUT_DIR}/stage"
ASSET_NAME="seaf-plugin-runtime.tar.gz"
PY_ROOT="${ROOT_DIR}/python"
STAGE_PY="${STAGE_DIR}/seaf_plugin/python"

rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/seaf_plugin" "${OUT_DIR}" "${STAGE_PY}"

cp "${ROOT_DIR}/plugin/seaf.plugin.js" "${STAGE_DIR}/seaf.plugin.js"
cp -r "${ROOT_DIR}/conf" "${STAGE_DIR}/seaf_plugin/conf"
cp -r "${ROOT_DIR}/runtime" "${STAGE_DIR}/seaf_plugin/runtime"
cp -r "${ROOT_DIR}/keys" "${STAGE_DIR}/seaf_plugin/keys"

# Python runtime: production scripts + python/vendor only (no tests, no yaml_schema_generator_examples)
cp "${PY_ROOT}/requirements.txt" "${STAGE_PY}/requirements.txt"
if [ ! -d "${PY_ROOT}/vendor/netconf_parser" ]; then
	echo "WARN: python/vendor/netconf_parser missing; run scripts/vendor/sync-netconf-parser.sh" >&2
fi
cp -r "${PY_ROOT}/vendor" "${STAGE_PY}/vendor"
mkdir -p "${STAGE_PY}/scripts"
cp -r "${PY_ROOT}/scripts/lib" "${STAGE_PY}/scripts/lib"
cp -r "${PY_ROOT}/scripts/main_menu" "${STAGE_PY}/scripts/main_menu"
cp -r "${PY_ROOT}/scripts/context_menu" "${STAGE_PY}/scripts/context_menu"
cp -r "${PY_ROOT}/scripts/events" "${STAGE_PY}/scripts/events"
for top in "${PY_ROOT}/scripts/"*.py; do
	[ -f "${top}" ] || continue
	cp "${top}" "${STAGE_PY}/scripts/"
done

shopt -s nullglob
for script in "${STAGE_PY}/scripts/"*.py "${STAGE_PY}/scripts/main_menu/"*.py \
	"${STAGE_PY}/scripts/context_menu/"*.py "${STAGE_PY}/scripts/events/"*.py; do
	chmod +x "${script}"
done
shopt -u nullglob

tar -C "${STAGE_DIR}" -czf "${OUT_DIR}/${ASSET_NAME}" .
sha256sum "${OUT_DIR}/${ASSET_NAME}" > "${OUT_DIR}/checksums.txt"

echo "Built ${OUT_DIR}/${ASSET_NAME}"
