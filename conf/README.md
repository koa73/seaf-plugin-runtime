# SEAF runtime configuration (modular layout)

Этот каталог хранит конфигурацию runtime в модульном формате.

## Файлы конфигурации

| Файл | Назначение |
|---|---|
| `plugin.yaml` | Общие настройки плагина и точки подключения include-файлов |
| `env.yaml` | Пользовательские настройки (редактируются через `SEAF -> Edit Config`) |
| `main_menu.yaml` | Описание команд/пунктов главного меню |
| `context_menu.yaml` | Описание правил контекстного меню |
| `events.yaml` | Правила event processor и скрытые event handlers (`add/remove/modify`) |
| `stencils/config.yaml` | Метаданные стенсилов: `layer`, `edit_data`, `data_lock`, опционально `data_hidden` (и резерв `fields`) |

---

## 1) `plugin.yaml` (core config)

`plugin.yaml` больше не хранит полный монолит `commands[]`.  
Он задает общие секции и include-файлы:

- `plugin.*`
- `python.*`
- `logging.*`
- `update.*`
- `events.configFile`
- `includes.menus.main`
- `includes.menus.context`
- `includes.events.commands`

### Таблица параметров `plugin.yaml`

| Параметр | Тип | Назначение | Default/Priority |
|---|---|---|---|
| `version` | `number` | Версия схемы core-конфига | `1` |
| `plugin.id` | `string` | Идентификатор runtime | required |
| `plugin.name` | `string` | Имя плагина | required |
| `plugin.description` | `string` | Описание плагина | optional |
| `plugin.runtimeVersion` | `string` | Fallback runtime version для UI | required |
| `python.executable` | `string` | Базовый Python (fallback) | `python3` |
| `python.requirementsFile` | `string` | Путь к requirements | `../python/requirements.txt` |
| `python.requiredModules` | `array<string>` | Preflight import check | `["lib.io"]` |
| `python.scriptsDir` | `string` | Корневой каталог скриптов | `../python/scripts` |
| `logging.level` | `string` | Fallback уровень логов (`debug/info/warn/error`) | `info` |
| `logging.extendedDebug` | `boolean` | Расширенная детализация логов | `false` |
| `logging.includePayload` | `boolean` | Логировать payload | `false` |
| `logging.output` | `string` | `console/file/both` | `console` |
| `logging.filePath` | `string` | Путь к лог-файлу | optional |
| `update.*` | `object` | Настройки runtime update | required для update |
| `events.configFile` | `string` | Файл event-правил | `events.yaml` |
| `includes.menus.main` | `string` | Include для main menu commands | `main_menu.yaml` |
| `includes.menus.context` | `string` | Include для context menu overrides | `context_menu.yaml` |
| `includes.events.commands` | `string` | Include для скрытых event commands | `events.yaml` |

---

## 2) `env.yaml` (user config)

`env.yaml` хранит пользовательские значения из `Edit Config`.

### Контракт приоритетов

1. Значения пользователя из `env.yaml` имеют приоритет над пересекающимися defaults.
2. Если пользовательское значение отсутствует, используется default из конфигурации.
3. При runtime update действует инкрементальный merge:
   - existing keys/values сохраняются;
   - добавляются только отсутствующие ключи;
   - неизвестные пользовательские ключи не удаляются.

### Типовые поля

| Параметр | Тип | Назначение |
|---|---|---|
| `companyPrefix` | `string` | Префикс для именования объектов |
| `inputSeafFile` | `string` | Входной файл |
| `useSameOutputFile` | `boolean` | Использовать входной файл как выходной |
| `outputSeafFile` | `string` | Выходной файл |
| `pluginLogLevel` | `string` | `none/info/debug` (переопределяет `logging.level`) |
| `scriptLogLevel` | `string` | Включает INFO-логирование сообщений Python скриптов (`none/info`) |
| `pythonExecutable` | `string` | Путь к Python-бинарнику или каталогу `.venv` |

---

## 3) `main_menu.yaml`

Содержит полный список команд main menu (`commands[]`) с:
- `id`, `title`, `script`, `execution`, `input`, `output`, `postActions`;
- `menu.main.*`;
- при необходимости `clientAction` и `configEditor`;
- опционально `scriptEnvEditor` — ссылка на файл схемы предзапускного диалога переменных.

Именно здесь хранится `seafEditConfig` schema для `Edit Config`.

