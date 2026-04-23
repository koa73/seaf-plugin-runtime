# Конфигурация SEAF runtime (`plugin.yaml`)

Файл [`plugin.yaml`](plugin.yaml) описывает:
- метаданные runtime‑плагина (id/название/версия),
- как запускать Python‑скрипты (интерпретатор и каталог),
- параметры логирования,
- параметры обновления runtime из GitHub Releases,
- набор команд (`commands[]`), которые добавляются в меню draw.io и запускают Python‑скрипты.

Ниже — **таблица всех полей**, их формат и назначение (по текущей реализации runtime‑пакета).

## Общие поля

| Имя поля | Формат | Назначение |
|---|---:|---|
| `version` | `number` | Версия схемы конфигурации. Сейчас используется как декларативное поле (для совместимости/эволюции формата). |

## `plugin.*`

| Имя поля | Формат | Назначение |
|---|---:|---|
| `plugin.id` | `string` | Идентификатор плагина. Используется как часть структуры runtime (например, имя каталога `seaf_plugin`). |
| `plugin.name` | `string` | Человекочитаемое имя плагина. |
| `plugin.description` | `string` | Описание плагина. |
| `plugin.runtimeVersion` | `string` | Фолбэк‑версия runtime, которая показывается в UI, если `runtime/version.json` недоступен. |

## `python.*`

| Имя поля | Формат | Назначение |
|---|---:|---|
| `python.executable` | `string` | Команда/путь для запуска Python (например, `python3`). |
| `python.requirementsFile` | `string` (relative path) | Путь к requirements-файлу для автоматической установки зависимостей. |
| `python.requiredModules` | `array<string>` | Список модулей для preflight-проверки импортов перед запуском команд. |
| `python.scriptsDir` | `string` (relative path) | Каталог скриптов относительно `conf/plugin.yaml` (например, `../python/scripts`). В командах ниже поле `script` указывает файл **внутри этого каталога**. |

`env.yaml` дополнительно хранит пользовательский путь `pythonExecutable`, который задается в `SEAF -> Edit Config`.
Именно этот интерпретатор используется для запуска скриптов и `pip install -r requirements.txt`.

## `logging.*`

> Примечание: часть настроек логирования используется в UI‑плагине напрямую (например, `includePayload` влияет на то, будет ли UI отправлять payload в логи; при этом чувствительные ключи маскируются).

| Имя поля | Формат | Назначение |
|---|---:|---|
| `logging.level` | `string` (`debug|info|warn|error`) | Технический fallback уровня логирования (если `env.pluginLogLevel` не задан). |
| `logging.extendedDebug` | `boolean` | Расширенная отладка (подробнее писать в логи). |
| `logging.includePayload` | `boolean` | Если `true`, UI‑плагин будет передавать в лог‑записи объект `data` (payload при вызове команд). Если `false` — payload не пишется. |
| `logging.output` | `string` (`file|console|both`) | Куда писать логи: в файл, в консоль или в оба места. |
| `logging.filePath` | `string` (relative path) | Путь к файлу логов относительно runtime (в примере: `../logs/seaf-plugin.log`). |

## `update.*` (обновление runtime из GitHub)

Эти параметры используются пунктом меню **`SEAF -> Update Plugin Runtime`**.

| Имя поля | Формат | Назначение |
|---|---:|---|
| `update.enabled` | `boolean` | Включить/выключить обновления runtime из GitHub. Если `false`, действие обновления покажет ошибку, что обновление отключено. |
| `update.repo` | `string` (`owner/repo`) | Репозиторий GitHub, откуда скачивать релизы (например, `my-org/my-repo`). Если пусто — обновление не стартует. |
| `update.assetName` | `string` | Имя asset в Release (по умолчанию `seaf-plugin-runtime.tar.gz`). |
| `update.tag` | `string` или пусто | Тег релиза. Если пусто — используется «latest» (по логике обновлятора). |
| `update.apiBaseUrl` | `string` URL | База GitHub API (обычно `https://api.github.com`). Полезно для GitHub Enterprise/прокси. |
| `update.expectedMinVersion` | `string` semver | Минимально допустимая версия runtime в скачанном asset. Если архив содержит более старую версию, update завершается с ошибкой «получен устаревший runtime asset». |

