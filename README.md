# SEAF Plugin Runtime

Репозиторий runtime-дополнений SEAF для draw.io desktop.

## Runtime profiles

В проекте поддерживаются два профиля:

- `full runtime` (для разработки и релиза runtime):
  - `plugin/seaf.plugin.js`
  - `conf/plugin.yaml`
  - `python/scripts/events/*`
  - `python/scripts/examples/*` (локальные демо, не из поставочного `main_menu.yaml`)
  - `python/scripts/lib/*`
  - `runtime/version.json`
- `minimal runtime` (для встраивания в пакет drawio):
  - `minimal-runtime/seaf.plugin.js`
  - `minimal-runtime/seaf_plugin/conf/plugin.yaml`
  - `minimal-runtime/seaf_plugin/runtime/version.json`
  - `minimal-runtime/seaf_plugin/log/`

## Layout

- `plugin/seaf.plugin.js` - полный renderer plugin (меню, IPC, async, системный update); при эмиссии stencil `modify` для userObject с `schema` под `events.schemaPrefix` в `dataBefore`/`dataAfter` включается **`label`**; in-place смена подписи на схеме для таких ячеек также может эмитить `modify` (см. `CHANGELOG` 0.5.35).
- `conf/plugin.yaml` - core-конфигурация full runtime (общие настройки + includes).
- `conf/main_menu.yaml` - описание main menu команд.
- `conf/context_menu.yaml` - описание context menu правил (overrides по id).
- `conf/env.yaml` - редактируемые переменные runtime (пути и режимы для Python-части).
- `conf/events.yaml` - конфигурация auto-event processor (правила по `add`/`reparent`/`modify` и скрытые event handlers).
- `conf/stencils/libraries.json` - JSON-конфиг секций/библиотек фигур для окна `More Shapes`.
- `conf/stencils/*.xml` - файлы библиотек фигур в формате `mxlibrary`.
- `conf/stencils/config.yaml` - schema-based конфиг: layer-routing для auto add handlers, режим `edit_data` (`seaf|standard|both`), список `data_lock` защищённых атрибутов, опциональный `data_hidden` (атрибуты не показываются в SEAF Edit Data, но сохраняются при Apply), опциональный **`sync_title_with_label`** (по умолчанию включена синхронизация `title`↔`label` для всех `seaf.company.ta.*`, явное `false` отключает для схемы) и зарезервированный ключ `fields` для Phase 2 rich-виджетов.
- `conf/README.md` - документация формата `plugin.yaml`.
- `python/scripts/examples/*.py` - локальные демо-скрипты (не подключаются из поставочного `main_menu.yaml` / `events.yaml`).
- `python/scripts/events/*.py` - production event handlers (оркестраторы event-логики).
- `python/scripts/lib/*` - общие Python-модули, которые импортируются entrypoint-скриптами.
- `python/requirements.txt` - зависимости для автоматической установки в выбранный Python интерпретатор.
- `python/scripts/README.md` - документация контракта скриптов и прогресса.
- `python/scripts/lib/io/__init__.py` - общий helper layer для REQUEST/Response/progress в Python-скриптах.
- `runtime/version.json` - версия full runtime.
- `minimal-runtime/*` - минимальный bootstrap runtime для package drawio.
- `release/runtime/build-runtime.sh` - сборка full runtime (`release/out/stage` + `seaf-plugin-runtime.tar.gz`).
- `release/runtime/build-minimal-runtime.sh` - сборка minimal runtime (`release/out/minimal-stage`).
- `release/runtime/check-version-consistency.sh` - проверка согласованности версий full runtime.
- `../drawio-desktop/verify-seaf-minimal-stage.cjs` - fail-fast guard для desktop packaging (наличие minimal-stage и ключевых файлов).

## Packaging integration (drawio-desktop)

- `release/out/minimal-stage` используется в `drawio-desktop/electron-builder-*.json` как `extraResources -> seaf-runtime-default`.
- Перед `release-*` в `drawio-desktop/package.json` выполняется `verify-seaf-minimal-stage.cjs`; при неполном stage сборка останавливается.
- При первом старте drawio `ensureSeafRuntimeInstalled` копирует `seaf-runtime-default` в пользовательский каталог плагинов.
- Bootstrap пишет диагностические логи `[SEAF bootstrap] ...` с причинами раннего выхода (`defaults_plugin_missing`, `defaults_runtime_missing`) и итоговой верификацией.
- Ключи из `seaf_plugin/keys` копируются idempotent, для приватного ключа применяется `chmod 600` (best effort).

