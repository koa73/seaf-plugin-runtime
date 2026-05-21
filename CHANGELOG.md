# Changelog

## 0.5.52

- **scriptEnvEditor (optional)**: предзапускный диалог переменных для команд `main_menu.yaml`; схема во внешнем `conf/scripts/*.script_env.yaml` (обязателен при включении опции). IPC: `getSeafScriptEnvSchema`, `getSeafScriptEnvDefaults`, `saveSeafScriptEnvDefaults`. Demo: `seafToolsScriptEnvDemo`.
- **NetConf_Parser**: vendored `vendor/netconf_parser/` (без `seaf_converter`), `scripts/vendor/sync-netconf-parser.sh`, `main_entry.py` с путями из `SEAF_ENV_*`, Tools → `Net_Conf_Parser` в `interactive_terminal` + `scriptEnvEditor`, `requirements-netconf.txt` (N2G).

## 0.5.51

- **Linked page sync**: при смене `title`/`label` у `seaf.company.ta.services.dcs` / `dc_offices` с существующей graph-link на страницу — `renameLinkedPage` + `setCellLinkToPage` (модуль `linked_page_sync`; Import и data_mirror). Дубликат имени страницы — один `mxUtils.confirm` на `(pageId, title)`; без `showMessage` из Python.

## 0.5.50

- **Import**: синхронизация `title`/`label` при загрузке из YAML — `build_import_patch` вызывает `apply_title_label_sync` (та же логика, что `events/label_title.py` / `data_mirror.py`); в отчёте `titleLabelSyncCount`.

## 0.5.49

- **Export (`seafP41Export`)**: progress bar — `execution.mode: async`, `indicator.type: percent`, `emit_progress` в `export.py` (resolve output → build map → write YAML → done).

## 0.5.48

- **Release**: пересобран `seaf-plugin-runtime.tar.gz` с версией, совпадающей с `runtime/version.json` (исправление ситуации, когда обновление считало 0.5.46 актуальной при поднятой версии в исходниках).

## 0.5.47

- **Import (fixes)**: устранено дублирование error-popup в async-ветке (если Python уже вернул `showMessage`, второй popup не показывается).
- **Import log**: сжат DEBUG-лог (`*Count` + `*Sample`), summary приведен к export-подобной статистике; `unmatchedInDiagram` остается в формате `{schema:[OID]}`.

## 0.5.46

- **P41 Import**: `main_menu/import.py` реализует обратную загрузку SEAF YAML из `inputSeafFile` (файл/каталог, рекурсивный поиск), сопоставление по `schema+OID` и batch-команду `applySeafImportBatch` для глобального обновления стенсилов без изменения `OID/schema`.
- **`lib/main_menu/import_helpers.py`**, **`import_yaml_loader.py`**, **`import_report.py`**, **`seaf_data_map.py`**: загрузка/merge/валидация структуры `schema -> OID -> attrs`, INFO/DEBUG отчёт (`loaded/matched/updated/unmatchedInDiagram`), дубликаты и ошибки структуры.
- **`plugin/seaf.plugin.js`**: добавлен UI-command handler `applySeafImportBatch` (multi-page update через `collectCellsByCriteriaAcrossPages`).
- **`conf/main_menu.yaml`**: `seafP41Import` переведён в `async` с `indicator.type=percent`, `includeSchemaObjects/includePages`, `timeoutSec=120`; `inputSeafFile` picker поддерживает и файл, и каталог.

## 0.5.45

- **Export**: `eligibleCount` и `exportedCount` считают уникальные пары `(schema, OID)`; повторы на других страницах — `duplicateOidCount` / `skippedDuplicate` (DEBUG), не входят в eligible.

## 0.5.44

- **Export**: объекты со `schema`, но без OID (stencil, mxgraph и т.п.) — тихо исключаются из выборки; в `warnings` / `skippedInput` попадает только `seaf.*` без OID (`missing_oid_seaf`). В отчёте: `skippedIgnored` (DEBUG) vs `exportErrorCount` (INFO).

