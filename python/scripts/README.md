# Python scripts: формат `REQUEST` и `Response`

Этот каталог содержит Python‑скрипты, которые runtime‑плагин запускает из draw.io Desktop.

Принцип работы:
- UI формирует `REQUEST` (JSON) и передаёт его в **stdin** скрипта.
- Скрипт печатает **в stdout** JSON‑объект `Response`.
- По `Response` UI выполняет интерактивные команды (`commands[]`) и показывает пользователю сообщение.

Примеры скриптов в этом каталоге:
- `success_reload.py` — успешный ответ + команды `showMessage` и `reloadDocument`.
- `validate_selection.py` — валидация выделения + команда `selectCells`.
- `async_background.py` — имитация фоновой задачи (использует `arguments.simulateDurationSec`).
- `failure_demo.py` — пример ошибки (error‑response).
- `timeout_demo.py` — пример «долгого» выполнения (для демонстрации таймаута).

## 1) Структура `REQUEST` (stdin)

Важно: в текущих демо‑скриптах часто используется подход:

```python
raw = sys.stdin.read()
req = json.loads(raw) if raw.strip() else {}
payload = req.get("payload") or {}
args = payload.get("arguments") or {}
```

То есть скрипты ожидают объект с полем `payload` и дальше работают с `payload.selection`, `payload.arguments` и т.п.

### Таблица полей `REQUEST`

| Поле | Формат | Назначение |
|---|---:|---|
| `payload` | `object` | Основной контейнер данных, которые UI передаёт скрипту. В демо‑скриптах почти вся логика завязана на `REQUEST.payload`. |

### Таблица полей `REQUEST.payload`

| Поле | Формат | Назначение |
|---|---:|---|
| `commandId` | `string` | Идентификатор команды, которая вызвала скрипт (соответствует `commands[].id` в `conf/plugin.yaml`). Удобно для маршрутизации/логов. |
| `source` | `string` | Источник вызова (например, `menu`). Можно использовать для аналитики/ветвления логики. |
| `timestamp` | `string` (ISO‑8601) | Время формирования payload на UI‑стороне. |
| `selection` | `array<object>` | Снимок текущего выделения в диаграмме. Скрипты используют это для проверок и для выбора/подсветки объектов. |
| `diagramXml` | `string` (XML) | Опционально. Полная диаграмма в виде XML. Попадает сюда, если в `plugin.yaml` у команды стоит `input.includeDiagramXml: true`. |
| `currentPage` | `object` | Опционально. Текущая страница `{id, name}`. Попадает сюда, если `input.includeCurrentPage: true`. |
| `arguments` | `object` | Опционально. Аргументы команды из `plugin.yaml` (`commands[].input.arguments`). Используется для параметризации (например, тайминги, режимы). |
| `env` | `object` | Значения из `conf/env.yaml`, инжектятся runtime перед запуском скрипта. |

### `REQUEST.payload.selection[]` (элемент массива)

Точный состав может расширяться, но текущая реализация формирует примерно такие поля:

| Поле | Формат | Назначение |
|---|---:|---|
| `id` | `string` | ID объекта (cell) в графе. Используется, например, чтобы вернуть `selectCells` с `cellIds`. |
| `isVertex` | `boolean` | Является ли объект вершиной. |
| `isEdge` | `boolean` | Является ли объект ребром. |
| `label` | `string` | Отображаемая подпись. |
| `style` | `object` | Стиль объекта (ключи/значения). |
| `geometry` | `object` | Геометрия (координаты/размеры). |

### Config values from `env.yaml`

Runtime передает значения редактируемой конфигурации в двух местах:
- `REQUEST.payload.env`
- `REQUEST.payload.arguments` (merge поверх `input.arguments`)

Это сделано для обратной совместимости скриптов.

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