## Runtime location in draw.io desktop

Рабочий runtime находится в пользовательском каталоге плагинов, например:

- `~/.config/draw.io/plugins/seaf.plugin.js`
- `~/.config/draw.io/plugins/seaf_plugin/conf/*`
- `~/.config/draw.io/plugins/seaf_plugin/python/*` (для full runtime)
- `~/.config/draw.io/plugins/seaf_plugin/runtime/*`
- `~/.config/draw.io/plugins/seaf_plugin/keys/*`

## Update flow

1. Собрать full runtime:
   - `release/runtime/build-runtime.sh`
2. Опубликовать артефакт `seaf-plugin-runtime.tar.gz` в репозитории обновления.
3. В draw.io вызвать системный пункт меню `SEAF -> Обновить плагин`.
4. Main-process выполняет native update (`ssh_git`) как async-job с `pollSeafPluginJob` и фазами прогресса.
5. В UI показывается процентный индикатор выполнения update.
6. После успеха показывается финальное сообщение с требованием полного перезапуска приложения draw.io; автоматический `reload` отключен.
7. Для `seaf.plugin.js` используется cache-busting загрузка (`?v=<mtime>`), чтобы после перезапуска гарантированно подхватывался новый plugin entry.
8. В update-конфиге поддерживается `update.expectedMinVersion`; если скачанный asset старее минимума, обновление завершается ошибкой.
9. При `payload.status=already_up_to_date` update не переустанавливает runtime и UI показывает сообщение о том, что уже установлена актуальная версия (без restart-required текста).
10. Кастомные библиотеки фигур из `conf/stencils` доставляются тем же runtime update и становятся доступны в `More Shapes -> SEAF` без пересборки desktop-пакета.
11. Библиотека `SEAF_Р41` отображается в `More Shapes -> SEAF`, а после включения появляется отдельной палитрой в левой панели.
12. Для SEAF библиотек действует политика `respect_saved`: если draw.io уже сохранил пользовательский выбор библиотек, он приоритетнее `enabledByDefault`; `enabledByDefault` используется только как стартовый дефолт при первом выборе.
13. Названия кастомных SEAF секций/библиотек передаются как локализуемые объекты (`{main: ...}`), чтобы корректно отображаться через `EditorUi.getResource` без `UNDEFINED`.

## Menu order contract

Главное меню `SEAF` собирается **только** из composed config (`main_menu.yaml` и include-файлов):
- в меню попадают команды с `menu.main.enabled: true`;
- опциональные подменю задаются через `menu.main.submenu` и `menu.main.submenuTitle` (динамически, без хардкода имён в JS);
- подменю `examples` не поддерживается и игнорируется.

В коде renderer остаются только два системных пункта (не из YAML):
- `Обновить плагин` (всегда предпоследний),
- `SEAF Runtime v...` (всегда последний).

Контекстное меню — только команды с `menu.context.enabled: true` (например `Создать страницу` в `context_menu.yaml`); команды без `menu.main.enabled: true` в главное меню не попадают.

В поставке `main_menu.yaml` (помимо `Edit Config`): подменю **P41** (`Export` / `Import`) и **Tools** (`Script Env Demo`, `Net_Conf_Parser`).

### Опциональный `scriptEnvEditor`

- Предзапускный диалог переменных подключается **только** если в команде задан `scriptEnvEditor: scripts/<name>.script_env.yaml` (путь относительно `conf/`).
- Без `scriptEnvEditor` команда запускается как раньше (Export, Import и т.д.).
- Схема полей — во внешнем YAML (`conf/scripts/*.script_env.yaml` в дереве runtime), не inline в `main_menu.yaml`.
- Значения попадают в `payload.env`, `payload.scriptEnv` и `SEAF_ENV_*` (interactive terminal).
- `persist: scriptDefaults` — отдельный файл значений (`defaultsFile`); IPC `getSeafScriptEnvDefaults` / `saveSeafScriptEnvDefaults`.

### Tools → Net_Conf_Parser

