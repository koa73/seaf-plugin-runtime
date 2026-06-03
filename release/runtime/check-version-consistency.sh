#!/usr/bin/env bash
set -euo pipefail

# Checks version consistency between:
# 1) seaf.plugin.js comment: Runtime script version: X.Y.Z
# 2) seaf_plugin/conf/plugin.yaml: plugin.runtimeVersion
# 3) seaf_plugin/runtime/version.json: version

TARGET_DIR="${1:-$HOME/.config/draw.io/plugins}"

PLUGIN_JS="${TARGET_DIR}/seaf.plugin.js"
PLUGIN_YAML="${TARGET_DIR}/seaf_plugin/conf/plugin.yaml"
VERSION_JSON="${TARGET_DIR}/seaf_plugin/runtime/version.json"

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

[[ -f "${PLUGIN_JS}" ]] || fail "Missing file: ${PLUGIN_JS}"
[[ -f "${PLUGIN_YAML}" ]] || fail "Missing file: ${PLUGIN_YAML}"
[[ -f "${VERSION_JSON}" ]] || fail "Missing file: ${VERSION_JSON}"

js_version="$(sed -n 's/^ \* Runtime script version: \(.*\)$/\1/p' "${PLUGIN_JS}" | sed -n '1p' | xargs)"
yaml_version="$(sed -n 's/^  runtimeVersion: \(.*\)$/\1/p' "${PLUGIN_YAML}" | sed -n '1p' | xargs)"
json_version="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' "${VERSION_JSON}" | sed -n '1p' | xargs)"

[[ -n "${js_version}" ]] || fail "Could not parse Runtime script version in ${PLUGIN_JS}"
[[ -n "${yaml_version}" ]] || fail "Could not parse plugin.runtimeVersion in ${PLUGIN_YAML}"
[[ -n "${json_version}" ]] || fail "Could not parse version in ${VERSION_JSON}"

[[ "${js_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Runtime version must be semver X.Y.Z: ${js_version}"
patch="${js_version##*.}"
if ((10#${patch} > 99)); then
  fail "Patch segment must be two-digit bounded (0..99): ${js_version}. After .99 increment middle segment."
fi

echo "Target: ${TARGET_DIR}"
echo "seaf.plugin.js     : ${js_version}"
echo "plugin.yaml        : ${yaml_version}"
echo "runtime/version.json: ${json_version}"

if [[ "${js_version}" == "${yaml_version}" && "${yaml_version}" == "${json_version}" ]]; then
  echo "OK: versions are consistent (${js_version})"
  exit 0
fi

echo "MISMATCH: versions are not consistent"
exit 2
