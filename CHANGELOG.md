# Changelog

## 0.5.30

- **`moveObjectsToLayer` / `plugin/seaf.plugin.js`**: опциональный аргумент **`targetMode: "schemaCell"`** — перенос выполняется по **конкретной ячейке** из `objectIds` (как в `Edit Data`), без подъёма до group-root; по умолчанию (без аргумента) сохраняется прежнее поведение **group-root** для обратной совместимости.
- **`lib/events/layer_routing.py`** и **`build_move_objects_to_layer_command`**: команды слоя из Python для **`all_add`** и **`reparent`** всегда передают **`targetMode: "schemaCell"`**, чтобы инвариант `schema → layer` из `stencils/config.yaml` не ломался при вложенности (например `dc_offices` внутри `dc_azs`).
- **`context_menu/add_page.py`**: mirror-ветка `moveObjectsToLayer` также задаёт **`targetMode: "schemaCell"`**.

## 0.5.28

- **`reparent` / `events/reparent.py`**: убрана вся промежуточная обработка payload; один вызов **`logger.info`** с полями `reparentScriptFired: true` и **`event`** из `REQUEST.payload.event` как есть (включая `items` с `currentLayerName` и прочими полями снимка). Нет проверки `eventType`, нет компактных билдеров — только лог + `commands=[]`. Условия попадания INFO в файл — по-прежнему `pluginLogLevel` / `scriptLogLevel` (см. 0.5.27).

## 0.5.27

- **`reparent` / `events/reparent.py`**: только аудит — одна структурированная запись **`logger.info`** (`action=reparent_move_audit`) с `page` и компактным списком `items` (`objectId`, `schema`, `OID`, **`currentLayerName`** как слой после перемещения в снимке, плюс опционально `previousParentId`, `newParentId`, `previousLayerName`, `targetParentLayerName`). `Response.commands` всегда пустой. Чтобы строка попала в `seaf-plugin.log`, в `REQUEST.payload.env` нужен **`pluginLogLevel`** не ниже `info` (эмиссия `SEAF_INFO` из Python); в `env.yaml` для записи INFO из скриптов в файл — **`scriptLogLevel: info`** (см. `seafPluginService`).

## 0.5.26

- **`reparent` / `events/reparent.py`**: больше **не** эмитит UI-команды слоя (`moveLayerUnderLayer`, `moveObjectsToLayer`). Семантический слой из `schemas.<schema>.layer` задаётся только на **`add`** (`all_add`); смена `mxCell` parent при перетаскивании не перестраивает дерево слоёв и не «перепривязывает» слой группы (например «Офис») под другой страничный слой. Контур `reparent` по-прежнему отделён от `add` и **без OID**.

## 0.5.25

- Двухуровневая модель слоёв для **`reparent`**: семантический слой из `schemas.<schema>.layer` остаётся именем группы; при смене родителя Python handler эмитит **`moveLayerUnderLayer`** (`childLayerName` = семантический слой, `parentLayerName` = целевой страничный слой из item `targetParentLayerName`), а не `moveObjectsToLayer` по `objectIds`. Команда UI: `ensureLayer` для обоих имён, затем `model.add` слоя-потомка под слой-родитель; `suppressStencilEvents: true`.
- В snapshot `reparent` в плагине уже передаётся **`targetParentLayerName`** (ближайший предок-слой над новым `parent`); **`findLayerByName`** / поиск слоя поддерживают вложенные слои (deep search под `root`).

## 0.5.24

- Stencil events: `mxChildChange` с непустым `previous` и сменой `parent` эмитится как **`reparent`**, а не `add`. Новая вставка остаётся `add` (`previous == null`).
- `conf/events.yaml`: `handlers.reparent` → `seafStencilReparent` → `events/reparent.py` (только layer-routing, без OID; `moveObjectsToLayer` с `suppressStencilEvents: true`).
- `events/all_add.py`: отказ от обработки при `eventType=reparent` (защита от ошибочного маршрута).
- `examples/events/test_reparent.py`, тест в `test_all_add.py` на misroute.

## 0.5.23

- Stencil event items include `currentLayerName` (layer display name from the graph). `lib/events/layer_routing.py`: `moveObjectsToLayer` is not emitted for objects already on the configured target layer (same name as in `stencils/config.yaml`). `moveObjectsToLayer` UI handler skips cells whose containing layer already matches `layerName` (no-op move).
- `examples/events/test_all_add.py`: tests for layer skip / partial move list.

## 0.5.22

- `events/all_add.py`: OID is assigned only when `data.OID` is missing or blank (`build_oid_updates_for_empty_oid_items`), so a synthetic second stencil `add` after `moveObjectsToLayer` / reparent no longer bumps the sequence. `lib/oid/generator.py`: treat missing `OID` key like empty for new cells.
- `examples/events/test_all_add.py`: fix `@patch` target for `load_stencil_layer_config` to `lib.events.layer_routing`; add tests for non-empty OID skip and missing-OID assignment.

## 0.5.21

- OID import collision detection (`collect_import_conflicts` / `all_add`): conflicts are reported only when another cell with the same OID lives on the **same page** as `payload.event.page.id`. Same OID on a different page (e.g. office + mirror) is no longer treated as a collision. Renderer snapshot `payload.event.index` now includes `objectPage` (`objectId` → `pageId`), filled when stencil index entries are built.

## 0.5.20

- `events.yaml`: rules `exact_dcs_data_mirror` and `exact_dc_offices_data_mirror` now declare `add: seafStencilAllAdd` and `remove: seafStencilAllRemove` alongside `modify: seafStencilDataMirrorModify`, so exact mirror rules no longer shadow wildcard/`all` for `add`/`remove` (OID assignment on insert works again). Removed unused registered command `seafStencilSpecificAdd` (script `examples/events/specific_add.py` remains in the tree for reference).

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
