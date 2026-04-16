# SEAF Plugin Runtime

SEAF runtime package for draw.io desktop.

## Layout

- `plugin/seaf.plugin.js` - desktop plugin entry point.
- `conf/plugin.yaml` - command, logging and update configuration.
- `python/scripts/*.py` - external command scripts executed by the desktop backend.
- `release/runtime/build-runtime.sh` - packs runtime release asset.

## Runtime location in draw.io desktop

The updater installs files into:

- `~/.config/draw.io/plugins/seaf.plugin.js`
- `~/.config/draw.io/plugins/seaf_plugin/conf/*`
- `~/.config/draw.io/plugins/seaf_plugin/python/*`

## Update flow

1. Configure `update.repo` in `conf/plugin.yaml` as `owner/repo`.
2. Publish release with asset `seaf-plugin-runtime.tar.gz`.
3. In draw.io use `SEAF -> Update Plugin Runtime`.

The update operation overwrites local runtime files with the release content.
