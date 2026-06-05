#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${ROOT_DIR}/release/out"
STAGE_DIR="${OUT_DIR}/minimal-stage"

rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}/seaf_plugin" "${OUT_DIR}"

cp "${ROOT_DIR}/minimal-runtime/seaf.plugin.js" "${STAGE_DIR}/seaf.plugin.js"
cp -r "${ROOT_DIR}/minimal-runtime/seaf_plugin/conf" "${STAGE_DIR}/seaf_plugin/conf"
cp -r "${ROOT_DIR}/minimal-runtime/seaf_plugin/runtime" "${STAGE_DIR}/seaf_plugin/runtime"
cp -r "${ROOT_DIR}/minimal-runtime/seaf_plugin/log" "${STAGE_DIR}/seaf_plugin/log"

echo "Built minimal stage ${STAGE_DIR}"
