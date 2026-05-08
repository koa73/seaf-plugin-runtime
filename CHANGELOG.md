# Changelog

## 0.5.13

- Fixed `insertStencilFromP41ByTitle` primary selection: the cell that receives parent `source_data` is now the first inserted descendant whose `schema` equals `sourceSchema` (not the first cell with a different schema). If no such cell exists, the command returns `reason: 'mirror_not_found'` and `validateSeafAddPageUiResults` surfaces the existing UX message «Не возможно добавить элемент <mirror> на страницу».

## 0.5.12

- Removed `assignEmptyOidOnPage` from `seafAddPage` flow to test baseline page creation pipeline (`createPage -> setCellLinkToPage -> insertStencilFromP41ByTitle -> updateStencilDataBulk -> moveObjectsToLayer`) without OID backfill on created page.

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
