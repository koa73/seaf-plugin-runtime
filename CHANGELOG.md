# Changelog

## 0.5.93

- **Logical link dialog layout patch**: для вспомогательного окна `Создать логическую связь` добавлен фиксированный нижний отступ `10px` под кнопочным блоком (`Создать/Отмена`), чтобы убрать визуальное прижатие кнопок к нижней границе.
- **Height tuning**: скорректирован контент-ориентированный расчет высоты диалога для стабильного отображения нового нижнего отступа без регрессий в валидации кнопки `Создать`.

## 0.5.92

- **Logical link dialog refinement**: в `seafCreateLogicalLink` добавлены параметры `Геометрия линии` (Прямая/Угловая/Скругленная) и optional `label`; endpoint-списки показывают формат `OID (title)`.
- **Logical link data contract**: при создании edge через `graph.insertEdge` в value записывается `schema=seaf.company.ta.logical_links`.
- **Layer routing for links**: после создания связь переносится на слой `Логические связи` с переиспользованием существующих runtime helper-ов `ensureLayer`/`moveObjectsToLayer` (создание слоя при отсутствии).
- **UI sizing and contracts**: высота вспомогательного окна переведена на контент-ориентированный расчет; обновлен `test-create-logical-link-ui-contract.mjs` под новые поля и слой/схему.

## 0.5.91

- **Context menu logical link**: добавлена команда `seafCreateLogicalLink` (`clientAction: createLogicalLink`) для multi-select сценария — пункт `Создать логическую связь` показывается только при выборе ровно 2 стенсилов из разрешённого schema allowlist.
- **Logical link dialog**: реализовано вспомогательное окно параметров связи (`Источник`, `Приемник`, `Тип связи`, `Цвет`, `Тип линии`, `Тип стрелки`) с `Создать/Отмена`, disabled-state кнопки до валидного заполнения и запретом `source == target`.
- **Draw.io edge creation**: связь создается через стандартный API `graph.insertEdge`, а итоговый стиль всегда строится из текущих значений диалога (стартовые default-поля при открытии + пользовательские изменения).
- **Debug diagnostics**: добавлены debug-логи eligibility context menu, открытия/отмены диалога, валидации и успешного создания логической связи.
- **Contracts**: добавлены `test-create-logical-link-menu-contract.mjs` и `test-create-logical-link-ui-contract.mjs`.

## 0.5.90

- **Managed venv bootstrap branching fix**: `bootstrapPythonRuntimeOnInstallOrUpdate` переведен на 2-веточный алгоритм — при наличии валидного `seaf_plugin/.venv` выполняется health-check (`probe -> ensure pip -> verify imports`) без пересоздания, при отсутствии/битом venv запускается recreate-ветка.
- **ENOENT loop protection**: при выборе `basePython` для recreate исключаются кандидаты внутри managed `.venv`, чтобы update не пытался запускать интерпретатор из каталога, который сам же удаляет перед `python -m venv`.
- **Diagnostics hardening**: в bootstrap-лог добавлены поля `branch`, `venvDirExists`, `selectedBasePython`, `selectedVenvPython`, `triedCandidates`, `filteredCandidates` для детального разбора update-сбоев.
- **Contract update**: обновлен `test-python-bootstrap-update-contract.mjs` под новый 2-веточный bootstrap и защиту от self-referential `.venv` кандидатов.

## 0.5.89

- **Add-page full-page layer routing**: в pipeline `context_menu/add_page.py` после `assignEmptyOidOnPage` и `autoLinkParentsOnPage` добавлен обязательный шаг `routePageStencilsToLayers`, который выполняется для всех сценариев (mirror и non-mirror).
- **Renderer routing handler**: добавлен `uiCommandHandlers.routePageStencilsToLayers` — переключение на созданную страницу, сбор всех schema-bearing объектов, группировка по target layer из `stencils/config.yaml`, `ensureLayer + moveObjectsToLayer` по группам, агрегированный результат (`status`, `createdLayers`, `moved`, `skipped`, `errors`).
- **Add-page validation gate**: `validateSeafAddPageUiResults` теперь валидирует шаг `routePageStencilsToLayers`; при статусе, отличном от `updated|noop`, сценарий переводится в `error` с кодом `page_layer_routing_failed`.
- **Contracts/tests**: обновлены `test-add-page-script.mjs` и `test-add-page-ui-contract.mjs` под новый routing-step; подтверждена совместимость через `test-all-add-layer-routing.mjs` и `test-reparent-layer-routing.mjs`.

