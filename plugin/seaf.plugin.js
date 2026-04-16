/**
 * SEAF plugin for draw.io desktop runtime.
 * Runtime script version: 0.1.1
 * Uses main-process IPC for config, command execution, logs and runtime updates.
 */
Draw.loadPlugin(function(ui)
{
	var state = {
		configPath: null,
		config: null,
		commandsById: {},
		runtimeVersion: 'unknown',
		logging: {
			level: 'info',
			extendedDebug: false,
			includePayload: false
		}
	};

	function requestAsync(msg)
	{
		if (typeof electron === 'undefined' || electron == null || typeof electron.request !== 'function')
		{
			return Promise.reject(new Error('Electron IPC bridge is unavailable'));
		}

		return new Promise(function(resolve, reject)
		{
			electron.request(msg, function(data)
			{
				resolve(data);
			}, function(errMsg, errObj)
			{
				reject(errObj || new Error(errMsg));
			});
		});
	}

	function maskSensitive(value)
	{
		if (value == null || typeof value !== 'object')
		{
			return value;
		}

		if (Array.isArray(value))
		{
			return value.map(maskSensitive);
		}

		var out = {};
		var secretRegex = /(token|secret|password|apikey|api_key|auth|cookie)/i;

		for (var key in value)
		{
			if (Object.prototype.hasOwnProperty.call(value, key))
			{
				out[key] = secretRegex.test(key) ? '***' : maskSensitive(value[key]);
			}
		}

		return out;
	}

	function safeLogData(data)
	{
		return state.logging.includePayload ? maskSensitive(data) : null;
	}

	async function writeLog(level, message, data)
	{
		var payload = {
			action: 'writeSeafPluginLog',
			configPath: state.configPath,
			level: level,
			message: message,
			data: safeLogData(data)
		};

		try
		{
			await requestAsync(payload);
		}
		catch (e)
		{
			try
			{
				console.log('[SEAF]', level, message, data || '');
			}
			catch (ignored)
			{
				// ignore fallback logging errors
			}
		}
	}

	function showInfo(message)
	{
		mxUtils.alert(message);
	}

	function showError(message)
	{
		mxUtils.alert(message);
	}

	function formatCommandError(commandId, message)
	{
		var id = commandId || 'unknownCommand';
		var msg = (message != null && String(message).trim().length > 0) ? String(message) : 'unknown error';
		return id + ': ' + msg;
	}

	async function detectRuntimeVersion()
	{
		var fallback = 'unknown';
		try
		{
			if (state.config && state.config.plugin && typeof state.config.plugin.runtimeVersion === 'string' &&
				state.config.plugin.runtimeVersion.trim().length > 0)
			{
				fallback = state.config.plugin.runtimeVersion.trim();
			}

			if (!state.configPath || typeof state.configPath !== 'string')
			{
				return fallback;
			}

			var runtimeVersionPath = state.configPath.replace(/[\\\/]conf[\\\/]plugin\.yaml$/i, '/runtime/version.json');
			if (runtimeVersionPath === state.configPath)
			{
				return fallback;
			}

			var raw = await requestAsync({
				action: 'readFile',
				filename: runtimeVersionPath,
				encoding: 'utf8'
			});
			var parsed = JSON.parse(raw);
			if (parsed && typeof parsed.version === 'string' && parsed.version.trim().length > 0)
			{
				return parsed.version.trim();
			}
		}
		catch (e)
		{
			// ignore metadata read errors and keep fallback
		}

		return fallback;
	}

	function getRuntimeVersionLabel()
	{
		return 'SEAF Runtime v' + (state.runtimeVersion || 'unknown');
	}

	function persistDesktopPluginReference()
	{
		try
		{
			if (typeof mxSettings === 'undefined' || mxSettings == null ||
				typeof mxSettings.getPlugins !== 'function' ||
				typeof mxSettings.setPlugins !== 'function' ||
				typeof mxSettings.save !== 'function')
			{
				return;
			}

			var plugins = mxSettings.getPlugins();
			if (!Array.isArray(plugins))
			{
				plugins = [];
			}
			else
			{
				plugins = plugins.slice();
			}

			if (mxUtils.indexOf(plugins, 'seaf.plugin.js') < 0)
			{
				plugins.push('seaf.plugin.js');
			}

			mxSettings.setPlugins(plugins);
			mxSettings.save();
		}
		catch (e)
		{
			// never break plugin startup
		}
	}

	function getSelectionPayload()
	{
		var graph = ui.editor.graph;
		var cells = graph.getSelectionCells();
		var out = [];

		for (var i = 0; i < cells.length; i++)
		{
			var cell = cells[i];
			out.push({
				id: cell.id,
				isVertex: graph.model.isVertex(cell),
				isEdge: graph.model.isEdge(cell),
				label: graph.convertValueToString(cell),
				style: graph.getCellStyle(cell),
				geometry: graph.getCellGeometry(cell)
			});
		}

		return out;
	}

	function buildPayload(command)
	{
		var inputCfg = command.input || {};
		var payload = {
			commandId: command.id,
			source: 'menu',
			timestamp: new Date().toISOString(),
			selection: getSelectionPayload()
		};

		if (inputCfg.includeDiagramXml === true)
		{
			payload.diagramXml = ui.getFileData(true, null, null, null, true, false);
		}

		if (inputCfg.includeCurrentPage === true && ui.currentPage != null)
		{
			payload.currentPage = {
				id: ui.currentPage.getId ? ui.currentPage.getId() : null,
				name: ui.currentPage.getName ? ui.currentPage.getName() : null
			};
		}

		if (inputCfg.arguments != null)
		{
			payload.arguments = inputCfg.arguments;
		}

		return payload;
	}

	function runUiCommand(cmd)
	{
		var graph = ui.editor.graph;
		var args = cmd.args || {};

		switch (cmd.name)
		{
		case 'reloadDocument':
			window.location.reload();
			break;
		case 'refreshGraph':
			graph.refresh();
			break;
		case 'selectCells':
			if (Array.isArray(args.cellIds))
			{
				var selected = [];
				for (var i = 0; i < args.cellIds.length; i++)
				{
					var c = graph.model.getCell(args.cellIds[i]);
					if (c != null)
					{
						selected.push(c);
					}
				}

				if (selected.length > 0)
				{
					graph.setSelectionCells(selected);
				}
			}
			break;
		case 'showMessage':
			if (args.text == null || String(args.text).trim().length === 0)
			{
				break;
			}
			if (args.level === 'error')
			{
				showError(args.text);
			}
			else
			{
				showInfo(args.text);
			}
			break;
		default:
			writeLog('warn', 'Unknown UI command ignored', {command: cmd});
			break;
		}
	}

	function executeInteractiveCommands(result)
	{
		if (result == null || !Array.isArray(result.commands))
		{
			return;
		}

		for (var i = 0; i < result.commands.length; i++)
		{
			runUiCommand(result.commands[i]);
		}
	}

	async function pollAsyncJob(jobId, command)
	{
		var maxAttempts = Math.max(1, (command.execution && command.execution.maxPollAttempts) || 120);
		var intervalMs = Math.max(200, (command.execution && command.execution.pollIntervalMs) || 1000);

		for (var i = 0; i < maxAttempts; i++)
		{
			var status = await requestAsync({
				action: 'pollSeafPluginJob',
				jobId: jobId
			});

			if (status.status === 'completed')
			{
				executeInteractiveCommands(status.result || {});
				if (status.result && typeof status.result.message === 'string' &&
					status.result.message.trim().length > 0)
				{
					showInfo(status.result.message);
				}
				return;
			}
			else if (status.status === 'failed')
			{
				showError(formatCommandError(command.id, status.error || 'unknown error'));
				return;
			}

			await new Promise(function(resolve)
			{
				window.setTimeout(resolve, intervalMs);
			});
		}

		showError(formatCommandError(command.id, 'async timeout'));
	}

	async function executeCommand(command, source)
	{
		var payload = buildPayload(command);
		payload.source = source;

		await writeLog('info', 'Command invocation started', {
			commandId: command.id,
			source: source,
			payload: payload
		});

		try
		{
			var response = await requestAsync({
				action: 'runSeafPluginCommand',
				configPath: state.configPath,
				commandId: command.id,
				payload: payload
			});

			if (response.mode === 'async' && response.jobId)
			{
				pollAsyncJob(response.jobId, command);
				return;
			}

			var result = response.result || {};
			executeInteractiveCommands(result);

			if (result.status === 'error')
			{
				if (typeof result.message === 'string' && result.message.trim().length > 0)
				{
					showError(formatCommandError(command.id, result.message));
				}
			}
			else
			{
				if (typeof result.message === 'string' && result.message.trim().length > 0)
				{
					showInfo(result.message);
				}
			}
		}
		catch (e)
		{
			await writeLog('error', 'Command invocation failed', {
				commandId: command.id,
				source: source,
				error: e.message
			});
			showError(formatCommandError(command.id, e.message));
		}
	}

	function contextMatches(command, graph)
	{
		var cfg = (command.menu && command.menu.context) ? command.menu.context : {};
		var target = cfg.target || 'any';
		var selection = graph.getSelectionCells();
		var first = graph.getSelectionCell();

		if (cfg.enabled === false)
		{
			return false;
		}

		if (target === 'selection_non_empty')
		{
			return selection.length > 0;
		}
		else if (target === 'selection_single')
		{
			return selection.length === 1;
		}
		else if (target === 'vertex')
		{
			return first != null && graph.model.isVertex(first);
		}
		else if (target === 'edge')
		{
			return first != null && graph.model.isEdge(first);
		}

		return true;
	}

	function ensureTopLevelMenu(sectionId, title)
	{
		if (ui.menus.get(sectionId) != null)
		{
			return;
		}

		ui.menus.put(sectionId, new Menu(function(){}));
		mxResources.parse(sectionId + '=' + (title || sectionId));

		if (Array.isArray(ui.menus.defaultMenuItems))
		{
			var items = ui.menus.defaultMenuItems.slice();
			if (mxUtils.indexOf(items, sectionId) < 0)
			{
				var helpIdx = mxUtils.indexOf(items, 'help');
				if (helpIdx >= 0)
				{
					items.splice(helpIdx, 0, sectionId);
				}
				else
				{
					items.push(sectionId);
				}
				ui.menus.defaultMenuItems = items;
			}
		}
	}

	function registerMainMenu()
	{
		var grouped = {};
		var commands = state.config.commands || [];

		for (var i = 0; i < commands.length; i++)
		{
			var cmd = commands[i];
			var mainCfg = (cmd.menu && cmd.menu.main) ? cmd.menu.main : {};
			if (mainCfg.enabled === false)
			{
				continue;
			}

			var section = mainCfg.section || 'extras';
			var sectionTitle = mainCfg.sectionTitle || section;
			ensureTopLevelMenu(section, sectionTitle);

			if (grouped[section] == null)
			{
				grouped[section] = [];
			}
			grouped[section].push(cmd.id);
		}

		for (var sectionId in grouped)
		{
			if (!Object.prototype.hasOwnProperty.call(grouped, sectionId))
			{
				continue;
			}

			(function(section, ids)
			{
				var menu = ui.menus.get(section);
				if (menu == null)
				{
					return;
				}

				var oldFunct = menu.funct;
				menu.funct = function(menuObj, parent)
				{
					oldFunct.apply(this, arguments);
					ui.menus.addMenuItems(menuObj, ['-'].concat(ids), parent);
				};
			})(sectionId, grouped[sectionId]);
		}
	}

	function registerContextMenu()
	{
		var oldCreatePopupMenu = ui.menus.createPopupMenu;
		ui.menus.createPopupMenu = function(menu, cell, evt)
		{
			oldCreatePopupMenu.apply(this, arguments);
			var graph = ui.editor.graph;
			var inserted = false;
			var commands = state.config.commands || [];

			for (var i = 0; i < commands.length; i++)
			{
				if (contextMatches(commands[i], graph))
				{
					if (!inserted)
					{
						this.addMenuItems(menu, ['-'], null, evt);
						inserted = true;
					}

					this.addMenuItems(menu, [commands[i].id], null, evt);
				}
			}
		};
	}

	function buildUpdateConfig()
	{
		var updateCfg = state.config.update || {};
		return {
			enabled: updateCfg.enabled !== false,
			repo: updateCfg.repo || updateCfg.githubRepo || '',
			assetName: updateCfg.assetName || updateCfg.releaseAsset || 'seaf-plugin-runtime.tar.gz',
			tag: updateCfg.tag || null,
			apiBaseUrl: updateCfg.apiBaseUrl || 'https://api.github.com'
		};
	}

	function registerUpdateAction()
	{
		if (ui.actions.get('seafUpdateRuntime') != null)
		{
			return;
		}

		ui.actions.addAction('seafUpdateRuntime', async function()
		{
			var cfg = buildUpdateConfig();
			if (!cfg.enabled)
			{
				showError('SEAF runtime update is disabled in plugin.yaml (update.enabled=false)');
				return;
			}

			if (!cfg.repo)
			{
				showError('SEAF update repo is not configured in plugin.yaml (update.repo)');
				return;
			}

			try
			{
				showInfo('SEAF runtime update started');
				var result = await requestAsync({
					action: 'updateSeafPluginRuntime',
					repo: cfg.repo,
					assetName: cfg.assetName,
					tag: cfg.tag,
					apiBaseUrl: cfg.apiBaseUrl
				});

				// Refresh config and runtime version immediately after update, so the menu
				// shows the currently installed runtime version without restarting draw.io.
				var loaded = await requestAsync({
					action: 'getSeafPluginConfig',
					configPath: state.configPath || ''
				});
				if (loaded != null && typeof loaded === 'object' && loaded.config != null && typeof loaded.config === 'object')
				{
					state.configPath = loaded.configPath || state.configPath;
					state.config = loaded.config;
					state.logging = state.config.logging || state.logging;
				}

				state.runtimeVersion = await detectRuntimeVersion();
				await writeLog('info', 'SEAF runtime version refreshed after update', {
					tag: result && result.tag ? result.tag : null,
					runtimeVersion: state.runtimeVersion
				});

				showInfo('SEAF runtime updated to v' + (state.runtimeVersion || 'unknown') + '.');
			}
			catch (e)
			{
				showError('SEAF runtime update failed: ' + e.message);
			}
		});
	}

	function registerUpdateMenu()
	{
		var targetMenuId = (ui.menus.get('seaf') != null) ? 'seaf' : 'extras';
		var targetMenu = ui.menus.get(targetMenuId);
		if (targetMenu == null)
		{
			return;
		}

		var oldFunct = targetMenu.funct;
		targetMenu.funct = function(menuObj, parent)
		{
			oldFunct.apply(this, arguments);
			ui.menus.addMenuItems(menuObj, ['-', 'seafUpdateRuntime'], parent);
			menuObj.addSeparator(parent);
			menuObj.addItem(getRuntimeVersionLabel(), null, null, parent, null, false);
		};
	}

	function registerActions()
	{
		var commands = state.config.commands || [];
		for (var i = 0; i < commands.length; i++)
		{
			(function(command)
			{
				state.commandsById[command.id] = command;
				ui.actions.addAction(command.id, function()
				{
					executeCommand(command, 'menu');
				});
			})(commands[i]);
		}

		registerUpdateAction();
	}

	async function init()
	{
		try
		{
			var loaded = await requestAsync({
				action: 'getSeafPluginConfig',
				configPath: (window.SEAF_PLUGIN_CONFIG_PATH || '')
			});

			if (loaded == null || typeof loaded !== 'object' || loaded.config == null || typeof loaded.config !== 'object')
			{
				throw new Error('Invalid SEAF config response');
			}

			state.configPath = loaded.configPath;
			state.config = loaded.config;
			state.logging = state.config.logging || state.logging;
			state.runtimeVersion = await detectRuntimeVersion();

			persistDesktopPluginReference();
			await writeLog('info', 'Plugin initialization started', {
				configPath: state.configPath,
				commandsCount: Array.isArray(state.config.commands) ? state.config.commands.length : 0
			});

			registerActions();
			registerMainMenu();
			registerContextMenu();
			registerUpdateMenu();

			await writeLog('info', 'Plugin initialization finished', {ok: true});
		}
		catch (e)
		{
			showError('SEAF plugin initialization failed: ' + e.message);
			try
			{
				console.error('SEAF plugin init failed', e);
			}
			catch (ignored)
			{
				// ignore
			}
		}
	}

	init();
});
