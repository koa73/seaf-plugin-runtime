# Python scripts: формат `REQUEST` и `Response`

Этот каталог содержит Python‑скрипты, которые runtime‑плагин запускает из draw.io Desktop.

Принцип работы:
- UI формирует `REQUEST` (JSON) и передаёт его в **stdin** скрипта.
- Скрипт печатает **в stdout** JSON‑объект `Response`.
- По `Response` UI выполняет интерактивные команды (`commands[]`) и показывает пользователю сообщение.

Скрипты в каталоге `examples/` остаются для локальной отладки и **не** подключаются из поставочных `main_menu.yaml` / `events.yaml` (см. [`examples/README.md`](examples/README.md)).

- `events/all_add.py` — production orchestrator для `add`-событий: собирает контекст, вызывает OID-библиотеку и формирует `Response.commands[]` (новый OID только при отсутствии или пустом `data.OID`, чтобы второй `add` после смены слоя не сдвигал sequence).
- `events/reparent.py` — логирует полный `event` (`reparentScriptFired`) и возвращает **`Response.commands`** с принудительным layer-routing (`moveObjectsToLayer`, **`targetMode: "schemaCell"`**). Условия попадания INFO в файл — `pluginLogLevel` / `scriptLogLevel` (см. `CHANGELOG` 0.5.27–0.5.28).
- `events/data_mirror.py` — production orchestrator для `modify`-синхронизации `schema+OID` (схемы `dcs`/`dc_offices`) через атомарную runtime-команду; перед санитизацией patch выравнивает `title`/`label` через `lib/events/title_label_sync.py`.
- `events/label_title.py` — wildcard `modify` для остальных `seaf.company.ta.*`: при необходимости дописывает парное поле через `updateStencilDataBulk` с `suppressStencilEvents: true`.
- `context_menu/add_page.py` — production handler для команды «Создать страницу»: валидирует `selection.data.title`, проверяет дубли имен страниц и возвращает `commands[]` для create page + установки link на исходный стенсил.
- `main_menu/export.py` — **P41 → Export**: строит `{schema: {OID: {attrs}}}` из `payload.schemaObjects`, генерирует SEAF YAML через vendored `yaml_schema_generator` (обёртка `seaf.company.ta.*` + OID); каталог — файл на schema (`services.network_segments.yaml`); при пустом пути — ошибка + popup.
- `lib/main_menu/export_helpers.py` — `build_export_by_schema`, `schema_to_export_filename`, `resolve_output_path`.
- `lib/main_menu/export_yaml_generator.py` — адаптер `export_map` → `YAMLGenerator`, каталог схем `python/vendor/yaml_schema_generator/schemas`.
- `lib/main_menu/export_report.py` — отчёт Export в лог (`pluginLogLevel`).
- `main_menu/import.py` — заглушка **P41 → Import**; логирует вызов.
- `main_menu/net_conf_parser.py` — заглушка **Tools → Net_Conf_Parser**; логирует вызов аналогично.
- `lib/oid/*` — модульная библиотека генерации/валидации OID и поиска конфликтов.
- `lib/diagram/*` — библиотека переиспользуемых helper-функций для context-menu сценариев создания страниц и установки page links.
- `lib/events/*` — service helper-слой для event handlers (`SEAF_INFO/SEAF_ERROR` логирование, сообщения о коллизиях, резолв env/arguments параметров).
- `lib/logging/*` — централизованный слой логирования runtime-скриптов (уровни и emit `SEAF_INFO/SEAF_ERROR`); метод `ScriptLogger.debug` пишет `SEAF_INFO` только при `pluginLogLevel: debug|trace` (для трассировки `title_label_sync` и др.).

Последовательность команд в `events/data_mirror.py`:
1. Выравнивание `title`/`label` в копии `dataAfter` (общий модуль `title_label_sync`; отключение точечно: `sync_title_with_label: false` в `conf/stencils/config.yaml` для схемы).
2. Санитизация patch (`dataAfter` без `OID`/`schema`).
3. Формирование `commands[].name=mirrorDataByOidAtomic` для каждой пары `schema+OID`.
4. Runtime выполняет `precheck -> snapshot -> apply -> rollback` и при ошибке возвращает список проблем с `pageName` и `OID`.