- Пункт меню: `seafToolsNetConfParser`, `clientAction: interactiveTerminal`, `execution.mode: interactive_terminal`.
- Перед запуском — `scriptEnvEditor: scripts/net_conf_parser.script_env.yaml` (каталоги data/patterns/output).
- Launcher: `python/scripts/main_menu/net_conf_parser.py` → `python/vendor/netconf_parser/main_entry.py` (без SEAF-конвертации).
- Обновление upstream: [`scripts/vendor/sync-netconf-parser.sh`](scripts/vendor/sync-netconf-parser.sh) → `python/vendor/netconf_parser/`.
- Зависимости: единый [`python/requirements.txt`](python/requirements.txt) (PyYAML, N2G).

### Vendored Python (`python/vendor/`)

Все сторонние Python-библиотеки runtime размещаются **только** в `seaf-plugin-runtime/python/vendor/<package>/`.  
Не создавать `vendor/` в корне runtime и не дублировать пакеты в `python/scripts/`.  
Синхронизация внешних репозиториев — скрипты в `scripts/vendor/`.

## Edit Config menu

- В full runtime добавлена UI-команда `Edit Config` в меню `SEAF`.
- Поля формы задаются декларативно через composed config; источник `seafEditConfig` хранится в `conf/main_menu.yaml` и подключается через `conf/plugin.yaml`.
- Каждое поле явно связывается с `envKey` из `conf/env.yaml`.
- Поддерживаемые типы полей: `text`, `list`, `filePicker`, `checkbox`, `radio`.
- Текущий контракт полей: `companyPrefix`, `inputSeafFile`, `useSameOutputFile`, `outputSeafFile`, `pluginLogLevel`, `scriptLogLevel`, `pythonExecutable`.
- Для поля можно задать `helpText` и получить tooltip-иконку `?` рядом с его label в диалоге.
- `Input SEAF file` реализован как `filePicker`: открывает системный навигатор и сохраняет выбранный путь в `env.yaml`.
- Поле `Python executable` задает интерпретатор для запуска Python-команд и установки зависимостей.
- Поле принимает путь к бинарнику Python или путь к каталогу venv (`.venv`); для каталога runtime автоматически резолвит стандартные кандидаты (`bin/python`, `bin/python3`, `Scripts/python.exe`).
- Если `useSameOutputFile=true`, `outputSeafFile` автоматически копирует `inputSeafFile` и становится read-only/disabled.
- Зависимость описывается декларативно в `configEditor.fields` через `syncFrom` и `disableWhen`, без жесткой привязки к конкретным env-ключам в renderer-коде.
- При `Browse` для `inputSeafFile` поле `outputSeafFile` обновляется автоматически только при включенном `useSameOutputFile`.
- Автоматическая проверка Python-среды выполняется в основном пути без popup при успехе.
- При первом запуске runtime пытается найти системный Python (`python3`, затем `python`) и сохранить его в `env.yaml`.
- При ошибке настройки показывается popup с диагностикой и инструкцией указать корректный путь в `Edit Config`.
- Для окружений без sudo используется тот же путь: установить Python для пользователя и указать бинарник или каталог venv в `Edit Config -> Python executable`.
- При runtime update `env.yaml` обновляется инкрементально: локальные значения пользователя сохраняются, новые ключи из схемы/дефолта добавляются, пользовательские ключи не удаляются.
- Уровень логирования пользователя задается через `env.pluginLogLevel` (`none|info|debug`), а блок `logging.*` в `plugin.yaml` используется как технический fallback.
- Геометрия диалога рассчитывается по фактическому `scrollHeight` контейнера (без эвристического запаса), с симметричными отступами `8px` по всем сторонам.
- Footer формы использует `flex + gap`, а успешное сохранение выполняется без `success` popup (сообщения показываются только при ошибках).
- Кнопки `Cancel/Apply` и `Browse...` унифицированы с системным стилем draw.io (`geBtn`, `gePrimaryBtn`), как в стандартных диалогах (например, `Файл -> Печать`).
- Скролл ограничен только областью полей формы, поэтому футер с action-кнопками всегда остается доступным.
- В критических async-ветках включен fail-safe cleanup: polling ошибки обрабатываются явно, а interactive-terminal overlay завершается watchdog-ом при отсутствии terminal-closed события.
- Auto-event processor подписывается на изменения модели и формирует batch-события для стенсилов из `events.yaml` (типы `add` / `reparent` / `remove` / `modify` по модели; в Python уходят только операции, для которых в matched rule задан `handlers.<operation>`).
- `modify` обрабатывается только в сценарии `Edit Data -> Apply` и только при реальном изменении данных.
- Snapshot-сессия `EditDataSessionCoordinator` остаётся активной на время полного цикла Apply (включая промежуточные `CHANGE` и порядок `hideDialog` → `setValue` в штатном draw.io); завершение сессии выполняется отложенно при `ui.hideDialog` (`installEditDataSessionHideHook`), чтобы `modify` стабильно попадал в event pipeline и в `data_mirror`.
- Маршрутизация событий идет по `rules` из `events.yaml` в рамках `listId` и `schema`-паттернов: приоритет `exact > wildcard > all`.
- Для схем `seaf.company.ta.services.dcs` и `seaf.company.ta.services.dc_offices` в `events.yaml` заданы exact-правила: `add` → `seafStencilAllAdd`, `modify` → `seafStencilDataMirrorModify` (`python/scripts/events/data_mirror.py`); синхронизация зеркала по `schema+OID` на всех страницах текущей диаграммы выполняется на `modify`. События `remove` для этих схем в Python не маршрутизируются (нет `handlers.remove`).
- Синхронизация `data_mirror` выполняется атомарной UI-командой `mirrorDataByOidAtomic` (`precheck -> snapshot -> apply -> rollback`) с `suppressStencilEvents=true`, чтобы исключить рекурсивный цикл modify-событий.
- При ошибке синхронизации runtime возвращает `status=error`, пишет диагностику в лог и показывает пользователю только ошибку с деталями `pageName` и `OID`; success-уведомление не показывается.
- `rule.schema` поддерживает 3 режима: точное значение (например `seaf.company.ta.services.dc_azs`), wildcard с `*` (например `seaf.company.ta.*`) и `all`.
- `rule.execution` задает режим вызова handler: `sync` (ожидание ответа) или `async` (fire-and-forget с отдельным trace в логе).
- Event payload для Python handlers обогащен полями `objectId`, `geometry(x,y,width,height)` и `data` (атрибуты объекта по модели `Edit Data`).
- Для modify дополнительно передаются `valueBefore/valueAfter` и `dataBefore/dataAfter`.
- Решение «есть ли реальный modify» в `collectStencilEventsFromModelChange` принимается по изменению карты редактируемых атрибутов (`dataBefore` vs `dataAfter`, стабильная сортировка ключей) и при необходимости по прежнему снимку `sanitizeForIpc(value)`; в лог пишется `Stencil modify candidate evaluated` (`emitModify`, `diffKeys`). Перед вызовом Python пишется `Stencil event handler started` (`commandId`, `ruleId`, `txId`).
- В payload команд контекстного меню (`selection[]`) передаются те же ключевые поля: `objectId`, `geometry`, `data`.
- Контекстное меню поддерживает 2 scope-режима: `canvas` (клик по полю) и `stencil` (клик по стенсилу).
- В context menu попадают только команды с явным `menu.context.enabled: true`; main-only команды без context-конфига не отображаются.
- Для stencil-режима поддержан `schemaPattern` с event-совместимым matching (`exact|wildcard|all`); фильтрация работает как `scope AND target AND schemaPattern`.
- Для `add` событий назначение `OID` выполняется через event handlers (`events.yaml`): wildcard `seaf.company.ta.*` и/или explicit `add: seafStencilAllAdd` в exact-правилах (в т.ч. `dcs` / `dc_offices`) и обратный канал `Response.commands[]`; handler не перезаписывает непустой `OID` (второй `add` после `moveObjectsToLayer`/reparent не увеличивает sequence).
- Смена родителя в модели эмитится как **`reparent`** → `seafStencilReparent` (**без** OID): `events/reparent.py` пишет в лог **`reparentScriptFired`** и полный **`event`** из payload, а затем принудительно применяет schema-based layer-routing (`moveObjectsToLayer` с **`targetMode: "schemaCell"`** и `suppressStencilEvents: true`), чтобы каждая schema-ячейка оставалась в слое из `conf/stencils/config.yaml` без подъёма до group-root; при `reparent` слой переустанавливается на target даже если `currentLayerName` уже совпадает. Для строки в `seaf-plugin.log` нужны **`pluginLogLevel`** (payload) и **`scriptLogLevel`** (`env.yaml`) не ниже `info`.
- Формат OID: `<companyPrefix>.<schemaCode>.<sequence>`, где `companyPrefix` читается из `env.yaml`, `schemaCode` — две последние части `schema`, fallback: `unknown`.
- Область уникальности OID — строго текущая диаграмма; при import-коллизиях выполняется информирование пользователя таблицей конфликтов (`cellId`, `OID`, `schema`, `conflictWithCellId`, `conflictWithSchema`) без автодедупликации; детектор в `all_add` сравнивает конфликтующие ячейки **только в пределах одной страницы** (`payload.event.page.id` и карта `payload.event.index.objectPage`), чтобы пара «офис + зеркало на другой странице» с общим OID не считалась коллизией.
- В renderer добавлен in-memory индекс (`byObjectId`, `bySchema`, `byOid`, `objectPage` в снимке для Python) для выборок, валидации OID и групповых операций.
- В `Response.commands[]` поддержана команда `updateStencilData` для обновления атрибутов выбранного стенсила по `pageId/objectId`.
- Команда поддерживает режимы `merge` (частичное обновление) и `replace` (полная перезапись data-словаря).
- Добавлена команда `updateStencilDataBulk` для пакетного обновления нескольких объектов в одной транзакции `beginUpdate/endUpdate`.
- Добавлены batch API-команды `bulkUpdateByIds` и `bulkUpdateByCriteria` (поддержка `dryRun`, отчет `updated/skipped/errors/conflicts`).
- Добавлена команда `ensureLayer` (create-or-get): находит слой по имени на странице или создает новый, делает его видимым и возвращает `layerId`.
- Добавлена команда `moveObjectsToLayer`: create-or-get слоя + перенос указанных объектов в слой через `graph.moveCells(...)` (в т.ч. для `add` и mirror-потоков); опционально **`targetMode: "schemaCell"`** — перенос по конкретной ячейке из `objectIds` (инвариант `schema → layer` при вложенности); без **`targetMode`** сохраняется legacy-подъём до group-root. Для ячеек, уже находящихся на слое с тем же именем, перенос не выполняется (и Python layer-routing не включает их в `objectIds`, если в item задан `currentLayerName` и не включён принудительный режим `reparent`).
- Добавлена команда `moveLayerUnderLayer`: перенос mxCell одного слоя под другой (вложенные слои); **не** вызывается из auto-handler **`reparent`** (слой группы не перестраивается при перетаскивании стенсила).
- Возвращаемые значения UI-команд агрегируются в `result.payload.uiCommandResults`.
- В event pipeline (`source=stencil_event_processor`) ответы Python handlers теперь также исполняют `Response.commands[]` через общий UI executor, поэтому `ensureLayer`/`updateStencilData` применяются не только в menu/system сценариях.
- Для ошибок event pipeline действует явная политика видимости: каждая ошибка пишется в лог, а popup показывается только если handler вернул `payload.errorPolicy.userVisible=true`.
- Исправлен extraction `add`-событий для grouped stencils: если root group не содержит `schema`, runtime использует дочерние schema-bearing ячейки для routing, чтобы layer-routing/`moveObjectsToLayer` срабатывал стабильно.
- Для grouped stencils без **`targetMode`** исполнитель по-прежнему может поднимать цель до group-root (legacy); Python layer-routing для **`all_add`**, **`reparent`** и mirror **`add_page`** передаёт **`targetMode: "schemaCell"`**, чтобы не ломать структуру вложенных schema-объектов при переносе на слой.
- Примерные Python handlers логируют извлеченные поля через `stderr`; поддержан протокол `SEAF_ERROR`/`SEAF_INFO`/`SEAF_LOG`.
- В `seaf-plugin.log` записи получают префикс `[PYTHON][script.py][ERROR|INFO]`; `INFO` пишется только при `pluginLogLevel in {info, debug, trace}` (из `REQUEST.payload.env/arguments`), `ERROR` — всегда.
- Значения `handlers` в `events.yaml` (например `seafStencilDataMirrorModify`) — это command id composed config; реальные скрипты задаются в `python/scripts/events/*.py` через скрытые `commands[]` в `events.yaml`.
- Для `seafStencilAllAdd` используется production orchestrator `python/scripts/events/all_add.py`; OID-алгоритм вынесен в библиотеку `python/scripts/lib/oid/*`, layer-routing работает по `conf/stencils/config.yaml` (`schema -> layer`), сервисная event-логика — в `python/scripts/lib/events/*`, а проверка уровней и emit logging-сообщений (`SEAF_INFO/SEAF_ERROR`) централизованы в `python/scripts/lib/logging/*`.
- Детальная спецификация конфига и mapping `handler id -> command -> script` описаны в `conf/README.md`, а подробное поведение production event-скриптов — в `python/scripts/README.md` и в исходниках `python/scripts/events/`.

