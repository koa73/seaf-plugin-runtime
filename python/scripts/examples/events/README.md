# Stencil events: примеры и тесты (`examples/events`)

Каталог **не** содержит поставочных entrypoint для `conf/events.yaml`: production-скрипты лежат в [`../events/`](../events/), а здесь остаются:

- `specific_add.py` — демо `add` для exact-правила (в типовом `events.yaml` не зарегистрирован).
- `all_add.py` — тонкий shim, проксирует выполнение в `events/all_add.py`.
- `test_*.py` — pytest для `all_add`, `reparent`, `data_mirror`, контрактов OID.

## Маршрутизация (канонично)

| Handler id | Command id | Script (production) |
|---|---|---|
| `seafStencilAllAdd` | `seafStencilAllAdd` | `events/all_add.py` |
| `seafStencilReparent` | `seafStencilReparent` | `events/reparent.py` |
| `seafStencilDataMirrorModify` | `seafStencilDataMirrorModify` | `events/data_mirror.py` |

В типовом `conf/events.yaml` для `handlers.remove` записей нет: события `remove` не отправляются в Python (renderer пишет в debug log `missing handler for operation`).

Связка задаётся в `conf/events.yaml`: `rules[].handlers.*` → `commands[].id` → `commands[].script` (путь относительно `python/scripts/`).

## Контракт `REQUEST.payload.event`

См. основной [`../README.md`](../README.md) и [`../../../conf/README.md`](../../../conf/README.md).

Ожидаемые поля верхнего уровня:

- `eventType`: `add` | `remove` | `modify` | `reparent`
- `ruleId`, `listId`, `txId`, `timestamp`
- `page`: `{id, name}`
- `items[]` — изменённые объекты (в т.ч. `objectId`, `schema`, `data`, для `modify` — `dataBefore`/`dataAfter`)

## Debug trace (пример)

При `pluginLogLevel=debug` в `seaf-plugin.log` ожидаются строки вроде `Stencil event routing selected` с `ruleId`, `matchType` (`exact|wildcard|all`), `commandId`, затем вывод Python (`SEAF_INFO` / structured logger) по обработчику.

## Протокол stderr

- `SEAF_ERROR <message>` — ошибки (всегда в лог).
- `SEAF_INFO <json>` — диагностика (зависит от `pluginLogLevel` / `scriptLogLevel`).