### Опциональный `scriptEnvEditor` (предзапускная параметризация)

Предзапускное окно переменных **необязательно**. Команды без `scriptEnvEditor` (Export, Import и т.д.) запускаются без дополнительного диалога.

Если `scriptEnvEditor` задан, **обязателен** внешний файл схемы под `conf/` (относительный путь от каталога `conf` runtime):

```yaml
scriptEnvEditor: conf/scripts/my_command.script_env.yaml
```

Допустима объектная форма:

```yaml
scriptEnvEditor:
  configFile: conf/scripts/my_command.script_env.yaml
```

Inline-поля `fields` в `main_menu.yaml` **не поддерживаются** — только ссылка на файл.

Файл `conf/scripts/*.script_env.yaml` описывает UI (как `configEditor.fields`):

| Поле | Назначение |
|---|---|
| `title` | Заголовок диалога |
| `persist` | `none` (только текущий запуск), `global` (запись в `env.yaml`), `scriptDefaults` (отдельный YAML значений) |
| `defaultsFile` | Путь к YAML значений по умолчанию (при `persist: scriptDefaults`) |
| `mergeGlobalEnv` | Подставить `env.yaml` как baseline (`true` по умолчанию) |
| `fields[]` | `label`, `envKey`, `inputMethod` (`text`, `list`, `radio`, `checkbox`, `filePicker`), `required`, `options`, `fileDialog`, `helpText`, `syncFrom`, `disableWhen` |

При Run значения попадают в `payload.env` и `SEAF_ENV_*` (interactive terminal). При Cancel запуск прерывается.

### Поля `menu.main.*`

| Параметр | Тип | Назначение |
|---|---|---|
| `menu.main.enabled` | `boolean` | Показывать команду в главном меню `SEAF` (`true` — только явное включение) |
| `menu.main.section` | `string` | Секция верхнего меню (обычно `seaf`) |
| `menu.main.sectionTitle` | `string` | Заголовок секции |
| `menu.main.submenu` | `string` | Идентификатор подменю (например `p41`, `tools`); без поля — пункт в корне `SEAF` |
| `menu.main.submenuTitle` | `string` | Подпись подменю в UI (если не задана — используется `submenu`) |

Подменю `examples` не поддерживается. Имена подменю и состав пунктов задаются только конфигом; в JS нет жёстко прошитых `P41` / `Tools` / `Examples`.

**Export (`seafP41Export`):** в `input` задайте `includeSchemaObjects: true` (и опционально `includePages: true`). Renderer передаёт `payload.schemaObjects[]`. Для progress bar — async + indicator (как у Import):
- `execution.mode: async`
- `indicator.enabled: true`, `indicator.type: percent`
- Python emits `SEAF_PROGRESS` (`emit_progress` в `export.py`).
Выходной путь в `outputSeafFile` (или `inputSeafFile` при `useSameOutputFile`):
- **файл** (`.yaml` / `.json`) — один файл со всей картой `{schema: {OID: attrs}}` (YAML по умолчанию);
- **каталог** (существующий каталог, путь без расширения или с `/` на конце) — по одному `.yaml` на schema; имя файла = последние два компонента schema, например `seaf.company.ta.services.network_segments` → `services.network_segments.yaml`, содержимое: `{OID: attrs}`.

**Import (`seafP41Import`):**
- источник только `inputSeafFile` (может быть YAML-файлом или каталогом);
- если каталог, Python скрипт делает рекурсивный поиск `*.yaml/*.yml`;
- для корректного сопоставления с диаграммой задайте `input.includeSchemaObjects: true` (и `includePages: true` для расширенной диагностики); в payload передаётся `schemaObjects[].data` и `schemaObjects[].linkedPageId` (из graph-link) — для `title`/`label` sync и переименования связанной страницы (`dcs`/`dc_offices`) через `renameLinkedPage`.
- для progress bar используйте async режим с indicator:
  - `execution.mode: async`
  - `indicator.enabled: true`, `indicator.type: percent`
  - Python emits `SEAF_PROGRESS`.

Пример (P41 / Tools в `main_menu.yaml`):

