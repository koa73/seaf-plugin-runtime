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
| `python.scriptsDir` | `string` (relative path) | Каталог скриптов относительно `conf/plugin.yaml` (например, `../python/scripts`). В командах ниже поле `script` указывает файл **внутри этого каталога**. |

## `logging.*`

> Примечание: часть настроек логирования используется в UI‑плагине напрямую (например, `includePayload` влияет на то, будет ли UI отправлять payload в логи; при этом чувствительные ключи маскируются).

| Имя поля | Формат | Назначение |
|---|---:|---|
| `logging.level` | `string` (`debug|info|warn|error`) | Уровень логов, который выставляет runtime. |
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

### `commands[].menu.main.*` — добавление в главное меню

| Имя поля | Формат | Назначение |
|---|---:|---|
| `commands[].menu.main.enabled` | `boolean` | Если `false`, команда не попадёт в верхнее меню. |
| `commands[].menu.main.section` | `string` | Идентификатор верхнего меню (например, `seaf` или `extras`). |
| `commands[].menu.main.sectionTitle` | `string` | Заголовок верхнего меню (например, `SEAF`). Если не задан — используется `section`. |

### `commands[].menu.context.*` — добавление в контекстное меню

| Имя поля | Формат | Назначение |
|---|---:|---|
| `commands[].menu.context.enabled` | `boolean` | Если `false`, команда не добавляется в контекстное меню. |
| `commands[].menu.context.target` | `string` | Условие, когда команда показывается в контекстном меню. Возможные значения (по текущей реализации): `any`, `selection_non_empty`, `selection_single`, `vertex`, `edge`. |

### `commands[].execution.*` — режим выполнения

| Имя поля | Формат | Назначение |
|---|---:|---|
| `commands[].execution.mode` | `string` (`sync|async`) | Режим выполнения: синхронно ждать результат или запускать в фоне и опрашивать статус задачи. |
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

## Практические примеры (из текущего `plugin.yaml`)

- `execution.mode: async` + `pollIntervalMs/maxPollAttempts` используется для фоновых задач (пример: `seafAsyncBackground`).\n+- `menu.context.target: selection_non_empty` используется для команд, которые должны появляться только при выделении объектов.\n+- `input.arguments` используется для передачи параметров в скрипт (например, `simulateDurationSec`, `sleepSec`).\n+
