#!/usr/bin/env bash
# Sync vendored NetConf_Parser into seaf-plugin-runtime/python/vendor/netconf_parser/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VENDOR_DIR="${ROOT}/python/vendor/netconf_parser"
UPSTREAM_URL="https://github.com/koa73/NetConf_Parser"
REF="${1:-master}"

SRC_DIR="${NETCONF_PARSER_SRC:-}"
if [[ -z "${SRC_DIR}" ]]; then
  if [[ -d "${HOME}/PycharmProjects/NetConf_Parser" ]]; then
    SRC_DIR="${HOME}/PycharmProjects/NetConf_Parser"
  fi
fi

TMP_DIR=""
cleanup() {
  if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
    rm -rf "${TMP_DIR}"
  fi
}
trap cleanup EXIT

if [[ -n "${SRC_DIR}" && -d "${SRC_DIR}" ]]; then
  echo "Using local source: ${SRC_DIR}"
  TMP_DIR="${SRC_DIR}"
else
  TMP_DIR="$(mktemp -d)"
  echo "Cloning ${UPSTREAM_URL} (ref=${REF})..."
  git clone --depth 1 --branch "${REF}" "${UPSTREAM_URL}" "${TMP_DIR}" 2>/dev/null || \
    git clone --depth 1 "${UPSTREAM_URL}" "${TMP_DIR}"
  if [[ "${REF}" != "master" ]]; then
    (cd "${TMP_DIR}" && git fetch --depth 1 origin "${REF}" && git checkout "${REF}")
  fi
  SRC_DIR="${TMP_DIR}"
fi

mkdir -p "${VENDOR_DIR}/lib" "${VENDOR_DIR}/patterns"

cp -f "${SRC_DIR}/lib/device_analyzer.py" "${VENDOR_DIR}/lib/"
cp -f "${SRC_DIR}/lib/network_visualizer.py" "${VENDOR_DIR}/lib/"
if [[ -f "${SRC_DIR}/lib/pattern_validator.py" ]]; then
  cp -f "${SRC_DIR}/lib/pattern_validator.py" "${VENDOR_DIR}/lib/"
fi
cp -f "${SRC_DIR}/lib/seaf_converter.py" "${VENDOR_DIR}/lib/"
# DrawioConverter/YAML export is not invoked from main_entry.py; only dictionary builder is used.

if [[ -d "${SRC_DIR}/patterns" ]]; then
  rsync -a --delete "${SRC_DIR}/patterns/" "${VENDOR_DIR}/patterns/"
fi

if [[ -d "${SRC_DIR}/.git" ]]; then
  (cd "${SRC_DIR}" && git rev-parse HEAD) > "${VENDOR_DIR}/VERSION"
  (cd "${SRC_DIR}" && git describe --tags --always 2>/dev/null || true) >> "${VENDOR_DIR}/VERSION" || true
else
  echo "${REF}" > "${VENDOR_DIR}/VERSION"
fi
echo "${UPSTREAM_URL}" > "${VENDOR_DIR}/UPSTREAM_URL"

echo "Synced NetConf_Parser to ${VENDOR_DIR}"
ls -la "${VENDOR_DIR}/lib"