```yaml
  - id: seafP41Export
    title: Export
    script: main_menu/export.py
    menu:
      main:
        enabled: true
        submenu: p41
        submenuTitle: P41
  - id: seafToolsNetConfParser
    title: Net_Conf_Parser
    clientAction: interactiveTerminal
    script: main_menu/net_conf_parser.py
    execution:
      mode: interactive_terminal
    scriptEnvEditor: conf/scripts/net_conf_parser.script_env.yaml
    menu:
      main:
        enabled: true
        submenu: tools
        submenuTitle: Tools
```

---

## 4) `context_menu.yaml`

Содержит `commands[]` для контекстного меню (полные команды или overrides по `id`).

Для context-only команд (например `seafAddPage` / «Создать страницу») задайте:
- `menu.context.enabled: true` и правила `scope` / `schemaPattern` / `target`;
- `menu.main.enabled: false` — чтобы команда **не** попала в главное меню `SEAF`.

Пример идеи для split-конфигурации:
- в `main_menu.yaml` — полное описание команды с `menu.main.enabled: true`;
- в `context_menu.yaml` — override `menu.context.*` по тому же `id`.

Compose-loader объединяет их в финальный `commands[]`.

---

## 5) `events.yaml`

`events.yaml` объединяет:
1) event routing rules;
2) скрытые `commands[]` для Python handlers.

### Поля event routing

| Параметр | Тип | Назначение |
|---|---|---|
| `version` | `number` | Версия схемы events |
| `enabled` | `boolean` | Включение event processor |
| `schemaPrefix` | `string` | Ранний фильтр (обычно `seaf.`) |
| `defaultRuleId` | `string` | Fallback rule id |
| `stencilLists[]` | `array<object>` | Списки библиотек стенсилов (по `id`) |
| `rules[]` | `array<object>` | Правила маршрутизации по `listId` и `schema` |
| `rules[].id` | `string` | Идентификатор правила |
| `rules[].listId` | `string` | К какому stencil list применяется правило |
| `rules[].schema` | `string` | `exact`, wildcard с `*`, или `all` |
| `rules[].execution` | `string` | Режим запуска handler: `sync` или `async` |
| `rules[].handlers.add` | `string` | command id для `add` |
| `rules[].handlers.reparent` | `string` | command id для `reparent` (смена родителя / слоя, без `all_add`) |
| `rules[].handlers.remove` | `string` | command id для `remove` |
| `rules[].handlers.modify` | `string` | command id для `modify` |

### Семантика `rules[].schema`

- `seaf.company.ta.services.dc_azs` — exact match только для одного schema.
- `seaf.company.ta.*` — wildcard match для группы schema.
- `all` — правило на все стенсилы выбранного `listId`.
- Смена родителя в модели (`mxChildChange` с непустым `previous` и новым `parent`) классифицируется как **`operation: reparent`**, а не `add`: маршрут `handlers.reparent` → `seafStencilReparent` → `events/reparent.py`. Handler **без** OID: пишет в лог полный `payload.event` (`reparentScriptFired`) и возвращает **`Response.commands`** с `moveObjectsToLayer` (**`targetMode: "schemaCell"`**, `suppressStencilEvents: true`) для принудительного соблюдения `schema → layer`. Слой группы из config также задаётся на **`add`** (`all_add`). Реальная вставка — `operation: add` → `seafStencilAllAdd`.
- Для auto-назначения `OID` при `add` используется `seafStencilAllAdd` из wildcard `seaf.company.ta.*` или из exact-правил, где явно указан `add` (в т.ч. `exact_dcs_data_mirror` / `exact_dc_offices_data_mirror`).
- Повторный stencil `add` для того же `objectId` (например после reparent / `moveObjectsToLayer`) не должен менять уже назначенный OID: `events/all_add.py` заполняет `OID` только если в `data` ключ отсутствует или значение пустое.
- В payload каждого stencil-item передаётся `currentLayerName` (имя слоя-контейнера в модели). Для `add` Python layer-routing не добавляет в `Response.commands` команду `moveObjectsToLayer` для ячеек, у которых `currentLayerName` уже совпадает с целевым слоем из `schemas.<schema>.layer` (повторный `add` после переноса не дублирует привязку); команды слоя из Python задают **`targetMode: "schemaCell"`** для переноса именно schema-ячейки.

Приоритет матчинга внутри list:
1. exact
2. wildcard
3. `schema: all` — если в конфиге присутствует такое правило, оно применяется после wildcard как наименее специфичное.

### Что такое handler id

`seafStencilDataMirrorModify` — это **command id**, а не метод.