Последовательность команд в `events/all_add.py`:
1. `updateStencilDataBulk` (пакетное обновление `data` стенсилов) — только для ячеек, где реально назначен новый `OID` (непустой существующий OID не перезаписывается).
2. `moveObjectsToLayer` (create-or-get слоя по `schema -> layer` из `conf/stencils/config.yaml` и перенос объекта в этот слой) — в команду передаётся **`targetMode: "schemaCell"`** (перенос по конкретной schema-ячейке из `objectIds`); объекты, у которых в событии `currentLayerName` уже совпадает с целевым слоем, в команду не попадают (кроме принудительного режима `reparent`); исполнитель UI дополнительно не вызывает `moveCells` для ячеек, уже лежащих на нужном слое.

Layer-routing правила:
- источник управления: `conf/stencils/config.yaml`, секция `schemas.<schema>.layer`;
- если `layer` отсутствует или пустой, слой не создается и объект не переносится;
- если `layer` — список, используется первый непустой элемент (для ручного разруливания конфликтов).
- `lib/io/__init__.py` — общий helper layer для чтения REQUEST, каноничного Response и `SEAF_PROGRESS`.

## 1) Структура `REQUEST` (stdin)

Важно: в текущих демо‑скриптах часто используется подход:

```python
raw = sys.stdin.read()
req = json.loads(raw) if raw.strip() else {}
payload = req.get("payload") or {}
args = payload.get("arguments") or {}
```

То есть скрипты ожидают **root REQUEST**, где пользовательские данные лежат в `REQUEST.payload`.

### Таблица полей `REQUEST`

| Поле | Формат | Назначение |
|---|---:|---|
| `commandId` | `string` | Идентификатор команды (корневой уровень REQUEST). |
| `timestamp` | `string` | Время формирования REQUEST (ISO-8601). |
| `io` | `object` | Декларативные I/O-настройки команды из runtime config. |
| `expectedOutput` | `object` | Декларативные ожидания по output (`commands[].output`). |
| `postActions` | `array<object>` | UI post-actions из runtime config. |
| `payload` | `object` | Основной контейнер данных, которые UI передаёт скрипту. В демо‑скриптах почти вся логика завязана на `REQUEST.payload`. |

### Таблица полей `REQUEST.payload`

| Поле | Формат | Назначение |
|---|---:|---|
| `source` | `string` | Источник вызова (например, `menu`). Можно использовать для аналитики/ветвления логики. |
| `timestamp` | `string` (ISO‑8601) | Время формирования payload на UI‑стороне. |
| `selection` | `array<object>` | Снимок текущего выделения в диаграмме. Скрипты используют это для проверок и для выбора/подсветки объектов. |
| `diagramXml` | `string` (XML) | Опционально. Полная диаграмма в виде XML. Попадает сюда, если в `plugin.yaml` у команды стоит `input.includeDiagramXml: true`. |
| `currentPage` | `object` | Опционально. Текущая страница `{id, name}`. Попадает сюда, если `input.includeCurrentPage: true`. |
| `pages` | `array<object>` | Опционально. Список страниц `{id,name,isCurrent}`. Попадает сюда, если `input.includePages: true`; используется скриптами для валидации дублей имен страниц. |
| `arguments` | `object` | Опционально. Аргументы команды из `plugin.yaml` (`commands[].input.arguments`). Используется для параметризации (например, тайминги, режимы). |
| `env` | `object` | Значения из `conf/env.yaml`, инжектятся runtime перед запуском скрипта. |

### `REQUEST.payload.selection[]` (элемент массива)

Точный состав может расширяться, но текущая реализация формирует примерно такие поля:

| Поле | Формат | Назначение |
|---|---:|---|
| `id` | `string` | ID объекта (cell) в графе. Используется, например, чтобы вернуть `selectCells` с `cellIds`. |
| `objectId` | `string` | Алиас `id` для унифицированного контракта event/context обработчиков. |
| `isVertex` | `boolean` | Является ли объект вершиной. |
| `isEdge` | `boolean` | Является ли объект ребром. |
| `label` | `string` | Отображаемая подпись. |
| `style` | `object` | Стиль объекта (ключи/значения). |
| `geometry` | `object` | Геометрия (координаты/размеры). |
| `data` | `object` | Атрибуты объекта в формате `Edit Data` (ключ/значение). |

