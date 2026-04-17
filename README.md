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
- `conf/README.md` - документация формата `plugin.yaml`.
- `python/scripts/*.py` - Python-скрипты команд full runtime.
- `python/scripts/README.md` - документация контракта скриптов и прогресса.
- `runtime/version.json` - версия full runtime.
- `minimal-runtime/*` - минимальный bootstrap runtime для package drawio.
- `release/runtime/build-runtime.sh` - сборка full runtime (`release/out/stage` + `seaf-plugin-runtime.tar.gz`).
- `release/runtime/build-minimal-runtime.sh` - сборка minimal runtime (`release/out/minimal-stage`).
- `release/runtime/check-version-consistency.sh` - проверка согласованности версий full runtime.

## Packaging integration (drawio-desktop)

- `release/out/minimal-stage` используется в `drawio-desktop/electron-builder-*.json` как `extraResources -> seaf-runtime-default`.
- При первом старте drawio `ensureSeafRuntimeInstalled` копирует `seaf-runtime-default` в пользовательский каталог плагинов.
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
4. Main-process выполняет native update (`ssh_git`), распаковывает архив и атомарно заменяет runtime.
5. После успеха выполняется `reloadDocument`, и загружается обновленный runtime.

## Versioning notes

- Для full runtime версия синхронизируется между:
  - `plugin/seaf.plugin.js` (comment `Runtime script version`)
  - `conf/plugin.yaml` (`plugin.runtimeVersion`)
  - `runtime/version.json` (`version`)
- Для minimal runtime версия синхронизируется между:
  - `minimal-runtime/seaf.plugin.js`
  - `minimal-runtime/seaf_plugin/conf/plugin.yaml`
  - `minimal-runtime/seaf_plugin/runtime/version.json`