Маршрут:
1. `events.yaml.rules[].handlers.modify` -> `seafStencilDataMirrorModify`
2. compose config ищет command с `id=seafStencilDataMirrorModify`
3. command указывает `script: events/data_mirror.py`
4. service runner запускает этот Python script

---

## 6) Handler mapping (event -> command -> script)

| Handler id | Script |
|---|---|
| `seafStencilAllAdd` | `events/all_add.py` |
| `seafStencilReparent` | `events/reparent.py` |
| `seafStencilDataMirrorModify` | `events/data_mirror.py` |
| `seafStencilLabelTitleSync` | `events/label_title.py` |

Правила `exact_dcs_data_mirror` и `exact_dc_offices_data_mirror`: `add` → `seafStencilAllAdd`, `modify` → `seafStencilDataMirrorModify` для схем:
- `seaf.company.ta.services.dcs`
- `seaf.company.ta.services.dc_offices`

Правило `wildcard_ta_services` (`seaf.company.ta.*`): `add` → `seafStencilAllAdd`, `reparent` → `seafStencilReparent`, `modify` → `seafStencilLabelTitleSync` (для схем с exact `modify` выше матчится только exact-правило).

Логика `modify` (`seafStencilDataMirrorModify` / `data_mirror.py`):
- выравнивание **`title`/`label`** в копии `dataAfter` перед построением patch (при конфликте в одной транзакции побеждает **title**; отключение: `schemas.<schema>.sync_title_with_label: false` в `stencils/config.yaml`);
- синхронизация атрибутов по `schema+OID` на всех страницах текущей диаграммы;
- служебные ключи `OID` и `schema` не переписываются;
- успех не показывает popup, ошибка возвращает `status=error` c деталями `pageName` и `OID`.

Renderer при эмиссии `modify`: для ячеек с `schema` под `events.schemaPrefix` в `items[].dataBefore` / `dataAfter` участвует и **`label`** (видимая подпись userObject), чтобы Python-handlers могли согласовать `title`↔`label`; правка подписи на схеме без открытого Edit Data также может дать `modify` (см. `CHANGELOG` 0.5.35).

Логика `modify` (`seafStencilLabelTitleSync` / `label_title.py`):
- при необходимости дописывает парное поле на той же ячейке через **`updateStencilDataBulk`** с **`suppressStencilEvents: true`**;
- если правки не нужны, возвращает пустой `commands[]`.

Правило `exact_dc_azs`: `add` → `seafStencilAllAdd`, `reparent` → `seafStencilReparent` (без Python handler для `remove` — события удаления не маршрутизируются).

---

## 7) Logging levels and effective priority

Фактический уровень логирования определяется так:
1. база из `plugin.yaml -> logging.*`;
2. пользовательский override из `env.yaml -> pluginLogLevel`.

`pluginLogLevel`:
- `none` -> только `error` в console;
- `info` -> `info/warn/error`;
- `debug` -> максимум детализации.

### Где смотреть лог

- Full runtime: `~/.config/draw.io/plugins/seaf_plugin/logs/seaf-plugin.log`
- Minimal runtime bootstrap: `~/.config/draw.io/plugins/seaf_plugin/log/seaf-plugin.log`

Если event-трейсы не видны:
1. проверьте, что активен full runtime (есть event listener),
2. проверьте эффективный `pluginLogLevel` из `env.yaml` (он приоритетнее `plugin.yaml`),
3. перезапустите draw.io после обновления runtime.

### Логи из Python скриптов

- Main-process поддерживает stderr-протокол:
  - `SEAF_ERROR <message>` — всегда пишется в `seaf-plugin.log` как error;
  - `SEAF_INFO <message>` — пишется только если `env.scriptLogLevel=info`;
  - `SEAF_LOG {\"level\":\"error|info\",\"message\":\"...\",\"data\":...}`.
- В log сообщение получает префикс:
  - `[PYTHON][<script_name>][ERROR] ...`
  - `[PYTHON][<script_name>][INFO] ...`

---

## 8) Примеры конфигов

### `plugin.yaml` (короткий)

```yaml
version: 1
plugin:
  id: seaf_plugin
  runtimeVersion: 0.3.6
events:
  configFile: events.yaml
includes:
  menus:
    main: main_menu.yaml
    context: context_menu.yaml
  events:
    commands: events.yaml
```

### `events.yaml` (короткий)