### Config values from `env.yaml`

Runtime передает значения редактируемой конфигурации в двух местах:
- `REQUEST.payload.env`
- `REQUEST.payload.arguments` (merge поверх `input.arguments`)

Это сделано для обратной совместимости скриптов.

Для production handler `events/all_add.py` служебный `SEAF_INFO` лог включается только при
`pluginLogLevel` в `REQUEST.payload.env/arguments` со значениями `info`, `debug` или `trace`.
При `none`/пустом значении INFO-лог не выводится.

Поддерживаемые методы редактирования в UI (`inputMethod`) для этих значений:
- `text`
- `list`
- `filePicker`
- `checkbox`
- `radio`

## 2) Структура `Response` (stdout)

Скрипт должен вывести **один JSON** в stdout.

Минимальный практический набор полей, который используется текущей логикой:

| Поле | Формат | Назначение |
|---|---:|---|
| `status` | `string` (`success|error`) | Главный статус результата. UI использует его, чтобы понять: показывать «успех» или «ошибку». |
| `message` | `string` | Сообщение пользователю (показывается в диалоге/alert). |
| `payload` | `object` | Произвольные данные результата (для отладки, передачи дополнительных данных в будущем). |
| `commands` | `array<object>` | Список UI‑команд, которые нужно выполнить после скрипта. |
| `errors` | `array<string>` | Машиночитаемые коды ошибок (для диагностики/логики). |

### Контракт видимости ошибок (`payload.errorPolicy`)

- Для event processor (`source=stencil_event_processor`) все ошибки всегда пишутся в лог.
- Popup пользователю показывается только при явном маркере:
  - `payload.errorPolicy.userVisible = true`
- Если маркер отсутствует или `false`, ошибка остается `log-only` без всплывающего окна.

### `Response.commands[]` (UI‑команды)

Каждая команда имеет форму:

| Поле | Формат | Назначение |
|---|---:|---|
| `name` | `string` | Имя UI‑команды. |
| `args` | `object` | Аргументы команды (зависят от `name`). |

Поддерживаемые имена UI‑команд в текущей реализации UI‑плагина:

