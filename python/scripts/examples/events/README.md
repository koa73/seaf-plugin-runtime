# Stencil Event Handlers (`examples/events`)

Этот каталог содержит примеры Python-обработчиков для auto-event processor (часть из них зарегистрирована в `conf/events.yaml`, см. ниже).

Важно:
- `events.yaml` хранит **handler id** (например, `seafStencilSpecificModify`), а не путь к `.py`.
- Связка с файлами скриптов задается через `events.yaml -> commands[].id -> commands[].script`.

## Маршрутизация handler id -> script

| Handler id (`events.yaml`) | Command id (`events.yaml`) | Script file |
|---|---|---|
| `seafStencilSpecificRemove` | `seafStencilSpecificRemove` | `specific_remove.py` |
| `seafStencilSpecificModify` | `seafStencilSpecificModify` | `specific_modify.py` |
| `seafStencilAllAdd` | `seafStencilAllAdd` | `../events/all_add.py` |
| `seafStencilReparent` | `seafStencilReparent` | `../events/reparent.py` |
| `seafStencilAllRemove` | `seafStencilAllRemove` | `all_remove.py` |
| `seafStencilAllModify` | `seafStencilAllModify` | `all_modify.py` |

## Что делают эти скрипты

Все перечисленные ниже скрипты используют одинаковый шаблон:
1. Читают входной `REQUEST` через `lib.io.read_request()`.
2. Извлекают `payload.event.items`.
3. Пишут диагностику по каждому item в `stderr` (попадает в plugin log).
4. Возвращают `status=success` через `lib.io.write_response(...)`.
5. В `payload` ответа возвращают:
   - имя обработчика (`handler`),
   - количество элементов (`count`).

Это демонстрационные скрипты для валидации маршрутизации событий и структуры payload.

## Используемые helper-методы

- `read_request()` из `lib.io`:
  - читает JSON из `stdin`,
  - возвращает Python `dict` с полным root-request.
- `write_response(status, message, payload, ...)` из `lib.io`:
  - формирует каноничный `Response`,
  - печатает JSON в `stdout`,
  - возвращает exit-code (обычно `0` для `success`).

## Контракт входного payload (`REQUEST.payload.event`)

Event processor передает события в поле `REQUEST.payload.event`.

Ожидаемые поля:
- `eventType`: `add` | `remove` | `modify` | `reparent`
- `ruleId`: id matched правила из `events.yaml`
- `listId`: id matched списка стенсилов
- `txId`: id транзакции модели
- `timestamp`: ISO datetime
- `page`: `{id, name}`
- `items[]`: список измененных объектов

### `items[]` для `add/remove/reparent`

- `id`
- `objectId` (алиас `id`)
- `operation`
- `label`
- `schema`
- `style`
- `styleText`
- `geometry` (`x`, `y`, `width`, `height`)
- `data` (атрибуты объекта по модели `Edit Data`)
- `value`

Для `reparent` дополнительно: `previousParentId`, `newParentId`, `previousLayerName`, `currentLayerName`, `targetParentLayerName` (целевой страничный слой для `moveLayerUnderLayer`).

### `items[]` для `modify`

Дополнительно к полям выше:
- `valueBefore`: исходное значение объекта до `Edit Data -> Apply`
- `valueAfter`: новое значение объекта после `Edit Data -> Apply`
- `dataBefore`: атрибуты объекта до `Edit Data -> Apply`
- `dataAfter`: атрибуты объекта после `Edit Data -> Apply`

## По скриптам отдельно

- `specific_add.py` (демо, в типовом `events.yaml` не зарегистрирован):
  - пример обработки `add` для specific-rule; при необходимости добавьте `commands[].id: seafStencilSpecificAdd` и handler в правило.
- `specific_remove.py`:
  - обрабатывает событие `remove` для specific-rule.
- `specific_modify.py`:
  - обрабатывает событие `modify` для specific-rule.
- `all_add.py`:
  - shim-обертка, проксирует выполнение в production handler `python/scripts/events/all_add.py`;
  - fallback-обработчик `add` для правила `all`;
  - назначает `OID` через event-механизм (wildcard `seaf.company.ta.*` или exact-правила `exact_dcs_data_mirror` / `exact_dc_offices_data_mirror` с `add: seafStencilAllAdd`);
  - формат OID: `<companyPrefix>.<schemaCode>.<sequence>`, где `schemaCode` = две последние части `schema`, fallback `unknown`;
  - для обновления нескольких элементов использует `commands[].name=updateStencilDataBulk`.
  - проверяет коллизии при import и выводит информационную таблицу конфликтов без автодедупликации.
  - дополнительно демонстрирует `commands[].name=ensureLayer` (`SEAF_AUTO_LAYER`) с `pageId` текущего события.
- `all_remove.py`:
  - fallback-обработчик `remove` для правила `all`.
- `all_modify.py`:
  - fallback-обработчик `modify` для правила `all`.

## Debug trace шаблон для `all_add`

При `pluginLogLevel=debug` ожидаемая последовательность в `seaf-plugin.log`:

1. `Stencil model change detected`  
2. `Stencil event batch queued`  
3. `Stencil event routing selected` с `ruleId`, `matchType` (`exact|wildcard|all`) и `commandId`  
4. `Stencil event batch dispatched`  
5. `Stencil event batch handler completed` (для `sync`) или `Stencil event async dispatch accepted`/`Stencil event async handler completed` (для `async`)  
6. Строки из Python `stderr` с `objectId`, `pageId`, `pageName`, `geometry`, `data`  

Если событие не ушло в python, смотрите строки:
- `Stencil event item filtered out` (причина в поле `reason`);
- `Stencil event batch produced no dispatch groups`.

## Протокол stderr для логирования в plugin log

- Для ошибок используйте:
  - `SEAF_ERROR <message>`
- Для информационных сообщений:
  - `SEAF_INFO <message>`
- Расширенный вариант:
  - `SEAF_LOG {"level":"info|error","message":"...","data":{...}}`

Main-process добавляет префикс вида `[PYTHON][script.py][ERROR|INFO]`.
`INFO`-сообщения пишутся только при включенном `env.scriptLogLevel=info`.

## Команда updateStencilData (из Response.commands)

- Формат:
  - `name: "updateStencilData"`
  - `args.pageId` (optional)
  - `args.objectId` (required)
  - `args.mode: "merge" | "replace"` (default `merge`)
  - `args.data: { ... }`
- `merge`: обновляются только переданные поля.
- `replace`: перезаписывается набор data-атрибутов объекта.

## Команда updateStencilDataBulk (из Response.commands)

- Формат:
  - `name: "updateStencilDataBulk"`
  - `args.pageId` (optional)
  - `args.updates` (required): массив `{objectId, mode, data}`
- Поведение:
  - пакетное применение изменений в одной транзакции модели.

## Команда ensureLayer (из Response.commands)

- Формат:
  - `name: "ensureLayer"`
  - `args.pageId` (optional)
  - `args.layerName` (required)
  - `args.makeVisible` (optional, default `true`)
- Поведение:
  - если слой существует на странице, возвращается его `layerId` и статус `existing`;
  - если слоя нет, он создается, делается видимым, возвращается `layerId` и статус `created`.
