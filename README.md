# SEAF Plugin Runtime

Репозиторий runtime-дополнений SEAF для draw.io desktop.

## Runtime profiles

В проекте поддерживаются два профиля:

- `full runtime` (для разработки и релиза runtime):
  - `plugin/seaf.plugin.js`
  - `conf/plugin.yaml`
  - `python/scripts/examples/*`
  - `python/scripts/lib/*`
  - `runtime/version.json`
- `minimal runtime` (для встраивания в пакет drawio):
  - `minimal-runtime/seaf.plugin.js`
  - `minimal-runtime/seaf_plugin/conf/plugin.yaml`
  - `minimal-runtime/seaf_plugin/runtime/version.json`
  - `minimal-runtime/seaf_plugin/log/`

## Layout

- `plugin/seaf.plugin.js` - полный renderer plugin (меню, IPC, async, системный update).
- `conf/plugin.yaml` - core-конфигурация full runtime (общие настройки + includes).
- `conf/main_menu.yaml` - описание main menu команд.
- `conf/context_menu.yaml` - описание context menu правил (overrides по id).
- `conf/env.yaml` - редактируемые переменные runtime (пути и режимы для Python-части).
- `conf/events.yaml` - конфигурация auto-event processor (правила add/remove/modify + скрытые event handlers).
- `conf/stencils/libraries.json` - JSON-конфиг секций/библиотек фигур для окна `More Shapes`.
- `conf/stencils/*.xml` - файлы библиотек фигур в формате `mxlibrary`.
- `conf/README.md` - документация формата `plugin.yaml`.
- `python/scripts/examples/*.py` - Python entrypoint-скрипты команд full runtime (демо/примеры).
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

Для секции `SEAF` порядок элементов должен оставаться стабильным (в runtime asset):
- `Edit Config`,
- подменю `P41`,
- подменю `Tools` (служебные команды),
- подменю `Examples` (все пункты, начинающиеся с `SEAF ...`),
- `Обновить плагин` (всегда второй с конца),
- `SEAF Runtime v...` (всегда последний).

## Edit Config menu

- В full runtime добавлена UI-команда `Edit Config` в меню `SEAF`.
- Поля формы задаются декларативно через composed config; источник `seafEditConfig` хранится в `conf/main_menu.yaml` и подключается через `conf/plugin.yaml`.
- Каждое поле явно связывается с `envKey` из `conf/env.yaml`.
- Поддерживаемые типы полей: `text`, `list`, `filePicker`, `checkbox`, `radio`.
- Текущий контракт полей: `companyPrefix`, `inputSeafFile`, `useSameOutputFile`, `outputSeafFile`, `pluginLogLevel`, `pythonExecutable`.
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
- Auto-event processor подписывается на изменения модели и отправляет batch события `add/remove` для стенсилов из `events.yaml`.
- `modify` обрабатывается только в сценарии `Edit Data -> Apply` и только при реальном изменении данных.
- Маршрутизация событий идет по `rules` из `events.yaml` в рамках `listId` и `schema`-паттернов: приоритет `exact > wildcard > all`.
- `rule.schema` поддерживает 3 режима: точное значение (например `seaf.company.ta.services.dc_azs`), wildcard с `*` (например `seaf.company.ta.*`) и `all`.
- `rule.execution` задает режим вызова handler: `sync` (ожидание ответа) или `async` (fire-and-forget с отдельным trace в логе).
- Значения `handlers` в `events.yaml` (например `seafStencilSpecificModify`) — это command id composed config; реальные скрипты задаются в `python/scripts/examples/events/*.py` через скрытые commands в `events.yaml`.
- Детальная спецификация конфига и mapping `handler id -> command -> script` описаны в `conf/README.md`, а подробное поведение скриптов — в `python/scripts/examples/events/README.md`.

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
