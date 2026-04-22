# SEAF Plugin Runtime

Репозиторий runtime-дополнений SEAF для draw.io desktop.

## Runtime profiles

В проекте поддерживаются два профиля:

- `full runtime` (для разработки и релиза runtime):
  - `plugin/seaf.plugin.js`
  - `conf/plugin.yaml`
  - `python/scripts/*`
  - `runtime/version.json`
- `minimal runtime` (для встраивания в пакет drawio):
  - `minimal-runtime/seaf.plugin.js`
  - `minimal-runtime/seaf_plugin/conf/plugin.yaml`
  - `minimal-runtime/seaf_plugin/runtime/version.json`
  - `minimal-runtime/seaf_plugin/log/`

## Layout

- `plugin/seaf.plugin.js` - полный renderer plugin (меню, IPC, async, системный update).
- `conf/plugin.yaml` - конфигурация full runtime (команды, logging, update).
- `conf/env.yaml` - редактируемые переменные runtime (пути и режимы для Python-части).
- `conf/README.md` - документация формата `plugin.yaml`.
- `python/scripts/*.py` - Python-скрипты команд full runtime.
- `python/scripts/README.md` - документация контракта скриптов и прогресса.
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

## Menu order contract

Для секции `SEAF` порядок элементов должен оставаться стабильным (в runtime asset):
- кастомные команды runtime (если есть),
- `Обновить плагин` (всегда второй с конца),
- `SEAF Runtime v...` (всегда последний).

## Edit Config menu

- В full runtime добавлена UI-команда `Edit Config` в меню `SEAF`.
- Поля формы задаются декларативно в `conf/plugin.yaml` (`configEditor.fields[]`).
- Каждое поле явно связывается с `envKey` из `conf/env.yaml`.
- Поддерживаемые типы полей: `text`, `list`, `filePicker`, `checkbox`, `radio`.
- `Input file` реализован как `filePicker`: открывает системный навигатор и сохраняет выбранный путь в переменную `env.yaml`.
- Геометрия диалога рассчитывается по фактическому `scrollHeight` контейнера (без эвристического запаса), с симметричными отступами `8px` по всем сторонам.
- Footer формы использует `flex + gap`, а успешное сохранение выполняется без `success` popup (сообщения показываются только при ошибках).
- Кнопки `Cancel/Apply` и `Browse...` унифицированы с системным стилем draw.io (`geBtn`, `gePrimaryBtn`), как в стандартных диалогах (например, `Файл -> Печать`).
- Скролл ограничен только областью полей формы, поэтому футер с action-кнопками всегда остается доступным.

## Interactive terminal command

- В full runtime добавлен demo-пункт `SEAF Interactive Terminal Demo`.
- Команда использует `clientAction: interactiveTerminal` и `execution.mode: interactive_terminal`.
- draw.io desktop открывает отдельное modal terminal-окно поверх editor и блокирует основной экран overlay-механизмом draw.io до закрытия terminal-окна.
- Python-скрипт запускается в настоящем TTY через `node-pty`, поэтому доступны интерактивные сценарии с `print(...)`, `input(...)` и live stdout/stderr.
- После завершения процесса terminal-окно не закрывается автоматически: пользователь закрывает его вручную, и только после этого управление полностью возвращается editor.

## Minimal/full parity contract

- `minimal-runtime` является усеченной версией `full runtime` и содержит только bootstrap/update функциональность.
- Общее update-поведение должно быть синхронным между `minimal-runtime/seaf.plugin.js` и `plugin/seaf.plugin.js`:
  - одинаковые статусы результата (`updated`, `already_up_to_date`, `error`);
  - одинаковая семантика сообщений пользователю;
  - одинаковая логика завершения прогресса (100% -> закрытие индикатора -> сообщение).

## Versioning notes

- Для full runtime версия синхронизируется между:
  - `plugin/seaf.plugin.js` (comment `Runtime script version`)
  - `conf/plugin.yaml` (`plugin.runtimeVersion`)
  - `runtime/version.json` (`version`)
- Для minimal runtime версия синхронизируется между:
  - `minimal-runtime/seaf.plugin.js`
  - `minimal-runtime/seaf_plugin/conf/plugin.yaml`
  - `minimal-runtime/seaf_plugin/runtime/version.json`
