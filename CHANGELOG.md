# Changelog

## 0.5.19

- Stencil `modify` detection: `collectStencilEventsFromModelChange` now treats a real Edit Data change when the **editable attribute map** (`dataBefore` vs `dataAfter` from `extractEditableDataFrom*`) differs, not only when `JSON.stringify(sanitizeForIpc(value))` differs — `sanitizeForIpc` over DOM/XML nodes could drop attributes and suppress `modify` (breaking `seafStencilDataMirrorModify` / `data_mirror`). Added debug log `Stencil modify candidate evaluated` with `diffKeys`, and `info` log `Stencil event handler started` at the beginning of `runStencilEventCommand`.

## 0.5.18

- SEAF Edit Data Apply: build the attribute clone **before** `hideDialog` (inputs stay valid while DOM is attached); snapshot `valueBefore` via `model.getValue(cell)` for the **edited cell** instead of `getSelectionCells()` (selection is often cleared when the dialog closes, which broke `modify` / `data_mirror`).

## 0.5.17

- Fixed Edit Data snapshot session lifecycle: the stencil model `CHANGE` listener no longer clears `editDataSessionActive` after every change (that dropped `modify` events when `hideDialog` emitted intermediate updates or when the session was cleared before Apply’s `setValue`). Session end is deferred to `ui.hideDialog` (`setTimeout(0)`) so both SEAF and native `Edit Data -> Apply` paths reliably emit `modify` for `data_mirror` and related handlers.

## 0.5.14

- Restored final `assignEmptyOidOnPage` step in `seafAddPage` flow (`context_menu/add_page.py`): on the created page, all objects that have an `OID` attribute with an empty value receive calculated OIDs via the same generator as `all_add` (`companyPrefix` + `schemaCode` + sequence).

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
