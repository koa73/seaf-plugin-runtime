/**
 * SEAF plugin for draw.io desktop runtime.
 * Runtime script version: 0.2.10
 * Uses main-process IPC for config, command execution and logs.
 */
Draw.loadPlugin(function(ui)
{
	var state = {
		configPath: null,
		config: null,
		envConfig: null,
		commandsById: {},
		runtimeVersion: 'unknown',
		manualIndicators: {},
		autoIndicatorsByJob: {},
		interactiveSessionHandlers: {},
		interactiveOverlay: null,
		interactiveSessionListenerRegistered: false,
		systemUpdateInProgress: false,
		actionsRegistered: false,
		mainMenuRegistered: false,
		contextMenuRegistered: false,
		contextMenuBaseCreatePopupMenu: null,
		interactiveSessionWatchdogs: {},
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

	function routeInteractiveSessionEvent(event)
	{
		if (event == null || !event.sessionId)
		{
			return;
		}

		var handler = state.interactiveSessionHandlers[event.sessionId];
		if (typeof handler === 'function')
		{
			handler(event);
		}
		else if (event.type === 'terminal-closed')
		{
			hideInteractiveOverlay(event.sessionId);
		}
	}

	function ensureInteractiveSessionListener()
	{
		if (state.interactiveSessionListenerRegistered ||
			typeof electron === 'undefined' || electron == null ||
			typeof electron.registerMsgListener !== 'function')
		{
			return;
		}

		electron.registerMsgListener('seafInteractiveSessionEvent', routeInteractiveSessionEvent);
		state.interactiveSessionListenerRegistered = true;
	}

	function showInteractiveOverlay(sessionId)
	{
		hideInteractiveOverlay();

		var host = document.createElement('div');
		host.style.width = '1px';
		host.style.height = '1px';
		host.style.overflow = 'hidden';

		var keyHandler = function(evt)
		{
			if (evt.key === 'Escape')
			{
				evt.preventDefault();
				evt.stopPropagation();
			}
		};

		document.addEventListener('keydown', keyHandler, true);
		ui.showDialog(host, 1, 1, true, false, null, true, true, null, true);
		state.interactiveOverlay = {
			sessionId: sessionId || null,
			container: host,
			keyHandler: keyHandler
		};
	}

	function hideInteractiveOverlay(sessionId)
	{
		if (state.interactiveOverlay == null)
		{
			return;
		}

		if (sessionId != null && state.interactiveOverlay.sessionId != null &&
			state.interactiveOverlay.sessionId !== sessionId)
		{
			return;
		}

		if (typeof state.interactiveOverlay.keyHandler === 'function')
		{
			document.removeEventListener('keydown', state.interactiveOverlay.keyHandler, true);
		}

		try
		{
			ui.hideDialog(true, false, state.interactiveOverlay.container);
		}
		catch (ignored)
		{
			// ignore overlay cleanup errors
		}

		state.interactiveOverlay = null;
	}

	function clearInteractiveSessionWatchdog(sessionId)
	{
		if (!sessionId || !Object.prototype.hasOwnProperty.call(state.interactiveSessionWatchdogs, sessionId))
		{
			return;
		}
		window.clearTimeout(state.interactiveSessionWatchdogs[sessionId]);
		delete state.interactiveSessionWatchdogs[sessionId];
	}

	function scheduleInteractiveSessionWatchdog(sessionId, command)
	{
		clearInteractiveSessionWatchdog(sessionId);
		state.interactiveSessionWatchdogs[sessionId] = window.setTimeout(function()
		{
			clearInteractiveSessionWatchdog(sessionId);
			if (state.interactiveSessionHandlers[sessionId] != null)
			{
				delete state.interactiveSessionHandlers[sessionId];
			}
			hideInteractiveOverlay(sessionId);
			var commandId = (command && command.id) ? command.id : 'interactiveTerminal';
			showError(formatCommandError(commandId, 'Interactive terminal session watchdog timeout'));
			writeLog('warn', 'Interactive terminal watchdog timeout', {
				sessionId: sessionId,
				commandId: commandId
			});
		}, 5 * 60 * 1000);
	}

	function buildRestartRequiredMessage(result)
	{
		var version = null;
		if (result && result.payload && typeof result.payload.version === 'string' && result.payload.version.trim().length > 0)
		{
			version = result.payload.version.trim();
		}
		var line1 = version ? ('Плагин обновлен до версии ' + version) : 'Плагин успешно обновлен';
		return line1 + '\nИзменения вступят в силу после перезапуска приложения draw.io';
	}

	function getUpdateUiOutcome(result)
	{
		var payload = (result && typeof result.payload === 'object' && result.payload != null) ? result.payload : {};
		var status = (typeof payload.status === 'string' && payload.status.trim().length > 0) ?
			payload.status.trim() : (typeof result.status === 'string' ? result.status.trim() : '');
		if (status === 'updated')
		{
			return {
				level: 'info',
				message: buildRestartRequiredMessage(result)
			};
		}
		if (status === 'already_up_to_date')
		{
			var latestMessage = (typeof result.message === 'string' && result.message.trim().length > 0) ?
				result.message.trim() :
				('Установлена актуальная версия ' + ((payload && payload.version) ? payload.version : 'плагина'));
			return {
				level: 'info',
				message: latestMessage
			};
		}

		// Backward compatibility: unknown success payload keeps restart-required behavior.
		return {
			level: 'info',
			message: buildRestartRequiredMessage(result)
		};
	}

	function formatCommandError(commandId, message)
	{
		var id = commandId || 'unknownCommand';
		var msg = (message != null && String(message).trim().length > 0) ? String(message) : 'unknown error';
		return id + ': ' + msg;
	}

	function getIndicatorConfig(command)
	{
		var indicator = (command && typeof command.indicator === 'object') ? command.indicator : {};
		return {
			enabled: indicator.enabled === true,
			type: indicator.type === 'percent' ? 'percent' : 'spinner',
			timeoutMs: Number.isFinite(indicator.timeoutMs) && indicator.timeoutMs > 0 ? Math.round(indicator.timeoutMs) : null,
			allowStop: indicator.allowStop === true
		};
	}

	function createIndicatorUi(params)
	{
		var overlay = document.createElement('div');
		overlay.style.position = 'fixed';
		overlay.style.left = '16px';
		overlay.style.bottom = '16px';
		overlay.style.minWidth = '280px';
		overlay.style.maxWidth = '420px';
		overlay.style.padding = '10px 12px';
		overlay.style.background = '#ffffff';
		overlay.style.border = '1px solid #d0d0d0';
		overlay.style.borderRadius = '6px';
		overlay.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
		overlay.style.zIndex = '99999';
		overlay.style.fontFamily = 'Arial, sans-serif';
		overlay.style.fontSize = '12px';

		var title = document.createElement('div');
		title.style.fontWeight = 'bold';
		title.style.marginBottom = '6px';
		title.textContent = params.title || 'SEAF task in progress';
		overlay.appendChild(title);

		var statusLine = document.createElement('div');
		statusLine.textContent = params.message || 'Running...';
		statusLine.style.marginBottom = '8px';
		overlay.appendChild(statusLine);

		var progressWrap = document.createElement('div');
		progressWrap.style.height = '6px';
		progressWrap.style.background = '#efefef';
		progressWrap.style.borderRadius = '3px';
		progressWrap.style.overflow = 'hidden';
		progressWrap.style.display = params.type === 'percent' ? 'block' : 'none';

		var progressFill = document.createElement('div');
		progressFill.style.height = '100%';
		progressFill.style.width = '0%';
		progressFill.style.background = '#4c8bf5';
		progressWrap.appendChild(progressFill);
		overlay.appendChild(progressWrap);

		var controls = document.createElement('div');
		controls.style.marginTop = '8px';
		controls.style.textAlign = 'right';
		if (params.allowStop === true && typeof params.onStop === 'function')
		{
			var stopBtn = document.createElement('button');
			stopBtn.textContent = 'Остановить';
			stopBtn.onclick = params.onStop;
			controls.appendChild(stopBtn);
		}
		overlay.appendChild(controls);
		document.body.appendChild(overlay);

		var timeoutId = null;
		if (Number.isFinite(params.timeoutMs) && params.timeoutMs > 0 && typeof params.onTimeout === 'function')
		{
			timeoutId = window.setTimeout(params.onTimeout, params.timeoutMs);
		}

		return {
			update: function(next)
			{
				var nextMessage = next && next.message != null ? String(next.message) : '';
				if (nextMessage.length > 0)
				{
					statusLine.textContent = nextMessage;
				}

				var nextProgress = next && Number.isFinite(next.progress) ? Math.max(0, Math.min(100, Math.round(next.progress))) : null;
				if (nextProgress != null)
				{
					progressWrap.style.display = 'block';
					progressFill.style.width = nextProgress + '%';
				}
				else if (params.type === 'spinner')
				{
					progressWrap.style.display = 'none';
				}
			},
			stop: function()
			{
				if (timeoutId != null)
				{
					window.clearTimeout(timeoutId);
				}
				if (overlay.parentNode != null)
				{
					overlay.parentNode.removeChild(overlay);
				}
			}
		};
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

		payload.arguments = inputCfg.arguments != null ? mxUtils.clone(inputCfg.arguments) : {};

		if (state.envConfig != null && typeof state.envConfig.env === 'object')
		{
			payload.env = mxUtils.clone(state.envConfig.env);
			for (var envKey in state.envConfig.env)
			{
				if (Object.prototype.hasOwnProperty.call(state.envConfig.env, envKey))
				{
					payload.arguments[envKey] = state.envConfig.env[envKey];
				}
			}
		}

		return payload;
	}

	function getEditConfigCommand()
	{
		if (!state.config || !Array.isArray(state.config.commands))
		{
			return null;
		}

		for (var i = 0; i < state.config.commands.length; i++)
		{
			var cmd = state.config.commands[i];
			if (cmd != null && cmd.clientAction === 'editConfig')
			{
				return cmd;
			}
		}

		return null;
	}

	function normalizeFieldValue(field, value)
	{
		var method = field && field.inputMethod ? field.inputMethod : 'text';
		if (method === 'checkbox')
		{
			return value === true;
		}

		if (value == null)
		{
			var options = Array.isArray(field && field.options) ? field.options : [];
			if ((method === 'list' || method === 'radio') && options.length > 0)
			{
				return String(options[0]);
			}
			return '';
		}

		return String(value);
	}

	function computeUiLoggingFromEnv(configLogging, envConfig)
	{
		var fallback = (configLogging && typeof configLogging === 'object') ? configLogging : {};
		var env = (envConfig && typeof envConfig.env === 'object' && envConfig.env != null) ? envConfig.env : {};
		var rawLevel = (typeof env.pluginLogLevel === 'string') ? env.pluginLogLevel.trim().toLowerCase() : '';

		var out = {
			level: fallback.level || 'info',
			extendedDebug: fallback.extendedDebug === true,
			includePayload: fallback.includePayload === true,
			output: fallback.output || 'both'
		};

		if (rawLevel === 'none')
		{
			out.level = 'error';
			out.extendedDebug = false;
			out.includePayload = false;
		}
		else if (rawLevel === 'info')
		{
			out.level = 'info';
			out.extendedDebug = false;
		}
		else if (rawLevel === 'debug')
		{
			out.level = 'debug';
			out.extendedDebug = true;
		}

		return out;
	}

	async function openEditConfigDialog(command)
	{
		var baseInset = 8;
		var editorCfg = command && command.configEditor ? command.configEditor : {};
		var fields = Array.isArray(editorCfg.fields) ? editorCfg.fields : [];
		var loadedEnv = await requestAsync({
			action: 'getSeafEnvConfig',
			configPath: state.configPath
		});
		var env = loadedEnv && loadedEnv.env ? loadedEnv.env : {};
		var container = document.createElement('div');
		container.style.minWidth = '420px';
		container.style.maxWidth = '760px';
		container.style.overflow = 'hidden';
		container.style.padding = baseInset + 'px';
		container.style.boxSizing = 'border-box';
		var formBody = document.createElement('div');
		formBody.style.overflowY = 'auto';
		formBody.style.overflowX = 'hidden';
		formBody.style.boxSizing = 'border-box';
		container.appendChild(formBody);
		var estimatedRows = 0;
		var hasChoiceControls = false;

		var fieldControls = {};
		var fieldByKey = {};
		var applyFieldRelations = function(){};
		var createRow = function(labelText)
		{
			var row = document.createElement('div');
			row.style.marginBottom = '10px';
			var label = document.createElement('div');
			label.style.fontWeight = 'bold';
			label.style.marginBottom = '4px';
			label.textContent = labelText;
			row.appendChild(label);
			formBody.appendChild(row);
			return row;
		};

		for (var i = 0; i < fields.length; i++)
		{
			var field = fields[i];
			if (!field || typeof field.envKey !== 'string')
			{
				continue;
			}
			fieldByKey[field.envKey] = field;

			var row = createRow(field.label || field.envKey);
			var method = field.inputMethod || 'text';
			var currentValue = normalizeFieldValue(field, env[field.envKey]);
			var input = null;
			estimatedRows += 1;

			if (method === 'checkbox')
			{
				input = document.createElement('input');
				input.type = 'checkbox';
				input.checked = currentValue === true;
				row.appendChild(input);
			}
			else if (method === 'list')
			{
				hasChoiceControls = true;
				estimatedRows += 0.5;
				input = document.createElement('select');
				input.style.width = '100%';
				var options = Array.isArray(field.options) ? field.options : [];
				for (var j = 0; j < options.length; j++)
				{
					var opt = document.createElement('option');
					opt.value = String(options[j]);
					opt.textContent = String(options[j]);
					input.appendChild(opt);
				}
				input.value = currentValue;
				row.appendChild(input);
			}
			else if (method === 'radio')
			{
				hasChoiceControls = true;
				input = [];
				var radioWrap = document.createElement('div');
				var radioOptions = Array.isArray(field.options) ? field.options : [];
				estimatedRows += Math.min(4, radioOptions.length);
				for (var k = 0; k < radioOptions.length; k++)
				{
					var radioLabel = document.createElement('label');
					radioLabel.style.display = 'block';
					var radio = document.createElement('input');
					radio.type = 'radio';
					radio.name = 'seaf-radio-' + field.envKey;
					radio.value = String(radioOptions[k]);
					radio.checked = String(radioOptions[k]) === currentValue;
					radioLabel.appendChild(radio);
					radioLabel.appendChild(document.createTextNode(' ' + String(radioOptions[k])));
					radioWrap.appendChild(radioLabel);
					input.push(radio);
				}
				row.appendChild(radioWrap);
			}
			else
			{
				var inputWrap = document.createElement('div');
				inputWrap.style.display = 'flex';
				inputWrap.style.gap = '6px';
				input = document.createElement('input');
				input.type = 'text';
				input.style.flex = '1';
				input.value = currentValue;
				inputWrap.appendChild(input);
				if (method === 'filePicker')
				{
					var browseBtn = mxUtils.button('Browse...', function(){});
					browseBtn.className = 'geBtn';
					browseBtn.onclick = (function(targetInput, targetField)
					{
						return async function()
						{
							var fileDialog = targetField.fileDialog || {};
							var currentPath = (targetInput.value != null) ? String(targetInput.value).trim() : '';
							var requestPayload = {
								action: 'selectSeafEnvFile',
								filters: Array.isArray(fileDialog.filters) ? fileDialog.filters : [],
								properties: Array.isArray(fileDialog.properties) && fileDialog.properties.length > 0 ?
									fileDialog.properties : ['openFile']
							};
							if (currentPath.length > 0)
							{
								requestPayload.defaultPath = currentPath;
							}

							try
							{
								var picked = await requestAsync(requestPayload);
								if (picked != null && String(picked).length > 0)
								{
									targetInput.value = String(picked);
									applyFieldRelations();
								}
							}
							catch (e)
							{
								await writeLog('error', 'Browse file selection failed', {
									envKey: targetField.envKey,
									error: e.message
								});
								showError('Не удалось открыть выбор файла: ' + e.message);
							}
						};
					})(input, field);
					inputWrap.appendChild(browseBtn);
				}
				row.appendChild(inputWrap);
			}

			fieldControls[field.envKey] = {
				method: method,
				control: input
			};
		}

		function getFieldValue(entry)
		{
			if (entry == null)
			{
				return null;
			}
			if (entry.method === 'checkbox')
			{
				return entry.control.checked === true;
			}
			if (entry.method === 'radio')
			{
				var selected = '';
				for (var r = 0; r < entry.control.length; r++)
				{
					if (entry.control[r].checked)
					{
						selected = entry.control[r].value;
						break;
					}
				}
				return selected;
			}
			return entry.control.value != null ? String(entry.control.value) : '';
		}

		function setTextFieldState(entry, value, disabled)
		{
			if (!entry || !entry.control || entry.control.tagName !== 'INPUT')
			{
				return;
			}
			if (value != null)
			{
				entry.control.value = String(value);
			}
			entry.control.disabled = disabled === true;
			entry.control.readOnly = disabled === true;
			entry.control.style.backgroundColor = disabled === true ? '#f5f5f5' : '';
		}

		function buildFieldRelation(field)
		{
			var relation = {
				syncFrom: field && typeof field.syncFrom === 'string' ? field.syncFrom : null,
				disableWhen: field && typeof field.disableWhen === 'object' ? field.disableWhen : null
			};
			if ((!relation.syncFrom || relation.disableWhen == null) &&
				field && field.envKey === 'outputSeafFile' &&
				fieldControls.useSameOutputFile && fieldControls.inputSeafFile)
			{
				relation.syncFrom = relation.syncFrom || 'inputSeafFile';
				relation.disableWhen = relation.disableWhen || {
					envKey: 'useSameOutputFile',
					equals: true
				};
			}
			return relation;
		}

		applyFieldRelations = function()
		{
			for (var key in fieldControls)
			{
				if (!Object.prototype.hasOwnProperty.call(fieldControls, key))
				{
					continue;
				}
				var field = fieldByKey[key] || {envKey: key};
				var relation = buildFieldRelation(field);
				var targetEntry = fieldControls[key];
				if (!targetEntry || targetEntry.method === 'checkbox' || targetEntry.method === 'radio')
				{
					continue;
				}

				var shouldDisable = false;
				if (relation.disableWhen && relation.disableWhen.envKey && fieldControls[relation.disableWhen.envKey])
				{
					var watchedValue = getFieldValue(fieldControls[relation.disableWhen.envKey]);
					var expected = Object.prototype.hasOwnProperty.call(relation.disableWhen, 'equals') ?
						relation.disableWhen.equals : true;
					shouldDisable = watchedValue === expected;
				}

				if (shouldDisable && relation.syncFrom && fieldControls[relation.syncFrom])
				{
					var sourceValue = getFieldValue(fieldControls[relation.syncFrom]);
					setTextFieldState(targetEntry, sourceValue, true);
				}
				else
				{
					setTextFieldState(targetEntry, null, shouldDisable);
				}
			}
		};

		for (var fieldKey in fieldControls)
		{
			if (!Object.prototype.hasOwnProperty.call(fieldControls, fieldKey))
			{
				continue;
			}
			var fieldEntry = fieldControls[fieldKey];
			if (fieldEntry.method === 'radio')
			{
				for (var rr = 0; rr < fieldEntry.control.length; rr++)
				{
					fieldEntry.control[rr].onchange = applyFieldRelations;
				}
			}
			else if (fieldEntry.control)
			{
				fieldEntry.control.onchange = applyFieldRelations;
				if (typeof fieldEntry.control.oninput !== 'undefined')
				{
					fieldEntry.control.oninput = applyFieldRelations;
				}
			}
		}

		applyFieldRelations();

		var footer = document.createElement('div');
		footer.style.textAlign = 'right';
		footer.style.marginTop = baseInset + 'px';
		footer.style.whiteSpace = 'nowrap';
		var cancelBtn = mxUtils.button(mxResources.get('cancel'), function()
		{
			ui.hideDialog();
		});
		cancelBtn.className = 'geBtn';
		var saveBtn = mxUtils.button(mxResources.get('apply'), async function()
		{
			var nextEnv = {};
			for (var key in fieldControls)
			{
				if (!Object.prototype.hasOwnProperty.call(fieldControls, key))
				{
					continue;
				}
				var entry = fieldControls[key];
				if (entry.method === 'checkbox')
				{
					nextEnv[key] = entry.control.checked === true;
				}
				else if (entry.method === 'radio')
				{
					var selected = '';
					for (var r = 0; r < entry.control.length; r++)
					{
						if (entry.control[r].checked)
						{
							selected = entry.control[r].value;
							break;
						}
					}
					nextEnv[key] = selected;
				}
				else
				{
					nextEnv[key] = entry.control.value != null ? String(entry.control.value) : '';
				}
			}

			try
			{
				var saved = await requestAsync({
					action: 'saveSeafEnvConfig',
					configPath: state.configPath,
					env: nextEnv
				});
				state.envConfig = saved;
				state.logging = computeUiLoggingFromEnv(state.config ? state.config.logging : null, state.envConfig);
				ui.hideDialog();
			}
			catch (e)
			{
				showError('Failed to save config: ' + e.message);
			}
		});
		saveBtn.className = 'geBtn gePrimaryBtn';
		if (ui.editor != null && ui.editor.cancelFirst === false)
		{
			footer.appendChild(saveBtn);
			footer.appendChild(cancelBtn);
		}
		else
		{
			footer.appendChild(cancelBtn);
			footer.appendChild(saveBtn);
		}
		container.appendChild(footer);

		var dialogWidth = 460 + (hasChoiceControls ? 40 : 0);
		dialogWidth = Math.max(420, Math.min(760, dialogWidth));
		var measureHost = document.createElement('div');
		measureHost.style.position = 'absolute';
		measureHost.style.left = '-10000px';
		measureHost.style.top = '0';
		measureHost.style.visibility = 'hidden';
		measureHost.style.pointerEvents = 'none';
		measureHost.style.width = dialogWidth + 'px';
		document.body.appendChild(measureHost);
		measureHost.appendChild(container);
		var measuredHeight = container.scrollHeight;
		var minHeight = 220;
		var maxHeight = 560;
		var framePaddingCompensation = 24;
		var desiredDialogHeight = measuredHeight + framePaddingCompensation;
		var dialogHeight = Math.max(minHeight, Math.min(maxHeight, desiredDialogHeight));
		container.style.maxHeight = 'none';
		var footerHeight = footer.offsetHeight;
		var bodyMaxHeight = Math.max(120, dialogHeight - footerHeight - (baseInset * 2) - framePaddingCompensation);
		formBody.style.maxHeight = bodyMaxHeight + 'px';
		measureHost.removeChild(container);
		document.body.removeChild(measureHost);
		ui.showDialog(container, dialogWidth, dialogHeight, true, true);
	}

	var uiCommandHandlers = {
		reloadDocument: function()
		{
			window.location.reload();
		},
		refreshGraph: function(args)
		{
			var graph = ui.editor.graph;
			graph.refresh();
		},
		selectCells: function(args)
		{
			var graph = ui.editor.graph;
			if (!Array.isArray(args.cellIds))
			{
				return;
			}
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
		},
		showMessage: function(args)
		{
			if (args.text == null || String(args.text).trim().length === 0)
			{
				return;
			}
			if (args.level === 'error')
			{
				showError(args.text);
			}
			else
			{
				showInfo(args.text);
			}
		}
	};

	function runUiCommand(cmd)
	{
		var args = cmd.args || {};
		var handler = uiCommandHandlers[cmd.name];
		if (typeof handler === 'function')
		{
			handler(args);
			return;
		}
		writeLog('warn', 'Unknown UI command ignored', {command: cmd});
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

	async function startManualIndicator(params)
	{
		var request = params || {};
		var remoteIndicator = await requestAsync({
			action: 'startSeafManualIndicator',
			type: request.type === 'percent' ? 'percent' : 'spinner',
			label: request.label || 'SEAF manual operation',
			timeoutMs: Number.isFinite(request.timeoutMs) ? request.timeoutMs : null,
			allowStop: request.allowStop === true
		});
		var id = remoteIndicator && remoteIndicator.indicatorId ? remoteIndicator.indicatorId : String(Date.now());
		var uiIndicator = createIndicatorUi({
			type: request.type === 'percent' ? 'percent' : 'spinner',
			title: request.title || 'SEAF manual operation',
			message: request.message || 'Running...',
			timeoutMs: Number.isFinite(request.timeoutMs) ? request.timeoutMs : null,
			allowStop: request.allowStop === true,
			onStop: (typeof request.onStop === 'function') ? request.onStop : null,
			onTimeout: (typeof request.onTimeout === 'function') ? request.onTimeout : null
		});
		state.manualIndicators[id] = uiIndicator;
		return {indicatorId: id};
	}

	async function stopManualIndicator(indicatorId, reason)
	{
		if (indicatorId == null)
		{
			return;
		}

		try
		{
			await requestAsync({
				action: 'finishSeafManualIndicator',
				indicatorId: indicatorId,
				reason: reason || 'completed'
			});
		}
		catch (e)
		{
			// ignore remote finish errors for local cleanup
		}

		var uiIndicator = state.manualIndicators[indicatorId];
		if (uiIndicator != null)
		{
			uiIndicator.stop();
			delete state.manualIndicators[indicatorId];
		}
	}

	async function pollAsyncJob(jobId, command, indicatorCfg, executionCfg)
	{
		var maxAttempts = Math.max(1, (executionCfg && executionCfg.maxPollAttempts) || (command.execution && command.execution.maxPollAttempts) || 120);
		var intervalMs = Math.max(200, (executionCfg && executionCfg.pollIntervalMs) || (command.execution && command.execution.pollIntervalMs) || 1000);
		var indicator = null;
		if (indicatorCfg && indicatorCfg.enabled)
		{
			indicator = createIndicatorUi({
				type: indicatorCfg.type,
				title: command.title || command.id,
				message: 'Запуск задачи...',
				timeoutMs: indicatorCfg.timeoutMs,
				allowStop: indicatorCfg.allowStop && !Number.isFinite(indicatorCfg.timeoutMs),
				onStop: async function()
				{
					await requestAsync({action: 'cancelSeafPluginJob', jobId: jobId});
				},
				onTimeout: async function()
				{
					await requestAsync({action: 'cancelSeafPluginJob', jobId: jobId});
				}
			});
			state.autoIndicatorsByJob[jobId] = indicator;
		}

		var cleanupIndicator = function()
		{
			if (indicator != null)
			{
				indicator.stop();
				indicator = null;
			}
			delete state.autoIndicatorsByJob[jobId];
		};

		try
		{
			for (var i = 0; i < maxAttempts; i++)
			{
				var status = await requestAsync({
					action: 'pollSeafPluginJob',
					jobId: jobId
				});

				if (indicator != null)
				{
					indicator.update({
						message: status.message || status.phase || 'Выполняется...',
						progress: Number.isFinite(status.progress) ? status.progress : null
					});
				}

				if (status.status === 'completed')
				{
					var completedResult = status.result || {};
					if (indicator != null)
					{
						indicator.update({
							message: 'Обновление завершено',
							progress: 100
						});
						await new Promise(function(resolve)
						{
							window.setTimeout(resolve, 300);
						});
						cleanupIndicator();
					}
					executeInteractiveCommands(completedResult);
					if (command && command.id === 'seafSystemUpdatePlugin')
					{
						var updateOutcome = getUpdateUiOutcome(completedResult);
						if (updateOutcome.level === 'error')
						{
							showError(updateOutcome.message);
						}
						else
						{
							showInfo(updateOutcome.message);
						}
					}
					else if (completedResult && typeof completedResult.message === 'string' &&
						completedResult.message.trim().length > 0)
					{
						showInfo(completedResult.message);
					}
					return;
				}

				if (status.status === 'failed' || status.status === 'timed_out' || status.status === 'cancelled')
				{
					var msg = status.status === 'cancelled' ? 'Операция остановлена' : (status.error || 'unknown error');
					showError(formatCommandError(command.id, msg));
					cleanupIndicator();
					return;
				}

				await new Promise(function(resolve)
				{
					window.setTimeout(resolve, intervalMs);
				});
			}
		}
		finally
		{
			cleanupIndicator();
		}

		showError(formatCommandError(command.id, 'async timeout'));
	}

	async function executeInteractiveTerminalCommand(command, source)
	{
		var payload = buildPayload(command);
		var overlayToken = 'pending-' + String(Date.now());
		payload.source = source;

		await writeLog('info', 'Interactive terminal command invocation started', {
			commandId: command.id,
			source: source,
			payload: payload
		});

		showInteractiveOverlay(overlayToken);

		try
		{
			var response = await requestAsync({
				action: 'startSeafInteractiveTerminalSession',
				configPath: state.configPath,
				commandId: command.id,
				payload: payload
			});
			var sessionId = response && response.sessionId ? response.sessionId : null;

			if (!sessionId)
			{
				throw new Error('Interactive terminal session did not return session id');
			}

			if (state.interactiveOverlay != null)
			{
				state.interactiveOverlay.sessionId = sessionId;
			}

			state.interactiveSessionHandlers[sessionId] = function(event)
			{
				if (event.type === 'terminal-closed')
				{
					clearInteractiveSessionWatchdog(sessionId);
					hideInteractiveOverlay(sessionId);
					delete state.interactiveSessionHandlers[sessionId];
					if (event.status === 'failed')
					{
						var errMsg = (typeof event.errorMessage === 'string' && event.errorMessage.trim().length > 0) ?
							event.errorMessage.trim() :
							'Interactive terminal process failed';
						showError(formatCommandError(command.id, errMsg));
					}
				}
			};
			scheduleInteractiveSessionWatchdog(sessionId, command);
		}
		catch (e)
		{
			hideInteractiveOverlay(overlayToken);
			await writeLog('error', 'Interactive terminal command invocation failed', {
				commandId: command.id,
				source: source,
				error: e.message
			});
			showError(formatCommandError(command.id, e.message));
		}
	}

	async function executeCommand(command, source)
	{
		if (command && command.clientAction === 'editConfig')
		{
			await openEditConfigDialog(command);
			return;
		}

		if (command && command.clientAction === 'interactiveTerminal')
		{
			await executeInteractiveTerminalCommand(command, source);
			return;
		}

		var payload = buildPayload(command);
		payload.source = source;
		var indicatorCfg = getIndicatorConfig(command);

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
				await pollAsyncJob(response.jobId, command, indicatorCfg, response.execution || null);
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

	async function executeSystemUpdate(source)
	{
		if (state.systemUpdateInProgress)
		{
			showInfo('Обновление уже выполняется. Подождите завершения.');
			return;
		}

		state.systemUpdateInProgress = true;
		var pseudoCommand = {
			id: 'seafSystemUpdatePlugin',
			title: 'Обновить плагин',
			input: {
				includeDiagramXml: false,
				includeCurrentPage: false
			}
		};
		var payload = buildPayload(pseudoCommand);
		payload.source = source || 'menu';

		await writeLog('info', 'System update invocation started', {
			commandId: pseudoCommand.id,
			source: payload.source
		});

		try
		{
			var response = await requestAsync({
				action: 'updateSeafPluginRuntime',
				configPath: state.configPath,
				commandId: 'seafUpdatePlugin',
				payload: payload
			});
			if (response && response.mode === 'async' && response.jobId)
			{
				var updateCommand = {
					id: pseudoCommand.id,
					title: pseudoCommand.title,
					execution: response.execution || {
						pollIntervalMs: 1000,
						maxPollAttempts: 180
					}
				};
				var updateIndicator = response.indicator || {
					enabled: true,
					type: 'percent',
					timeoutMs: 120000,
					allowStop: false
				};
				await pollAsyncJob(response.jobId, updateCommand, updateIndicator, response.execution || null);
				return;
			}

			var result = response.result || {};
			executeInteractiveCommands(result);
			if (result.status === 'error')
			{
				if (typeof result.message === 'string' && result.message.trim().length > 0)
				{
					showError('seafUpdatePlugin: ' + result.message);
				}
			}
			else
			{
				var updateOutcome = getUpdateUiOutcome(result);
				if (updateOutcome.level === 'error')
				{
					showError(updateOutcome.message);
				}
				else
				{
					showInfo(updateOutcome.message);
				}
			}
		}
		catch (e)
		{
			await writeLog('error', 'System update invocation failed', {
				commandId: pseudoCommand.id,
				source: payload.source,
				error: e.message
			});
			showError('seafUpdatePlugin: ' + e.message);
		}
		finally
		{
			state.systemUpdateInProgress = false;
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
		if (state.mainMenuRegistered)
		{
			return;
		}
		var commands = state.config.commands || [];
		ensureTopLevelMenu('seaf', 'SEAF');
		var customSeafItems = [];
		for (var i = 0; i < commands.length; i++)
		{
			var cmd = commands[i];
			if (cmd.id === 'seafUpdatePlugin')
			{
				continue;
			}
			var mainCfg = (cmd.menu && cmd.menu.main) ? cmd.menu.main : {};
			if (mainCfg.enabled === false)
			{
				continue;
			}
			if (mxUtils.indexOf(customSeafItems, cmd.id) < 0)
			{
				customSeafItems.push(cmd.id);
			}
		}
		var seafMenu = ui.menus.get('seaf');
		if (seafMenu != null)
		{
			var oldFunct = seafMenu.funct;
			seafMenu.funct = function(menuObj, parent)
			{
				oldFunct.apply(this, arguments);
				if (customSeafItems.length > 0)
				{
					ui.menus.addMenuItems(menuObj, ['-'].concat(customSeafItems), parent);
					menuObj.addSeparator(parent);
				}
				ui.menus.addMenuItems(menuObj, ['seafSystemUpdatePlugin'], parent);
				menuObj.addSeparator(parent);
				menuObj.addItem(getRuntimeVersionLabel(), null, null, parent, null, false);
			};
		}

		state.mainMenuRegistered = true;
	}

	function registerContextMenu()
	{
		if (state.contextMenuRegistered)
		{
			return;
		}
		state.contextMenuBaseCreatePopupMenu = ui.menus.createPopupMenu;
		ui.menus.createPopupMenu = function(menu, cell, evt)
		{
			state.contextMenuBaseCreatePopupMenu.apply(this, arguments);
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
		state.contextMenuRegistered = true;
	}

	function registerActions()
	{
		if (state.actionsRegistered)
		{
			return;
		}
		mxResources.parse('seafSystemUpdatePlugin=Обновить плагин');
		if (ui.actions.get('seafSystemUpdatePlugin') == null)
		{
			ui.actions.addAction('seafSystemUpdatePlugin', function()
			{
				executeSystemUpdate('menu');
			});
		}

		var commands = state.config.commands || [];
		for (var i = 0; i < commands.length; i++)
		{
			(function(command)
			{
				if (command.id === 'seafUpdatePlugin')
				{
					return;
				}
				state.commandsById[command.id] = command;
			mxResources.parse(command.id + '=' + (command.title || command.id));
				if (ui.actions.get(command.id) == null)
				{
					ui.actions.addAction(command.id, function()
					{
						executeCommand(command, 'menu');
					});
				}
			})(commands[i]);
		}
		state.actionsRegistered = true;
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
			state.runtimeVersion = await detectRuntimeVersion();
			try
			{
				state.envConfig = await requestAsync({
					action: 'getSeafEnvConfig',
					configPath: state.configPath
				});
			}
			catch (envErr)
			{
				state.envConfig = {env: {}};
			}
			state.logging = computeUiLoggingFromEnv(state.config ? state.config.logging : null, state.envConfig);

			await writeLog('info', 'Plugin initialization started', {
				configPath: state.configPath,
				commandsCount: Array.isArray(state.config.commands) ? state.config.commands.length : 0
			});

			ensureInteractiveSessionListener();
			registerActions();
			registerMainMenu();
			registerContextMenu();
			window.SEAF_PLUGIN_API = {
				startIndicator: startManualIndicator,
				stopIndicator: stopManualIndicator
			};

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