## `commands[]` — описание команд меню

`commands` — это список команд, каждая команда:
- получает `payload` (сформированный UI‑плагином),
- запускает Python‑скрипт,
- получает `Response` (JSON) из stdout скрипта,
- может выполнить `commands[]` (UI‑команды из ответа) и/или `postActions[]` (UI‑команды из конфигурации).

Ниже описаны поля объекта команды `commands[i]`.

### Основные поля команды

| Имя поля | Формат | Назначение |
|---|---:|---|
| `commands[].id` | `string` | Уникальный id команды. Используется как id `action` в draw.io и как `commandId` в `REQUEST`. |
| `commands[].title` | `string` | Заголовок команды (как отображается пользователю). |
| `commands[].script` | `string` (filename) | Имя Python‑скрипта (например, `validate_selection.py`). Скрипт ищется в каталоге `python.scriptsDir`. |
| `commands[].clientAction` | `string` | UI-действие без стандартного JSON-runner (например, `editConfig` для открытия формы редактирования `env.yaml`, `interactiveTerminal` для запуска интерактивного terminal-окна). |

### `commands[].menu.main.*` — добавление в главное меню

| Имя поля | Формат | Назначение |
|---|---:|---|
| `commands[].menu.main.enabled` | `boolean` | Если `false`, команда не попадёт в верхнее меню. |
| `commands[].menu.main.section` | `string` | Идентификатор верхнего меню (например, `seaf` или `extras`). |
| `commands[].menu.main.sectionTitle` | `string` | Заголовок верхнего меню (например, `SEAF`). Если не задан — используется `section`. |
| `commands[].menu.main.submenu` | `string` (`p41|tools|examples`) | Опциональная группировка внутри меню `SEAF` во вложенные подменю. |

### `commands[].menu.context.*` — добавление в контекстное меню

| Имя поля | Формат | Назначение |
|---|---:|---|
| `commands[].menu.context.enabled` | `boolean` | Если `false`, команда не добавляется в контекстное меню. |
| `commands[].menu.context.target` | `string` | Условие, когда команда показывается в контекстном меню. Возможные значения (по текущей реализации): `any`, `selection_non_empty`, `selection_single`, `vertex`, `edge`. |

### `commands[].execution.*` — режим выполнения

| Имя поля | Формат | Назначение |
|---|---:|---|
| `commands[].execution.mode` | `string` (`sync|async|interactive_terminal`) | Режим выполнения: синхронно ждать результат, запускать в фоне с polling или открывать модальное interactive terminal-окно с реальным TTY. |
| `commands[].execution.timeoutSec` | `number` | Таймаут выполнения скрипта (секунды). Для `sync` — ограничение по времени выполнения; для `async` — обычно используется на шаге запуска/опроса. |
| `commands[].execution.pollIntervalMs` | `number` | Только для `async`: интервал опроса статуса job (мс). |
| `commands[].execution.maxPollAttempts` | `number` | Только для `async`: максимальное число попыток опроса. |

### `commands[].input.*` — какие данные попадут в `REQUEST.payload`

UI‑плагин формирует `REQUEST.payload` и может добавлять опциональные поля.

| Имя поля | Формат | Назначение |
|---|---:|---|
| `commands[].input.includeDiagramXml` | `boolean` | Если `true`, в `REQUEST.payload` будет добавлен `diagramXml` (XML диаграммы). |
| `commands[].input.includeCurrentPage` | `boolean` | Если `true`, добавляется `currentPage` (`{id,name}`) для текущей страницы. |
| `commands[].input.arguments` | `object` | Произвольные аргументы команды, будут добавлены в `REQUEST.payload.arguments`. Используйте для параметризации скрипта без правок кода. |

### `commands[].output.*` — ожидания по результату

| Имя поля | Формат | Назначение |
|---|---:|---|
| `commands[].output.expectedStatus` | `string` (`success|error`) | Ожидаемый статус результата. Используется как декларативная настройка/самодокументация (чтобы было ясно, что должна вернуть команда). |

### `commands[].postActions[]` — UI‑действия после выполнения

`postActions` — список UI‑команд, которые выполняются **на стороне UI** (draw.io) после выполнения команды (в дополнение к `Response.commands[]`, если они возвращаются скриптом).