## SEAF Edit Data dialog (data_lock / data_hidden)

- Для P41-стенсилов штатный диалог draw.io «Edit Data» заменяется собственным `SeafEditDataDialog`, реализованным в `plugin/seaf.plugin.js`.
- Каноническая точка маршрутизации — переопределение `EditorUi.prototype.showDataDialog` (`installEditDataDialogRouter`). Это покрывает все пути одинаково: правое меню → штатный action `editData`, кнопка «Edit Data» в Format panel и горячая клавиша Ctrl+M.
- Контекстное меню получает отдельный явный пункт «Редактировать данные (SEAF)…» (action `seafEditData`):
  - `mode=seaf` — штатный `editData` скрыт через `Menus.hiddenMenuItems` (только на время `createPopupMenu`), показывается только SEAF-пункт;
  - `mode=both` — оба пункта доступны и enabled (ровно один штатный `Edit Data` + один `Редактировать данные (SEAF)…`);
  - `mode=standard` — штатный `Edit Data` остается enabled, `Редактировать данные (SEAF)…` показывается disabled.
  - В любом режиме plugin не добавляет стандартный `Edit Data` вручную: единственный источник standard-пункта — базовый draw.io popup.
- Для grouped stencil-элементов mode для RMB/`seafEditData` теперь вычисляется не только по кликнутой дочерней ячейке, но и по ближайшему родителю со `schema`; это устраняет ситуацию, когда пункт SEAF не показывался из-за клика в служебный внутренний `mxCell`.
- Реинжиниринг v2: Edit Data логика декомпозирована на слои `EditDataModeEngine` (policy/intent), `ContextMenuPresenter` (отрисовка RMB), `EditDataDialogRouter` (маршрутизация entry-points) и `EditDataSessionCoordinator` (явный lifecycle snapshot-сессии).
- Завершение snapshot-сессии привязано к `ui.hideDialog` (отложенный `reset` через `setTimeout(0)` в `installEditDataSessionHideHook`), а не к каждому `mxEvent.CHANGE` модели — иначе промежуточные изменения или штатный порядок Apply обнуляли бы сессию до `setValue` и `modify` не формировался бы (в т.ч. для `data_mirror` по OID).
- В `SeafEditDataDialog` Apply снимок «до» для `modify` берётся по **целевой ячейке** из модели (`captureEditDataBeforeForCellIds`), а не по текущему selection: после `hideDialog` выделение часто пустое, из‑за чего прежний `captureEditDataBeforeSnapshots` не находил `before`-состояние; построение `clone` из полей формы выполняется до закрытия диалога.
- Конфигурация — `conf/stencils/config.yaml`: `schemas.<schema>.edit_data` (`seaf|standard|both`), `schemas.<schema>.data_lock` (список защищённых атрибутов), опционально `schemas.<schema>.data_hidden` (атрибуты скрыты из формы, в XML не трогаются при Apply).
- Fallback policy: если `conf/stencils/config.yaml` не загрузился (битый файл, отсутствует, ошибка IPC) или схема не описана в config, для любой schema, начинающейся на `seaf.`, plugin всё равно использует `mode=seaf` и `data_lock=[OID, schema]`. Не-`seaf.` схемы по-прежнему получают штатный диалог. Для `data_hidden` prefix-fallback **нет**: без записи в config список скрытых пустой.
- Защита `data_lock` (по умолчанию `[OID, schema]` для каждой schema, перечисленной в config или попавшей под seaf-prefix fallback) — поле дизейблится, кнопка «X» удаления отсутствует, добавление атрибута с защищённым именем блокируется alert'ом. `data_hidden` задаётся только явно в YAML для нужных schema (пример: `link` скрыт для `dcs` и `dc_offices`).
- Apply SEAF-диалога вызывает `graph.getModel().setValue(cell, clonedXml)`, поэтому существующий event processor (`collectStencilEventsFromModelChange`) ловит `modify`-события без изменений.
- Диагностика: при загрузке `stencils/config.yaml`, установке router'а и формировании RMB (`resolvedMode`, `resolvedCell`, `statePresent`, `isEditable`) пишутся `info`/`debug`-сообщения в `seaf-plugin.log` (при `pluginLogLevel=info|debug`; при `pluginLogLevel=none` эти записи не выводятся).
- Технически `stencils/config.yaml` читается через typed IPC action `getSeafStencilConfig` (main-process `seafPluginService`); legacy `readSeafPluginFile` остается как backup path под feature flag на миграционный период.
- Feature flags для поэтапного rollout/rollback (через `env.yaml`): `featureIntentEngineV2`, `featureMenuPresenterV2`, `featureIpcStencilConfigV2`, `featureSessionCoordinatorV2`.
- Матрица `standard|both|seaf` применяется только для `policySource=config-hit` (schema присутствует в `conf/stencils/config.yaml`); для остальных объектов plugin не вмешивается в standard item.
- Phase 2 (зарезервировано): `schemas.<schema>.fields.<attr>.widget` (`text|textarea|combo|radio|checkbox`) — rich-виджеты внутри того же диалога без изменений в маршрутизации/menu hooks.