## 0.5.88

- **Bootstrap retry recovery fix**: для `bootstrapPythonRuntime` дефолтные опции переключены в recovery-режим (`allowDependencyInstall=true`, `allowFallback=true`, `persistFallback=true`), чтобы retry после update восстанавливал Python даже при битом `env.pythonExecutable`.
- **Update-test readiness**: сценарий из recovery-диалога (`Повторить`) теперь использует тот же практический путь восстановления, что и системный update bootstrap.

## 0.5.87

- **Context menu dedupe fix**: устранён дубль пункта `Редактировать данные (SEAF)…` при overlap policy (`seafEditDataHard` + `seafEditDataSoft`) — при построении context menu второй совпавший `clientAction: seafEditData` больше не добавляется.
- **Contract update**: обновлён `test-edit-data-context-policy-contract.mjs` для фиксации guard от дублирования пункта.

## 0.5.86

- **OID recovery after runtime update**: `applyRuntimeFromExtractRoot` теперь мигрирует `seaf_plugin/.venv` из backup в новый runtime до удаления backup, чтобы не терять рабочий Python между обновлениями.
- **Update bootstrap payload**: `runNativeSshRuntimeUpdate` теперь запускает `bootstrapPythonRuntimeOnInstallOrUpdate` после apply и возвращает структурированный результат в `payload.pythonBootstrap`.
- **Python bootstrap API/IPC**: добавлены main-process API `bootstrapPythonRuntime` / IPC action `bootstrapSeafPythonRuntime` для ручного повторного bootstrap без повторной установки runtime.
- **Stale executable recovery**: `resolvePythonExecutable` при битом `env.pythonExecutable` автоматически пробует fallback-интерпретаторы (`python3`/`python`) и логирует recovery.
- **Renderer init guard**: при инициализации plugin добавлен не-критичный шаг `ensurePythonEnvironmentAuto`, чтобы early обнаруживать отсутствующий интерпретатор.
- **Context menu diagnostics**: исправлена нормализация label (`replace(...).trim()`), добавлены явные debug-логи matched `clientAction: seafEditData` команд.

## 0.5.85

- **Network sync regression fix**: `connect/disconnect` event items теперь резолвят terminal-ячейки к ближайшему schema-bearing стенсилу (`resolveEditDataTarget`), чтобы `seafStencilNetworkConnectionSync` не терялся при привязке к внутренним `mxCell`/портам grouped stencil.
- **Atomicity guard**: добавлен контракт `test-network-sync-atomicity-contract.mjs`, фиксирующий независимость event-маршрутизации (`matchEventRoute` + `handlers.connect/disconnect`) от policy команд `seafEditData` в `context_menu.yaml`.
- **Edit Data context policy**: в `context_menu.yaml` сохранены оба режима `editDataMode` (`hard` default и `soft` для точечных схем) без влияния на dispatch `seafStencilNetworkConnectionSync`.

## 0.5.84

- **SEAF Edit Data policy migration**: переключение режима `Редактировать данные (SEAF)` перенесено из `conf/stencils/config.yaml` в `conf/context_menu.yaml` через context-menu policy `editDataMode: hard|soft` (по умолчанию `hard`).
- **Atomic context menu behavior**: показ/скрытие native `Edit Data` больше не зависит от `policySource=config-hit`; для `hard` скрывается native-пункт и остаётся только SEAF, для `soft` доступны оба пункта.
- **IPC hardening**: восстановлен main-process роут `getSeafStencilConfig` в `electron.js`; загрузка stencil-config в renderer использует typed action без legacy `readSeafPluginFile` fallback.
- **Data config cleanup**: ключ `edit_data` удалён из `conf/stencils/config.yaml` (режимы теперь полностью управляются `context_menu.yaml`).
- **Contracts/tests**: добавлен `test-edit-data-context-policy-contract.mjs`, обновлены `test-edit-data-ipc-contract.mjs` и `test-edit-data-menu-integration.mjs`.

## 0.5.83

