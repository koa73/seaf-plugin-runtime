# Changelog

## 0.1.3

- Added configurable command-level `indicator` block in `conf/plugin.yaml`.
- Added async job progress/timeout/cancel statuses and cancel IPC in desktop service.
- Added manual indicator start/stop API via SEAF plugin IPC bridge.
- Updated `seafAsyncBackground` and script progress events for percent indicator demo.

## 0.1.2

- Removed default SEAF command popups in UI flow.
- Show command messages only when explicitly returned by script response.

## 0.1.0

- Initial split into standalone SEAF plugin runtime repository.
- Added runtime update contract for GitHub Release asset `seaf-plugin-runtime.tar.gz`.