## Context menu: Create Page

- Контекстная команда `Создать страницу` выполняется Python-скриптом `python/scripts/context_menu/add_page.py`.
- Источник стенсила берется приоритетно из `payload.contextObject` (snapshot RMB-клика), fallback — `payload.selection[0]`.
- Имя новой страницы берется из `contextObject.data.title` (fallback `selection[0].data.title`); перед созданием выполняются проверки:
  - `title` не пустой;
  - в `payload.pages` нет страницы с тем же именем.
- После успешного создания страницы скрипт возвращает UI-команды:
  - `createPage` (штатный draw.io `ui.createPage` + `ui.insertPage`);
  - `setCellLinkToPage` (устанавливает `data:page/id,<id>` в исходный стенсил через `graph.setLinkForCell`).
- `createPage` выполняется с `selectCreated=false`, чтобы линк в исходном стенсиле ставился в стабильном контексте текущей страницы.
- Runtime дополнительно восстанавливает исходную страницу после `ui.insertPage(...)`, если build draw.io автоматически переключил фокус на созданную страницу несмотря на `selectCreated=false`.
- `setCellLinkToPage` исполняется только с валидным `targetPageId` (полученным из результата `createPage` в `uiCommandResults`), без fallback-поиска страницы по title.
- Если `createPage` не вернул `pageId` или `setCellLinkToPage` завершился не `updated` (`missing_target`/`cell_not_found`), сценарий считается ошибкой, а не silent-skip.
- После успешной связки `createPage + setCellLinkToPage` runtime переключается на созданную страницу и добавляет mirror-элемент из библиотеки `SEAF_Р41`, если для `sourceSchema` в `conf/stencils/config.yaml` задан `schemas.<schema>.mirror`.
- Вставка mirror выполняется новой UI-командой `insertStencilFromP41ByTitle` (по `mirrorTitle`, позиция top-left), далее выполняются:
  - `updateStencilDataBulk` (полный copy-all данных source-объекта в новый mirror-объект);
  - `moveObjectsToLayer` (с заранее вычисленным `layerName` из общего Python helper `lib/events/layer_routing.py`, который также используется в `all_add`).