| `name` | `args` | Что делает |
|---|---:|---|
| `showMessage` | `{ "level": "info|error", "text": "..." }` | Показывает пользователю сообщение. |
| `reloadDocument` | `{}` | Перезагружает окно/документ (фактически `window.location.reload()`). |
| `refreshGraph` | `{}` | Обновляет граф/перерисовку. |
| `selectCells` | `{ "cellIds": ["id1", "id2"] }` | Выделяет объекты по их `id` в диаграмме. |
| `updateStencilData` | `{ "pageId": "...", "objectId": "...", "mode": "merge|replace", "data": {...} }` | Обновляет `data` объекта через встроенный путь draw.io (`model.setValue`). |
| `updateStencilDataBulk` | `{ "pageId": "...", "updates": [{"objectId":"...","mode":"merge|replace","data":{...}}] }` | Пакетно обновляет данные объектов в одной транзакции. |
| `mirrorDataByOidAtomic` | `{ "schema": "...", "oid": "...", "patch": {...}, "excludedFields": ["OID","schema"], "sourceRollbacks": [...], "suppressStencilEvents": true }` | Атомарно синхронизирует объекты с тем же `schema+OID` на всех страницах; при сбое откатывает изменения и возвращает `failures` с `pageName`/`OID`. |
| `ensureLayer` | `{ "pageId": "...", "layerName": "...", "makeVisible": true }` | Находит или создает слой по имени и делает его видимым. |
| `moveObjectsToLayer` | `{ "pageId": "...", "layerName": "...", "objectIds": ["id1"], "makeVisible": true, "targetMode": "schemaCell" (опционально), "suppressStencilEvents": true (опционально) }` | Находит/создает слой и переносит объекты через `graph.moveCells(...)`. При **`targetMode: "schemaCell"`** двигается ячейка, соответствующая `objectId` (инвариант слоя по schema); без **`targetMode`** для совместимости используется подъём до group-root (как для grouped stencils). |
| `moveLayerUnderLayer` | `{ "pageId": "...", "childLayerName": "...", "parentLayerName": "...", "makeVisible": true, "suppressStencilEvents": true }` | Вкладывает mxCell слоя `childLayerName` под слой `parentLayerName` (опционально для ручных сценариев; **не** вызывается из `events/reparent.py`). |
| `createPage` | `{ "title": "...", "selectCreated": false }` | Создает страницу через штатные API draw.io (`ui.createPage` + `ui.insertPage`) с заданным именем; для сценария add-page рекомендуется `selectCreated=false`. |
| `setCellLinkToPage` | `{ "objectId": "...", "targetPageId": "..." }` | Устанавливает ссылку `data:page/id,<pageId>` в выбранный объект через `graph.setLinkForCell(...)`; `targetPageId` должен быть валидным. |
| `insertStencilFromP41ByTitle` | `{ "pageId": "...", "mirrorTitle": "...", "x": 20, "y": 20, "sourceSchema": "..." }` | Ищет элемент в библиотеке `SEAF_Р41` по `title`, вставляет группу на страницу; в `objectId` возвращает первую вставленную ячейку, у которой `schema` совпадает с `sourceSchema` (для последующего `updateStencilDataBulk`). Если такой ячейки нет — `status: error`, `reason: mirror_not_found`. |
| `assignEmptyOidOnPage` | `{ "pageId": "...", "companyPrefix": "company", "suppressStencilEvents": true }` | Находит на странице объекты, где атрибут `OID` существует и пуст, и присваивает уникальные значения по OID-алгоритму `all_add`. |

### Результат UI-команд

- Renderer агрегирует возвращаемые значения UI-команд в `result.payload.uiCommandResults`.
- Для `ensureLayer` возвращается объект вида:
  - `{ "status": "created|existing", "layerId": "...", "layerName": "..." }`.
- Для сценария `createPage -> setCellLinkToPage` runtime валидирует `uiCommandResults`: если `createPage` не вернул `pageId` или link-команда вернула `status!=updated`, весь сценарий переводится в `status=error`.
- Для mirror-ветки `seafAddPage` runtime дополнительно валидирует:
  - `insertStencilFromP41ByTitle.status === "inserted"`;
  - `updateStencilDataBulk.updated >= 1`;
  - `moveObjectsToLayer.moved >= 1`.
- При нарушении любого из условий сценарий переводится в `status=error`.
- Layer-routing для `events/all_add.py` и `context_menu/add_page.py` унифицирован в Python helper `lib/events/layer_routing.py`; `add_page.py` передает в `moveObjectsToLayer` уже вычисленный `layerName` (без JS-резолва `schema -> layer`).
- Для финального шага `assignEmptyOidOnPage` runtime валидирует статус `updated|noop`; при другом статусе результат `seafAddPage` переводится в `status=error` (`assign_oid_failed`).

## 3) Разбор вашего примера `Response` (ошибка) и как поля используются

Пример:

```python
response = {
    "status": "error",
    "message": "Simulated script error for debugging--1",
    "payload": {},
    "commands": [
        {
            "name": "showMessage",
            "args": {"level": "error", "text": "Failure demo command returned error"},
        }
    ],
    "errors": ["simulated_error"],
}
sys.stdout.write(json.dumps(response))
return 1
```

Что означает каждое поле и как оно влияет на поведение:

- **`status: "error"`**
  - **Назначение**: сигнализирует UI, что команда завершилась с ошибкой.
  - **Как используется**: UI после получения ответа проверяет `result.status`. Если это `error`, показывается ошибка (через диалог) с текстом из `message`.

- **`message`**
  - **Назначение**: основной текст для пользователя.
  - **Как используется**: при `status="error"` UI формирует строку ошибки вида `"<commandId>: <message>"` и показывает её.

