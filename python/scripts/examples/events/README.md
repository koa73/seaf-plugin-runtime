# Stencil Event Handlers (`examples/events`)

Этот каталог содержит 6 тестовых Python-обработчиков для auto-event processor.

Важно:
- `event.yaml` хранит **handler id** (например, `seafStencilSpecificModify`), а не путь к `.py`.
- Связка с файлами скриптов задается в `conf/plugin.yaml` через `commands[].id -> commands[].script`.

## Маршрутизация handler id -> script

| Handler id (`event.yaml`) | Command id (`plugin.yaml`) | Script file |
|---|---|---|
| `seafStencilSpecificAdd` | `seafStencilSpecificAdd` | `specific_add.py` |
| `seafStencilSpecificRemove` | `seafStencilSpecificRemove` | `specific_remove.py` |
| `seafStencilSpecificModify` | `seafStencilSpecificModify` | `specific_modify.py` |
| `seafStencilAllAdd` | `seafStencilAllAdd` | `all_add.py` |
| `seafStencilAllRemove` | `seafStencilAllRemove` | `all_remove.py` |
| `seafStencilAllModify` | `seafStencilAllModify` | `all_modify.py` |

## Что делают эти скрипты

Все 6 скриптов используют одинаковый шаблон:
1. Читают входной `REQUEST` через `lib.io.read_request()`.
2. Извлекают `payload.event.items`.
3. Возвращают `status=success` через `lib.io.write_response(...)`.
4. В `payload` ответа возвращают:
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
- `eventType`: `add` | `remove` | `modify`
- `ruleId`: id matched правила из `event.yaml`
- `listId`: id matched списка стенсилов
- `txId`: id транзакции модели
- `timestamp`: ISO datetime
- `page`: `{id, name}`
- `items[]`: список измененных объектов

### `items[]` для `add/remove`

- `id`
- `operation`
- `label`
- `schema`
- `style`
- `styleText`
- `geometry`
- `value`

### `items[]` для `modify`

Дополнительно к полям выше:
- `dataBefore`: данные объекта до `Edit Data -> Apply`
- `dataAfter`: данные объекта после `Edit Data -> Apply`

## По скриптам отдельно

- `specific_add.py`:
  - обрабатывает событие `add` для specific-rule.
- `specific_remove.py`:
  - обрабатывает событие `remove` для specific-rule.
- `specific_modify.py`:
  - обрабатывает событие `modify` для specific-rule.
- `all_add.py`:
  - fallback-обработчик `add` для правила `all`.
- `all_remove.py`:
  - fallback-обработчик `remove` для правила `all`.
- `all_modify.py`:
  - fallback-обработчик `modify` для правила `all`.