| Имя поля | Формат | Назначение |
|---|---:|---|
| `commands[].postActions[].name` | `string` | Имя UI‑команды (например, `showMessage`, `reloadDocument`). |
| `commands[].postActions[].args` | `object` | Аргументы UI‑команды. Структура зависит от `name`. |

### `commands[].indicator.*` — индикатор выполнения команды

Индикатор задается прямо в описании команды и управляет отображением прогресса в UI при `execution.mode: async`.

| Имя поля | Формат | Назначение |
|---|---:|---|
| `commands[].indicator.enabled` | `boolean` | Включает/выключает индикатор выполнения для команды. |
| `commands[].indicator.type` | `string` (`spinner|percent`) | Тип индикатора. `percent` показывает прогресс, если скрипт отправляет события прогресса; иначе UI делает fallback на текст. |
| `commands[].indicator.timeoutMs` | `number \| null` | Локальный таймаут индикатора в миллисекундах. При срабатывании UI отправляет запрос на отмену фоновой job; итоговый статус обычно `timed_out` или `cancelled` (зависит от состояния job в момент отмены). |
| `commands[].indicator.allowStop` | `boolean` | Показывает кнопку `Остановить` только если `timeoutMs` **не задан** (`null`). Если `timeoutMs` задан, ручная кнопка в авто-индикаторе не показывается. |

## `configEditor` (schema-driven форма Edit Config)

Команда с `clientAction: editConfig` может содержать блок `configEditor`, который описывает поля формы и связывает их с переменными `conf/env.yaml`.

| Поле | Формат | Назначение |
|---|---:|---|
| `commands[].configEditor.title` | `string` | Заголовок формы редактирования |
| `commands[].configEditor.fields[]` | `array<object>` | Описание полей формы |
| `fields[].label` | `string` | Текст подписи в UI |
| `fields[].envKey` | `string` | Ключ переменной в `env.yaml` |
| `fields[].inputMethod` | `string` | Метод редактирования: `text`, `list`, `filePicker`, `checkbox`, `radio` |
| `fields[].options` | `array<string>` | Набор значений для `list` и `radio` |
| `fields[].fileDialog` | `object` | Параметры системного file dialog для `filePicker` |
| `fields[].syncFrom` | `string` | Опционально: `envKey` поля-источника для автосинхронизации значения |
| `fields[].disableWhen` | `object` | Опционально: условие блокировки поля (`{envKey, equals}`) |
| `fields[].helpText` | `string` | Опционально: текст подсказки для иконки `?` рядом с label поля |

### Поддерживаемые inputMethod

- `text`: обычное текстовое поле.
- `list`: выпадающий список из `options`.
- `filePicker`: текстовое поле + кнопка выбора файла через системный навигатор.
- `checkbox`: булево значение `true/false`.
- `radio`: выбор одного значения из `options`.

### Рекомендуемая схема `Edit Config` для SEAF

Порядок полей и ожидаемые `envKey`:
- `Company prefix` -> `companyPrefix` (`text`)
- `Input SEAF file` -> `inputSeafFile` (`filePicker`)
- `Use same output file` -> `useSameOutputFile` (`checkbox`)
- `Output SEAF file` -> `outputSeafFile` (`text`)
- `Plugin logging` -> `pluginLogLevel` (`list`, options: `none|info|debug`)
- `Python executable` -> `pythonExecutable` (`filePicker`)
- Для любого поля можно задать `helpText`, чтобы показать tooltip-иконку `?` рядом с подписью.

UX-правило:
- если `useSameOutputFile=true`, поле `outputSeafFile` синхронизируется со значением `inputSeafFile` и блокируется для редактирования;
- при выборе файла через `Browse` для `inputSeafFile` значение `outputSeafFile` обновляется автоматически только в этом режиме.

Пример декларативной зависимости:

```yaml
- label: Output SEAF file
  envKey: outputSeafFile
  inputMethod: text
  syncFrom: inputSeafFile
  disableWhen:
    envKey: useSameOutputFile
    equals: true
```

## `interactiveTerminal` (interactive sync terminal execution)

Команда с `clientAction: interactiveTerminal` и `execution.mode: interactive_terminal` запускается не через стандартный JSON stdin/stdout runner, а в отдельном modal terminal-окне draw.io desktop.