```yaml
version: 1
enabled: true
schemaPrefix: "seaf."
defaultRuleId: "wildcard_ta_services"
stencilLists:
  - id: SEAF_Р41
rules:
  - id: exact_dc_azs
    listId: SEAF_Р41
    schema: "seaf.company.ta.services.dc_azs"
    execution: sync
    handlers:
      add: seafStencilAllAdd
      reparent: seafStencilReparent
  - id: exact_dcs_data_mirror
    listId: SEAF_Р41
    schema: "seaf.company.ta.services.dcs"
    execution: sync
    handlers:
      add: seafStencilAllAdd
      reparent: seafStencilReparent
      modify: seafStencilDataMirrorModify
  - id: wildcard_ta_services
    listId: SEAF_Р41
    schema: "seaf.company.ta.*"
    execution: sync
    handlers:
      add: seafStencilAllAdd
      reparent: seafStencilReparent
```

## Диагностика matching

- `item.schema` извлекается в первую очередь из `cell.value.schema`, затем fallback на `style.shape`.
- `item.data` формируется из атрибутов объекта (`cell.value`) по модели `Edit Data`.
- `item.objectId` дублирует `item.id` для унифицированного контракта Python handlers.
- `item.geometry` передается в нормализованном виде: `x`, `y`, `width`, `height`.
- Если `schema` пустой, событие фильтруется с reason `schema_missing`.
- Для `add` изменений в групповых stencil-элементах processor дополнительно обходит дочерние ячейки и строит события по узлам, где `schema` пришел из `cell.value.schema` (object-узлы). Это предотвращает ошибочную привязку к служебным `mxCell` внутри группы.
- Для wildcard используйте `*`, например `seaf.company.ta.*`.

### Порядок роутинга

1. Проверка `schemaPrefix` (обычно `seaf.`).
2. Поиск rules в рамках `listId`.
3. Match по `schema` с приоритетом `exact > wildcard > all`.
4. Если нет handler для eventType -> dispatch пропускается.
5. `execution: sync` ждет ответ, `execution: async` отправляет fire-and-forget и пишет отдельный trace.

### Видимость ошибок event handlers

- Любая ошибка handler всегда логируется в `seaf-plugin.log`.
- Для `source=stencil_event_processor` popup пользователю показывается только если в ответе есть
  `payload.errorPolicy.userVisible=true`.
- При отсутствии этого флага ошибка остается технической (`log-only`) и не поднимается как всплывающее окно.

### Важное уточнение по порядку правил

- Выбор идет не по принципу "первое совпавшее сверху", а по **специфичности**:
  - `exact` имеет приоритет над `wildcard`,
  - `wildcard` имеет приоритет над `all`.
- Для одного события выбирается только **одно** правило (без повторного dispatch по нескольким rules).
- Если совпали несколько правил **одинаковой специфичности** (например, два wildcard), применяется то, которое раньше в `rules[]`.
- Рекомендуемый порядок в `rules[]` для читаемости: `exact -> wildcard -> all`.

## Payload contract (event + context commands)

- Event processor передает enriched `payload.event.items[]`:
  - `id`, `objectId`, `schema`, `geometry`, `data`, `value`;
  - для modify также: `valueBefore`, `valueAfter`, `dataBefore`, `dataAfter`.
  - эмиссия `modify` в renderer сравнивает `dataBefore` и `dataAfter` (нормализованная карта атрибутов из `Edit Data`), чтобы не терять изменения из‑за сериализации XML-узла через `sanitizeForIpc`; при успешном матче в логе появляются `Stencil modify candidate evaluated` и далее `Stencil event handler started` перед `runSeafPluginCommand`.
- В `payload.event.index` передаётся снимок stencil-index:
  - `bySchema`, `byOid` (как раньше);
  - `objectPage`: карта `objectId -> pageId` (id страницы draw.io в момент индексации ячейки). Используется в `all_add` / `collect_import_conflicts`: коллизия OID при импорте учитывается **только между ячейками на той же странице**, что и `payload.event.page.id`; один и тот же OID на разных страницах (зеркала) не считается конфликтом.
- Команды контекстного меню получают те же ключевые поля в `payload.selection[]`:
  - `id`, `objectId`, `geometry`, `data`.
- Это позволяет Python-скриптам использовать единый контракт для event и context сценариев.

## Context menu scopes

