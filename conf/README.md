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
| `stencils/config.yaml` | Метаданные стенсилов: `layer`, `edit_data`, `data_lock` (и резерв `fields`) |

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
- при необходимости `clientAction` и `configEditor`.

Именно здесь хранится `seafEditConfig` schema для `Edit Config`.

---

## 4) `context_menu.yaml`

Содержит `commands[]`-overrides по `id` для секции `menu.context.*`.

Пример идеи:
- в `main_menu.yaml` лежит полное описание команды;
- в `context_menu.yaml` лежит только:
  - `id`
  - `menu.context.enabled`
  - `menu.context.target`.

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
| `rules[].handlers.remove` | `string` | command id для `remove` |
| `rules[].handlers.modify` | `string` | command id для `modify` |

### Семантика `rules[].schema`

- `seaf.company.ta.services.dc_azs` — exact match только для одного schema.
- `seaf.company.ta.*` — wildcard match для группы schema.
- `all` — правило на все стенсилы выбранного `listId`.
- Для auto-назначения `OID` при `add` следует использовать wildcard-правило `seaf.company.ta.*`.

Приоритет матчинга внутри list:
1. exact
2. wildcard
3. all

### Что такое handler id

`seafStencilSpecificModify` (и аналогичные) — это **command id**, а не метод.

Маршрут:
1. `events.yaml.rules[].handlers.modify` -> `seafStencilSpecificModify`
2. compose config ищет command с `id=seafStencilSpecificModify`
3. command указывает `script: examples/events/specific_modify.py`
4. service runner запускает этот Python script

---

## 6) Handler mapping (event -> command -> script)

| Handler id | Script |
|---|---|
| `seafStencilSpecificAdd` | `examples/events/specific_add.py` |
| `seafStencilSpecificRemove` | `examples/events/specific_remove.py` |
| `seafStencilSpecificModify` | `examples/events/specific_modify.py` |
| `seafStencilAllAdd` | `events/all_add.py` |
| `seafStencilAllRemove` | `examples/events/all_remove.py` |
| `seafStencilAllModify` | `examples/events/all_modify.py` |

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
stencilLists:
  - id: SEAF_Р41
rules:
  - id: exact_dc_azs
    listId: SEAF_Р41
    schema: "seaf.company.ta.services.dc_azs"
    execution: sync
    handlers:
      add: seafStencilSpecificAdd
      remove: seafStencilSpecificRemove
      modify: seafStencilSpecificModify
  - id: wildcard_ta_services
    listId: SEAF_Р41
    schema: "seaf.company.ta.*"
    execution: async
    handlers:
      add: seafStencilSpecificAdd
  - id: all
    listId: SEAF_Р41
    schema: all
    execution: sync
    handlers:
      add: seafStencilAllAdd
      remove: seafStencilAllRemove
      modify: seafStencilAllModify
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
  - `makeVisible` (optional, default `true`).
- Поведение:
  - слой создается/переиспользуется через create-or-get;
  - для grouped stencil переносится целевой контейнер компонента (group-root), чтобы не разрывать внутренние `mxCell` по разным parent;
  - объекты/контейнеры переносятся в слой стандартным draw.io API `graph.moveCells(cells, 0, 0, false, targetLayer)`.

### Stencil metadata: layer

- Layer-routing настраивается отдельным файлом `conf/stencils/config.yaml`.
- Формат: `schemas.<schema>.layer`.
- `layer` может быть строкой или списком строк (для конфликтов/ручного разруливания).
- Если `layer` отсутствует или пустой, слой не создается и объект не переносится.

### Stencil metadata: edit_data + data_lock

В том же файле `conf/stencils/config.yaml` для каждой schema можно описать поведение
диалога «Редактировать данные» (Edit Data). Используется plugin'ом для P41-стенсилов;
парсер на стороне renderer (минимальный inline YAML, поддерживает скаляры/объекты/списки).

Поля:

| Параметр | Тип | Назначение | Default |
|---|---|---|---|
| `schemas.<schema>.edit_data` | `string` | Режим Edit Data: `seaf` \| `standard` \| `both` | `seaf`, если schema присутствует в config или её ключ начинается на `seaf.`; иначе `standard` |
| `schemas.<schema>.data_lock` | `array<string>` | Имена атрибутов, защищённых от edit/remove/add-with-same-name | `[OID, schema]` для всех seaf-схем (включая prefix-fallback) |

Семантика `edit_data`:

- `seaf` — штатный пункт «Edit Data» в context menu скрыт, в контекстное меню добавляется отдельный пункт «Редактировать данные (SEAF)…» (action `seafEditData`); Right-click, Ctrl+M и Format panel открывают SEAF-диалог `SeafEditDataDialog` с поддержкой `data_lock`.
- `standard` — в context menu показывается только штатный `Edit Data`; если базовый пункт не был добавлен draw.io из-за внутреннего состояния ячейки, plugin добавляет fallback-пункт вручную; `data_lock` игнорируется (для совместимости).
- `both` — в context menu доступны оба пункта (штатный + «Редактировать данные (SEAF)…»); если штатный пункт не был добавлен draw.io, plugin добавляет fallback-пункт стандартного `Edit Data`; Ctrl+M / Format panel ведут на SEAF-диалог.
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

Семантика `data_lock`:

- Список имён атрибутов (строки). Для каждого защищённого имени:
  - textarea/input в SEAF-диалоге дизейблен (`disabled`), нельзя изменить значение;
  - кнопка «X» удаления отсутствует, удалить атрибут невозможно;
  - попытка добавить новый атрибут с этим же именем блокируется alert'ом.
- Если ключ `data_lock` отсутствует у schema, перечисленной в config, по умолчанию защищаются `OID` и `schema`.
- Schemas, отсутствующие в `config.yaml`:
  - имена с префиксом `seaf.` -> `data_lock=[OID, schema]` (prefix fallback);
  - прочие -> `data_lock=[]` (`mode=standard`).

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
- блокировки редактирования/удаления критичных атрибутов (`data_lock`).

### Структура

```yaml
schemas:
  <schema-name>:
    layer: "<layer-name>"        # string | array<string>
    edit_data: seaf              # seaf | standard | both
    data_lock: [OID, schema]     # array<string>
    # fields: ...                # резерв под Phase 2
```

### Поля и поведение

| Поле | Тип | Назначение | Значение по умолчанию |
|---|---|---|---|
| `schemas.<schema>.layer` | `string` \| `array<string>` | Целевой слой для `ensureLayer/moveObjectsToLayer` | отсутствует (слой не назначается) |
| `schemas.<schema>.edit_data` | `string` | Режим Edit Data: `seaf` \| `standard` \| `both` | `seaf` для `seaf.*`, иначе `standard` |
| `schemas.<schema>.data_lock` | `array<string>` | Имена атрибутов, запрещённых для редактирования/удаления в SEAF-диалоге | `[OID, schema]` для `seaf.*`, иначе `[]` |
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
- Для схем без префикса `seaf.` по умолчанию используется штатный режим `standard`.