- Primary для `updateStencilDataBulk` — первый вставленный объект (обход в ширину), у которого `schema` в данных ячейки совпадает с `sourceSchema` родителя; при отсутствии такого объекта вставка mirror считается неуспешной (`mirror_not_found`).
- Для mirror используется Python lookup `title -> schema` по библиотеке `conf/stencils/Р41.xml`; если schema или layer не резолвятся, `add_page.py` возвращает `status=error` и не отправляет `moveObjectsToLayer` с пустым `layerName`.
- Если `mirror` не найден в библиотеке `SEAF_Р41` или вставка/синхронизация/назначение слоя завершились неуспешно, сценарий переводится в `status=error`.
- Пользовательское сообщение для ошибки вставки mirror: `Не возможно добавить элемент <mirror> на страницу`; расширенная диагностика (`mirrorTitle`, `sourceObjectId`, `sourceSchema`, `pageId`, `reason/error`) пишется в `seaf-plugin.log`.
- После шагов create/link/mirror (и при отсутствии mirror — после create/link) сценарий `add_page` добавляет финальную UI-команду `assignEmptyOidOnPage`: на созданной странице обходятся все объекты, у которых в данных есть атрибут `OID` и значение пустое; им назначаются уникальные OID по тому же алгоритму, что в `events/all_add.py` (`companyPrefix` + `schemaCode` + sequence). Результат `updated|noop` валидируется в `validateSeafAddPageUiResults`.
- Скрипт не отправляет отдельные `showMessage` для `success/error`; пользовательские сообщения отображаются единообразно через общий runtime-обработчик статуса команды.