- **`payload: {}`**
  - **Назначение**: «контейнер» произвольных данных результата (можно вернуть детали вычислений, списки, диагностику).
  - **Как используется**: текущие демо‑скрипты обычно не требуют `payload` для UI‑логики, но он полезен для расширения протокола и для логов.

- **`commands: [...]`**
  - **Назначение**: указание UI выполнить дополнительные действия.
  - **Как используется**: UI проходит по массиву и выполняет команды по `name`.
  - В примере `showMessage` с `level="error"` и текстом — это **дополнительное** сообщение пользователю. Оно выполнится независимо от того, что `status="error"` (то есть вы можете и показать всплывашку, и попросить UI сделать другое действие).

- **`errors: ["simulated_error"]`**
  - **Назначение**: машинные коды ошибок.
  - **Как используется**: удобно для логов/фильтрации/автоматизации (например, различать `selection_is_empty` и `timeout`). В текущих демо‑скриптах UI напрямую не ветвится по `errors`, но backend/логи могут это сохранять.

- **`return 1` (код возврата процесса)**
  - **Назначение**: системный признак неуспеха выполнения скрипта.
  - **Как используется**: в идеальной схеме backend может учитывать и `status`, и exit code. В ваших демо есть нюанс: некоторые скрипты возвращают `0` даже при `status="error"` (например, `validate_selection.py` в ветке «нет выделения»). Поэтому **надёжнее считать источником истины `Response.status`**, а exit code — как дополнительный сигнал для инфраструктуры/обвязки.

## 4) Рекомендации по стабильному контракту

Чтобы протокол был предсказуемым:
- Всегда возвращайте `Response` со всеми ключами: `status`, `message`, `payload`, `commands`, `errors` (пусть даже пустыми).
- Согласуйте exit code с `status`:
  - `status="success"` → `return 0`
  - `status="error"` → `return 1`
- Если скрипт падает исключением, старайтесь перехватывать его и возвращать `status="error"` + понятный `message` и `errors`.

Рекомендуется использовать helper layer:

```python
from lib.io import read_request, get_payload, get_arguments, write_response, emit_progress
```

Это дает единый контракт для всех команд и уменьшает дублирование шаблонного кода.

## 5) События прогресса для `percent` индикатора

Если команда в `conf/plugin.yaml` использует `indicator.type: percent`, скрипт может передавать прогресс в реальном времени через `stderr`.

Формат строки:

```text
SEAF_PROGRESS {"progress": 40, "phase": "step 2 of 5", "message": "Processing data"}
```

Требования:
- префикс должен быть строго `SEAF_PROGRESS `;
- JSON должен быть валидным;
- `progress` — число `0..100` (опционально, но желательно для `percent`);
- `phase` и `message` — опциональные строки.

Пример:

```python
for step in range(total):
    progress = int(((step + 1) * 100) / total)
    sys.stderr.write(
        "SEAF_PROGRESS " + json.dumps({"progress": progress, "phase": f"step {step + 1} of {total}"}) + "\n"
    )
    sys.stderr.flush()
```

## 6) Ручное управление индикатором через SEAF plugin API

Когда в команде нет блока `indicator`, индикатор можно запускать/закрывать из JS-кода плагина:

- `window.SEAF_PLUGIN_API.startIndicator(params)`
- `window.SEAF_PLUGIN_API.stopIndicator(indicatorId, reason)`

`startIndicator(params)` принимает:
- `type`: `spinner | percent`
- `title`: заголовок виджета
- `message`: стартовый текст
- `timeoutMs`: таймаут
- `allowStop`: показывать кнопку `Остановить`
- `onStop`: callback при остановке пользователем
- `onTimeout`: callback при локальном таймауте

Пример использования:

```javascript
const handle = await window.SEAF_PLUGIN_API.startIndicator({
  type: 'spinner',
  title: 'Manual SEAF operation',
  message: 'Preparing...',
  allowStop: true
});

try {
  // long operation
} finally {
  await window.SEAF_PLUGIN_API.stopIndicator(handle.indicatorId, 'completed');
}
```

## 7) Interactive terminal mode

Для команды с `clientAction: interactiveTerminal` / `execution.mode: interactive_terminal` скрипт выполняется в реальном terminal TTY, а не через стандартный JSON stdin/stdout протокол.