- Поддерживаются 2 типа контекстного меню через `menu.context.scope`:
  - `canvas` — показывать пункт только при правом клике по пустому полю диаграммы;
  - `stencil` — показывать пункт только при правом клике по стенсилу/ячейке.
- Для `scope=stencil` можно задавать `menu.context.schemaPattern` (строка или список строк).
- `schemaPattern` матчится тем же алгоритмом, что event rules:
  - `exact`, `wildcard` (`*`) и `all`;
  - при несовпадении schema пункт меню не отображается.

### Response.commands: updateStencilData

- Поддерживается UI-команда `updateStencilData` для обратного канала Python -> draw.io.
- Аргументы:
  - `pageId` (optional),
  - `objectId` (required),
  - `mode`: `merge | replace`,
  - `data`: словарь атрибутов.
- `merge`: обновляются только переданные ключи `data`.
- `replace`: перезаписывается набор data-атрибутов объекта (с сохранением базовых служебных полей `label/schema`).

### Response.commands: updateStencilDataBulk

- Поддерживается UI-команда `updateStencilDataBulk` для пакетного обновления нескольких объектов.
- Аргументы:
  - `pageId` (optional),
  - `updates`: массив `{objectId, mode, data}`.
- Обновления применяются в одной транзакции модели (`beginUpdate/endUpdate`).

### Response.commands: ensureLayer

- Поддерживается UI-команда `ensureLayer` для create-or-get слоя на странице.
- Аргументы:
  - `pageId` (optional),
  - `layerName` (required),
  - `makeVisible` (optional, default `true`).
- Результат команды фиксируется в `result.payload.uiCommandResults[]`:
  - `status: created|existing`,
  - `layerId`,
  - `layerName`.

### Response.commands: moveObjectsToLayer

- Поддерживается UI-команда `moveObjectsToLayer` для привязки объектов к слою.
- Аргументы:
  - `pageId` (optional),
  - `layerName` (required, fallback `unknown` на стороне Python orchestration),
  - `objectIds` (required): массив id объектов,
  - `makeVisible` (optional, default `true`),
  - `targetMode` (optional): при значении **`schemaCell`** переносится именно ячейка из `objectIds` (инвариант `schema → layer` при вложенности); если не задано — legacy-подъём до **group-root** для grouped stencil,
  - `suppressStencilEvents` (optional): подавление stencil-events при массовых операциях.
- Поведение:
  - слой создается/переиспользуется через create-or-get;
  - при **`targetMode: "schemaCell"`** (команды из Python `lib/events/layer_routing.py` для `all_add` / `reparent` и mirror `add_page`) переносится указанная schema-ячейка;
  - без **`targetMode`** для grouped stencil переносится целевой контейнер компонента (group-root), чтобы не разрывать внутренние `mxCell` по разным parent;
  - объекты/контейнеры переносятся в слой стандартным draw.io API `graph.moveCells(cells, 0, 0, false, targetLayer)`.

### Response.commands: moveLayerUnderLayer

- UI-команда для **ручного** сценария «слой под слой» (вложенные страничные слои). Текущий handler **`reparent` её не вызывает**: при перетаскивании стенсила слой группы из `schemas.<schema>.layer` не перестраивается.
- Аргументы:
  - `pageId` (optional),
  - `childLayerName` (required): имя mxCell дочернего слоя,
  - `parentLayerName` (required): имя mxCell родительского слоя,
  - `makeVisible` (optional, default `true`),
  - `suppressStencilEvents` (optional): для подавления stencil-events при массовых операциях.
- Поведение: `ensureLayer` для обоих имён, поиск слоя под `root` (в т.ч. вложенный), `model.add(parentLayer, childLayer, ...)` если дочерний слой ещё не под указанным родителем; при уже корректной иерархии — no-op.

### Stencil metadata: layer

- Layer-routing настраивается отдельным файлом `conf/stencils/config.yaml`.
- Формат: `schemas.<schema>.layer`.
- `layer` может быть строкой или списком строк (для конфликтов/ручного разруливания).
- Если `layer` отсутствует или пустой, слой не создается и объект не переносится.

### Stencil metadata: edit_data + data_lock + data_hidden

В том же файле `conf/stencils/config.yaml` для каждой schema можно описать поведение
диалога «Редактировать данные» (Edit Data). Используется plugin'ом для P41-стенсилов;
парсер на стороне renderer (минимальный inline YAML, поддерживает скаляры/объекты/списки).