- **Network connection events**: event pipeline расширен операциями `connect`/`disconnect` для edge lifecycle (`mxTerminalChange` и add/remove ребра), в payload добавлены поля `edgeId`, `source/target*`, `network*`, `receiver*` для handler-скриптов.
- **New event handler**: добавлен `python/scripts/events/network_connection_sync.py` и маршруты `handlers.connect/disconnect` в `conf/events.yaml`; handler синхронизирует список `network_connection` через `updateStencilDataBulk` (`suppressStencilEvents: true`) с remove/add без дублей.
- **Desktop event config normalization**: `normalizeEventConfig` в main-process теперь принимает `handlers.connect` и `handlers.disconnect`.
- **Contracts/tests**: добавлены `test-network-connection-event-contract.mjs` и `test-network-connection-sync-script.mjs`.

## 0.5.82

- **Autonomous Python bootstrap**: в update-flow добавлен fallback `venv -> virtualenv` (установка `virtualenv` через существующий `pip`), чтобы подготовка `.venv` не зависела от наличия системного `python3-venv`/`ensurepip`.
- **Structured bootstrap errors**: ошибки автоподготовки нормализованы в единый контракт (`code`, `stage`, `category`, `error`, `hint`, `stderrTail`) и возвращаются в payload обновления.
- **Update recovery dialog**: при bootstrap fail после update renderer показывает диалог с действиями `Повторить`, `Диагностика`, `Edit Config`.

## 0.5.81

- **Python bootstrap lifecycle**: автоподготовка Python перенесена с command/init preflight на фазу runtime install/update (`seafUpdatePlugin`) с managed `.venv` в `seaf_plugin/.venv`.
- **Managed environment**: после успешного bootstrap (`venv` + `pip install -r requirements` + import-check `requiredModules`) путь к интерпретатору автоматически сохраняется в `env.yaml` (`pythonExecutable`), ручной override через `Edit Config` сохранен.
- **Update UX**: если runtime обновлен, но bootstrap Python не выполнен, UI показывает явную ошибку автонстройки и подсказку про `Edit Config`.
- **Contracts**: добавлен тест `test-python-bootstrap-update-contract.mjs` для update/bootstrap и UI контрактов.

## 0.5.80

- **Preflight dialog UX**: для информационного окна команд с `descriptionFile` добавлен автоподбор высоты по фактическому объему текста.
- **Adaptive scrolling**: текущая высота окна сохранена как максимум; при переполнении включается прокрутка текстового блока, при коротком описании высота окна уменьшается под контент.

## 0.5.79

- **Tools preflight description**: для пунктов main menu с параметром `descriptionFile` добавлен блокирующий информационный диалог с кнопками `Продолжить` / `Завершить` перед запуском команды.
- **NetConf rollout**: для `seafToolsNetConfParser` добавлен `descriptionFile` и отдельный markdown-файл `conf/main_menu/descriptions/seafToolsNetConfParser.md` (краткое описание инструмента и необходимых настроек).
- **Contracts**: добавлен тест `test-tools-description-contract.mjs` на наличие `descriptionFile`, description markdown и подключение preflight helper в renderer.

## 0.5.78

- **Layer routing (grouped stencils)**: для event-сценариев `all_add` и `reparent` команды `moveObjectsToLayer` переключены на `targetMode: groupRoot`, чтобы переносить на слой корень группы (`style=group`) и не разрывать составные P41-стенсилы.
- **Renderer move target mode**: добавлен режим `groupRoot` в `resolveMoveTargetsByObjectIds` (fallback на текущую target-логику, если group-root не найден).
- **Tests**: обновлён контракт `test-all-add-layer-routing.mjs` и добавлен `test-reparent-layer-routing.mjs` для контроля нового targetMode.

## 0.5.77

- **Add page**: после `assignEmptyOidOnPage` добавлен автоматический шаг `autoLinkParentsOnPage`, который предзаполняет parent-поля для стенсилов новой страницы по `parent.schema[]/parent.field`.
- **Parent-link reuse**: общее вычисление parent-кандидатов вынесено в `python/scripts/lib/diagram/parent_linking.py`; `context_menu/link_with_parent.py` переведен на shared helper.
- **Validation/Test contracts**: `validateSeafAddPageUiResults` валидирует новый шаг автосвязи, а контрактные тесты `test-add-page-script.mjs` и `test-add-page-ui-contract.mjs` расширены под новый пайплайн.

## 0.5.76

- **Link with parent**: `parent.schema` в `conf/stencils/config.yaml` теперь обрабатывается как массив разрешённых parent-схем; связь применяется только при ровно одном найденном кандидате в выделении, при 2+ кандидатах формируется коллизия.
- **Tests**: добавлены сценарии для multi-parent (`network_segments`) — success при одном кандидате, collision при двух разных parent-типах, missing при отсутствии кандидатов.

