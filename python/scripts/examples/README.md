# Python examples (`python/scripts/examples`)

Этот каталог содержит демонстрационные entrypoint-скрипты для SEAF runtime.
Скрипты используются командами из `seaf-plugin-runtime/conf/plugin.yaml` и показывают основные режимы выполнения:

- `sync` (обычный запрос/ответ);
- `async` с прогрессом через `SEAF_PROGRESS`;
- `interactive_terminal` в реальном TTY.

## Общий контракт

Для `sync`/`async` скриптов используется helper-слой из `python/scripts/lib/io/__init__.py`:

- `read_request()` — читает root REQUEST JSON из `stdin`;
- `get_payload(request)` — достает `request.payload`;
- `get_arguments(request)` — достает `request.payload.arguments`;
- `emit_progress(progress, phase, message)` — пишет строку прогресса в `stderr`;
- `write_response(...)` — формирует итоговый Response JSON в `stdout`.

Ожидаемая структура результата:

- `status`: `success | error`
- `message`: текст результата
- `payload`: объект данных результата
- `commands`: массив UI-команд (`showMessage`, `reloadDocument`, `refreshGraph`, `selectCells`)
- `errors`: массив кодов ошибок

## 1) `success_reload.py`

### Что делает

- Демонстрация успешного sync-скрипта.
- Возвращает информацию о команде и количестве выделенных объектов.
- Просит UI показать сообщение и перезагрузить документ.

### Что получает на вход

- Root `REQUEST` из `stdin`.
- Использует:
  - `request.commandId`
  - `request.payload.selection` (опционально)

### Что возвращает

- `status: "success"`
- `message: "Document reload flow completed"`
- `payload`:
  - `receivedCommandId`
  - `selectionCount`
- `commands`:
  - `showMessage` (`level=info`)
  - `reloadDocument`
- `errors: []`

### Логика внутри скрипта

1. `read_request()` читает входной JSON.
2. `get_payload()` извлекает `payload`.
3. Считается длина `selection`.
4. Возвращается `write_response(...)` с успешным статусом и UI-командами.

## 2) `validate_selection.py`

### Что делает

- Проверяет, есть ли выделение в диаграмме.
- Если выделения нет — возвращает ошибку с подсказкой пользователю.
- Если выделение есть — собирает `id` объектов и просит UI выделить их явно.

### Что получает на вход

- Root `REQUEST` из `stdin`.
- Использует:
  - `request.payload.selection` (массив объектов)
  - у элементов массива ожидается поле `id`.

### Что возвращает

Ветка без выделения:

- `status: "error"`
- `message: "No selected objects found"`
- `commands`: `showMessage` (`level=error`)
- `errors: ["selection_is_empty"]`
- `exit_code=0` (важно: ошибка сигнализируется через `status`, а не код процесса)

Ветка с выделением:

- `status: "success"`
- `message: "Validated N selected object(s)"`
- `payload.selectedIds`: список `id`
- `commands`:
  - `selectCells` с `cellIds`
  - `showMessage` (`level=info`)

### Логика внутри скрипта

1. Читает REQUEST (`read_request`).
2. Извлекает `payload` и `selection`.
3. При пустом `selection` возвращает error-response.
4. Иначе фильтрует `id`, формирует `selectedIds` и возвращает success-response.

## 3) `async_background.py`

### Что делает

- Демонстрирует фоновую async-задачу с прогрессом.
- Пошагово отправляет прогресс в `stderr` в формате `SEAF_PROGRESS {...}`.
- По завершении возвращает `success` и UI-команду обновления графа.

### Что получает на вход

- Root `REQUEST` из `stdin`.
- Использует `request.payload.arguments.simulateDurationSec` (опционально).
- По умолчанию `simulateDurationSec = 2`, минимум — `1`.

### Что возвращает

- `status: "success"`
- `message: "Background task completed"`
- `payload.durationSec`
- `commands`:
  - `showMessage` (`level=info`)
  - `refreshGraph`
- `errors: []`

### Прогресс

На каждом шаге:

- вычисляет `progress` (0..100);
- формирует фазу `step X of N`;
- вызывает `emit_progress(progress, phase=...)`;
- ждет `1` секунду (`time.sleep(1)`).

### Логика внутри скрипта

1. Читает REQUEST и `arguments`.
2. Определяет длительность симуляции.
3. Выполняет цикл шагов с `emit_progress`.
4. Возвращает success-response.

## 4) `failure_demo.py`

### Что делает

- Демонстрация управляемой ошибки.
- Всегда возвращает error-response.

### Что получает на вход

- Root `REQUEST` из `stdin` (читается для сохранения контракта, но не используется в логике).

### Что возвращает

- `status: "error"`
- `message: "Simulated script error for debugging"`
- `commands`: `showMessage` (`level=error`)
- `errors: ["simulated_error"]`
- `exit_code=1`

### Логика внутри скрипта

1. Читает REQUEST.
2. Формирует заранее определенный error-response.

## 5) `timeout_demo.py`

### Что делает

- Демонстрирует долгую операцию.
- Спит указанное число секунд, после чего возвращает успех.
- Используется для проверки таймаутов на уровне runtime-конфига.

### Что получает на вход

- Root `REQUEST` из `stdin`.
- Использует `request.payload.arguments.sleepSec` (опционально).
- Значение по умолчанию: `120`.

### Что возвращает

- `status: "success"`
- `message: "Completed after sleep"`
- `payload.sleepSec`
- `commands: []`
- `errors: []`

### Логика внутри скрипта

1. Читает REQUEST и `arguments`.
2. Берет `sleepSec`.
3. Делает `time.sleep(max(0, sleepSec))`.
4. Возвращает success-response.

## 6) `interactive_terminal_demo.py`

### Что делает

- Демонстрирует интерактивный terminal-режим (`execution.mode: interactive_terminal`).
- Работает в реальном TTY: читает команды пользователя через `input`.
- Поддерживает команды:
  - `help`
  - `env`
  - `page`
  - `exception` (также `error`, `fail`)
  - `quit`/`exit`

### Что получает на вход

Этот скрипт не использует JSON REQUEST через `stdin`, а работает через environment variables:

- `SEAF_PAYLOAD_JSON` — payload текущего вызова;
- `SEAF_RUNTIME_ENV_JSON` — текущие значения `env.yaml`.

Из `SEAF_PAYLOAD_JSON` читает `currentPage`.

### Что возвращает

- Завершение через код процесса:
  - `0` — штатный выход (`quit`, EOF);
  - `130` — `KeyboardInterrupt`;
  - исключение `RuntimeError` — аварийный сценарий по команде `exception` + подтверждение `Y`.

Важно: это интерактивный скрипт, он не формирует `write_response(...)` JSON в `stdout`.

### Логика внутри скрипта

1. Печатает стартовые инструкции и список команд.
2. Пытается распарсить `SEAF_PAYLOAD_JSON`.
3. В цикле принимает ввод пользователя.
4. Выполняет действия по командам:
   - `help`: выводит помощь;
   - `env`: печатает `SEAF_RUNTIME_ENV_JSON`;
   - `page`: печатает `currentPage`;
   - `exception`: спрашивает `Y/N` и при `Y` бросает исключение;
   - любой другой текст: `Echo: ...`;
   - пустой ввод: отдельное сообщение.

## Содержимое примеров и соответствие пунктам меню

- `SEAF Reload Document` -> `examples/success_reload.py`
- `SEAF Validate Selection` -> `examples/validate_selection.py`
- `SEAF Async Background Task` -> `examples/async_background.py`
- `SEAF Failure Demo` -> `examples/failure_demo.py`
- `SEAF Timeout Demo` -> `examples/timeout_demo.py`
- `SEAF Interactive Terminal Demo` -> `examples/interactive_terminal_demo.py`

## Практические замечания

- Для новых `sync`/`async` примеров рекомендуется всегда использовать `lib.io` helpers.
- Для `async` задач используйте `emit_progress(...)`, если нужен `percent`-индикатор в UI.
- Для интерактивных CLI-сценариев используйте шаблон `interactive_terminal_demo.py` (TTY + `input`/`print`).