Особенности режима:
- editor draw.io блокируется modal overlay до закрытия terminal-окна;
- Python-скрипт запускается в настоящем TTY (`node-pty`), поэтому доступны `print(...)`, `input(...)` и другое интерактивное консольное поведение;
- terminal-окно масштабируемое, стартует примерно в размере `1/2` окна редактора;
- после завершения процесса terminal-окно остается открытым до ручного закрытия пользователем;
- если terminal-окно закрыто принудительно до завершения, процесс Python завершается принудительно.

## `env.yaml`

Файл `conf/env.yaml` хранит редактируемые значения, используемые командами и Python-скриптами.

Пример:

```yaml
companyPrefix: ""
inputSeafFile: ""
useSameOutputFile: true
outputSeafFile: ""
pluginLogLevel: "none"
pythonExecutable: ""
```

`pluginLogLevel` управляет эффективной моделью логирования runtime:
- `none` — файловое логирование отключается, остаются только минимальные системные сообщения в консоли (`error`);
- `info` — стандартные информационные/ошибочные записи;
- `debug` — расширенная детализация (включая debug и extended debug).

## Структура меню SEAF (вложенные подменю)

Текущая структура главного меню `SEAF`:
- `Edit Config` (верхний уровень);
- `P41` (подменю, сейчас пустое);
- `Tools` (подменю со служебными утилитами);
- `Examples` (подменю с demo-командами);
- `Обновить плагин`;
- `SEAF Runtime v...`.

Правило маршрутизации для demo-команд:
- пункты, у которых `title` начинается с `SEAF`, относятся к группе `Examples`;
- для явной декларации можно задать `commands[].menu.main.submenu: examples`.

Для команд в `Examples` Python entrypoint-скрипты размещаются в подпапке:
- `python/scripts/examples/*.py`
- в `plugin.yaml` используются пути `script: examples/<name>.py`.

## Кастомные библиотеки фигур (`conf/stencils`)

SEAF runtime поддерживает добавление библиотек фигур в окно `More Shapes` через отдельный конфиг:
- `conf/stencils/libraries.json`
- файлы библиотек (`*.xml` с корнем `<mxlibrary>`) хранятся в той же папке `conf/stencils`.

Формат `libraries.json`:

```json
{
  "version": 1,
  "sections": [
    {
      "id": "seaf",
      "title": "SEAF",
      "entries": [
        {
          "id": "seaf_r41",
          "title": "SEAF_Р41",
          "file": "Р41.xml",
          "enabledByDefault": false
        }
      ]
    }
  ]
}
```

Пояснения:
- `sections[]` — разделы, которые отображаются в `More Shapes`;
- `entries[]` — библиотеки внутри раздела;
- `file` — имя XML-файла библиотеки в `conf/stencils`;
- `enabledByDefault` — флаг preload палитры (опционально).

Важно:
- `libraries.json` читается в runtime-плагине на старте;
- файл должен быть JSON-совместимым, т.к. в renderer используется `JSON.parse`;
- XML-файл должен быть в формате draw.io `mxlibrary` (JSON-массив внутри тега `<mxlibrary>`);
- ошибки чтения/парсинга отдельной библиотеки логируются, остальные библиотеки продолжают загружаться.

Обновление перечня библиотек:
- добавьте/измените `libraries.json` и `*.xml` в `seaf-plugin-runtime/conf/stencils`;
- соберите новый runtime asset (`release/runtime/build-runtime.sh`);
- обновите runtime через `SEAF -> Обновить плагин`;
- пересборка desktop-пакета для этого сценария не требуется.

Дополнительно:
- при первом запуске runtime пытается найти системный Python (`python3`, затем `python`) и сохраняет выбор в `env.yaml` (`pythonExecutable`);
- если Python не найден, пользователю показывается инструкция установить Python и указать путь через `Edit Config`.

## Режимы логирования и примеры для Python

Ниже собрана практическая модель логирования, которая сейчас реализована в runtime.

### 1) Где задается уровень логирования