## Interactive terminal command

- В full runtime добавлен demo-пункт `SEAF Interactive Terminal Demo`.
- Команда использует `clientAction: interactiveTerminal` и `execution.mode: interactive_terminal`.
- draw.io desktop открывает отдельное modal terminal-окно поверх editor и блокирует основной экран overlay-механизмом draw.io до закрытия terminal-окна.
- Python-скрипт запускается в настоящем TTY через `node-pty`, поэтому доступны интерактивные сценарии с `print(...)`, `input(...)` и live stdout/stderr.
- При успешном завершении процесса terminal-окно остается открытым (пользователь закрывает вручную).
- При аварийном завершении (ненулевой `exitCode`) terminal-окно закрывается автоматически, overlay снимается, и в editor показывается сообщение об ошибке.

## Minimal/full parity contract

- `minimal-runtime` является усеченной версией `full runtime` и содержит только bootstrap/update функциональность.
- Общее update-поведение должно быть синхронным между `minimal-runtime/seaf.plugin.js` и `plugin/seaf.plugin.js`:
  - одинаковые статусы результата (`updated`, `already_up_to_date`, `error`);
  - одинаковая семантика сообщений пользователю;
  - одинаковая логика завершения прогресса (100% -> закрытие индикатора -> сообщение).

## Stability invariants (do not break)