## 0.5.75

- **Link with parent**: устранено дублирование popup при коллизиях parent — одинаковые сообщения `showMessage` дедуплицируются по тексту, чтобы ошибка показывалась один раз.

## 0.5.74

- **Link with parent**: текст popup коллизии сокращён до формата `Коллизия, найдено более одного кандидата : <OID, OID>`, список OID в сообщении теперь дедуплицируется и сортируется.

## 0.5.73

- **OID index bootstrap**: `stencilIndex` в renderer теперь пересобирается по всем страницам диаграммы и обновляется на lifecycle событиях `fileLoaded`/`pageSelected`, чтобы `all_add` получал актуальный `index.byOid` и не генерировал дубликаты OID после открытия существующих файлов.
- **all_add hardening**: добавлена нормализация `payload.event.index.byOid/objectPage` в `events/all_add.py` для устойчивой генерации OID при деградированных payload.

## 0.5.72

- **Context menu config fix**: удалён дублирующийся root-блок `version/commands` в `conf/context_menu.yaml`; `seafLinkWithParent` больше не теряется при загрузке конфига и корректно доступен для `target: selection_multi`.

## 0.5.71

- **Context menu**: добавлена команда `seafLinkWithParent` («Связать с родителем») с `target: selection_multi`.
- **Parent binding**: новый handler `context_menu/link_with_parent.py` связывает выбранные child с parent по `conf/stencils/config.yaml` (`parent.schema` / `parent.field`) и пишет батч через `updateStencilDataBulk`.
- **Collision policy**: popup всегда для коллизий parent (2+ кандидата); для `missing parent` popup только если не установлена ни одна связь.
- **Debug logging**: статистика `processed/updated/missing/collisions` и детали конфликтов пишутся в debug (`pluginLogLevel: debug|trace`).

## 0.5.70

- **Tools → Edit Data (bulk)**: при блокировке bulk-режима по policy (`edit_data: standard`) renderer теперь пишет явный `warn` в `seaf-plugin.log` (`Bulk Edit Data denied by schema policy`) с `commandId/schema/layer/editMode`, чтобы отказ фиксировался в логах, а не только в UI popup.

## 0.5.69

- **Bulk Edit Data (архитектура)**: Tabulator перенесён в draw.io webapp (`js/vendor/tabulator/`, preload в `ElectronApp.js`); runtime грузит только `seaf-bulk-edit-data-module.js` из корня plugins через `getPluginFile` + `script.src`.
- **build-runtime.sh**: исправлено вложение `conf/conf/` (`cp conf/.` merge); Tabulator и дубль bulk-модуля в `conf/` убраны из tarball.
- **Оптимизация**: `collectSchemaObjectsAcrossPages(schema)` фильтрует по schema при сборе; Apply получает только объекты выбранной schema.

## 0.5.68

- **Edit Data bulk**: Tabulator и bulk-модуль загружаются через `file://` из `seaf_plugin/conf/` (`script.src` / `link.href`), а не inline — CSP `script-src 'self'` блокировал `script.text` и давал `SeafBulkEditData module is not available`.

## 0.5.67

- **Edit Data bulk**: загрузка Tabulator и bulk-модуля через `readSeafPluginFile` (файлы в `seaf_plugin/conf/vendor/`), исправлена ошибка `failed to load stylesheet: vendor/tabulator/...` в Electron.

## 0.5.66

- **Tools → Edit Data (bulk)**: после выбора schema — табличный редактор (Tabulator) по всем объектам диаграммы; `data_lock` / `data_hidden`, выбор видимых колонок; Save → `edit_data_apply.py` → `updateStencilDataBulk` + linked-page sync (как Import). Vendored `plugin/vendor/tabulator`, `seaf-bulk-edit-data-module.js` в tarball.

## 0.5.65

- **Tools → Edit Data**: увеличен отступ между выпадающим списком и кнопками OK/Отмена; высота диалога 148 px.

## 0.5.64

- **Tools → Edit Data**: компактный диалог выбора стенсилов (`openStencilSchemaPickerDialog`, высота 120 px); подпись «Выбор объектов для редактирования»; исправлен tarball обновления (актуальный `seaf.plugin.js` в пакете).

## 0.5.63