Что это означает:
- можно использовать обычные `print(...)`, `input(...)`, `sys.stdin`, `sys.stdout`;
- draw.io открывает отдельное modal terminal-окно и блокирует editor до его закрытия;
- переменные из `env.yaml` и payload доступны через environment variables:
  - `SEAF_RUNTIME_ENV_JSON`
  - `SEAF_PAYLOAD_JSON`
  - `SEAF_COMMAND_ID`
  - `SEAF_COMMAND_TITLE`
  - `SEAF_RUNTIME_CONFIG_PATH`
- для отдельных ключей из `env.yaml` также экспортируются переменные вида `SEAF_ENV_<KEY>`.

Этот режим предназначен для truly interactive CLI-сценариев и не требует возврата JSON `Response`.

Для demo-команды `examples/interactive_terminal_demo.py`:
- команда `exception` (также `error`/`fail`) запрашивает подтверждение `Y/N`;
- при `Y` скрипт симулирует исключение и завершается с ошибкой;
- draw.io закрывает terminal-окно, снимает блокировку editor и показывает сообщение об ошибке.

## 8) Stencil events contract

Auto-event processor передает event batch в Python handlers через `REQUEST.payload.event`.

Источник:
- `event.yaml.handlers.<event>` -> `plugin.yaml.commands[id]` -> `script`.

Это означает:
- значения вроде `seafStencilSpecificModify` — это **command id**, а не Python/JS функция;
- реальный файл скрипта определяется в `plugin.yaml` полем `commands[].script`.
- для сценария OID используется `add`-маршрут с wildcard-правилом `seaf.company.ta.*`, а handler возвращает `updateStencilDataBulk`.

Формат `REQUEST.payload.event`:

| Поле | Формат | Назначение |
|---|---:|---|
| `eventType` | `add \| remove \| modify \| reparent` | Тип события |
| `ruleId` | `string` | matched rule из `event.yaml` |
| `listId` | `string` | matched stencil list |
| `txId` | `string` | идентификатор транзакции модели |
| `timestamp` | `string` | время события |
| `page` | `object` | текущая страница `{id,name}` |
| `items` | `array<object>` | затронутые объекты |

`items[]` обычно содержит:
- `id`, `operation`, `label`, `schema`, `style`, `styleText`, `geometry`, `value`.
- для `operation=reparent` дополнительно: `previousParentId`, `newParentId`, `previousLayerName`, `currentLayerName`, **`targetParentLayerName`** (ближайший страничный слой над новым родителем — только для логов/диагностики; handler `reparent` не меняет слои).

Примечание для grouped stencils:
- если root group-ячейка добавления не содержит `schema`, runtime извлекает `add`-items из дочерних ячеек с валидным `schema`, чтобы `all_add` корректно формировал `moveObjectsToLayer`.
- при `reparent` Python handler только логирует полный `payload.event` в `SEAF_INFO` (`reparentScriptFired`); команд нет.

Для `eventType=modify` добавляются:
- `dataBefore`, `dataAfter`.

Renderer (`plugin/seaf.plugin.js`) эмитит `modify` только при реальном изменении: сравнивается нормализованная карта атрибутов `dataBefore`/`dataAfter` (плюс резервное сравнение сериализованного `value`), чтобы изменения полей не терялись до вызова Python handler.

## Export: отчёт в логе

Включение: **SEAF → Edit Config** → `pluginLogLevel: info` или `debug`.

| Уровень | Содержание |
|---------|------------|
| `info` | `reportLevel: summary` — counts (eligible, exported, `exportErrorCount` = только `seaf.*` без OID), `writtenFiles`, `warnings` |
| `debug` | `reportLevel: detail` — per-object eligible/exported/skipped; `skippedIgnored` — schema без OID не `seaf.*` (не ошибка) |

Зависимость Export: `PyYAML` (`python/requirements.txt`). Каталог схем: `python/vendor/yaml_schema_generator/schemas` (override: `env.schemaDir`).

Формат YAML на диске:

```yaml
seaf.company.ta.services.dcs:
  company.services.dcs.1:
    title: ...
```