Поля:

| Параметр | Тип | Назначение | Default |
|---|---|---|---|
| `schemas.<schema>.edit_data` | `string` | Режим Edit Data: `seaf` \| `standard` \| `both` | `seaf`, если schema присутствует в config или её ключ начинается на `seaf.`; иначе `standard` |
| `schemas.<schema>.data_lock` | `array<string>` | Имена атрибутов, защищённых от edit/remove/add-with-same-name | `[OID, schema]` для всех seaf-схем (включая prefix-fallback) |
| `schemas.<schema>.data_hidden` | `array<string>` | Имена атрибутов, **не показываемых** в SEAF Edit Data; значения сохраняются в XML при Apply | `[]` (только если ключ задан в config для этой schema) |

Семантика `edit_data`:

- `seaf` — штатный пункт «Edit Data» в context menu скрыт, в контекстное меню добавляется отдельный пункт «Редактировать данные (SEAF)…» (action `seafEditData`); Right-click, Ctrl+M и Format panel открывают SEAF-диалог `SeafEditDataDialog` с поддержкой `data_lock` и опционального `data_hidden`.
- `standard` — в context menu остается один штатный `Edit Data` (enabled), SEAF-пункт отображается disabled.
- `both` — в context menu ровно два пункта: штатный `Edit Data` (enabled) и `Редактировать данные (SEAF)…` (enabled).
- Для grouped stencil-элементов при RMB mode/target определяются по ближайшему родителю со `schema`, если клик пришелся в дочерний служебный `mxCell` без schema.
- Lookup schema в `config.yaml` устойчив к шуму формата (`;`, `,`, `#` в конце, дополнительные префиксы перед `seaf.`), чтобы избежать ложного fallback в `mode=seaf`.

Точка маршрутизации диалога: plugin переопределяет `EditorUi.prototype.showDataDialog` (`installEditDataDialogRouter`), что покрывает Right-click → штатный `editData`, Format panel и Ctrl+M единообразно. Action `seafEditData` гарантирует видимый кастомный пункт RMB даже если штатный по какой-то причине не скрылся.

Fallback policy (когда `conf/stencils/config.yaml` не загрузился или схема не описана):

- Любая схема, начинающаяся на `seaf.` (например `seaf.company.ta.services.dc_regions`), всё равно резолвится в `mode=seaf` и `data_lock=[OID, schema]`. Это защищает SEAF-объекты даже при сбоях загрузки конфига.
- Не-`seaf.` схемы по-прежнему получают `mode=standard` и `data_lock=[]`.

Диагностика RMB:

- Для расследования кейсов `standard/both` включайте `pluginLogLevel: info|debug` в `conf/env.yaml`.
- При `pluginLogLevel: none` debug/info записи о резолве режима/ячейки в лог не попадают.
- `stencils/config.yaml` читается через typed action `getSeafStencilConfig` (main-process `seafPluginService`) с преднормализованным payload; legacy `readSeafPluginFile` используется только как migration fallback.
- Rollout v2 архитектуры управляется feature flags в `env.yaml`: `featureIntentEngineV2`, `featureMenuPresenterV2`, `featureIpcStencilConfigV2`, `featureSessionCoordinatorV2`.
- Контракт RMB без дублей: plugin не добавляет штатный `Edit Data` вручную. В `both` и `standard` остается один базовый standard-пункт draw.io; в `both` SEAF-пункт enabled, в `standard` SEAF-пункт disabled, в `seaf` standard скрывается policy-слоем и остается только SEAF enabled.
- Матрица `standard|both|seaf` применяется только для `policySource=config-hit` (schema найдена в `stencils/config.yaml`), чтобы не вмешиваться в объекты вне stencil-policy.

Семантика `data_lock`:

- Список имён атрибутов (строки). Для каждого защищённого имени:
  - textarea/input в SEAF-диалоге дизейблен (`disabled`), нельзя изменить значение;
  - кнопка «X» удаления для него отсутствует, удалить атрибут невозможно;
  - попытка добавить новый атрибут с этим же именем блокируется alert'ом.
- Если ключ `data_lock` отсутствует у schema, перечисленной в config, по умолчанию защищаются `OID` и `schema`.
- Schemas, отсутствующие в `config.yaml`:
  - имена с префиксом `seaf.` -> `data_lock=[OID, schema]` (prefix fallback);
  - прочие -> `data_lock=[]` (`mode=standard`).