- `env.yaml` merge policy: preserve existing values, add missing keys, keep unknown keys.
- Custom More Shapes titles contract: runtime always passes localizable objects (`{main: ...}`), never plain string keys.
- Visibility policy contract: `respect_saved` is always higher priority than `enabledByDefault`.
- Init pipeline contract: failures in non-critical init steps must be logged and must not break other plugin subsystems.
- Update/rollback contract: failed update/apply never leaves a partially switched runtime state.

## Pre-release checklist

- Run `release/runtime/build-runtime.sh`.
- Run `node ../drawio-desktop/scripts/seaf-stability-smoke.mjs`.
- Run contract checks for recent runtime flows:
  - `node ../drawio-desktop/scripts/test-edit-data-unit.mjs`
  - `node ../drawio-desktop/scripts/test-edit-data-menu-integration.mjs`
  - `node ../drawio-desktop/scripts/test-edit-data-ipc-contract.mjs`
  - `node ../drawio-desktop/scripts/test-add-page-script.mjs`
- (Optional aggregate) run `node ../drawio-desktop/scripts/legacy-removal-gate.mjs` to ensure `docs/validation-status.json` contains all required green checks.
- Manual UI smoke: `More Shapes -> SEAF -> SEAF_Р41` renders without `undefined`.
- Manual UI smoke: saved library selection is respected over defaults.
- Runtime update smoke: `env.yaml` keeps user values after update.

## Versioning notes

- Для full runtime версия синхронизируется между:
  - `plugin/seaf.plugin.js` (comment `Runtime script version`)
  - `conf/plugin.yaml` (`plugin.runtimeVersion`)
  - `runtime/version.json` (`version`)
- Для minimal runtime версия синхронизируется между:
  - `minimal-runtime/seaf.plugin.js`
  - `minimal-runtime/seaf_plugin/conf/plugin.yaml`
  - `minimal-runtime/seaf_plugin/runtime/version.json`