- **Tools → Edit Data**: пункт меню `seafToolsEditData` — диалог выбора группы стенсилов по `layer` из `conf/stencils/config.yaml`; полная запись schema передаётся в `main_menu/edit_data.py` (`stencilSchema`, `stencilSchemaConfig`); выбор сохраняется в `state.editDataSelection` (плагин) и `SELECTED_STENCIL_ENTRY` (Python); при `pluginLogLevel: debug` — запись в `seaf-plugin.log`.

## 0.5.62

- **NetConf SEAF data parity**: vendored `lib/seaf_converter.py` — полный upstream (YAML `patterns/seaf` → `schema`, `app_components`, `location` и др. на объектах диаграммы); lite-заглушка удалена. `network_visualizer` передаёт `patterns/seaf` в `get_seaf_dictionary()`.
- **NetConf**: `main_entry.py` — для топологии пропускаются `cdp`/`version`/`inventory` и дубли `running.*` при наличии `running.current`; сводка «использовано N из M файлов» в stderr.
- **sync-netconf-parser.sh**: копирует `seaf_converter.py` из upstream (DrawioConverter по-прежнему не вызывается из `main_entry`).

## 0.5.61

- **NetConf import**: после фонового импорта на страницу `netconf_perser` восстанавливается исходная страница диаграммы и фокус возвращается в окно interactive terminal; убран модальный `showInfo`, который перехватывал фокус. Desktop: IPC `focusSeafInteractiveTerminalSession` (**a59+**).

## 0.5.60

- **NetConf Parser (вариант A)**: после успешного построения диаграммы `main_entry.py` печатает `SEAF_NETCONF_DIAGRAM_READY`; плагин на `process-exit` импортирует `network_diagram.drawio` на страницу `netconf_perser` (существующая страница — замена содержимого). Desktop: `process-exit` передаёт `outputTail` для парсинга маркера (**a58+**).

## 0.5.59

- **NetConf**: подсказка в `script_env` про права на каталог данных (без правок vendored `netconf_parser` lib).
- **Desktop**: tail вывода interactive terminal (~16 KB) в `seaf-plugin.log` при failed или `pluginLogLevel: debug`.

## 0.5.58

- Удалены demo `seafToolsScriptEnvDemo`, `script_env_demo.py`, `conf/scripts/script_env_demo.*` и тест `test-script-env-demo-python.mjs`.

## 0.5.57

- **scriptEnvEditor**: общая `appendFieldHelpIcon` для диалогов параметров скрипта и env; подсказка `helpText` через hover-tooltip (`geHint`), не только `title` — исправлено отсутствие подсказки у «?» в NetConf Parser.

## 0.5.56

- **NetConf_Parser**: добавлен `lib/seaf_converter.py` (lite) для `network_visualizer` — исправлен `ModuleNotFoundError: lib.seaf_converter` при interactive terminal; полный SEAF YAML export по-прежнему не используется.

## 0.5.55

- **NetConf_Parser**: `patterns/` не параметризуется в `scriptEnvEditor` — всегда `python/vendor/netconf_parser/patterns/` относительно vendored-пакета в runtime.

## 0.5.54

- **python/vendor**: все vendored-пакеты только в `seaf-plugin-runtime/python/vendor/` (`yaml_schema_generator`, `netconf_parser`); удалён корневой `vendor/` и каталог `python/yaml_schema_generator_examples/`.
- **requirements**: единый `python/requirements.txt` (PyYAML + N2G); удалён `requirements-netconf.txt` и `extraRequirementsFiles` из `plugin.yaml`.

## 0.5.53

- **scriptEnvEditor paths**: пути `scriptEnvEditor` и `defaultsFile` — относительно каталога `conf/` (`scripts/...`, не `conf/scripts/...`); исправлен ENOENT `conf/conf/scripts` при загрузке схемы.
- **build-runtime**: в tarball добавляются `vendor/netconf_parser/` и `python/requirements-netconf.txt`.

## 0.5.52

- **scriptEnvEditor (optional)**: предзапускный диалог переменных для команд `main_menu.yaml`; схема во внешнем `conf/scripts/*.script_env.yaml` (обязателен при включении опции). IPC: `getSeafScriptEnvSchema`, `getSeafScriptEnvDefaults`, `saveSeafScriptEnvDefaults`.
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
- **`build-runtime.sh`**: в tar только production Python (`python/vendor`, scripts без `examples/`); `python/tests/` — только в репозитории.

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