Семантика `data_hidden`:

- Опциональный список имён атрибутов (как у `data_lock`). Если ключ отсутствует, массив пустой или schema не в config — **ничего не скрывается** (в отличие от prefix-fallback для `data_lock`, для `data_hidden` fallback всегда `[]`).
- Для каждого скрытого имени строка в форме **не создаётся**; атрибут остаётся в XML и **не удаляется** при Apply (тот же механизм сохранения, что для `data_lock`).
- Добавление нового атрибута с именем из `data_hidden` блокируется alert'ом.
- Если одно и то же имя указано и в `data_lock`, и в `data_hidden`, применяется **`data_hidden`**: поле не отображается, на Apply значение сохраняется без изменений из формы.

### Stencil metadata: fields (зарезервировано, Phase 2)

В Phase 2 поле `schemas.<schema>.fields.<attr>` будет описывать widget диалога:

```yaml
schemas:
  seaf.company.ta.services.dc_regions:
    layer: "Регион"
    edit_data: seaf
    data_lock: [OID, schema]
    fields:
      stand:
        widget: combo            # text | textarea | combo | radio | checkbox
        options: [PROD, DEV, TEST]
        required: true
      external_id:
        widget: text
        pattern: "^[A-Z0-9_-]+$"
```

В Phase 1 ключ `fields` plugin'ом не читается; неуказанные атрибуты рендерятся как `textarea`.

---

## 9) `stencils/config.yaml`

Файл `conf/stencils/config.yaml` хранит **метаданные по schema** для P41-стенсилов.
Он используется renderer-плагином для:

- маршрутизации объектов по слоям (`layer`);
- поведения диалога Edit Data (`edit_data`);
- блокировки редактирования/удаления критичных атрибутов (`data_lock`);
- опционального скрытия атрибутов в форме (`data_hidden`).

### Структура

```yaml
schemas:
  <schema-name>:
    layer: "<layer-name>"        # string | array<string>
    edit_data: seaf              # seaf | standard | both
    data_lock: [OID, schema]     # array<string>
    data_hidden: []              # optional array<string>, omit or [] = show all non-lock UI fields
    sync_title_with_label: true # optional; false отключает связку title/label в modify-handlers
    # fields: ...                # резерв под Phase 2
```

### Поля и поведение

| Поле | Тип | Назначение | Значение по умолчанию |
|---|---|---|---|
| `schemas.<schema>.layer` | `string` \| `array<string>` | Целевой слой для `ensureLayer/moveObjectsToLayer` | отсутствует (слой не назначается) |
| `schemas.<schema>.edit_data` | `string` | Режим Edit Data: `seaf` \| `standard` \| `both` | `seaf` для `seaf.*`, иначе `standard` |
| `schemas.<schema>.data_lock` | `array<string>` | Имена атрибутов, запрещённых для редактирования/удаления в SEAF-диалоге | `[OID, schema]` для `seaf.*`, иначе `[]` |
| `schemas.<schema>.data_hidden` | `array<string>` | Имена атрибутов, не показываемых в SEAF Edit Data (сохраняются при Apply) | `[]` |
| `schemas.<schema>.sync_title_with_label` | `boolean` | Синхронизация `title`↔`label` в Python modify-handlers (`data_mirror`, `label_title`) | `true` для `seaf.company.ta.*` при отсутствии ключа; явное `false` отключает |
| `schemas.<schema>.fields` | `object` | Будущая схема rich-виджетов (`combo/radio/checkbox`) | не используется в Phase 1 |

### Минимальный пример

```yaml
schemas:
  seaf.company.ta.services.dc_regions:
    layer: "Регион"
    edit_data: seaf
    data_lock:
      - OID
      - schema
```

### Практические правила

- Для всех `seaf.*` схем рекомендуется явно задавать `data_lock: [OID, schema]`.
- Если `data_lock` содержит имя поля, в SEAF Edit Data:
  - поле становится read-only;
  - кнопка удаления для него скрыта;
  - добавление нового поля с тем же именем блокируется.
- Если `data_hidden` содержит имя поля — строка в форме не показывается, атрибут в XML сохраняется при Apply; добавление свойства с этим именем блокируется.
- Для схем без префикса `seaf.` по умолчанию используется штатный режим `standard`.