- Базовый fallback берется из `plugin.yaml` (`logging.level`, `logging.extendedDebug`, `logging.includePayload`, `logging.output`, `logging.filePath`).
- Пользовательский режим задается через `env.yaml` в поле `pluginLogLevel` (`none|info|debug`) и переопределяет поведение runtime.
- Фактическая запись строк в лог выполняется на стороне desktop-host (`seafPluginService`), а не в Python-скриптах напрямую.

### 2) Поддерживаемые уровни и их приоритет

Внутренний фильтр логов использует уровни:
- `debug` (10)
- `info` (20)
- `warn` (30)
- `error` (40)

Сообщение пишется, если его приоритет не ниже активного уровня.

### 3) Что реально означает `pluginLogLevel`

- `none`
  - эффективно включает только `error`;
  - отключает `extendedDebug`;
  - отключает `includePayload`;
  - переключает вывод в `console` (без файла).
- `info`
  - включает `info`, `warn`, `error`;
  - `extendedDebug=false`;
  - `includePayload` остается как в `plugin.yaml`.
- `debug`
  - включает максимум (`debug`, `info`, `warn`, `error`);
  - `extendedDebug=true`;
  - на практике дает наибольшую диагностическую детализацию.

### 4) Какой объем информации обычно попадает в лог

- При `none`:
  - почти только аварийные события/ошибки;
  - payload не пишется.
- При `info`:
  - видны типовые события выполнения команд: `Command started`, `Command finished`, `Async command completed/failed`;
  - payload пишется только если `logging.includePayload=true`.
- При `debug`:
  - максимальная детализация;
  - при ошибках добавляются расширенные детали;
  - для sync-выполнения в meta доступны подробности (`stdout/stderr`) благодаря `extendedDebug`.

### 5) Как Python участвует в логировании

Python-скрипты в runtime используют протокол I/O, а не прямую запись в `seaf-plugin.log`:
- `stdout`: итоговый JSON через `write_response(...)`;
- `stderr`: прогресс в формате `SEAF_PROGRESS ...` через `emit_progress(...)`.

Desktop-host принимает результаты выполнения и уже сам пишет структурированные строки в лог.

### 6) Примеры использования из Python-скриптов

Пример A: прогресс + успешный ответ.

```python
from lib.io import read_request, emit_progress, write_response

def main() -> int:
    _req = read_request()
    emit_progress(10, phase="start", message="Начало обработки")
    emit_progress(80, phase="processing", message="Почти готово")
    return write_response(
        status="success",
        message="Обработка завершена",
        payload={"processed": 42},
        commands=[{"name": "showMessage", "args": {"level": "info", "text": "Готово"}}]
    )
```

Пример B: контролируемая ошибка.

```python
from lib.io import write_response

def main() -> int:
    return write_response(
        status="error",
        message="Ошибка валидации входных данных",
        payload={"reason": "invalid input"},
        errors=["validation_failed"],
        exit_code=1
    )
```

Пример C: отправка прогресса в фоне.

```python
from lib.io import emit_progress

def do_work() -> None:
    emit_progress(25, phase="step 1")
    emit_progress(50, phase="step 2")
    emit_progress(100, phase="done", message="Завершено")
```

Примечание: `showMessage.args.level` (`info|error`) относится к уровню UI-сообщения в draw.io, а не к уровню строки в `seaf-plugin.log`.

## Практические примеры (из текущего `plugin.yaml`)

- `execution.mode: async` + `pollIntervalMs/maxPollAttempts` используется для фоновых задач (пример: `seafAsyncBackground`).
- `menu.context.target: selection_non_empty` используется для команд, которые должны появляться только при выделении объектов.
- `input.arguments` используется для передачи параметров в скрипт (например, `simulateDurationSec`, `sleepSec`).

## Пример команды с индикатором (`seafAsyncBackground`)

> Важно: в этом примере таймаут `40000` мс не срабатывает, потому что `simulateDurationSec: 3` завершается раньше.  
> Для проверки таймаута увеличьте `simulateDurationSec` (например, до `60`) или уменьшите `timeoutMs`.

```yaml
- id: seafAsyncBackground
  title: SEAF Async Background Task
  script: examples/async_background.py
  execution:
    mode: async
    pollIntervalMs: 1000
    maxPollAttempts: 120
  indicator:
    enabled: true
    type: percent
    timeoutMs: 40000
    allowStop: true
  input:
    arguments:
      simulateDurationSec: 60
```