## 0.5.43

- **Export (P41)**: интеграция vendored `yaml_schema_generator` — SEAF YAML с обёрткой `schema` + OID; PyYAML в `python/requirements.txt`.
- **`lib/main_menu/export_yaml_generator.py`**, **`export_report.py`**: генерация, нормализация attrs (`[]` → list), отчёт eligible/exported/skipped/validation в лог (`pluginLogLevel: info` — summary, `debug` — detail).
- **`build-runtime.sh`**: в tar только production Python (`vendor`, scripts без `examples/`); `python/tests/`, `yaml_schema_generator_examples/` — только в репозитории.

## 0.5.42

- **`plugin/seaf.plugin.js`**: многостраничный сбор для Export/поиска ячеек через `page.root` + `model.setRoot` (`getCellsByCriteriaForPage`), без `selectPage` в цикле — экспорт не зависит от активной вкладки.

## 0.5.41

- **`plugin/seaf.plugin.js`**: исправлен обход страниц при `collectSchemaObjectsAcrossPages` / `collectCellsByCriteriaAcrossPages` — переключение страницы по `ui.currentPage !== page` вместо `originalPage !== page`, чтобы при экспорте с непервой страницы не читалась модель предыдущей страницы (6 vs 4 YAML-файлов на `1.drawio`).

## 0.5.40

- **`lib/main_menu/export_helpers.py`**: если `outputSeafFile` указывает **каталог**, Export создаёт по файлу `.yaml` на каждую schema; имя = последние два компонента schema (`services.network_segments.yaml` и т.д.); одиночный файл — YAML (`.json` по расширению).

## 0.5.39

- **`plugin/seaf.plugin.js`**: при `status=error` не дублировать popup, если Python уже вернул `commands[]` с `showMessage` (`level: error`) — исправляет двойной вывод ошибки Export при пустом `outputSeafFile`.

## 0.5.38

- **`main_menu/export.py`**, **`lib/main_menu/export_helpers.py`**: P41 Export собирает `{schema: {OID: data}}` из `payload.schemaObjects`, пишет JSON в `outputSeafFile` (fallback на `inputSeafFile` при `useSameOutputFile`); пустой путь → `status=error` + `showMessage`.
- **`plugin/seaf.plugin.js`**: `includeSchemaObjects` в `buildPayload`, `collectSchemaObjectsAcrossPages()` (все страницы, `requireSchema`, выделение ячеек, `buildIndexEntryFromCell`).
- **`conf/main_menu.yaml`**: для `seafP41Export` — `includePages`, `includeSchemaObjects`.

## 0.5.37

- **`conf/main_menu.yaml`**: подменю **P41** (`Export`, `Import`) и **Tools** (`Net_Conf_Parser`) через `menu.main.submenu` / `submenuTitle`.
- **`python/scripts/main_menu/`**: заглушки `export.py`, `import.py`, `net_conf_parser.py` — логируют вызов через `ScriptLogger` (`SEAF_INFO` при `pluginLogLevel: info`).

## 0.5.36

- **`plugin/seaf.plugin.js`**: главное меню `SEAF` строится только из команд с `menu.main.enabled: true`; подменю создаются динамически по `menu.main.submenu` / `menu.main.submenuTitle`; удалены хардкод `P41` / `Tools` / `Examples` и эвристика по префиксу `SEAF` в `title`.
- **`conf/context_menu.yaml`**: для `seafAddPage` явно `menu.main.enabled: false` — «Создать страницу» только в контекстном меню.
- **`drawio-standalone/.../Menus.js`**, **`ElectronApp.js`**: удалены placeholder-пункты `Download` / `Create P41` / `Upload`; контейнер `seaf` пустой (наполняется runtime plugin).

## 0.5.35

- **`plugin/seaf.plugin.js`**: для userObject с `schema` под префиксом из `events.yaml` (`schemaPrefix`, по умолчанию `seaf.`) в карту `data` при `modify` включается атрибут **`label`** (раньше отфильтровывался как у обычных ячеек), чтобы Python `title_label_sync` видел правку подписи из SEAF Edit Data.
- **`plugin/seaf.plugin.js`**: при смене user value **без** активной сессии Edit Data (например правка подписи на схеме) для тех же SEAF-стенсилов эмитится **`modify`** с `dataBefore`/`dataAfter` из `change.previous` / `change.value` (лог `inplaceSeafValueChange: true`).
- **Проверка вручную**: SEAF Edit Data — смена только `label` → в логе `diffKeys` содержит `label`, Python обновляет `title`; in-place подпись → тот же эффект при `pluginLogLevel=debug`. Обычная фигура без `schema` под `schemaPrefix` — `label` по-прежнему не включается в `data` (как в draw.io по умолчанию).

## 0.5.34

- **`lib/events/title_label_sync.py`**: общая политика согласования **`title`/`label`** при stencil `modify` (если в одной транзакции меняются оба — побеждает **title**); опциональная отладочная трассировка через `ScriptLogger.debug` при `pluginLogLevel: debug|trace`.
- **`lib/logging`**: метод **`ScriptLogger.debug`** — пишет `SEAF_INFO` только для `debug`/`trace`.
- **`events/data_mirror.py`**: перед санитизацией patch применяется `title_label_sync` для зеркалирования `dcs`/`dc_offices`.
- **`events/label_title.py`**, **`conf/events.yaml`**: wildcard `modify` → `seafStencilLabelTitleSync` с `updateStencilDataBulk` и **`suppressStencilEvents: true`** при необходимости дописать парное поле.
- **`lib/events/all_add_helpers.py`**: `build_update_stencil_data_bulk_command(..., suppress_stencil_events=...)`.
- **`conf/stencils/config.yaml`**: опциональный флаг **`sync_title_with_label`** (пример для `dcs`/`dc_offices`).

## 0.5.33

- **`conf/stencils/config.yaml`**: опциональный список **`data_hidden`** (формат как у `data_lock`) — атрибуты не показываются в `SeafEditDataDialog`, не удаляются при Apply; добавление свойства с таким именем блокируется. Для `seaf.company.ta.services.dcs` и `seaf.company.ta.services.dc_offices` по умолчанию скрыт атрибут **`link`**. Если имя есть и в `data_lock`, и в `data_hidden`, приоритет у **`data_hidden`**.
- **`plugin/seaf.plugin.js`**: `getDataHiddenForSchema`, `hiddenList` в `resolveSchemaPolicy` / `buildEditDataIntent`, ресурс `seafEditDataHiddenAddAlert`.

## 0.5.32

- **`conf/events.yaml`**: удалены скрытые команды и ссылки `handlers.remove` / `handlers.modify`, которые обслуживали только диагностические скрипты (`seafStencilSpecificRemove`, `seafStencilSpecificModify`, `seafStencilAllRemove`, `seafStencilAllModify`). Для `dcs` / `dc_offices` остаются `add`, `reparent` и `modify` → `seafStencilDataMirrorModify`; для `dc_azs` — только `add` и `reparent`. События `remove` без handler по-прежнему отфильтровываются в renderer (см. `missing handler for operation` в debug log).
- Удалены ранее добавленные по ошибке файлы `python/scripts/events/{specific_remove,specific_modify,all_remove,all_modify}.py` (дубликаты логики из examples; в поставке не используются).

## 0.5.31

- **`conf/events.yaml`**: удалено catch-all правило `id: all` (`schema: all` для `SEAF_Р41`); `defaultRuleId` указывает на `wildcard_ta_services`.
- **`conf/main_menu.yaml`**, **`conf/context_menu.yaml`**: из поставочного меню убраны команды, чей `script` указывал на `python/scripts/examples/...` (демо reload/validate/async/failure/timeout/interactive terminal и overrides контекстного меню для удалённых id).

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
