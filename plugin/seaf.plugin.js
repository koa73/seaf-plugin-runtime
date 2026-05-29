/**
 * SEAF plugin for draw.io desktop runtime.
 * Runtime script version: 0.5.86
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
		},
		seafStencilPaletteIds: [],
		seafStencilSections: [],
		eventConfig: null,
		stencilModelListenerInstalled: false,
		stencilIndexLifecycleHooksInstalled: false,
		stencilEventDispatchInFlight: false,
		pendingStencilBatches: [],
		stencilEventsSuppressedDepth: 0,
		editDataSessionActive: false,
		editDataBeforeByCell: {},
		editDataDialogRouterInstalled: false,
		editDataSessionHideHookInstalled: false,
		originalShowDataDialog: null,
		contextMenuLastCell: null,
		stencilsLayerConfig: null,
		editDataSelection: null,
		bulkEditDataModuleLoaded: false,
		features: {
			intentEngineV2: true,
			menuPresenterV2: true,
			ipcStencilConfigV2: true,
			sessionCoordinatorV2: true
		},
		stencilIndex: {
			ready: false,
			byObjectId: {},
			bySchema: {},
			byOid: {},
			total: 0,
			lastRebuildAt: null
		},
		linkedPageRenameConfirmCache: null
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

	function toBoolFlag(raw, fallback)
	{
		if (typeof raw === 'boolean') return raw;
		if (typeof raw === 'number') return raw !== 0;
		if (typeof raw === 'string')
		{
			var v = raw.trim().toLowerCase();
			if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
			if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
		}
		return fallback === true;
	}

	function refreshFeatureFlagsFromEnv()
	{
		var env = (state.envConfig && state.envConfig.env && typeof state.envConfig.env === 'object') ? state.envConfig.env : {};
		state.features.intentEngineV2 = toBoolFlag(env.featureIntentEngineV2, true);
		state.features.menuPresenterV2 = toBoolFlag(env.featureMenuPresenterV2, true);
		state.features.ipcStencilConfigV2 = toBoolFlag(env.featureIpcStencilConfigV2, true);
		state.features.sessionCoordinatorV2 = toBoolFlag(env.featureSessionCoordinatorV2, true);
	}

	function sanitizeForIpc(value, depth, seen)
	{
		var maxDepth = 6;
		var nextDepth = Number.isFinite(depth) ? depth : 0;
		var known = seen || [];

		if (nextDepth > maxDepth)
		{
			return '[max_depth]';
		}

		if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
		{
			return value;
		}

		if (Array.isArray(value))
		{
			var outArr = [];
			for (var i = 0; i < value.length; i++)
			{
				outArr.push(sanitizeForIpc(value[i], nextDepth + 1, known));
			}
			return outArr;
		}

		if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined')
		{
			return null;
		}

		if (typeof value === 'object')
		{
			for (var j = 0; j < known.length; j++)
			{
				if (known[j] === value)
				{
					return '[circular]';
				}
			}

			known.push(value);
			var outObj = {};
			for (var key in value)
			{
				if (!Object.prototype.hasOwnProperty.call(value, key))
				{
					continue;
				}
				var current = value[key];
				if (typeof current === 'function' || typeof current === 'symbol' || typeof current === 'undefined')
				{
					continue;
				}
				outObj[key] = sanitizeForIpc(current, nextDepth + 1, known);
			}
			known.pop();
			return outObj;
		}

		return String(value);
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

	function normalizePythonBootstrapPayload(payload)
	{
		var src = (payload && typeof payload === 'object') ? payload : {};
		return {
			ok: src.ok === true,
			code: (typeof src.code === 'string' && src.code.trim().length > 0) ? src.code.trim() : 'python_bootstrap_failed',
			stage: (typeof src.stage === 'string' && src.stage.trim().length > 0) ? src.stage.trim() : 'unknown',
			category: (typeof src.category === 'string' && src.category.trim().length > 0) ? src.category.trim() : 'unknown',
			error: (typeof src.error === 'string' && src.error.trim().length > 0) ? src.error.trim() : 'unknown error',
			hint: (typeof src.hint === 'string' && src.hint.trim().length > 0) ? src.hint.trim() : '',
			stderrTail: (typeof src.stderrTail === 'string' && src.stderrTail.trim().length > 0) ? src.stderrTail.trim() : ''
		};
	}

	function parsePythonBootstrapErrorFromMessage(rawMessage)
	{
		if (typeof rawMessage !== 'string' || rawMessage.trim().length === 0)
		{
			return normalizePythonBootstrapPayload(null);
		}
		try
		{
			return normalizePythonBootstrapPayload(JSON.parse(rawMessage));
		}
		catch (e)
		{
			return normalizePythonBootstrapPayload({
				error: rawMessage
			});
		}
	}

	function buildPythonBootstrapDiagnosticText(bootstrap)
	{
		var b = normalizePythonBootstrapPayload(bootstrap);
		var lines = [
			'Автонастройка Python не выполнена.',
			'code: ' + b.code,
			'stage: ' + b.stage,
			'category: ' + b.category,
			'error: ' + b.error
		];
		if (b.hint)
		{
			lines.push('hint: ' + b.hint);
		}
		if (b.stderrTail)
		{
			lines.push('');
			lines.push('stderr:');
			lines.push(b.stderrTail);
		}
		return lines.join('\n');
	}

	function getUpdateUiOutcome(result)
	{
		var payload = (result && typeof result.payload === 'object' && result.payload != null) ? result.payload : {};
		var pythonBootstrap = (payload && typeof payload.pythonBootstrap === 'object' && payload.pythonBootstrap != null) ?
			normalizePythonBootstrapPayload(payload.pythonBootstrap) : null;
		var status = (typeof payload.status === 'string' && payload.status.trim().length > 0) ?
			payload.status.trim() : (typeof result.status === 'string' ? result.status.trim() : '');
		if (status === 'updated')
		{
			if (pythonBootstrap && pythonBootstrap.ok !== true)
			{
				return {
					level: 'bootstrap_failed',
					message: 'Плагин обновлен, но автонастройка Python не выполнена.',
					pythonBootstrap: pythonBootstrap
				};
			}
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

	function openPythonBootstrapFailureDialog(outcome)
	{
		return new Promise(function(resolve)
		{
			var bootstrap = normalizePythonBootstrapPayload(outcome && outcome.pythonBootstrap);
			var container = document.createElement('div');
			container.style.minWidth = '520px';
			container.style.maxWidth = '760px';
			container.style.padding = '8px';
			container.style.boxSizing = 'border-box';

			var title = document.createElement('div');
			title.style.fontWeight = 'bold';
			title.style.marginBottom = '8px';
			title.textContent = 'Автонастройка Python не выполнена';
			container.appendChild(title);

			var text = document.createElement('div');
			text.style.marginBottom = '10px';
			text.style.whiteSpace = 'pre-wrap';
			text.textContent = 'Плагин обновлен, но Python окружение не подготовлено автоматически.';
			container.appendChild(text);

			var footer = document.createElement('div');
			footer.style.textAlign = 'right';
			footer.style.marginTop = '10px';
			footer.style.whiteSpace = 'nowrap';

			var editConfigBtn = mxUtils.button('Edit Config', async function()
			{
				ui.hideDialog();
				var cfgCommand = state.commandsById['seafEditConfig'] || null;
				if (cfgCommand != null)
				{
					await openEditConfigDialog(cfgCommand);
				}
				resolve('edit_config');
			});
			editConfigBtn.className = 'geBtn';

			var diagnosticsBtn = mxUtils.button('Диагностика', function()
			{
				showError(buildPythonBootstrapDiagnosticText(bootstrap));
			});
			diagnosticsBtn.className = 'geBtn';

			var retryBtn = mxUtils.button('Повторить', async function()
			{
				try
				{
					var retry = await requestAsync({
						action: 'bootstrapSeafPythonRuntime',
						configPath: state.configPath,
						source: 'update_retry'
					});
					ui.hideDialog();
					var py = normalizePythonBootstrapPayload(retry);
					if (py.ok === true)
					{
						showInfo('Автонастройка Python завершена успешно.');
					}
					else
					{
						showError(buildPythonBootstrapDiagnosticText(py));
					}
					resolve('retry');
				}
				catch (e)
				{
					var parsed = parsePythonBootstrapErrorFromMessage(e && e.message ? e.message : String(e));
					showError(buildPythonBootstrapDiagnosticText(parsed));
				}
			});
			retryBtn.className = 'geBtn gePrimaryBtn';

			footer.appendChild(retryBtn);
			footer.appendChild(diagnosticsBtn);
			footer.appendChild(editConfigBtn);
			container.appendChild(footer);

			ui.showDialog(container, 560, 210, true, true);
		});
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

	function joinPathFragments()
	{
		var out = '';
		for (var i = 0; i < arguments.length; i++)
		{
			var part = arguments[i];
			if (part == null)
			{
				continue;
			}
			var text = String(part);
			if (text.length === 0)
			{
				continue;
			}
			if (out.length === 0)
			{
				out = text.replace(/[\\\/]+$/, '');
			}
			else
			{
				out = out.replace(/[\\\/]+$/, '') + '/' + text.replace(/^[\\\/]+/, '');
			}
		}
		return out;
	}

	function getRuntimeRootFromConfigPath()
	{
		if (typeof state.configPath !== 'string' || state.configPath.length === 0)
		{
			return null;
		}
		var normalized = state.configPath.replace(/\\/g, '/');
		var suffix = '/conf/plugin.yaml';
		if (normalized.length <= suffix.length || normalized.slice(-suffix.length) !== suffix)
		{
			return null;
		}
		return normalized.slice(0, normalized.length - suffix.length);
	}

	function getStencilsConfigPath()
	{
		var runtimeRoot = getRuntimeRootFromConfigPath();
		if (!runtimeRoot)
		{
			return null;
		}
		return joinPathFragments(runtimeRoot, 'conf', 'stencils', 'libraries.json');
	}

	function getStencilsLayerConfigPath()
	{
		var runtimeRoot = getRuntimeRootFromConfigPath();
		if (!runtimeRoot)
		{
			return null;
		}
		return joinPathFragments(runtimeRoot, 'conf', 'stencils', 'config.yaml');
	}

	function parseLibrariesConfig(rawText)
	{
		var raw = (typeof rawText === 'string') ? rawText.trim() : '';
		if (raw.length === 0)
		{
			return null;
		}

		// YAML is a superset of JSON. We keep config JSON-compatible for stable parsing in renderer.
		return JSON.parse(raw);
	}

	function validateLibrariesConfig(parsed)
	{
		if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed))
		{
			throw new Error('Stencils config must be an object');
		}

		if (!Array.isArray(parsed.sections))
		{
			throw new Error('Stencils config must contain sections[]');
		}

		for (var i = 0; i < parsed.sections.length; i++)
		{
			var section = parsed.sections[i];
			if (section == null || typeof section !== 'object' || Array.isArray(section))
			{
				throw new Error('Invalid section at index ' + i);
			}
			if (!Array.isArray(section.entries))
			{
				throw new Error('Section "' + (section.id || i) + '" must contain entries[]');
			}

			for (var j = 0; j < section.entries.length; j++)
			{
				var entry = section.entries[j];
				if (entry == null || typeof entry !== 'object' || Array.isArray(entry))
				{
					throw new Error('Invalid entry at section ' + i + ', index ' + j);
				}
				if (typeof entry.file !== 'string' || entry.file.trim().length === 0)
				{
					throw new Error('Entry "' + (entry.id || (i + ':' + j)) + '" must contain non-empty file');
				}
			}
		}
	}

	function parseMxLibraryData(rawXml)
	{
		var doc = mxUtils.parseXml(rawXml);
		if (doc == null || doc.documentElement == null || doc.documentElement.nodeName !== 'mxlibrary')
		{
			throw new Error('Invalid library XML root (expected <mxlibrary>)');
		}
		var dataText = mxUtils.getTextContent(doc.documentElement);
		var parsed = JSON.parse(dataText);
		if (!Array.isArray(parsed))
		{
			throw new Error('Library data must be an array');
		}
		return parsed;
	}

	function toDisplayText(value)
	{
		if (value == null)
		{
			return '';
		}
		if (typeof value === 'string')
		{
			return value.trim();
		}
		if (typeof value === 'object')
		{
			if (typeof value.main === 'string' && value.main.trim().length > 0)
			{
				return value.main.trim();
			}
			if (typeof value.ru === 'string' && value.ru.trim().length > 0)
			{
				return value.ru.trim();
			}
			if (typeof value.en === 'string' && value.en.trim().length > 0)
			{
				return value.en.trim();
			}
		}
		return String(value).trim();
	}

	// Inline mini YAML parser tuned for stencils/config.yaml shape:
	// - top-level objects, nested objects with 2-space indent
	// - lists ("- item" lines)
	// - scalars (string/bool/number/null), with optional double or single quotes
	// - "#" comments stripped (outside quotes)
	function stencilsYaml_stripComment(line)
	{
		var quote = null;
		for (var i = 0; i < line.length; i++)
		{
			var ch = line[i];
			if ((ch === '"' || ch === "'") && (i === 0 || line[i - 1] !== '\\'))
			{
				if (quote === ch)
				{
					quote = null;
				}
				else if (quote == null)
				{
					quote = ch;
				}
			}
			else if (ch === '#' && quote == null)
			{
				return line.substring(0, i);
			}
		}
		return line;
	}

	function stencilsYaml_parseScalar(raw)
	{
		var text = String(raw == null ? '' : raw);
		if (text === 'true') return true;
		if (text === 'false') return false;
		if (text === 'null' || text === '~') return null;
		if (/^-?\d+$/.test(text)) return parseInt(text, 10);
		if (/^-?\d+\.\d+$/.test(text)) return parseFloat(text);
		if (text.length >= 2 &&
			((text.charAt(0) === '"' && text.charAt(text.length - 1) === '"') ||
			 (text.charAt(0) === "'" && text.charAt(text.length - 1) === "'")))
		{
			return text.substring(1, text.length - 1);
		}
		// Inline list: "[a, b]"
		if (text.length >= 2 && text.charAt(0) === '[' && text.charAt(text.length - 1) === ']')
		{
			var inner = text.substring(1, text.length - 1).trim();
			if (inner.length === 0) return [];
			var parts = inner.split(',');
			var arr = [];
			for (var i = 0; i < parts.length; i++)
			{
				arr.push(stencilsYaml_parseScalar(parts[i].trim()));
			}
			return arr;
		}
		return text;
	}

	function stencilsYaml_preprocess(text)
	{
		var lines = text.split(/\r?\n/);
		var out = [];
		for (var i = 0; i < lines.length; i++)
		{
			var cleaned = stencilsYaml_stripComment(lines[i]).replace(/\t/g, '    ');
			if (cleaned.replace(/\s+$/, '').length === 0)
			{
				continue;
			}
			var indentMatch = /^ */.exec(cleaned);
			var indent = indentMatch ? indentMatch[0].length : 0;
			var content = cleaned.replace(/\s+$/, '').trim();
			out.push({indent: indent, content: content});
		}
		return out;
	}

	function stencilsYaml_parseCollection(lines, startIdx, baseIndent)
	{
		var idx = startIdx;
		var mode = null;
		var obj = {};
		var arr = [];
		while (idx < lines.length)
		{
			var line = lines[idx];
			if (line.indent < baseIndent)
			{
				break;
			}
			if (line.indent > baseIndent)
			{
				throw new Error('Invalid indentation near: ' + line.content);
			}
			var isList = line.content.indexOf('- ') === 0 || line.content === '-';
			if (mode == null)
			{
				mode = isList ? 'array' : 'object';
			}
			else if ((mode === 'array' && !isList) || (mode === 'object' && isList))
			{
				break;
			}
			if (mode === 'array')
			{
				var item = (line.content === '-') ? '' : line.content.substring(2).trim();
				if (item.length === 0)
				{
					var nestedEmpty = stencilsYaml_parseCollection(lines, idx + 1, baseIndent + 2);
					arr.push(nestedEmpty.value);
					idx = nestedEmpty.nextIdx;
				}
				else
				{
					var inlineColon = item.indexOf(':');
					if (inlineColon > 0 && (inlineColon === item.length - 1 || item.charAt(inlineColon + 1) === ' '))
					{
						var key = item.substring(0, inlineColon).trim();
						var rest = item.substring(inlineColon + 1).trim();
						var seed = {};
						if (rest.length > 0)
						{
							seed[key] = stencilsYaml_parseScalar(rest);
							idx++;
							var nestedInline = stencilsYaml_parseCollection(lines, idx, baseIndent + 4);
							if (nestedInline.nextIdx > idx && nestedInline.value && typeof nestedInline.value === 'object' && !Array.isArray(nestedInline.value))
							{
								for (var k1 in nestedInline.value)
								{
									if (Object.prototype.hasOwnProperty.call(nestedInline.value, k1))
									{
										seed[k1] = nestedInline.value[k1];
									}
								}
								idx = nestedInline.nextIdx;
							}
						}
						else
						{
							var nested2 = stencilsYaml_parseCollection(lines, idx + 1, baseIndent + 4);
							seed[key] = nested2.value;
							idx = nested2.nextIdx;
						}
						arr.push(seed);
					}
					else
					{
						arr.push(stencilsYaml_parseScalar(item));
						idx++;
					}
				}
			}
			else
			{
				var colonIdx = line.content.indexOf(':');
				if (colonIdx < 0)
				{
					throw new Error('Missing ":" in: ' + line.content);
				}
				var keyObj = line.content.substring(0, colonIdx).trim();
				var restObj = line.content.substring(colonIdx + 1).trim();
				if (restObj.length > 0)
				{
					obj[keyObj] = stencilsYaml_parseScalar(restObj);
					idx++;
				}
				else
				{
					var nestedObj = stencilsYaml_parseCollection(lines, idx + 1, baseIndent + 2);
					obj[keyObj] = nestedObj.value;
					idx = nestedObj.nextIdx;
				}
			}
		}
		return {value: mode === 'array' ? arr : obj, nextIdx: idx};
	}

	function parseStencilsConfigYaml(text)
	{
		if (typeof text !== 'string')
		{
			return {};
		}
		var trimmed = text.trim();
		if (trimmed.length === 0)
		{
			return {};
		}
		// JSON shortcut
		if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[')
		{
			try { return JSON.parse(trimmed); } catch (e) { /* fall through */ }
		}
		var lines = stencilsYaml_preprocess(text);
		if (lines.length === 0)
		{
			return {};
		}
		var parsed = stencilsYaml_parseCollection(lines, 0, lines[0].indent);
		return parsed.value || {};
	}

	function normalizeIpcTextPayload(rawValue)
	{
		if (typeof rawValue === 'string')
		{
			return rawValue;
		}
		if (rawValue == null)
		{
			return '';
		}
		if (Array.isArray(rawValue))
		{
			try
			{
				if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function')
				{
					return Buffer.from(rawValue).toString('utf8');
				}
			}
			catch (eArr)
			{
				// fall through
			}
		}
		// Node/Electron Buffer payload can arrive as plain object through IPC serialization.
		// Example: {type: 'Buffer', data: [..bytes..]}
		if (rawValue != null && typeof rawValue === 'object' &&
			rawValue.type === 'Buffer' && Array.isArray(rawValue.data))
		{
			try
			{
				if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function')
				{
					return Buffer.from(rawValue.data).toString('utf8');
				}
			}
			catch (eBuf)
			{
				// fall through
			}
		}
		if (rawValue != null && typeof rawValue === 'object')
		{
			if (typeof rawValue.text === 'string')
			{
				return rawValue.text;
			}
			if (typeof rawValue.data === 'string')
			{
				return rawValue.data;
			}
			if (typeof rawValue.value === 'string')
			{
				return rawValue.value;
			}
			if (typeof rawValue.length === 'number' && rawValue.length > 0)
			{
				try
				{
					var bytes = [];
					for (var i = 0; i < rawValue.length; i++)
					{
						var bv = rawValue[i];
						if (typeof bv !== 'number') { bytes = null; break; }
						bytes.push(bv & 255);
					}
					if (bytes != null && bytes.length > 0)
					{
						if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function')
						{
							return Buffer.from(bytes).toString('utf8');
						}
						if (typeof TextDecoder !== 'undefined')
						{
							return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
						}
					}
				}
				catch (eLike)
				{
					// fall through
				}
			}
		}
		if (typeof ArrayBuffer !== 'undefined' && rawValue instanceof ArrayBuffer)
		{
			try
			{
				return new TextDecoder('utf-8').decode(new Uint8Array(rawValue));
			}
			catch (eAb)
			{
				// fall through
			}
		}
		if (typeof Uint8Array !== 'undefined' && rawValue instanceof Uint8Array)
		{
			try
			{
				return new TextDecoder('utf-8').decode(rawValue);
			}
			catch (eUa)
			{
				// fall through
			}
		}
		return '';
	}

	async function loadStencilsLayerConfig()
	{
		var path = getStencilsLayerConfigPath();
		if (path == null)
		{
			state.stencilsLayerConfig = {schemas: {}};
			await writeLog('warn', 'Stencils layer config path not resolved; SEAF prefix fallback in effect', {});
			return;
		}
		try
		{
			var normalizedText = '';
			var parsed = null;
			var typed = await requestAsync({
				action: 'getSeafStencilConfig',
				configPath: state.configPath
			});
			if (typed != null && typeof typed === 'object' && typed.stencils != null &&
				typeof typed.stencils === 'object' && !Array.isArray(typed.stencils))
			{
				parsed = typed.stencils;
			}
			if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed))
			{
				parsed = {};
			}
			if (parsed.schemas == null || typeof parsed.schemas !== 'object' || Array.isArray(parsed.schemas))
			{
				parsed.schemas = {};
			}
			state.stencilsLayerConfig = parsed;
			var schemaKeys = Object.keys(parsed.schemas);
			var sampleKey = schemaKeys.length > 0 ? schemaKeys[0] : null;
			var sample = null;
			if (sampleKey != null)
			{
				sample = {
					schema: sampleKey,
					mode: getEditDataModeForSchema(sampleKey),
					lock: getDataLockForSchema(sampleKey)
				};
			}
			await writeLog('info', 'Stencils layer config loaded', {
				path: path,
				schemas: schemaKeys.length,
				sample: sample,
				source: 'getSeafStencilConfig'
			});
			if (schemaKeys.length === 0)
			{
				await writeLog('warn', 'Stencils layer config parsed empty', {
					normalizedLength: normalizedText.length,
					normalizedHead: normalizedText.substring(0, 80),
					typedApiEnabled: true
				});
			}
		}
		catch (e)
		{
			state.stencilsLayerConfig = {schemas: {}};
			await writeLog('error', 'Stencils layer config load failed; SEAF prefix fallback in effect', {
				path: path,
				error: e && e.message ? e.message : String(e)
			});
		}
	}

	function getSchemaConfigEntry(schema)
	{
		var key = (typeof schema === 'string') ? schema.trim() : '';
		if (key.length === 0) return null;
		var cfg = state.stencilsLayerConfig;
		if (cfg == null || cfg.schemas == null || typeof cfg.schemas !== 'object') return null;

		var candidates = [];
		var seen = {};
		function addCandidate(raw)
		{
			var v = (typeof raw === 'string') ? raw.trim() : '';
			if (v.length === 0 || seen[v] === true) return;
			seen[v] = true;
			candidates.push(v);
		}

		addCandidate(key);
		addCandidate(key.replace(/[;,#\s]+$/g, ''));
		var stopChars = [';', ',', '#'];
		for (var si = 0; si < stopChars.length; si++)
		{
			var p = key.indexOf(stopChars[si]);
			if (p > 0)
			{
				addCandidate(key.substring(0, p));
			}
		}

		// Some shape/style payloads can prepend namespaced shape families.
		var marker = 'seaf.';
		var idx = key.indexOf(marker);
		if (idx > 0)
		{
			addCandidate(key.substring(idx));
		}

		for (var i = 0; i < candidates.length; i++)
		{
			var entry = cfg.schemas[candidates[i]];
			if (entry != null && typeof entry === 'object' && !Array.isArray(entry))
			{
				return entry;
			}
		}
		return null;
	}

	// True if schema key looks like a SEAF-managed schema (must start with seaf.<companyPrefix>.).
	// Used as a safe fallback when stencils/config.yaml could not be loaded or the schema is missing
	// from the config: we still want SEAF behavior for clearly-SEAF schemas instead of silently
	// degrading to the standard dialog.
	function isSeafPrefixedSchema(schema)
	{
		if (typeof schema !== 'string') return false;
		var key = schema.trim();
		if (key.length === 0) return false;
		return key.indexOf('seaf.') === 0;
	}

	function getEditDataContextConfigCommands()
	{
		var out = [];
		var commands = (state && state.config && Array.isArray(state.config.commands)) ? state.config.commands : [];
		for (var i = 0; i < commands.length; i++)
		{
			var cmd = commands[i];
			if (!cmd || typeof cmd !== 'object')
			{
				continue;
			}
			if (cmd.clientAction !== 'seafEditData')
			{
				continue;
			}
			var ctx = (cmd.menu && cmd.menu.context && typeof cmd.menu.context === 'object') ? cmd.menu.context : null;
			if (!ctx || ctx.enabled !== true)
			{
				continue;
			}
			out.push(cmd);
		}
		return out;
	}

	function normalizeEditDataContextMode(raw)
	{
		var value = (typeof raw === 'string') ? raw.trim().toLowerCase() : '';
		if (value === 'soft')
		{
			return 'soft';
		}
		return 'hard';
	}

	function resolveEditDataContextModeForSchema(schema)
	{
		var normalizedSchema = (typeof schema === 'string') ? schema.trim() : '';
		if (normalizedSchema.length === 0)
		{
			return {mode: 'standard', source: 'schema_missing'};
		}
		var matches = [];
		var commands = getEditDataContextConfigCommands();
		for (var i = 0; i < commands.length; i++)
		{
			var cmd = commands[i];
			var ctx = cmd && cmd.menu && cmd.menu.context ? cmd.menu.context : {};
			var mode = normalizeEditDataContextMode(ctx.editDataMode);
			var schemaPattern = ctx.schemaPattern;
			var patterns = [];
			if (schemaPattern == null)
			{
				patterns = ['all'];
			}
			else
			{
				var rawPatterns = Array.isArray(schemaPattern) ? schemaPattern : [schemaPattern];
				for (var p = 0; p < rawPatterns.length; p++)
				{
					var normalizedPattern = (typeof rawPatterns[p] === 'string') ? rawPatterns[p].trim() : '';
					if (normalizedPattern.length > 0)
					{
						patterns.push(normalizedPattern);
					}
				}
			}
			for (var pi = 0; pi < patterns.length; pi++)
			{
				var match = matchSchemaPattern(normalizedSchema, patterns[pi]);
				if (match && match.matched === true)
				{
					matches.push({
						score: match.score || 0,
						mode: mode,
						pattern: patterns[pi],
						commandId: cmd.id || ''
					});
				}
			}
		}
		if (matches.length === 0)
		{
			return {mode: 'standard', source: 'context_no_match'};
		}
		matches.sort(function(a, b)
		{
			if (a.score !== b.score)
			{
				return b.score - a.score;
			}
			if (a.mode !== b.mode)
			{
				// hard wins over soft for deterministic safety.
				return a.mode === 'hard' ? -1 : 1;
			}
			return 0;
		});
		return {
			mode: matches[0].mode,
			source: 'context_menu',
			commandId: matches[0].commandId,
			pattern: matches[0].pattern
		};
	}

	function getEditDataModeForSchema(schema)
	{
		var resolved = resolveEditDataContextModeForSchema(schema);
		if (!resolved || resolved.mode === 'standard')
		{
			return 'standard';
		}
		return resolved.mode === 'soft' ? 'both' : 'seaf';
	}

	function getDataLockForSchema(schema)
	{
		var entry = getSchemaConfigEntry(schema);
		if (entry == null)
		{
			return isSeafPrefixedSchema(schema) ? ['OID', 'schema'] : [];
		}
		var raw = entry.data_lock;
		if (Array.isArray(raw))
		{
			var out = [];
			for (var i = 0; i < raw.length; i++)
			{
				var name = (raw[i] == null) ? '' : String(raw[i]).trim();
				if (name.length > 0 && out.indexOf(name) < 0)
				{
					out.push(name);
				}
			}
			return out;
		}
		return ['OID', 'schema'];
	}

	function getDataHiddenForSchema(schema)
	{
		var entry = getSchemaConfigEntry(schema);
		if (entry == null)
		{
			return [];
		}
		var raw = entry.data_hidden;
		if (Array.isArray(raw))
		{
			var out = [];
			for (var i = 0; i < raw.length; i++)
			{
				var name = (raw[i] == null) ? '' : String(raw[i]).trim();
				if (name.length > 0 && out.indexOf(name) < 0)
				{
					out.push(name);
				}
			}
			return out;
		}
		return [];
	}

	function normalizeSchemaKey(rawSchema)
	{
		if (typeof rawSchema === 'string')
		{
			return rawSchema.trim();
		}
		if (rawSchema != null && typeof rawSchema === 'object')
		{
			if (typeof rawSchema.schema === 'string')
			{
				return rawSchema.schema.trim();
			}
		}
		return '';
	}

	function getLayerNameForSchema(schema)
	{
		var key = normalizeSchemaKey(schema);
		if (key.length === 0)
		{
			return '';
		}
		var entry = getSchemaConfigEntry(key);
		if (entry == null)
		{
			return '';
		}
		var layer = entry.layer;
		if (typeof layer === 'string')
		{
			return layer.trim();
		}
		if (Array.isArray(layer))
		{
			for (var i = 0; i < layer.length; i++)
			{
				var value = String(layer[i] || '').trim();
				if (value.length > 0)
				{
					return value;
				}
			}
		}
		return '';
	}

	function findP41LibraryItemByTitle(title)
	{
		var expected = (typeof title === 'string') ? title.trim() : '';
		if (!expected || !Array.isArray(state.seafStencilSections))
		{
			return null;
		}
		for (var i = 0; i < state.seafStencilSections.length; i++)
		{
			var section = state.seafStencilSections[i] || {};
			var entries = Array.isArray(section.entries) ? section.entries : [];
			for (var j = 0; j < entries.length; j++)
			{
				var entry = entries[j] || {};
				var isP41 = (entry.id === 'seaf_r41') || (toDisplayText(entry.title) === 'SEAF_Р41');
				if (!isP41)
				{
					continue;
				}
				var libs = Array.isArray(entry.libs) ? entry.libs : [];
				for (var k = 0; k < libs.length; k++)
				{
					var lib = libs[k] || {};
					var data = Array.isArray(lib.data) ? lib.data : [];
					for (var n = 0; n < data.length; n++)
					{
						var item = data[n] || {};
						var itemTitle = (typeof item.title === 'string') ? item.title.trim() : '';
						if (itemTitle === expected)
						{
							return item;
						}
					}
				}
			}
		}
		return null;
	}

	function extractTemplateSchemaFromCells(cells)
	{
		var queue = Array.isArray(cells) ? cells.slice() : [];
		var seen = {};
		while (queue.length > 0)
		{
			var cell = queue.shift();
			if (cell == null)
			{
				continue;
			}
			var cid = (typeof cell.id === 'string' && cell.id.length > 0) ? cell.id : ('tmp_' + queue.length + '_' + Math.random());
			if (seen[cid] === true)
			{
				continue;
			}
			seen[cid] = true;
			try
			{
				var value = cell.value;
				if (value != null)
				{
					var schema = '';
					if (typeof value.getAttribute === 'function')
					{
						schema = String(value.getAttribute('schema') || '').trim();
					}
					else if (typeof value === 'object' && typeof value.schema === 'string')
					{
						schema = value.schema.trim();
					}
					if (schema.length > 0)
					{
						return schema;
					}
				}
			}
			catch (ignored)
			{
				// ignore malformed node
			}
			var children = cell.children;
			if (Array.isArray(children))
			{
				for (var i = 0; i < children.length; i++)
				{
					queue.push(children[i]);
				}
			}
		}
		return '';
	}

	function resolveSchemaPolicy(schema)
	{
		var key = (typeof schema === 'string') ? schema.trim() : '';
		var mode = 'standard';
		var policySource = 'hard-default';
		var contextPolicy = resolveEditDataContextModeForSchema(key);
		if (contextPolicy && contextPolicy.mode === 'soft')
		{
			mode = 'both';
			policySource = 'context-menu-soft';
		}
		else if (contextPolicy && contextPolicy.mode === 'hard')
		{
			mode = 'seaf';
			policySource = 'context-menu-hard';
		}
		else
		{
			mode = 'standard';
			policySource = 'context-menu-none';
		}

		return {
			schema: key,
			mode: mode,
			lockList: getDataLockForSchema(key),
			hiddenList: getDataHiddenForSchema(key),
			policySource: policySource
		};
	}

	function buildEditDataIntent(sourceCell, graph, sourceKind)
	{
		var resolved = resolveEditDataTarget(sourceCell, graph);
		var targetCell = (resolved && resolved.cell) ? resolved.cell : sourceCell;
		var schema = (resolved && typeof resolved.schema === 'string') ? resolved.schema : '';
		var policy = resolveSchemaPolicy(schema);

		return {
			source: (typeof sourceKind === 'string' && sourceKind.length > 0) ? sourceKind : 'unknown',
			sourceCellId: sourceCell && sourceCell.id ? String(sourceCell.id) : null,
			targetCellId: targetCell && targetCell.id ? String(targetCell.id) : null,
			sourceCell: sourceCell || null,
			targetCell: targetCell || null,
			schema: policy.schema,
			mode: policy.mode,
			lockList: Array.isArray(policy.lockList) ? policy.lockList : [],
			hiddenList: Array.isArray(policy.hiddenList) ? policy.hiddenList : [],
			policySource: policy.policySource
		};
	}

	var EditDataSessionCoordinator = {
		begin: function(graph)
		{
			state.editDataSessionActive = true;
			state.editDataBeforeByCell = captureEditDataBeforeSnapshots(graph);
		},
		reset: function()
		{
			state.editDataSessionActive = false;
			state.editDataBeforeByCell = {};
		}
	};

	var ContextMenuPresenter = {
		normalizeMenuLabel: function(value)
		{
			var text = (value == null) ? '' : String(value);
			// Draw.io may render menu labels with trailing "..." while custom fallback can use plain text.
			// Compare normalized forms to avoid false "item missing" and duplicate insertion.
			return text
				.replace(/\u2026/g, '...')
				.replace(/\s*\.\.\.\s*$/, '')
				.trim();
		},
		getItemStateByLabel: function(menuObj, labelText)
		{
			var out = {present: false, enabled: false};
			try
			{
				if (menuObj == null || menuObj.tbody == null || typeof labelText !== 'string') return out;
				var expected = this.normalizeMenuLabel(labelText);
				if (expected.length === 0) return out;
				var rows = menuObj.tbody.getElementsByTagName('tr');
				for (var ri = 0; ri < rows.length; ri++)
				{
					var cols = rows[ri].getElementsByTagName('td');
					if (cols != null && cols.length > 1)
					{
						var current = this.normalizeMenuLabel(cols[1].textContent || '');
						if (current === expected)
						{
							out.present = true;
							var className = String(rows[ri].className || '');
							out.enabled = className.indexOf('mxDisabled') < 0;
							return out;
						}
					}
				}
			}
			catch (e)
			{
				return out;
			}
			return out;
		},
		addSeaf: function(menuObj, evt, enabled)
		{
			var seafLabel = mxResources.get('seafEditData');
			menuObj.addItem(seafLabel, null, function()
			{
				var action = ui.actions.get('seafEditData');
				if (action != null && typeof action.funct === 'function') action.funct(evt);
			}, null, null, enabled !== false);
		},
		render: function(menuObj, intent, evt)
		{
			if (intent == null || intent.targetCell == null) return;
			if (intent.mode === 'seaf')
			{
				this.addSeaf(menuObj, evt, true);
				return;
			}
			if (intent.mode === 'both')
			{
				this.addSeaf(menuObj, evt, true);
				return;
			}
			if (intent.mode === 'standard')
			{
				this.addSeaf(menuObj, evt, false);
			}
		}
	};

	var EditDataDialogRouter = {
		route: function(cell, sourceKind)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			var intent = buildEditDataIntent(cell, graph, sourceKind);
			if (intent.targetCell != null && (intent.mode === 'seaf' || intent.mode === 'both'))
			{
				showSeafEditDataDialog(intent.targetCell);
				return {handled: true, intent: intent};
			}
			return {handled: false, intent: intent};
		}
	};

	function isSeafEditDataModeForCell(cell, graph)
	{
		if (cell == null)
		{
			return false;
		}
		try
		{
		var resolved = resolveEditDataTarget(cell, graph);
		var schema = (resolved && typeof resolved.schema === 'string') ? resolved.schema : '';
			var mode = getEditDataModeForSchema(schema);
			return mode === 'seaf' || mode === 'both';
		}
		catch (e)
		{
			return false;
		}
	}

	function captureEditDataBeforeSnapshots(graph)
	{
		var map = {};
		try
		{
			if (!graph) return map;
			var selected = graph.getSelectionCells() || [];
			for (var i = 0; i < selected.length; i++)
			{
				var cell = selected[i];
				if (cell && cell.id)
				{
					map[cell.id] = {
						value: sanitizeForIpc(cell.value),
						data: extractEditableDataFromCell(cell, graph)
					};
				}
			}
		}
		catch (e)
		{
			// ignore pre-snapshot errors
		}
		return map;
	}

	// Snapshot explicit cells (by id) from the live model — unlike captureEditDataBeforeSnapshots(selection),
	// does not depend on graph selection (hideDialog often clears selection before Apply writes the value).
	function captureEditDataBeforeForCellIds(graph, cells)
	{
		var map = {};
		try
		{
			if (!graph || !graph.getModel || !Array.isArray(cells))
			{
				return map;
			}
			var model = graph.getModel();
			for (var ci = 0; ci < cells.length; ci++)
			{
				var c = cells[ci];
				if (!c || !c.id || !model || typeof model.getValue !== 'function')
				{
					continue;
				}
				map[c.id] = {
					value: sanitizeForIpc(model.getValue(c)),
					data: extractEditableDataFromCell(c, graph)
				};
			}
		}
		catch (e)
		{
			// ignore
		}
		return map;
	}

	function normalizeLocalizedResource(value, fallback)
	{
		if (value != null && typeof value === 'object' && !Array.isArray(value))
		{
			if (typeof value.main === 'string' && value.main.trim().length > 0)
			{
				return value;
			}
		}

		if (typeof value === 'string' && value.trim().length > 0)
		{
			return {main: value.trim()};
		}

		return {main: (typeof fallback === 'string' && fallback.trim().length > 0) ? fallback.trim() : ''};
	}

	function normalizeCustomEntriesConfig(rawSections)
	{
		var sections = Array.isArray(rawSections) ? rawSections : [];
		var outSections = [];
		var usedSectionIds = {};
		var usedEntryIds = {};

		for (var i = 0; i < sections.length; i++)
		{
			var section = sections[i];
			if (section == null || typeof section !== 'object' || Array.isArray(section))
			{
				continue;
			}

			var sectionId = (typeof section.id === 'string' && section.id.trim().length > 0) ?
				section.id.trim() : ('seaf_section_' + i);
			if (Object.prototype.hasOwnProperty.call(usedSectionIds, sectionId))
			{
				continue;
			}
			usedSectionIds[sectionId] = true;

			var sectionTitle = normalizeLocalizedResource(section.title, sectionId);
			var rawEntries = Array.isArray(section.entries) ? section.entries : [];
			var entries = [];

			for (var j = 0; j < rawEntries.length; j++)
			{
				var entry = rawEntries[j];
				if (entry == null || typeof entry !== 'object' || Array.isArray(entry))
				{
					continue;
				}
				var entryId = (typeof entry.id === 'string' && entry.id.trim().length > 0) ?
					entry.id.trim() : ('seaf_stencil_' + i + '_' + j);
				if (entryId.indexOf(';') >= 0 || Object.prototype.hasOwnProperty.call(usedEntryIds, entryId))
				{
					continue;
				}
				usedEntryIds[entryId] = true;

				var file = (typeof entry.file === 'string') ? entry.file.trim() : '';
				if (file.length === 0)
				{
					continue;
				}

				entries.push({
					id: entryId,
					file: file,
					title: normalizeLocalizedResource(entry.title, entryId),
					enabledByDefault: entry.enabledByDefault === true
				});
			}

			if (entries.length > 0)
			{
				outSections.push({
					id: sectionId,
					title: sectionTitle,
					entries: entries
				});
			}
		}

		return outSections;
	}

	function getSavedLibrariesString()
	{
		try
		{
			if (typeof mxSettings !== 'undefined' && mxSettings != null &&
				typeof mxSettings.getLibraries === 'function')
			{
				var saved = mxSettings.getLibraries();
				if (typeof saved === 'string' && saved.trim().length > 0)
				{
					return saved.trim();
				}
			}
		}
		catch (ignored)
		{
			// ignore settings read errors
		}

		return '';
	}

	function splitLibrariesString(value)
	{
		var text = (typeof value === 'string') ? value : '';
		if (text.trim().length === 0)
		{
			return [];
		}

		var parts = text.split(';');
		var out = [];
		for (var i = 0; i < parts.length; i++)
		{
			var item = parts[i].trim();
			if (item.length > 0)
			{
				out.push(item);
			}
		}
		return out;
	}

	function buildLibrariesString(items)
	{
		var seen = {};
		var out = [];
		for (var i = 0; i < items.length; i++)
		{
			var item = items[i];
			if (typeof item !== 'string' || item.trim().length === 0)
			{
				continue;
			}
			var key = item.trim();
			if (!Object.prototype.hasOwnProperty.call(seen, key))
			{
				seen[key] = true;
				out.push(key);
			}
		}
		return out.join(';');
	}

	function applySeafStencilVisibilityPolicy(sidebar, loadedSections)
	{
		if (sidebar == null || typeof sidebar.showEntries !== 'function')
		{
			return;
		}

		var saved = getSavedLibrariesString();
		if (saved.length > 0)
		{
			// respect_saved policy
			sidebar.showEntries(saved, false, true);
			return;
		}

		var baseline = [];
		if (typeof sidebar.defaultEntries === 'string')
		{
			baseline = splitLibrariesString(sidebar.defaultEntries);
		}

		for (var i = 0; i < loadedSections.length; i++)
		{
			var section = loadedSections[i];
			for (var j = 0; section && section.entries && j < section.entries.length; j++)
			{
				var entry = section.entries[j];
				if (entry && entry._enabledByDefault === true)
				{
					baseline.push(entry.id);
				}
			}
		}

		sidebar.showEntries(buildLibrariesString(baseline), false, true);
	}

	function removeSeafStencilPalettes(sidebar)
	{
		if (sidebar == null || typeof sidebar.removePalette !== 'function')
		{
			return;
		}
		for (var i = 0; i < state.seafStencilPaletteIds.length; i++)
		{
			sidebar.removePalette(state.seafStencilPaletteIds[i]);
		}
		state.seafStencilPaletteIds = [];
	}

	function applySeafCustomEntriesToSidebar(sidebar, sections)
	{
		if (sidebar == null)
		{
			return;
		}
		var current = Array.isArray(sidebar.customEntries) ? sidebar.customEntries.slice() : [];
		var filtered = [];
		for (var i = 0; i < current.length; i++)
		{
			if (current[i] && current[i]._seafStencilSection === true)
			{
				continue;
			}
			filtered.push(current[i]);
		}
		for (var j = 0; j < sections.length; j++)
		{
			filtered.push(sections[j]);
		}
		sidebar.customEntries = filtered;
	}

	function applySeafCustomEntriesPipeline(sidebar, loadedSections)
	{
		removeSeafStencilPalettes(sidebar);
		applySeafCustomEntriesToSidebar(sidebar, loadedSections);
		if (typeof sidebar.addCustomEntries === 'function')
		{
			sidebar.addCustomEntries();
		}
		if (typeof sidebar.updateEntries === 'function')
		{
			sidebar.updateEntries();
		}
		applySeafStencilVisibilityPolicy(sidebar, loadedSections);
	}

	async function loadSeafStencilLibraries()
	{
		var sidebar = ui != null ? ui.sidebar : null;
		state.seafStencilSections = [];
		if (sidebar == null)
		{
			return;
		}

		var configPath = getStencilsConfigPath();
		if (configPath == null)
		{
			await writeLog('warn', 'SEAF stencils config path is unavailable', {
				configPath: state.configPath
			});
			return;
		}

		var configRaw = await requestAsync({
			action: 'readFile',
			filename: configPath,
			encoding: 'utf8'
		});
		var parsedConfig = parseLibrariesConfig(configRaw) || {};
		validateLibrariesConfig(parsedConfig);
		var sections = normalizeCustomEntriesConfig(parsedConfig.sections);
		var stencilsDir = configPath.replace(/[\\\/]libraries\.json$/i, '');
		var loadedSections = [];

		for (var i = 0; i < sections.length; i++)
		{
			var section = sections[i] || {};
			var entries = Array.isArray(section.entries) ? section.entries : [];
			var loadedEntries = [];

			for (var j = 0; j < entries.length; j++)
			{
				var entry = entries[j] || {};
				if (typeof entry.file !== 'string' || entry.file.trim().length === 0)
				{
					continue;
				}
				var resolvedFile = joinPathFragments(stencilsDir, entry.file.trim());
				try
				{
					var rawXml = await requestAsync({
						action: 'readFile',
						filename: resolvedFile,
						encoding: 'utf8'
					});
					var libraryData = parseMxLibraryData(rawXml);
					var entryId = entry.id;
					var entryTitleObj = normalizeLocalizedResource(entry.title, entryId);
					loadedEntries.push({
						id: entryId,
						title: entryTitleObj,
						_enabledByDefault: entry.enabledByDefault === true,
						libs: [{
							title: entryTitleObj,
							data: libraryData,
							preload: entry.enabledByDefault === true
						}]
					});
				}
				catch (entryErr)
				{
					await writeLog('warn', 'SEAF stencil library skipped', {
						file: resolvedFile,
						error: entryErr.message
					});
				}
			}

			if (loadedEntries.length > 0)
			{
				var sectionId = section.id;
				var sectionTitleObj = normalizeLocalizedResource(section.title, sectionId);
				loadedSections.push({
					id: sectionId,
					title: sectionTitleObj,
					entries: loadedEntries,
					_seafStencilSection: true
				});
			}
		}

		applySeafCustomEntriesPipeline(sidebar, loadedSections);
		state.seafStencilSections = loadedSections;

		for (var s = 0; s < loadedSections.length; s++)
		{
			var loadedSection = loadedSections[s];
			for (var e = 0; e < loadedSection.entries.length; e++)
			{
				var loadedEntry = loadedSection.entries[e];
				for (var k = 0; k < loadedEntry.libs.length; k++)
				{
					state.seafStencilPaletteIds.push(loadedEntry.id + '.' + k);
				}
			}
		}

		await writeLog('info', 'SEAF stencil libraries loaded', {
			configPath: configPath,
			sections: loadedSections.length,
			palettes: state.seafStencilPaletteIds.length
		});
	}

	function getSelectionPayload()
	{
		var graph = ui.editor.graph;
		var cells = graph.getSelectionCells();
		var out = [];

		for (var i = 0; i < cells.length; i++)
		{
			var cell = cells[i];
			var geometry = null;
			try
			{
				geometry = graph.getCellGeometry(cell);
			}
			catch (e)
			{
				geometry = null;
			}
			out.push({
				id: cell.id,
				objectId: cell.id || null,
				isVertex: graph.model.isVertex(cell),
				isEdge: graph.model.isEdge(cell),
				label: graph.convertValueToString(cell),
				style: sanitizeForIpc(graph.getCellStyle(cell)),
				geometry: buildGeometryPayload(geometry),
				data: extractEditableDataFromCell(cell, graph)
			});
		}

		return out;
	}

	function buildGeometryPayload(geometry)
	{
		var g = geometry || null;
		return {
			x: g && Number.isFinite(g.x) ? Number(g.x) : null,
			y: g && Number.isFinite(g.y) ? Number(g.y) : null,
			width: g && Number.isFinite(g.width) ? Number(g.width) : null,
			height: g && Number.isFinite(g.height) ? Number(g.height) : null
		};
	}

	function getEventsSchemaPrefix()
	{
		try
		{
			var ev = state.eventConfig && state.eventConfig.events ? state.eventConfig.events : null;
			if (ev && typeof ev.schemaPrefix === 'string')
			{
				var p = ev.schemaPrefix.trim();
				if (p.length > 0)
				{
					return p;
				}
			}
		}
		catch (e)
		{
			// ignore
		}
		return 'seaf.';
	}

	function isSchemaUnderEventsPrefix(schema)
	{
		var sch = String(schema || '').trim();
		if (sch.length === 0)
		{
			return false;
		}
		var prefix = getEventsSchemaPrefix();
		return sch.indexOf(prefix) === 0;
	}

	function isSeafStencilUserValue(value)
	{
		try
		{
			if (value && typeof value.getAttribute === 'function')
			{
				return isSchemaUnderEventsPrefix(value.getAttribute('schema'));
			}
			if (value && typeof value === 'object' && !Array.isArray(value))
			{
				return isSchemaUnderEventsPrefix(value.schema);
			}
		}
		catch (e2)
		{
			return false;
		}
		return false;
	}

	function extractEditableDataFromValue(value, graph, cell)
	{
		var out = {};
		var isLayer = false;
		var allowLabel = false;
		try
		{
			isLayer = !!(graph && graph.model && typeof graph.model.isLayer === 'function' && cell && graph.model.isLayer(cell));
		}
		catch (e)
		{
			isLayer = false;
		}
		try
		{
			var currentStyle = (graph && typeof graph.getCurrentCellStyle === 'function' && cell) ? (graph.getCurrentCellStyle(cell) || {}) : {};
			allowLabel = (currentStyle && String(currentStyle.metaEdit || '') === '1') ||
				(typeof Graph !== 'undefined' && Graph != null && Graph.translateDiagram === true) ||
				isLayer;
		}
		catch (e)
		{
			allowLabel = false;
		}
		if (!allowLabel && isSeafStencilUserValue(value))
		{
			allowLabel = true;
		}

		if (value && typeof value.getAttribute === 'function' && value.attributes)
		{
			var attrs = value.attributes;
			for (var i = 0; i < attrs.length; i++)
			{
				var attr = attrs[i];
				var name = attr && typeof attr.nodeName === 'string' ? attr.nodeName : '';
				if (!name || name === 'placeholders')
				{
					continue;
				}
				if (name === 'label' && !allowLabel)
				{
					continue;
				}
				out[name] = attr && attr.nodeValue != null ? String(attr.nodeValue) : '';
			}
			return out;
		}

		if (value && typeof value === 'object')
		{
			for (var key in value)
			{
				if (!Object.prototype.hasOwnProperty.call(value, key))
				{
					continue;
				}
				if (key === 'placeholders')
				{
					continue;
				}
				if (key === 'label' && !allowLabel)
				{
					continue;
				}
				var v = value[key];
				if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
				{
					out[key] = String(v);
				}
			}
		}

		return out;
	}

	function extractEditableDataFromCell(cell, graph)
	{
		if (!cell)
		{
			return {};
		}
		return extractEditableDataFromValue(cell.value, graph, cell);
	}

	function parseStyleString(styleValue)
	{
		var out = {};
		var text = (typeof styleValue === 'string') ? styleValue : '';
		if (text.length === 0)
		{
			return out;
		}
		var parts = text.split(';');
		for (var i = 0; i < parts.length; i++)
		{
			var item = parts[i];
			if (typeof item !== 'string' || item.length === 0)
			{
				continue;
			}
			var idx = item.indexOf('=');
			if (idx <= 0)
			{
				continue;
			}
			var key = item.substring(0, idx).trim();
			var value = item.substring(idx + 1).trim();
			if (key.length > 0)
			{
				out[key] = value;
			}
		}
		return out;
	}

	function extractShapeSchema(cell, graph)
	{
		var schemaFromValue = '';
		try
		{
			var cellValue = cell ? cell.value : null;
			if (cellValue != null)
			{
				if (typeof cellValue.getAttribute === 'function')
				{
					schemaFromValue = String(cellValue.getAttribute('schema') || '').trim();
				}
				else if (typeof cellValue === 'object' && typeof cellValue.schema === 'string')
				{
					schemaFromValue = cellValue.schema.trim();
				}
			}
		}
		catch (e)
		{
			schemaFromValue = '';
		}
		var styleText = '';
		try
		{
			styleText = (cell && typeof cell.style === 'string') ? cell.style :
				(graph && graph.model && typeof graph.model.getStyle === 'function') ? (graph.model.getStyle(cell) || '') : '';
		}
		catch (e)
		{
			styleText = '';
		}
		var parsedStyle = parseStyleString(styleText);
		var shape = (typeof parsedStyle.shape === 'string') ? parsedStyle.shape.trim() : '';
		var schema = schemaFromValue.length > 0 ? schemaFromValue : shape;
		var schemaSource = schemaFromValue.length > 0 ? 'cell.value.schema' : (shape.length > 0 ? 'style.shape' : 'missing');
		return {
			schema: schema,
			styleText: styleText,
			schemaSource: schemaSource
		};
	}

	function resolveEditDataTarget(cell, graph)
	{
		var fallbackMeta = extractShapeSchema(cell, graph);
		var fallbackSchema = (fallbackMeta && typeof fallbackMeta.schema === 'string') ? fallbackMeta.schema.trim() : '';
		var resolvedCell = cell;
		var resolvedSchema = fallbackSchema;

		try
		{
			if (cell == null || graph == null || graph.model == null)
			{
				return {cell: resolvedCell, schema: resolvedSchema};
			}
			if (resolvedSchema.length > 0)
			{
				return {cell: resolvedCell, schema: resolvedSchema};
			}

			var model = graph.model;
			var root = (typeof model.getRoot === 'function') ? model.getRoot() : model.root;
			var current = cell;
			var guard = 0;
			while (current != null && guard < 80)
			{
				guard++;
				var parent = (typeof model.getParent === 'function') ? model.getParent(current) : current.parent;
				if (parent == null || parent === root || (typeof model.isLayer === 'function' && model.isLayer(parent)))
				{
					break;
				}
				var parentMeta = extractShapeSchema(parent, graph);
				var parentSchema = (parentMeta && typeof parentMeta.schema === 'string') ? parentMeta.schema.trim() : '';
				if (parentSchema.length > 0)
				{
					return {cell: parent, schema: parentSchema};
				}
				current = parent;
			}
		}
		catch (e)
		{
			// fallback to original cell below
		}

		return {cell: resolvedCell, schema: resolvedSchema};
	}

	function parseSchemaCode(schemaValue)
	{
		var schema = String(schemaValue || '').trim();
		if (schema.length === 0)
		{
			return 'unknown';
		}
		var parts = schema.split('.');
		var clean = [];
		for (var i = 0; i < parts.length; i++)
		{
			var token = String(parts[i] || '').trim();
			if (token.length > 0)
			{
				clean.push(token);
			}
		}
		if (clean.length < 2)
		{
			return 'unknown';
		}
		return clean[clean.length - 2] + '.' + clean[clean.length - 1];
	}

	function getCompanyPrefix()
	{
		var env = state.envConfig && state.envConfig.env ? state.envConfig.env : {};
		var prefix = env && typeof env.companyPrefix === 'string' ? env.companyPrefix.trim() : '';
		return prefix.length > 0 ? prefix : 'company';
	}

	function getOidFromData(data)
	{
		if (!data || typeof data !== 'object')
		{
			return '';
		}
		var oid = data.OID != null ? String(data.OID).trim() : '';
		return oid;
	}

	function buildIndexEntryFromCell(cell, graph, forcedPageId)
	{
		if (!cell || !cell.id || !graph)
		{
			return null;
		}
		var data = extractEditableDataFromCell(cell, graph);
		var schemaMeta = extractShapeSchema(cell, graph);
		var schema = schemaMeta && typeof schemaMeta.schema === 'string' ? schemaMeta.schema.trim() : '';
		var oid = getOidFromData(data);
		var pageId = '';
		if (typeof forcedPageId === 'string' && forcedPageId.trim().length > 0)
		{
			pageId = forcedPageId.trim();
		}
		else
		{
			try
			{
				if (ui && ui.currentPage && typeof ui.currentPage.getId === 'function')
				{
					pageId = String(ui.currentPage.getId() || '').trim();
				}
			}
			catch (ePage)
			{
				pageId = '';
			}
		}
		return {
			objectId: cell.id,
			schema: schema,
			schemaCode: parseSchemaCode(schema),
			oid: oid,
			data: sanitizeForIpc(data),
			pageId: pageId
		};
	}

	function clearStencilIndex()
	{
		state.stencilIndex.byObjectId = {};
		state.stencilIndex.bySchema = {};
		state.stencilIndex.byOid = {};
		state.stencilIndex.total = 0;
		state.stencilIndex.ready = false;
		state.stencilIndex.lastRebuildAt = new Date().toISOString();
	}

	function addEntryToStencilIndex(entry)
	{
		if (!entry || !entry.objectId)
		{
			return;
		}
		var objectId = entry.objectId;
		state.stencilIndex.byObjectId[objectId] = entry;
		var schemaKey = entry.schema || 'unknown';
		if (!state.stencilIndex.bySchema[schemaKey])
		{
			state.stencilIndex.bySchema[schemaKey] = {};
		}
		state.stencilIndex.bySchema[schemaKey][objectId] = true;
		if (entry.oid)
		{
			if (!state.stencilIndex.byOid[entry.oid])
			{
				state.stencilIndex.byOid[entry.oid] = {};
			}
			state.stencilIndex.byOid[entry.oid][objectId] = true;
		}
	}

	function removeEntryFromStencilIndex(objectId)
	{
		var id = String(objectId || '').trim();
		if (!id)
		{
			return;
		}
		var prev = state.stencilIndex.byObjectId[id];
		if (!prev)
		{
			return;
		}
		delete state.stencilIndex.byObjectId[id];
		var schemaKey = prev.schema || 'unknown';
		if (state.stencilIndex.bySchema[schemaKey])
		{
			delete state.stencilIndex.bySchema[schemaKey][id];
			if (Object.keys(state.stencilIndex.bySchema[schemaKey]).length === 0)
			{
				delete state.stencilIndex.bySchema[schemaKey];
			}
		}
		if (prev.oid && state.stencilIndex.byOid[prev.oid])
		{
			delete state.stencilIndex.byOid[prev.oid][id];
			if (Object.keys(state.stencilIndex.byOid[prev.oid]).length === 0)
			{
				delete state.stencilIndex.byOid[prev.oid];
			}
		}
	}

	function upsertCellInStencilIndex(cell, graph)
	{
		if (!cell || !cell.id || !graph)
		{
			return;
		}
		removeEntryFromStencilIndex(cell.id);
		var entry = buildIndexEntryFromCell(cell, graph);
		if (entry)
		{
			addEntryToStencilIndex(entry);
		}
	}

	function rebuildStencilIndex()
	{
		var graph = ui && ui.editor ? ui.editor.graph : null;
		clearStencilIndex();
		if (!graph || !graph.model)
		{
			return;
		}
		syncCurrentPageRootFromGraph(graph);
		var pages = (ui && Array.isArray(ui.pages)) ? ui.pages : [];
		if (pages.length === 0)
		{
			var model = graph.model;
			var root = model.getRoot ? model.getRoot() : model.root;
			var all = [];
			if (typeof model.filterDescendants === 'function')
			{
				all = model.filterDescendants(function(cell)
				{
					return model.isVertex(cell) || model.isEdge(cell);
				}, root) || [];
			}
			else if (typeof model.getDescendants === 'function')
			{
				all = model.getDescendants(root) || [];
			}
			for (var i = 0; i < all.length; i++)
			{
				var cell = all[i];
				if (!cell || !cell.id)
				{
					continue;
				}
				if (!(model.isVertex(cell) || model.isEdge(cell)))
				{
					continue;
				}
				var entry = buildIndexEntryFromCell(cell, graph);
				if (entry)
				{
					addEntryToStencilIndex(entry);
				}
			}
		}
		else
		{
			for (var p = 0; p < pages.length; p++)
			{
				var page = pages[p];
				if (!page)
				{
					continue;
				}
				var pageId = '';
				try
				{
					if (typeof page.getId === 'function')
					{
						pageId = String(page.getId() || '').trim();
					}
					else
					{
						pageId = String(page.id || '').trim();
					}
				}
				catch (ePageId)
				{
					pageId = '';
				}
				try
				{
					var cells = getCellsByCriteriaForPage(graph, page, {});
					for (var c = 0; c < cells.length; c++)
					{
						var pageCell = cells[c];
						if (!pageCell || !pageCell.id)
						{
							continue;
						}
						var pageEntry = buildIndexEntryFromCell(pageCell, graph, pageId);
						if (pageEntry)
						{
							addEntryToStencilIndex(pageEntry);
						}
					}
				}
				catch (ePage)
				{
					// ignore page-level scan errors and continue indexing remaining pages
				}
			}
		}
		state.stencilIndex.total = Object.keys(state.stencilIndex.byObjectId).length;
		state.stencilIndex.ready = true;
		state.stencilIndex.lastRebuildAt = new Date().toISOString();
	}

	function ensureStencilIndexReady()
	{
		if (state.stencilIndex.ready === true)
		{
			return;
		}
		rebuildStencilIndex();
	}

	function installStencilIndexLifecycleHooks()
	{
		if (state.stencilIndexLifecycleHooksInstalled)
		{
			return;
		}
		var editor = ui && ui.editor ? ui.editor : null;
		if (!editor || typeof editor.addListener !== 'function')
		{
			return;
		}
		var rebuildFromLifecycle = function(source)
		{
			try
			{
				rebuildStencilIndex();
				writeLog('debug', 'Stencil index lifecycle rebuild completed', {
					source: source,
					total: state.stencilIndex.total
				});
			}
			catch (e)
			{
				writeLog('error', 'Stencil index lifecycle rebuild failed', {
					source: source,
					error: e && e.message ? e.message : String(e)
				});
			}
		};
		editor.addListener('fileLoaded', function()
		{
			rebuildFromLifecycle('fileLoaded');
		});
		editor.addListener('pageSelected', function()
		{
			rebuildFromLifecycle('pageSelected');
		});
		state.stencilIndexLifecycleHooksInstalled = true;
	}

	function makeStencilIndexSnapshot()
	{
		var bySchema = {};
		for (var schema in state.stencilIndex.bySchema)
		{
			if (!Object.prototype.hasOwnProperty.call(state.stencilIndex.bySchema, schema))
			{
				continue;
			}
			var ids = Object.keys(state.stencilIndex.bySchema[schema]);
			bySchema[schema] = ids;
		}
		var byOid = {};
		for (var oid in state.stencilIndex.byOid)
		{
			if (!Object.prototype.hasOwnProperty.call(state.stencilIndex.byOid, oid))
			{
				continue;
			}
			byOid[oid] = Object.keys(state.stencilIndex.byOid[oid]);
		}
		var objectPage = {};
		for (var objId in state.stencilIndex.byObjectId)
		{
			if (!Object.prototype.hasOwnProperty.call(state.stencilIndex.byObjectId, objId))
			{
				continue;
			}
			var ent = state.stencilIndex.byObjectId[objId];
			objectPage[objId] = (ent && typeof ent.pageId === 'string') ? ent.pageId : '';
		}
		return {
			total: state.stencilIndex.total,
			bySchema: bySchema,
			byOid: byOid,
			objectPage: objectPage
		};
	}

	function getLayerDisplayNameForAncestorChain(graph, startCell)
	{
		if (!graph || !graph.model || !startCell)
		{
			return '';
		}
		var model = graph.model;
		var root = model.getRoot ? model.getRoot() : model.root;
		var current = startCell;
		var guard = 0;
		while (current && guard < 128)
		{
			guard++;
			if (typeof model.isLayer === 'function' && model.isLayer(current))
			{
				return String(graph.convertValueToString(current) || '').trim();
			}
			var parent = (typeof model.getParent === 'function') ? model.getParent(current) : current.parent;
			if (!parent || parent === root)
			{
				break;
			}
			current = parent;
		}
		return '';
	}

	function getCellLayerDisplayName(graph, cell)
	{
		if (!graph || !graph.model || !cell)
		{
			return '';
		}
		var model = graph.model;
		var root = model.getRoot ? model.getRoot() : model.root;
		var current = cell;
		while (current)
		{
			var parent = (typeof model.getParent === 'function') ? model.getParent(current) : current.parent;
			if (!parent || parent === root)
			{
				break;
			}
			if (typeof model.isLayer === 'function' && model.isLayer(parent))
			{
				return String(graph.convertValueToString(parent) || '').trim();
			}
			current = parent;
		}
		return '';
	}

	function buildStencilItemSnapshot(cell, operation)
	{
		var graph = ui && ui.editor ? ui.editor.graph : null;
		if (!graph || !cell)
		{
			return null;
		}
		var meta = extractShapeSchema(cell, graph);
		var geom = null;
		try
		{
			geom = graph.getCellGeometry(cell);
		}
		catch (e)
		{
			geom = null;
		}
		var data = extractEditableDataFromCell(cell, graph);
		var currentLayerName = getCellLayerDisplayName(graph, cell);
		var linkedPageId = parseLinkedPageIdFromCell(graph, cell);
		return {
			id: cell.id || null,
			objectId: cell.id || null,
			operation: operation || 'unknown',
			label: graph.convertValueToString(cell),
			schema: meta.schema,
			schemaSource: meta.schemaSource,
			style: sanitizeForIpc(graph.getCellStyle(cell)),
			styleText: meta.styleText,
			geometry: buildGeometryPayload(geom),
			data: data,
			linkedPageId: linkedPageId || '',
			oid: getOidFromData(data),
			companyPrefix: getCompanyPrefix(),
			schemaCode: parseSchemaCode(meta.schema),
			value: sanitizeForIpc(cell.value),
			currentLayerName: currentLayerName
		};
	}

	function isNetworksSchema(schema)
	{
		return String(schema || '').trim() === 'seaf.company.ta.services.networks';
	}

	function hasNetworkConnectionField(data)
	{
		return !!(data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'network_connection'));
	}

	function isP41Schema(schema)
	{
		return String(schema || '').trim().indexOf('seaf.company.ta.') === 0;
	}

	function resolveNetworkEventTerminalCell(cell, graph)
	{
		if (!cell)
		{
			return null;
		}
		try
		{
			var resolved = resolveEditDataTarget(cell, graph);
			if (resolved && resolved.cell)
			{
				return resolved.cell;
			}
		}
		catch (e)
		{
			// ignore and keep original cell
		}
		return cell;
	}

	function buildSingleNetworkConnectionEventItem(edgeCell, operation, sourceCell, targetCell, sourceMeta, targetMeta, sourceData, targetData, networkCell, networkMeta, networkData, receiverCell, receiverMeta, receiverData)
	{
		var networkOid = getOidFromData(networkData);
		return {
			id: (edgeCell.id || '') + ':' + (receiverCell.id || '') + ':' + operation + ':' + (networkCell.id || ''),
			objectId: receiverCell.id || null,
			operation: operation,
			edgeId: edgeCell.id || null,
			schema: receiverMeta && receiverMeta.schema ? receiverMeta.schema : '',
			schemaSource: receiverMeta && receiverMeta.schemaSource ? receiverMeta.schemaSource : '',
			receiverObjectId: receiverCell.id || null,
			receiverSchema: receiverMeta && receiverMeta.schema ? receiverMeta.schema : '',
			receiverData: receiverData || {},
			networkObjectId: networkCell.id || null,
			networkSchema: networkMeta && networkMeta.schema ? networkMeta.schema : '',
			networkData: networkData || {},
			networkOid: networkOid || '',
			sourceObjectId: sourceCell.id || null,
			sourceSchema: sourceMeta && sourceMeta.schema ? sourceMeta.schema : '',
			sourceData: sourceData || {},
			targetObjectId: targetCell.id || null,
			targetSchema: targetMeta && targetMeta.schema ? targetMeta.schema : '',
			targetData: targetData || {}
		};
	}

	function buildNetworkConnectionEventItems(graph, edgeCell, operation, sourceCell, targetCell)
	{
		sourceCell = resolveNetworkEventTerminalCell(sourceCell, graph);
		targetCell = resolveNetworkEventTerminalCell(targetCell, graph);
		if (!graph || !edgeCell || !sourceCell || !targetCell || !sourceCell.id || !targetCell.id)
		{
			return [];
		}
		var sourceMeta = extractShapeSchema(sourceCell, graph);
		var targetMeta = extractShapeSchema(targetCell, graph);
		var sourceSchema = sourceMeta && typeof sourceMeta.schema === 'string' ? sourceMeta.schema.trim() : '';
		var targetSchema = targetMeta && typeof targetMeta.schema === 'string' ? targetMeta.schema.trim() : '';
		var sourceData = extractEditableDataFromCell(sourceCell, graph);
		var targetData = extractEditableDataFromCell(targetCell, graph);
		var sourceIsNetwork = isNetworksSchema(sourceSchema);
		var targetIsNetwork = isNetworksSchema(targetSchema);
		if ((sourceIsNetwork && targetIsNetwork) || (!sourceIsNetwork && !targetIsNetwork))
		{
			return [];
		}
		var networkCell = sourceIsNetwork ? sourceCell : targetCell;
		var networkMeta = sourceIsNetwork ? sourceMeta : targetMeta;
		var networkData = sourceIsNetwork ? sourceData : targetData;
		var peerCell = sourceIsNetwork ? targetCell : sourceCell;
		var peerMeta = sourceIsNetwork ? targetMeta : sourceMeta;
		var peerData = sourceIsNetwork ? targetData : sourceData;
		if (!isP41Schema(peerMeta && peerMeta.schema ? peerMeta.schema : ''))
		{
			return [];
		}
		var out = [];
		if (hasNetworkConnectionField(peerData))
		{
			out.push(buildSingleNetworkConnectionEventItem(
				edgeCell,
				operation,
				sourceCell,
				targetCell,
				sourceMeta,
				targetMeta,
				sourceData,
				targetData,
				networkCell,
				networkMeta,
				networkData,
				peerCell,
				peerMeta,
				peerData
			));
		}
		if (hasNetworkConnectionField(networkData))
		{
			out.push(buildSingleNetworkConnectionEventItem(
				edgeCell,
				operation,
				sourceCell,
				targetCell,
				sourceMeta,
				targetMeta,
				sourceData,
				targetData,
				networkCell,
				networkMeta,
				networkData,
				networkCell,
				networkMeta,
				networkData
			));
		}
		return out;
	}

	function appendConnectionItems(out, items)
	{
		if (!Array.isArray(items) || !Array.isArray(out))
		{
			return;
		}
		for (var i = 0; i < items.length; i++)
		{
			if (items[i])
			{
				out.push(items[i]);
			}
		}
	}

	function collectConnectionEventsFromEdgeLifecycle(change, graph, operation)
	{
		var out = [];
		if (!change || !change.child || !graph || !graph.model || !change.child.id)
		{
			return out;
		}
		var edgeCell = change.child;
		var model = graph.model;
		if (typeof model.isEdge === 'function' && !model.isEdge(edgeCell))
		{
			return out;
		}
		var sourceCell = (typeof model.getTerminal === 'function') ? model.getTerminal(edgeCell, true) : edgeCell.source;
		var targetCell = (typeof model.getTerminal === 'function') ? model.getTerminal(edgeCell, false) : edgeCell.target;
		appendConnectionItems(out, buildNetworkConnectionEventItems(graph, edgeCell, operation, sourceCell, targetCell));
		return out;
	}

	function collectConnectionEventsFromTerminalChange(change, graph)
	{
		var out = [];
		if (!change || !graph || !graph.model || !change.cell || !change.cell.id)
		{
			return out;
		}
		var edgeCell = change.cell;
		var model = graph.model;
		if (typeof model.isEdge === 'function' && !model.isEdge(edgeCell))
		{
			return out;
		}
		var isSourceTerminal = change.source === true;
		var previousTerminal = change.previous || null;
		var nextTerminal = change.terminal || null;
		var currentSource = (typeof model.getTerminal === 'function') ? model.getTerminal(edgeCell, true) : edgeCell.source;
		var currentTarget = (typeof model.getTerminal === 'function') ? model.getTerminal(edgeCell, false) : edgeCell.target;
		var prevId = previousTerminal && previousTerminal.id ? String(previousTerminal.id) : '';
		var nextId = nextTerminal && nextTerminal.id ? String(nextTerminal.id) : '';
		if (prevId && nextId && prevId === nextId)
		{
			return out;
		}

		if (previousTerminal != null)
		{
			var oldSource = isSourceTerminal ? previousTerminal : currentSource;
			var oldTarget = isSourceTerminal ? currentTarget : previousTerminal;
			appendConnectionItems(out, buildNetworkConnectionEventItems(graph, edgeCell, 'disconnect', oldSource, oldTarget));
		}

		if (nextTerminal != null)
		{
			var newSource = isSourceTerminal ? nextTerminal : currentSource;
			var newTarget = isSourceTerminal ? currentTarget : nextTerminal;
			appendConnectionItems(out, buildNetworkConnectionEventItems(graph, edgeCell, 'connect', newSource, newTarget));
		}

		return out;
	}

	function collectAddSnapshotTargets(cell, graph)
	{
		var out = [];
		var strictOut = [];
		if (!cell || !graph || !graph.model)
		{
			return out;
		}
		var model = graph.model;
		var queue = [cell];
		var seen = {};
		while (queue.length > 0)
		{
			var current = queue.shift();
			if (!current || !current.id || Object.prototype.hasOwnProperty.call(seen, current.id))
			{
				continue;
			}
			seen[current.id] = true;
			var schemaMeta = extractShapeSchema(current, graph);
			var schema = schemaMeta && typeof schemaMeta.schema === 'string' ? schemaMeta.schema.trim() : '';
			if (schema.length > 0)
			{
				out.push(current);
				if (schemaMeta && schemaMeta.schemaSource === 'cell.value.schema')
				{
					strictOut.push(current);
				}
			}
			var childCount = (typeof model.getChildCount === 'function') ? model.getChildCount(current) : 0;
			for (var i = 0; i < childCount; i++)
			{
				var child = (typeof model.getChildAt === 'function') ? model.getChildAt(current, i) : null;
				if (child)
				{
					queue.push(child);
				}
			}
		}
		if (strictOut.length > 0)
		{
			return strictOut;
		}
		if (out.length === 0)
		{
			out.push(cell);
		}
		return out;
	}

	function getEventConfigListIds()
	{
		var map = {};
		var cfg = state.eventConfig && state.eventConfig.events ? state.eventConfig.events : null;
		var lists = cfg && Array.isArray(cfg.stencilLists) ? cfg.stencilLists : [];
		for (var i = 0; i < lists.length; i++)
		{
			var list = lists[i];
			if (list && typeof list.id === 'string')
			{
				map[list.id] = true;
			}
		}
		return map;
	}

	function escapeRegex(text)
	{
		return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function matchSchemaPattern(schema, pattern)
	{
		var normalizedSchema = String(schema || '').trim();
		var normalizedPattern = String(pattern || '').trim();
		if (normalizedPattern.length === 0)
		{
			return {matched: false, matchType: 'none'};
		}
		if (normalizedPattern === 'all')
		{
			return {matched: true, matchType: 'all', score: 1};
		}
		if (normalizedPattern.indexOf('*') >= 0)
		{
			var wildcardRegex = new RegExp('^' + escapeRegex(normalizedPattern).replace(/\\\*/g, '.*') + '$');
			return wildcardRegex.test(normalizedSchema) ? {matched: true, matchType: 'wildcard', score: 2} : {matched: false, matchType: 'wildcard'};
		}
		if (normalizedSchema === normalizedPattern)
		{
			return {matched: true, matchType: 'exact', score: 3};
		}
		return {matched: false, matchType: 'exact'};
	}

	function matchEventRoute(item)
	{
		var cfg = state.eventConfig && state.eventConfig.events ? state.eventConfig.events : null;
		if (!cfg || cfg.enabled === false)
		{
			return {rule: null, reason: 'events_disabled'};
		}
		var schemaPrefix = (typeof cfg.schemaPrefix === 'string' && cfg.schemaPrefix.length > 0) ? cfg.schemaPrefix : 'seaf.';
		var schema = item && typeof item.schema === 'string' ? item.schema.trim() : '';
		if (schema.length === 0)
		{
			return {rule: null, reason: 'schema_missing'};
		}
		if (schema.indexOf(schemaPrefix) !== 0)
		{
			return {rule: null, reason: 'schema_prefix_mismatch', schema: schema, schemaPrefix: schemaPrefix};
		}
		var listsMap = getEventConfigListIds();
		var rules = Array.isArray(cfg.rules) ? cfg.rules : [];
		var best = null;
		for (var i = 0; i < rules.length; i++)
		{
			var rule = rules[i];
			if (!rule || typeof rule !== 'object')
			{
				continue;
			}
			if (typeof rule.listId !== 'string' || rule.listId.trim().length === 0)
			{
				continue;
			}
			if (!listsMap[rule.listId.trim()])
			{
				continue;
			}
			var schemaPattern = (typeof rule.schema === 'string' && rule.schema.trim().length > 0) ?
				rule.schema.trim() : (rule.all === true ? 'all' : '');
			var match = matchSchemaPattern(schema, schemaPattern);
			if (match.matched !== true)
			{
				continue;
			}
			if (!best || match.score > best.score)
			{
				best = {
					rule: rule,
					score: match.score,
					matchType: match.matchType,
					schemaPattern: schemaPattern
				};
			}
		}
		if (best)
		{
			return {
				rule: best.rule,
				reason: 'rule_matched',
				matchType: best.matchType,
				schemaPattern: best.schemaPattern
			};
		}
		return {rule: null, reason: 'no_rule_match'};
	}

	function isEventErrorUserVisible(result)
	{
		if (result == null || typeof result !== 'object')
		{
			return false;
		}
		var payload = (result.payload && typeof result.payload === 'object') ? result.payload : {};
		var policy = (payload.errorPolicy && typeof payload.errorPolicy === 'object') ? payload.errorPolicy : {};
		return policy.userVisible === true;
	}

	async function runStencilEventCommand(commandId, eventPayload)
	{
		if (typeof commandId !== 'string' || commandId.trim().length === 0)
		{
			return null;
		}
		var trimmedCmd = commandId.trim();
		await writeLog('info', 'Stencil event handler started', {
			commandId: trimmedCmd,
			eventType: eventPayload && eventPayload.eventType ? eventPayload.eventType : '',
			ruleId: eventPayload && eventPayload.ruleId ? eventPayload.ruleId : '',
			listId: eventPayload && eventPayload.listId ? eventPayload.listId : '',
			txId: eventPayload && eventPayload.txId ? eventPayload.txId : '',
			itemCount: eventPayload && Array.isArray(eventPayload.items) ? eventPayload.items.length : 0
		});
		var response = await requestAsync({
			action: 'runSeafPluginCommand',
			configPath: state.configPath,
			commandId: trimmedCmd,
			payload: {
				commandId: trimmedCmd,
				source: 'stencil_event_processor',
				timestamp: new Date().toISOString(),
				selection: [],
				pages: getPagesPayload(),
				event: eventPayload,
				arguments: {
					eventType: eventPayload.eventType,
					ruleId: eventPayload.ruleId || '',
					listId: eventPayload.listId || '',
					companyPrefix: getCompanyPrefix()
				}
			}
		});
		var result = response && response.result ? response.result : {};
		var uiResults = [];
		try
		{
			uiResults = executeInteractiveCommands(result) || [];
		}
		catch (uiErr)
		{
			await writeLog('error', 'Stencil event UI command execution failed', {
				commandId: trimmedCmd,
				error: uiErr && uiErr.message ? uiErr.message : String(uiErr)
			});
		}
		if (uiResults.length > 0)
		{
			await writeLog('info', 'Stencil event UI commands executed', {
				commandId: trimmedCmd,
				count: uiResults.length
			});
		}
		if (result && result.status === 'error')
		{
			var errorMessage = (typeof result.message === 'string' && result.message.trim().length > 0) ?
				result.message.trim() : 'stencil_event_handler_failed';
			await writeLog('error', 'Stencil event handler returned error status', {
				commandId: trimmedCmd,
				eventType: eventPayload && eventPayload.eventType ? eventPayload.eventType : '',
				ruleId: eventPayload && eventPayload.ruleId ? eventPayload.ruleId : '',
				message: errorMessage,
				userVisible: isEventErrorUserVisible(result)
			});
			if (isEventErrorUserVisible(result))
			{
				showError('stencil_event_processor: ' + errorMessage);
			}
		}
		return response;
	}

	async function flushStencilBatches()
	{
		if (state.stencilEventDispatchInFlight)
		{
			await writeLog('debug', 'Stencil event flush skipped: dispatch already in flight', {
				pending: state.pendingStencilBatches.length
			});
			return;
		}
		state.stencilEventDispatchInFlight = true;
		try
		{
			while (state.pendingStencilBatches.length > 0)
			{
				var batch = state.pendingStencilBatches.shift();
				await writeLog('debug', 'Stencil event batch processing started', {
					txId: batch.txId,
					items: batch.items.length
				});
				var grouped = {};
				for (var i = 0; i < batch.items.length; i++)
				{
					var item = batch.items[i];
					var route = matchEventRoute(item);
					var rule = route ? route.rule : null;
					if (!rule || !rule.handlers)
					{
						await writeLog('debug', 'Stencil event item filtered out', {
							txId: batch.txId,
							itemId: item && item.id ? item.id : null,
							operation: item && item.operation ? item.operation : null,
							schema: item && item.schema ? item.schema : '',
							reason: route && route.reason ? route.reason : 'no_rule'
						});
						continue;
					}
					var operation = item.operation;
					var handlerCmd = rule.handlers[operation];
					if (typeof handlerCmd !== 'string' || handlerCmd.trim().length === 0)
					{
						await writeLog('debug', 'Stencil event item filtered out: missing handler for operation', {
							txId: batch.txId,
							itemId: item && item.id ? item.id : null,
							operation: operation,
							ruleId: rule.id || '',
							reason: route && route.reason ? route.reason : 'matched_no_handler'
						});
						continue;
					}
					await writeLog('debug', 'Stencil event routing selected', {
						txId: batch.txId,
						itemId: item && item.id ? item.id : null,
						operation: operation,
						schema: item && item.schema ? item.schema : '',
						schemaSource: item && item.schemaSource ? item.schemaSource : '',
						ruleId: rule.id || '',
						listId: rule.listId || '',
						route: route && route.reason ? route.reason : 'matched',
						matchType: route && route.matchType ? route.matchType : '',
						schemaPattern: route && route.schemaPattern ? route.schemaPattern : '',
						commandId: handlerCmd.trim(),
						execution: (typeof rule.execution === 'string' && rule.execution.trim().length > 0) ? rule.execution.trim() : 'sync'
					});
					var key = handlerCmd.trim() + '::' + operation + '::' + (rule.id || '');
					if (!grouped[key])
					{
						grouped[key] = {
							commandId: handlerCmd.trim(),
							operation: operation,
							ruleId: rule.id || '',
							listId: rule.listId || '',
							execution: (typeof rule.execution === 'string' && rule.execution.trim().length > 0) ? rule.execution.trim() : 'sync',
							items: []
						};
					}
					grouped[key].items.push(item);
				}
				if (Object.keys(grouped).length === 0)
				{
					await writeLog('debug', 'Stencil event batch produced no dispatch groups', {
						txId: batch.txId
					});
				}

				for (var groupKey in grouped)
				{
					if (!Object.prototype.hasOwnProperty.call(grouped, groupKey))
					{
						continue;
					}
					var group = grouped[groupKey];
					try
					{
						if (group.execution === 'async')
						{
							ensureStencilIndexReady();
							var asyncCommandId = group.commandId;
							var asyncEventType = group.operation;
							var asyncTxId = batch.txId;
							runStencilEventCommand(group.commandId, {
								eventType: group.operation,
								txId: batch.txId,
								timestamp: batch.timestamp,
								page: batch.page,
								ruleId: group.ruleId,
								listId: group.listId,
								items: group.items,
								index: makeStencilIndexSnapshot()
							}).then(function() {
								writeLog('debug', 'Stencil event async handler completed', {
									commandId: asyncCommandId,
									eventType: asyncEventType,
									txId: asyncTxId
								});
							}).catch(function(asyncErr) {
								writeLog('error', 'Stencil event async dispatch failed', {
									commandId: asyncCommandId,
									eventType: asyncEventType,
									txId: asyncTxId,
									error: asyncErr && asyncErr.message ? asyncErr.message : String(asyncErr)
								});
							});
							await writeLog('debug', 'Stencil event batch dispatched', {
								commandId: group.commandId,
								eventType: group.operation,
								txId: batch.txId,
								items: group.items.length,
								execution: group.execution
							});
							await writeLog('debug', 'Stencil event async dispatch accepted', {
								commandId: group.commandId,
								eventType: group.operation,
								txId: batch.txId
							});
						}
						else
						{
							ensureStencilIndexReady();
							await runStencilEventCommand(group.commandId, {
								eventType: group.operation,
								txId: batch.txId,
								timestamp: batch.timestamp,
								page: batch.page,
								ruleId: group.ruleId,
								listId: group.listId,
								items: group.items,
								index: makeStencilIndexSnapshot()
							});
							await writeLog('debug', 'Stencil event batch dispatched', {
								commandId: group.commandId,
								eventType: group.operation,
								txId: batch.txId,
								items: group.items.length,
								execution: group.execution
							});
							await writeLog('debug', 'Stencil event batch handler completed', {
								commandId: group.commandId,
								eventType: group.operation,
								txId: batch.txId,
								message: 'python handler response received'
							});
						}
					}
					catch (dispatchErr)
					{
						await writeLog('error', 'Stencil event batch dispatch failed', {
							commandId: group.commandId,
							eventType: group.operation,
							txId: batch.txId,
							error: dispatchErr && dispatchErr.message ? dispatchErr.message : String(dispatchErr)
						});
					}
				}
			}
		}
		finally
		{
			state.stencilEventDispatchInFlight = false;
		}
	}

	function queueStencilBatch(items)
	{
		if (!Array.isArray(items) || items.length === 0)
		{
			writeLog('debug', 'Stencil event queue skipped: empty items');
			return;
		}
		var currentPage = (ui && ui.currentPage) ? {
			id: ui.currentPage.getId ? ui.currentPage.getId() : null,
			name: ui.currentPage.getName ? ui.currentPage.getName() : null
		} : null;
		state.pendingStencilBatches.push({
			txId: 'tx_' + Date.now() + '_' + Math.round(Math.random() * 100000),
			timestamp: new Date().toISOString(),
			page: currentPage,
			items: items
		});
		writeLog('debug', 'Stencil event batch queued', {
			txId: state.pendingStencilBatches[state.pendingStencilBatches.length - 1].txId,
			items: items.length
		});
		flushStencilBatches();
	}

	// Deterministic stringify for Edit Data attribute maps (object XML attributes -> plain key/value).
	function stableStringifyEditableData(data)
	{
		var src = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
		var keys = Object.keys(src).sort();
		var sorted = {};
		for (var si = 0; si < keys.length; si++)
		{
			var k = keys[si];
			sorted[k] = src[k];
		}
		return JSON.stringify(sorted);
	}

	function diffEditableDataKeys(beforeData, afterData)
	{
		var b = (beforeData && typeof beforeData === 'object' && !Array.isArray(beforeData)) ? beforeData : {};
		var a = (afterData && typeof afterData === 'object' && !Array.isArray(afterData)) ? afterData : {};
		var keySet = {};
		var k;
		for (k in b)
		{
			if (Object.prototype.hasOwnProperty.call(b, k))
			{
				keySet[k] = true;
			}
		}
		for (k in a)
		{
			if (Object.prototype.hasOwnProperty.call(a, k))
			{
				keySet[k] = true;
			}
		}
		var names = Object.keys(keySet).sort();
		var out = [];
		for (var i = 0; i < names.length; i++)
		{
			var name = names[i];
			var bv = Object.prototype.hasOwnProperty.call(b, name) ? String(b[name]) : '';
			var av = Object.prototype.hasOwnProperty.call(a, name) ? String(a[name]) : '';
			if (bv !== av)
			{
				out.push(name);
			}
		}
		return out;
	}

	function collectStencilEventsFromModelChange(evt)
	{
		var result = [];
		var graph = ui && ui.editor ? ui.editor.graph : null;
		if (!graph)
		{
			return result;
		}
		var edit = evt && typeof evt.getProperty === 'function' ? evt.getProperty('edit') : null;
		var changes = edit && Array.isArray(edit.changes) ? edit.changes : [];
		if (state.stencilEventsSuppressedDepth > 0)
		{
			writeLog('debug', 'Stencil model change ignored due to suppression flag', {
				changes: changes.length,
				suppressedDepth: state.stencilEventsSuppressedDepth
			});
			return result;
		}
		writeLog('debug', 'Stencil model change detected', {
			changes: changes.length,
			editDataSessionActive: state.editDataSessionActive === true
		});
		var seen = {};
		for (var i = 0; i < changes.length; i++)
		{
			var change = changes[i];
			if (!change || typeof change !== 'object')
			{
				continue;
			}

			if (change.child)
			{
				var operation = null;
				if (change.parent != null && change.previous == null)
				{
					operation = 'add';
				}
				else if (change.parent != null && change.previous != null && change.previous !== change.parent)
				{
					operation = 'reparent';
				}
				if (change.parent == null && change.previous != null)
				{
					operation = 'remove';
				}
				if (operation != null)
				{
					if (operation === 'add' || operation === 'remove')
					{
						var edgeConnectionItems = collectConnectionEventsFromEdgeLifecycle(change, graph, operation === 'add' ? 'connect' : 'disconnect');
						for (var eci = 0; eci < edgeConnectionItems.length; eci++)
						{
							var edgeConnectionItem = edgeConnectionItems[eci];
							if (!edgeConnectionItem || !edgeConnectionItem.id)
							{
								continue;
							}
							var edgeKey = edgeConnectionItem.id;
							if (!Object.prototype.hasOwnProperty.call(seen, edgeKey))
							{
								seen[edgeKey] = true;
								result.push(edgeConnectionItem);
							}
						}
					}
					var targets = (operation === 'remove') ? [change.child] : collectAddSnapshotTargets(change.child, graph);
					for (var t = 0; t < targets.length; t++)
					{
						var targetCell = targets[t];
						if (operation === 'remove')
						{
							removeEntryFromStencilIndex(targetCell && targetCell.id ? targetCell.id : '');
						}
						else
						{
							upsertCellInStencilIndex(targetCell, graph);
						}
						var snapshot = buildStencilItemSnapshot(targetCell, operation);
						if (operation === 'reparent' && snapshot && change.previous != null)
						{
							snapshot.previousParentId = change.previous && change.previous.id ? String(change.previous.id) : '';
							snapshot.newParentId = change.parent && change.parent.id ? String(change.parent.id) : '';
							snapshot.previousLayerName = getLayerDisplayNameForAncestorChain(graph, change.previous);
							snapshot.targetParentLayerName = change.parent ? getLayerDisplayNameForAncestorChain(graph, change.parent) : '';
						}
						if (snapshot && snapshot.id)
						{
							var key = operation + ':' + snapshot.id;
							if (!Object.prototype.hasOwnProperty.call(seen, key))
							{
								seen[key] = true;
								result.push(snapshot);
							}
						}
					}
				}
			}

			if (change.cell && !change.child &&
				Object.prototype.hasOwnProperty.call(change, 'terminal') &&
				Object.prototype.hasOwnProperty.call(change, 'previous'))
			{
				var connectionItems = collectConnectionEventsFromTerminalChange(change, graph);
				for (var ci = 0; ci < connectionItems.length; ci++)
				{
					var connectionItem = connectionItems[ci];
					if (!connectionItem || !connectionItem.id)
					{
						continue;
					}
					var cKey = connectionItem.id;
					if (!Object.prototype.hasOwnProperty.call(seen, cKey))
					{
						seen[cKey] = true;
						result.push(connectionItem);
					}
				}
			}

			if (change.cell && !change.child &&
				Object.prototype.hasOwnProperty.call(change, 'value') &&
				Object.prototype.hasOwnProperty.call(change, 'previous') &&
				!Object.prototype.hasOwnProperty.call(change, 'geometry') &&
				!Object.prototype.hasOwnProperty.call(change, 'style') &&
				!Object.prototype.hasOwnProperty.call(change, 'terminal'))
			{
				if (state.editDataSessionActive === true)
				{
					upsertCellInStencilIndex(change.cell, graph);
					var beforeKey = change.cell.id || '';
					var beforeState = state.editDataBeforeByCell[beforeKey];
					var beforeValue = (beforeState && typeof beforeState === 'object' && Object.prototype.hasOwnProperty.call(beforeState, 'value')) ?
						beforeState.value : beforeState;
					var beforeData = (beforeState && typeof beforeState === 'object' && Object.prototype.hasOwnProperty.call(beforeState, 'data')) ?
						beforeState.data : {};
					var afterValue = sanitizeForIpc(change.value);
					var afterData = extractEditableDataFromValue(change.value, graph, change.cell);
					var dataBeforeStr = stableStringifyEditableData(beforeData);
					var dataAfterStr = stableStringifyEditableData(afterData);
					var dataChanged = (dataBeforeStr !== dataAfterStr);
					var diffKeys = diffEditableDataKeys(beforeData, afterData);
					var beforeJson = JSON.stringify(beforeValue);
					var afterJson = JSON.stringify(afterValue);
					var valueSnapshotChanged = (beforeJson !== afterJson);
					var emitModify = dataChanged || valueSnapshotChanged;
					writeLog('debug', 'Stencil modify candidate evaluated', {
						cellId: change.cell && change.cell.id ? change.cell.id : '',
						emitModify: emitModify,
						dataChanged: dataChanged,
						valueSnapshotChanged: valueSnapshotChanged,
						diffKeys: diffKeys,
						hasBeforeState: !!(beforeState && typeof beforeState === 'object')
					});
					if (emitModify)
					{
						var modifySnapshot = buildStencilItemSnapshot(change.cell, 'modify');
						if (modifySnapshot && modifySnapshot.id)
						{
							var mKey = 'modify:' + modifySnapshot.id;
							if (!Object.prototype.hasOwnProperty.call(seen, mKey))
							{
								seen[mKey] = true;
								modifySnapshot.valueBefore = beforeValue;
								modifySnapshot.valueAfter = afterValue;
								modifySnapshot.dataBefore = beforeData;
								modifySnapshot.dataAfter = afterData;
								result.push(modifySnapshot);
							}
						}
					}
				}
				else if (isSeafStencilUserValue(change.value) || isSeafStencilUserValue(change.previous))
				{
					var beforeRaw = change.previous;
					var afterRaw = change.value;
					upsertCellInStencilIndex(change.cell, graph);
					var beforeDataIp = extractEditableDataFromValue(beforeRaw, graph, change.cell);
					var afterDataIp = extractEditableDataFromValue(afterRaw, graph, change.cell);
					var dataBeforeStrIp = stableStringifyEditableData(beforeDataIp);
					var dataAfterStrIp = stableStringifyEditableData(afterDataIp);
					var dataChangedIp = (dataBeforeStrIp !== dataAfterStrIp);
					var diffKeysIp = diffEditableDataKeys(beforeDataIp, afterDataIp);
					var beforeJsonIp = JSON.stringify(sanitizeForIpc(beforeRaw));
					var afterJsonIp = JSON.stringify(sanitizeForIpc(afterRaw));
					var valueSnapshotChangedIp = (beforeJsonIp !== afterJsonIp);
					var emitModifyIp = dataChangedIp || valueSnapshotChangedIp;
					writeLog('debug', 'Stencil modify candidate evaluated', {
						cellId: change.cell && change.cell.id ? change.cell.id : '',
						emitModify: emitModifyIp,
						dataChanged: dataChangedIp,
						valueSnapshotChanged: valueSnapshotChangedIp,
						diffKeys: diffKeysIp,
						hasBeforeState: false,
						inplaceSeafValueChange: true
					});
					if (emitModifyIp)
					{
						var modifySnapshotIp = buildStencilItemSnapshot(change.cell, 'modify');
						if (modifySnapshotIp && modifySnapshotIp.id)
						{
							var mKeyIp = 'modify:' + modifySnapshotIp.id;
							if (!Object.prototype.hasOwnProperty.call(seen, mKeyIp))
							{
								seen[mKeyIp] = true;
								modifySnapshotIp.valueBefore = sanitizeForIpc(beforeRaw);
								modifySnapshotIp.valueAfter = sanitizeForIpc(afterRaw);
								modifySnapshotIp.dataBefore = beforeDataIp;
								modifySnapshotIp.dataAfter = afterDataIp;
								result.push(modifySnapshotIp);
							}
						}
					}
				}
			}
		}
		return result;
	}

	function installStencilModelListener()
	{
		if (state.stencilModelListenerInstalled)
		{
			return;
		}
		var graph = ui && ui.editor ? ui.editor.graph : null;
		if (!graph || !graph.model || typeof graph.model.addListener !== 'function' || typeof mxEvent === 'undefined')
		{
			return;
		}
		graph.model.addListener(mxEvent.CHANGE, function(sender, evt)
		{
			try
			{
				var items = collectStencilEventsFromModelChange(evt);
				if (items.length > 0)
				{
					queueStencilBatch(items);
				}
			}
			catch (e)
			{
				writeLog('error', 'Stencil model listener failed', {
					error: e && e.message ? e.message : String(e)
				});
			}
		});
		state.stencilModelListenerInstalled = true;
	}

	// End Edit Data snapshot session after the dialog stack unwinds. Clearing the session in the
	// model CHANGE listener breaks both native and SEAF Apply: hideDialog often emits intermediate
	// CHANGE events, and native EditDataDialog calls hideDialog before setValue.
	function installEditDataSessionHideHook()
	{
		if (state.editDataSessionHideHookInstalled === true)
		{
			return;
		}
		if (ui == null || typeof ui.hideDialog !== 'function')
		{
			return;
		}
		var originalHideDialog = ui.hideDialog.bind(ui);
		ui.hideDialog = function()
		{
			var ret = originalHideDialog.apply(ui, arguments);
			if (state.editDataSessionActive === true)
			{
				window.setTimeout(function()
				{
					if (state.editDataSessionActive === true)
					{
						EditDataSessionCoordinator.reset();
					}
				}, 0);
			}
			return ret;
		};
		state.editDataSessionHideHookInstalled = true;
	}

	function ensureSeafEditDataResources()
	{
		if (typeof mxResources !== 'undefined' && typeof mxResources.parse === 'function')
		{
			mxResources.parse('seafEditDataLockTooltip=Поле защищено data_lock и недоступно для изменения или удаления');
			mxResources.parse('seafEditDataLockedAddAlert=Имя свойства защищено data_lock и не может быть добавлено');
			mxResources.parse('seafEditDataHiddenAddAlert=Имя свойства скрыто data_hidden и не может быть добавлено');
		}
	}

	function runWithStencilEventsSuppressed(fn)
	{
		state.stencilEventsSuppressedDepth += 1;
		try
		{
			return fn();
		}
		finally
		{
			state.stencilEventsSuppressedDepth = Math.max(0, state.stencilEventsSuppressedDepth - 1);
		}
	}

	function getSeafEditDataLockTooltip()
	{
		try
		{
			if (typeof mxResources !== 'undefined' && typeof mxResources.get === 'function')
			{
				var s = mxResources.get('seafEditDataLockTooltip');
				if (typeof s === 'string' && s.length > 0 && s !== 'seafEditDataLockTooltip')
				{
					return s;
				}
			}
		}
		catch (e)
		{
			// fall through
		}
		return 'Поле защищено data_lock и недоступно для изменения или удаления';
	}

	function getSeafEditDataLockedAddAlert()
	{
		try
		{
			if (typeof mxResources !== 'undefined' && typeof mxResources.get === 'function')
			{
				var s = mxResources.get('seafEditDataLockedAddAlert');
				if (typeof s === 'string' && s.length > 0 && s !== 'seafEditDataLockedAddAlert')
				{
					return s;
				}
			}
		}
		catch (e)
		{
			// fall through
		}
		return 'Имя свойства защищено data_lock и не может быть добавлено';
	}

	function getSeafEditDataHiddenAddAlert()
	{
		try
		{
			if (typeof mxResources !== 'undefined' && typeof mxResources.get === 'function')
			{
				var s = mxResources.get('seafEditDataHiddenAddAlert');
				if (typeof s === 'string' && s.length > 0 && s !== 'seafEditDataHiddenAddAlert')
				{
					return s;
				}
			}
		}
		catch (e)
		{
			// fall through
		}
		return 'Имя свойства скрыто data_hidden и не может быть добавлено';
	}

	// SEAF Edit Data dialog. Mirrors the standard EditDataDialog UX (XML object node attributes,
	// Apply/Cancel/Export, optional placeholders checkbox), but with first-class support for:
	//   - data_lock list per schema (locked rows are disabled and have no remove button)
	//   - data_hidden list per schema (rows omitted; attributes preserved on Apply)
	//   - blocking add of properties whose name is in data_lock or data_hidden
	//   - Phase 2 hook: schemas.<x>.fields.<attr>.widget (combo/radio/...) - currently fallback to textarea
	function SeafEditDataDialog(uiRef, cell, optionalGraph)
	{
		ensureSeafEditDataResources();
		var graph = optionalGraph || (uiRef && uiRef.editor ? uiRef.editor.graph : null);
		var model = graph ? graph.getModel() : null;
		var rawValue = (model && typeof model.getValue === 'function') ? model.getValue(cell) : (cell ? cell.value : null);
		// Convert plain string/null values to an XML object node, like the standard dialog does.
		var value;
		if (mxUtils.isNode(rawValue))
		{
			value = rawValue;
		}
		else
		{
			var doc = mxUtils.createXmlDocument();
			value = doc.createElement('object');
			value.setAttribute('label', (rawValue == null ? '' : String(rawValue)));
		}

		var schemaMeta = extractShapeSchema(cell, graph);
		var schemaKey = schemaMeta && typeof schemaMeta.schema === 'string' ? schemaMeta.schema : '';
		var lockList = getDataLockForSchema(schemaKey);
		var lockSet = {};
		for (var li = 0; li < lockList.length; li++) { lockSet[lockList[li]] = true; }
		var hiddenList = getDataHiddenForSchema(schemaKey);
		var hiddenSet = {};
		for (var hi = 0; hi < hiddenList.length; hi++) { hiddenSet[hiddenList[hi]] = true; }

		var div = document.createElement('div');
		var top = document.createElement('div');
		top.style.position = 'absolute';
		top.style.top = '30px';
		top.style.left = '30px';
		top.style.right = '30px';
		top.style.bottom = '80px';
		top.style.overflowY = 'auto';

		var form = new mxForm('properties');
		form.table.style.width = '100%';

		var rowState = []; // [{name, locked, input, removed, removeBtn, row}]
		var isLayer = false;
		try
		{
			isLayer = !!(model && typeof model.isLayer === 'function' && cell && model.isLayer(cell));
		}
		catch (eIsLayer) { isLayer = false; }
		var styleMap = {};
		try
		{
			styleMap = (graph && typeof graph.getCurrentCellStyle === 'function' && cell) ? (graph.getCurrentCellStyle(cell) || {}) : {};
		}
		catch (eStyle) { styleMap = {}; }
		var allowLabel = (String(styleMap.metaEdit || '') === '1') ||
			(typeof Graph !== 'undefined' && Graph != null && Graph.translateDiagram === true) ||
			isLayer;

		// id row (read-only) for non-root cells, mirrors EditDataDialog.getDisplayIdForCell()
		var idText = null;
		try
		{
			if (typeof EditDataDialog !== 'undefined' && typeof EditDataDialog.getDisplayIdForCell === 'function')
			{
				idText = EditDataDialog.getDisplayIdForCell(uiRef, cell, optionalGraph);
			}
			else if (cell && typeof cell.getId === 'function' && model && typeof model.getParent === 'function' && model.getParent(cell) != null)
			{
				idText = cell.getId();
			}
		}
		catch (eId) { idText = null; }
		if (idText != null)
		{
			var idDiv = document.createElement('div');
			idDiv.style.width = '100%';
			idDiv.style.fontSize = '11px';
			idDiv.style.textAlign = 'center';
			mxUtils.write(idDiv, idText);
			form.addField(mxResources.get('id') + ':', idDiv);
		}

		// Build sorted attribute list
		var temp = [];
		var attrs = (value && value.attributes) ? value.attributes : [];
		for (var ai = 0; ai < attrs.length; ai++)
		{
			var a = attrs[ai];
			var nm = a && typeof a.nodeName === 'string' ? a.nodeName : '';
			if (!nm || nm === 'placeholders') continue;
			if (nm === 'label' && !allowLabel) continue;
			temp.push({name: nm, value: (a.nodeValue == null ? '' : String(a.nodeValue))});
		}
		temp.sort(function(a, b)
		{
			if (a.name === 'label') return 1;
			if (b.name === 'label') return -1;
			if (a.name < b.name) return -1;
			if (a.name > b.name) return 1;
			return 0;
		});

		function addPropertyRow(name, val)
		{
			if (hiddenSet[name] === true)
			{
				return null;
			}
			var locked = !!lockSet[name];
			// Phase 1: always textarea; Phase 2 will branch on schemas.<x>.fields.<name>.widget
			var input = form.addTextarea(name + ':', val, 2);
			input.style.width = '100%';
			if (val.indexOf('\n') > 0)
			{
				input.setAttribute('rows', '2');
			}
			var rowEl = input.parentNode ? input.parentNode.parentNode : null; // td.parent === tr
			var removeBtn = null;

			// Wrap textarea + (optional) remove button into a flex container
			var wrapper = document.createElement('div');
			wrapper.style.position = 'relative';
			wrapper.style.display = 'flex';
			wrapper.style.alignItems = 'center';
			wrapper.style.boxSizing = 'border-box';
			wrapper.style.width = '100%';
			var textParent = input.parentNode;
			if (textParent != null)
			{
				textParent.appendChild(wrapper);
				wrapper.appendChild(input);
			}

			var entry = {name: name, locked: locked, input: input, removed: false, removeBtn: null, row: rowEl};
			if (locked)
			{
				try
				{
					input.setAttribute('disabled', 'disabled');
					input.title = getSeafEditDataLockTooltip();
				}
				catch (e) { /* ignore */ }
			}
			else
			{
				removeBtn = document.createElement('a');
				try
				{
					var img = mxUtils.createImage(Dialog.prototype.closeImage);
					img.style.height = '9px';
					img.style.fontSize = '9px';
					removeBtn.appendChild(img);
				}
				catch (eImg)
				{
					mxUtils.write(removeBtn, 'X');
				}
				removeBtn.className = 'geButton';
				removeBtn.setAttribute('title', mxResources.get('delete'));
				removeBtn.style.marginLeft = '8px';
				removeBtn.style.cursor = 'pointer';
				wrapper.appendChild(removeBtn);
				entry.removeBtn = removeBtn;
				mxEvent.addListener(removeBtn, 'click', function()
				{
					entry.removed = true;
					if (entry.row && entry.row.parentNode)
					{
						entry.row.parentNode.removeChild(entry.row);
					}
				});
			}
			rowState.push(entry);
			return entry;
		}

		for (var ti = 0; ti < temp.length; ti++)
		{
			if (hiddenSet[temp[ti].name] === true)
			{
				continue;
			}
			addPropertyRow(temp[ti].name, temp[ti].value);
		}
		top.appendChild(form.table);

		// Add Property block
		var newProp = document.createElement('div');
		newProp.style.display = 'flex';
		newProp.style.alignItems = 'center';
		newProp.style.boxSizing = 'border-box';
		newProp.style.paddingRight = '160px';
		newProp.style.whiteSpace = 'nowrap';
		newProp.style.marginTop = '6px';
		newProp.style.width = '100%';

		var nameInput = document.createElement('input');
		nameInput.setAttribute('placeholder', mxResources.get('enterPropertyName'));
		nameInput.setAttribute('type', 'text');
		nameInput.setAttribute('size', '40');
		nameInput.style.boxSizing = 'border-box';
		nameInput.style.borderWidth = '1px';
		nameInput.style.borderStyle = 'solid';
		nameInput.style.marginLeft = '2px';
		nameInput.style.padding = '4px';
		nameInput.style.width = '100%';
		newProp.appendChild(nameInput);
		top.appendChild(newProp);
		div.appendChild(top);

		var addBtn = mxUtils.button(mxResources.get('addProperty'), function()
		{
			var name = (nameInput.value == null ? '' : String(nameInput.value)).trim();
			if (name.length === 0 || name === 'label' || name === 'id' || name === 'placeholders' || name.indexOf(':') >= 0)
			{
				mxUtils.alert(mxResources.get('invalidName'));
				return;
			}
			if (lockSet[name] === true)
			{
				mxUtils.alert(getSeafEditDataLockedAddAlert());
				return;
			}
			if (hiddenSet[name] === true)
			{
				mxUtils.alert(getSeafEditDataHiddenAddAlert());
				return;
			}
			// If property with this name already exists in current state, focus it
			for (var j = 0; j < rowState.length; j++)
			{
				if (rowState[j].name === name && !rowState[j].removed && rowState[j].input)
				{
					try { rowState[j].input.focus(); } catch (e) { /* ignore */ }
					addBtn.setAttribute('disabled', 'disabled');
					nameInput.value = '';
					return;
				}
			}
			// Validate via clone (catches XML-illegal names)
			try
			{
				var clone = value.cloneNode(false);
				clone.setAttribute(name, '');
			}
			catch (e)
			{
				mxUtils.alert(e && e.message ? e.message : String(e));
				return;
			}
			var entry = addPropertyRow(name, '');
			try { entry.input.focus(); } catch (e2) { /* ignore */ }
			addBtn.setAttribute('disabled', 'disabled');
			nameInput.value = '';
		});
		addBtn.setAttribute('title', mxResources.get('addProperty'));
		addBtn.setAttribute('disabled', 'disabled');
		addBtn.style.textOverflow = 'ellipsis';
		addBtn.style.position = 'absolute';
		addBtn.style.overflow = 'hidden';
		addBtn.style.width = '144px';
		addBtn.style.right = '0px';
		addBtn.className = 'geBtn';
		newProp.appendChild(addBtn);

		mxEvent.addListener(nameInput, 'keypress', function(e)
		{
			if (e.keyCode === 13)
			{
				addBtn.click();
			}
		});
		function updateAddBtn()
		{
			if (nameInput.value.length > 0)
			{
				addBtn.removeAttribute('disabled');
			}
			else
			{
				addBtn.setAttribute('disabled', 'disabled');
			}
		}
		mxEvent.addListener(nameInput, 'keyup', updateAddBtn);
		mxEvent.addListener(nameInput, 'change', updateAddBtn);

		// Buttons row
		var buttons = document.createElement('div');
		buttons.style.display = 'flex';
		buttons.style.justifyContent = 'flex-end';
		buttons.style.alignItems = 'center';
		buttons.style.position = 'absolute';
		buttons.style.left = '30px';
		buttons.style.right = '30px';
		buttons.style.bottom = '30px';
		buttons.style.height = '40px';

		// Placeholders checkbox (parity with standard dialog)
		var hasPlaceholders = false;
		try
		{
			hasPlaceholders = !!(model && typeof model.isVertex === 'function' && (model.isVertex(cell) || model.isEdge(cell)));
		}
		catch (eP) { hasPlaceholders = false; }
		var placeholdersInput = null;
		if (hasPlaceholders)
		{
			var replaceSpan = document.createElement('span');
			replaceSpan.style.marginRight = '10px';
			replaceSpan.style.justifyContent = 'flex-end';
			replaceSpan.style.alignItems = 'center';
			replaceSpan.style.display = 'flex';
			replaceSpan.style.whiteSpace = 'nowrap';
			placeholdersInput = document.createElement('input');
			placeholdersInput.setAttribute('type', 'checkbox');
			placeholdersInput.style.marginRight = '6px';
			if (value.getAttribute && value.getAttribute('placeholders') === '1')
			{
				placeholdersInput.setAttribute('checked', 'checked');
				placeholdersInput.defaultChecked = true;
			}
			replaceSpan.appendChild(placeholdersInput);
			mxUtils.write(replaceSpan, mxResources.get('placeholders'));
			buttons.appendChild(replaceSpan);
		}

		var cancelBtn = mxUtils.button(mxResources.get('cancel'), function()
		{
			try
			{
				EditDataSessionCoordinator.reset();
			}
			catch (eCancelReset) { /* ignore */ }
			uiRef.hideDialog.apply(uiRef, arguments);
		});
		cancelBtn.setAttribute('title', 'Escape');
		cancelBtn.className = 'geBtn';

		var exportBtn = mxUtils.button(mxResources.get('export'), function()
		{
			try
			{
				var exportData = (typeof graph.getDataForCells === 'function') ? graph.getDataForCells([cell], true) : null;
				if (typeof EmbedDialog === 'function')
				{
					var dlg = new EmbedDialog(uiRef, JSON.stringify(exportData, null, 2), null, null, function()
					{
						try { console.log(exportData); } catch (e) { /* ignore */ }
						uiRef.alert('Written to Console (Dev Tools)');
					}, mxResources.get('export'), null, 'Console', 'data.json');
					uiRef.showDialog(dlg.container, 450, 270, true, true, null, false, null, new mxRectangle(0, 0, 400, 250));
					if (typeof dlg.init === 'function') dlg.init();
				}
			}
			catch (e)
			{
				mxUtils.alert(e && e.message ? e.message : String(e));
			}
		});
		exportBtn.setAttribute('title', mxResources.get('export'));
		exportBtn.className = 'geBtn';

		var applyBtn = mxUtils.button(mxResources.get('apply'), function()
		{
			try
			{
				// Read form and build clone while dialog DOM is still mounted (hideDialog may detach the form).
				var clone = value.cloneNode(true);
				var removeLabel = false;
				var seenNames = {};

				// First, write/keep all rowState entries
				for (var i = 0; i < rowState.length; i++)
				{
					var f = rowState[i];
					seenNames[f.name] = true;
					if (f.removed)
					{
						clone.removeAttribute(f.name);
						continue;
					}
					if (f.locked)
					{
						// Preserve original value verbatim
						continue;
					}
					var v = (f.input && f.input.value != null) ? String(f.input.value) : '';
					clone.setAttribute(f.name, v);
					if (f.name === 'placeholder' && clone.getAttribute('placeholders') === '1')
					{
						removeLabel = true;
					}
				}

				// Drop any attributes from clone that user removed but were not in rowState (defensive)
				if (clone.attributes && typeof clone.removeAttribute === 'function')
				{
					var toRemove = [];
					for (var k = 0; k < clone.attributes.length; k++)
					{
						var an = clone.attributes[k] && clone.attributes[k].nodeName ? clone.attributes[k].nodeName : '';
						if (!an || an === 'label' || an === 'placeholders' || an === 'id') continue;
						if (lockSet[an] === true || hiddenSet[an] === true) continue;
						if (!seenNames[an])
						{
							toRemove.push(an);
						}
					}
					for (var k2 = 0; k2 < toRemove.length; k2++)
					{
						clone.removeAttribute(toRemove[k2]);
					}
				}

				if (placeholdersInput != null)
				{
					if (placeholdersInput.checked)
					{
						clone.setAttribute('placeholders', '1');
					}
					else
					{
						clone.removeAttribute('placeholders');
					}
				}
				if (removeLabel)
				{
					clone.removeAttribute('label');
				}

				// Before-state for modify must use the edited cell from the model, not current selection:
				// hideDialog() often clears selection, so captureEditDataBeforeSnapshots(graph) was empty/wrong.
				try
				{
					state.editDataSessionActive = true;
					state.editDataBeforeByCell = captureEditDataBeforeForCellIds(graph, [cell]);
				}
				catch (eSnap) { /* ignore */ }

				uiRef.hideDialog.apply(uiRef, arguments);

				if (model && typeof model.setValue === 'function')
				{
					model.setValue(cell, clone);
				}
			}
			catch (e)
			{
				mxUtils.alert(e && e.message ? e.message : String(e));
			}
			finally
			{
				try
				{
					EditDataSessionCoordinator.reset();
				}
				catch (eApplyReset) { /* ignore */ }
			}
		});
		applyBtn.setAttribute('title', 'Ctrl+Enter');
		applyBtn.className = 'geBtn gePrimaryBtn';

		mxEvent.addListener(div, 'keydown', function(e)
		{
			if (e.keyCode === 13 && mxEvent.isControlDown(e))
			{
				applyBtn.click();
			}
		});

		if (uiRef.editor && uiRef.editor.cancelFirst)
		{
			buttons.appendChild(cancelBtn);
			buttons.appendChild(exportBtn);
			buttons.appendChild(applyBtn);
		}
		else
		{
			buttons.appendChild(exportBtn);
			buttons.appendChild(applyBtn);
			buttons.appendChild(cancelBtn);
		}
		div.appendChild(buttons);

		this.container = div;
		this.init = function()
		{
			for (var fi = 0; fi < rowState.length; fi++)
			{
				if (!rowState[fi].locked && rowState[fi].input && typeof rowState[fi].input.focus === 'function')
				{
					try { rowState[fi].input.focus(); return; } catch (e) { /* ignore */ }
				}
			}
			try { nameInput.focus(); } catch (e2) { /* ignore */ }
		};
	}

	function showSeafEditDataDialog(cell)
	{
		try
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			EditDataSessionCoordinator.begin(graph);
			var dlg = new SeafEditDataDialog(ui, cell, graph);
			ui.showDialog(dlg.container, 480, 420, true, false, null,
				false, null, new mxRectangle(0, 0, 440, 220));
			if (typeof dlg.init === 'function')
			{
				dlg.init();
			}
		}
		catch (e)
		{
			writeLog('error', 'Failed to open SEAF edit data dialog', {
				error: e && e.message ? e.message : String(e)
			});
		}
	}

	// Canonical router for "Edit Data" entry-points.
	// Draw.io invokes ui.showDataDialog(cell) from the editData action, the Format panel and Ctrl+M;
	// overriding it here covers all paths uniformly without depending on action.funct internals.
	function installEditDataDialogRouter()
	{
		if (state.editDataDialogRouterInstalled === true)
		{
			return;
		}
		if (ui == null || typeof ui.showDataDialog !== 'function')
		{
			writeLog('warn', 'showDataDialog override skipped: ui.showDataDialog unavailable', {});
			return;
		}
		var originalShowDataDialog = ui.showDataDialog.bind(ui);
		state.originalShowDataDialog = originalShowDataDialog;
		ui.showDataDialog = function(cell)
		{
			try
			{
				var routed = EditDataDialogRouter.route(cell, 'showDataDialog');
				if (routed && routed.handled === true)
				{
					writeLog('debug', 'showDataDialog routed to SEAF dialog', {
						cellId: routed.intent && routed.intent.targetCellId ? routed.intent.targetCellId : null,
						mode: routed.intent && routed.intent.mode ? routed.intent.mode : null,
						policySource: routed.intent && routed.intent.policySource ? routed.intent.policySource : null
					});
					return;
				}
			}
			catch (e)
			{
				writeLog('error', 'showDataDialog router failed; falling back to standard dialog', {
					error: e && e.message ? e.message : String(e)
				});
			}
			EditDataSessionCoordinator.begin(ui && ui.editor ? ui.editor.graph : null);
			return originalShowDataDialog(cell);
		};
		state.editDataDialogRouterInstalled = true;
		writeLog('info', 'showDataDialog router installed', {});
	}

	function buildContextObjectPayload(cell)
	{
		var graph = ui && ui.editor ? ui.editor.graph : null;
		if (!graph || cell == null)
		{
			return null;
		}
		var geometry = null;
		try
		{
			geometry = graph.getCellGeometry(cell);
		}
		catch (e)
		{
			geometry = null;
		}
		return {
			id: cell.id || null,
			objectId: cell.id || null,
			isVertex: graph.model.isVertex(cell),
			isEdge: graph.model.isEdge(cell),
			label: graph.convertValueToString(cell),
			style: sanitizeForIpc(graph.getCellStyle(cell)),
			geometry: buildGeometryPayload(geometry),
			data: extractEditableDataFromCell(cell, graph)
		};
	}

	function buildPayload(command, sourceCell)
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
		if (inputCfg.includePages === true)
		{
			payload.pages = getPagesPayload();
		}
		if (inputCfg.includeSchemaObjects === true)
		{
			payload.schemaObjects = collectSchemaObjectsAcrossPages();
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

		var contextCell = sourceCell || state.contextMenuLastCell || null;
		var contextObject = buildContextObjectPayload(contextCell);
		if (contextObject != null)
		{
			payload.contextObject = contextObject;
		}

		return payload;
	}

	function getPagesPayload()
	{
		var pages = Array.isArray(ui.pages) ? ui.pages : [];
		var out = [];
		for (var i = 0; i < pages.length; i++)
		{
			var page = pages[i];
			if (page == null) continue;
			out.push({
				id: (typeof page.getId === 'function') ? page.getId() : null,
				name: (typeof page.getName === 'function') ? page.getName() : null,
				isCurrent: ui.currentPage === page
			});
		}
		return out;
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

	function resolveScriptEnvEditorConfigFile(command)
	{
		if (!command || command.scriptEnvEditor == null)
		{
			return '';
		}

		var raw = command.scriptEnvEditor;
		if (typeof raw === 'string')
		{
			return raw.trim();
		}

		if (typeof raw === 'object' && typeof raw.configFile === 'string')
		{
			return raw.configFile.trim();
		}

		return '';
	}

	function resolveCommandDescriptionFile(command)
	{
		if (!command || command.descriptionFile == null)
		{
			return '';
		}
		if (typeof command.descriptionFile === 'string')
		{
			return command.descriptionFile.trim();
		}
		if (typeof command.descriptionFile === 'object' && typeof command.descriptionFile.path === 'string')
		{
			return command.descriptionFile.path.trim();
		}
		return '';
	}

	async function loadCommandDescriptionMarkdown(command)
	{
		var relPath = resolveCommandDescriptionFile(command);
		if (!relPath)
		{
			return '';
		}
		try
		{
			var raw = await requestAsync({
				action: 'readSeafPluginFile',
				configPath: state.configPath,
				relativePath: relPath,
				encoding: 'utf8'
			});
			return normalizeIpcTextPayload(raw);
		}
		catch (e)
		{
			await writeLog('warn', 'Command description markdown load failed', {
				commandId: command && command.id ? command.id : '',
				relativePath: relPath,
				error: e && e.message ? e.message : String(e)
			});
			return '';
		}
	}

	function renderSimpleMarkdownToElement(markdownText)
	{
		var host = document.createElement('div');
		host.style.overflowY = 'hidden';
		host.style.whiteSpace = 'normal';
		host.style.wordBreak = 'break-word';
		var raw = String(markdownText || '').replace(/\r\n?/g, '\n').trim();
		if (!raw)
		{
			var fallback = document.createElement('div');
			fallback.textContent = 'Описание инструмента не найдено.';
			host.appendChild(fallback);
			return host;
		}
		var lines = raw.split('\n');
		for (var i = 0; i < lines.length; i++)
		{
			var line = String(lines[i] || '');
			var trimmed = line.trim();
			if (!trimmed)
			{
				continue;
			}
			if (/^#{1,6}\s+/.test(trimmed))
			{
				var heading = document.createElement('div');
				heading.style.fontWeight = 'bold';
				heading.style.margin = '6px 0 4px 0';
				heading.textContent = trimmed.replace(/^#{1,6}\s+/, '');
				host.appendChild(heading);
				continue;
			}
			if (/^[-*]\s+/.test(trimmed))
			{
				var bullet = document.createElement('div');
				bullet.style.margin = '2px 0';
				bullet.textContent = '\u2022 ' + trimmed.replace(/^[-*]\s+/, '');
				host.appendChild(bullet);
				continue;
			}
			var paragraph = document.createElement('div');
			paragraph.style.margin = '4px 0';
			paragraph.textContent = trimmed;
			host.appendChild(paragraph);
		}
		if (host.childNodes.length === 0)
		{
			var emptyFallback = document.createElement('div');
			emptyFallback.textContent = 'Описание инструмента не найдено.';
			host.appendChild(emptyFallback);
		}
		return host;
	}

	function openCommandDescriptionDialog(command, markdownText)
	{
		return new Promise(function(resolve)
		{
			var dialogWidth = 560;
			var dialogMaxHeight = 420;
			var dialogMinHeight = 170;
			var container = document.createElement('div');
			container.style.minWidth = '520px';
			container.style.maxWidth = '760px';
			container.style.padding = '8px';
			container.style.boxSizing = 'border-box';

			var title = document.createElement('div');
			title.style.fontWeight = 'bold';
			title.style.marginBottom = '8px';
			title.textContent = String((command && command.title) || (command && command.id) || 'Инструмент');
			container.appendChild(title);

			var body = renderSimpleMarkdownToElement(markdownText);
			container.appendChild(body);

			var footer = document.createElement('div');
			footer.style.textAlign = 'right';
			footer.style.marginTop = '10px';
			footer.style.whiteSpace = 'nowrap';

			var stopBtn = mxUtils.button('Завершить', function()
			{
				ui.hideDialog();
				resolve(false);
			});
			stopBtn.className = 'geBtn';

			var continueBtn = mxUtils.button('Продолжить', function()
			{
				ui.hideDialog();
				resolve(true);
			});
			continueBtn.className = 'geBtn gePrimaryBtn';

			footer.appendChild(continueBtn);
			footer.appendChild(stopBtn);
			container.appendChild(footer);

			var measuredHeight = dialogMaxHeight;
			var measureHost = document.createElement('div');
			measureHost.style.position = 'absolute';
			measureHost.style.left = '-10000px';
			measureHost.style.top = '-10000px';
			measureHost.style.visibility = 'hidden';
			measureHost.style.width = dialogWidth + 'px';
			document.body.appendChild(measureHost);
			measureHost.appendChild(container);

			var bodyNaturalHeight = body.scrollHeight;
			var chromeHeight = Math.max(0, container.scrollHeight - bodyNaturalHeight);
			var availableBodyHeight = Math.max(80, dialogMaxHeight - chromeHeight);

			if (bodyNaturalHeight > availableBodyHeight)
			{
				body.style.maxHeight = availableBodyHeight + 'px';
				body.style.overflowY = 'auto';
				measuredHeight = dialogMaxHeight;
			}
			else
			{
				body.style.maxHeight = 'none';
				body.style.overflowY = 'hidden';
				measuredHeight = Math.max(dialogMinHeight, chromeHeight + bodyNaturalHeight);
			}

			measureHost.removeChild(container);
			document.body.removeChild(measureHost);

			ui.showDialog(container, dialogWidth, measuredHeight, true, true);
		});
	}

	async function runCommandDescriptionPreflight(command)
	{
		var relPath = resolveCommandDescriptionFile(command);
		if (!relPath)
		{
			return true;
		}
		var markdownText = await loadCommandDescriptionMarkdown(command);
		return await openCommandDescriptionDialog(command, markdownText);
	}

	function applyScriptEnvToPayload(payload, scriptEnvOverrides)
	{
		if (!payload || typeof payload !== 'object' || !scriptEnvOverrides || typeof scriptEnvOverrides !== 'object')
		{
			return payload;
		}

		payload.scriptEnv = mxUtils.clone(scriptEnvOverrides);
		var baseEnv = (payload.env && typeof payload.env === 'object') ? payload.env : {};
		payload.env = Object.assign({}, baseEnv, scriptEnvOverrides);
		if (!payload.arguments || typeof payload.arguments !== 'object')
		{
			payload.arguments = {};
		}
		for (var key in scriptEnvOverrides)
		{
			if (Object.prototype.hasOwnProperty.call(scriptEnvOverrides, key))
			{
				payload.arguments[key] = scriptEnvOverrides[key];
			}
		}
		return payload;
	}

	function collectFieldValuesFromControls(fieldControls)
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
		return nextEnv;
	}

	function validateRequiredScriptEnvFields(fields, envValues)
	{
		for (var i = 0; i < fields.length; i++)
		{
			var field = fields[i];
			if (!field || field.required !== true || typeof field.envKey !== 'string')
			{
				continue;
			}
			var value = envValues[field.envKey];
			if (field.inputMethod === 'checkbox')
			{
				continue;
			}
			if (value == null || String(value).trim().length === 0)
			{
				return field.label || field.envKey;
			}
		}
		return '';
	}

	function hideFieldHelpTooltip(tooltipState)
	{
		if (tooltipState != null && tooltipState.el != null && tooltipState.el.parentNode != null)
		{
			tooltipState.el.parentNode.removeChild(tooltipState.el);
		}

		if (tooltipState != null)
		{
			tooltipState.el = null;
		}
	}

	function showFieldHelpTooltip(helpEl, helpText, tooltipState)
	{
		hideFieldHelpTooltip(tooltipState);

		var tip = document.createElement('div');
		tip.className = 'geHint';
		tip.textContent = helpText;
		tip.style.position = 'fixed';
		tip.style.zIndex = '10010';
		tip.style.maxWidth = '320px';
		tip.style.whiteSpace = 'normal';
		tip.style.pointerEvents = 'none';

		var rect = helpEl.getBoundingClientRect();
		tip.style.left = Math.round(rect.right + 6) + 'px';
		tip.style.top = Math.round(rect.top) + 'px';
		document.body.appendChild(tip);
		tooltipState.el = tip;
	}

	function appendFieldHelpIcon(labelWrap, field)
	{
		var helpText = (field && typeof field.helpText === 'string') ? field.helpText.trim() : '';

		if (helpText.length === 0)
		{
			return;
		}

		var helpEl = null;

		if (typeof Editor !== 'undefined' && Editor != null && typeof Editor.helpImage === 'string' && Editor.helpImage.length > 0)
		{
			helpEl = document.createElement('img');
			helpEl.setAttribute('src', Editor.helpImage);
			helpEl.className = 'geHelpIcon';
		}
		else
		{
			helpEl = document.createElement('span');
			helpEl.textContent = '?';
			helpEl.style.display = 'inline-block';
			helpEl.style.width = '14px';
			helpEl.style.height = '14px';
			helpEl.style.lineHeight = '14px';
			helpEl.style.textAlign = 'center';
			helpEl.style.borderRadius = '50%';
			helpEl.style.border = '1px solid #909090';
			helpEl.style.fontSize = '10px';
			helpEl.style.fontWeight = 'bold';
		}

		helpEl.setAttribute('title', helpText);
		helpEl.setAttribute('aria-label', helpText);
		helpEl.style.cursor = 'help';

		var tooltipState = {el: null};
		var onEnter = function()
		{
			showFieldHelpTooltip(helpEl, helpText, tooltipState);
		};
		var onLeave = function()
		{
			hideFieldHelpTooltip(tooltipState);
		};

		if (typeof mxEvent !== 'undefined' && mxEvent != null && typeof mxEvent.addListener === 'function')
		{
			mxEvent.addListener(helpEl, 'mouseenter', onEnter);
			mxEvent.addListener(helpEl, 'mouseleave', onLeave);
		}
		else
		{
			helpEl.addEventListener('mouseenter', onEnter);
			helpEl.addEventListener('mouseleave', onLeave);
		}

		labelWrap.appendChild(helpEl);
	}

	function openScriptEnvFieldsDialog(dialogOpts)
	{
		return new Promise(function(resolve)
		{
			var baseInset = 8;
			var editorCfg = dialogOpts || {};
			var fields = Array.isArray(editorCfg.fields) ? editorCfg.fields : [];
			var env = (editorCfg.env && typeof editorCfg.env === 'object') ? editorCfg.env : {};
			var persist = (typeof editorCfg.persist === 'string') ? editorCfg.persist : 'none';
			var configFile = (typeof editorCfg.configFile === 'string') ? editorCfg.configFile : '';
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

			var createRow = function(labelText, field)
			{
				var row = document.createElement('div');
				row.style.marginBottom = '10px';
				var labelWrap = document.createElement('div');
				labelWrap.style.display = 'inline-flex';
				labelWrap.style.alignItems = 'center';
				labelWrap.style.gap = '4px';
				var labelGapPx = (field != null && field.labelMarginBottom != null) ?
					parseInt(field.labelMarginBottom, 10) : 4;
				if (isNaN(labelGapPx) || labelGapPx < 0)
				{
					labelGapPx = 4;
				}
				labelWrap.style.marginBottom = labelGapPx + 'px';
				var label = document.createElement('div');
				label.style.fontWeight = 'bold';
				label.textContent = labelText;
				labelWrap.appendChild(label);
				appendFieldHelpIcon(labelWrap, field);
				row.appendChild(labelWrap);
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
				var row = createRow(field.label || field.envKey, field);
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
					input = document.createElement('select');
					input.style.width = '100%';
					var options = Array.isArray(field.options) ? field.options : [];
					for (var j = 0; j < options.length; j++)
					{
						var opt = document.createElement('option');
						var rawOpt = options[j];
						if (rawOpt != null && typeof rawOpt === 'object' && !Array.isArray(rawOpt))
						{
							opt.value = String(rawOpt.value != null ? rawOpt.value : '');
							opt.textContent = String(rawOpt.label != null ? rawOpt.label : rawOpt.value);
						}
						else
						{
							opt.value = String(rawOpt);
							opt.textContent = String(rawOpt);
						}
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
					for (var k = 0; k < radioOptions.length; k++)
					{
						var radioLabel = document.createElement('label');
						radioLabel.style.display = 'block';
						var radio = document.createElement('input');
						radio.type = 'radio';
						radio.name = 'seaf-script-radio-' + field.envKey;
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

			applyFieldRelations = function(){};

			var footer = document.createElement('div');
			footer.style.textAlign = 'right';
			footer.style.marginTop = baseInset + 'px';
			footer.style.whiteSpace = 'nowrap';
			var cancelBtn = mxUtils.button(mxResources.get('cancel'), function()
			{
				ui.hideDialog();
				resolve({cancelled: true});
			});
			cancelBtn.className = 'geBtn';

			var runBtn = mxUtils.button('Run', async function()
			{
				var nextEnv = collectFieldValuesFromControls(fieldControls);
				var missing = validateRequiredScriptEnvFields(fields, nextEnv);
				if (missing.length > 0)
				{
					showError('Заполните обязательное поле: ' + missing);
					return;
				}
				ui.hideDialog();
				resolve({cancelled: false, env: nextEnv});
			});
			runBtn.className = 'geBtn gePrimaryBtn';

			var saveBtn = null;
			if (persist === 'global' || persist === 'scriptDefaults')
			{
				saveBtn = mxUtils.button(mxResources.get('save'), async function()
				{
					var nextEnv = collectFieldValuesFromControls(fieldControls);
					var missing = validateRequiredScriptEnvFields(fields, nextEnv);
					if (missing.length > 0)
					{
						showError('Заполните обязательное поле: ' + missing);
						return;
					}
					try
					{
						if (persist === 'global')
						{
							var saved = await requestAsync({
								action: 'saveSeafEnvConfig',
								configPath: state.configPath,
								env: nextEnv
							});
							state.envConfig = saved;
							state.logging = computeUiLoggingFromEnv(state.config ? state.config.logging : null, state.envConfig);
						}
						else if (persist === 'scriptDefaults' && configFile.length > 0)
						{
							await requestAsync({
								action: 'saveSeafScriptEnvDefaults',
								configPath: state.configPath,
								configFile: configFile,
								env: nextEnv
							});
						}
					}
					catch (e)
					{
						showError('Failed to save defaults: ' + e.message);
						return;
					}
				});
				saveBtn.className = 'geBtn';
			}

			if (saveBtn != null)
			{
				footer.appendChild(runBtn);
				footer.appendChild(saveBtn);
				footer.appendChild(cancelBtn);
			}
			else
			{
				footer.appendChild(runBtn);
				footer.appendChild(cancelBtn);
			}
			container.appendChild(footer);

			var dialogWidth = 460 + (hasChoiceControls ? 40 : 0);
			dialogWidth = Math.max(420, Math.min(760, dialogWidth));
			var defaultDialogHeight = 360;
			var defaultFormBodyMaxHeight = 280;
			var dialogHeight = (editorCfg.dialogHeight != null && !isNaN(parseInt(editorCfg.dialogHeight, 10))) ?
				parseInt(editorCfg.dialogHeight, 10) : defaultDialogHeight;
			var formBodyMaxHeight = (editorCfg.formBodyMaxHeight != null &&
				!isNaN(parseInt(editorCfg.formBodyMaxHeight, 10))) ?
				parseInt(editorCfg.formBodyMaxHeight, 10) : defaultFormBodyMaxHeight;
			dialogHeight = Math.max(100, dialogHeight);
			formBodyMaxHeight = Math.max(60, formBodyMaxHeight);
			formBody.style.maxHeight = formBodyMaxHeight + 'px';
			ui.showDialog(container, dialogWidth, dialogHeight, true, true);
		});
	}

	async function collectScriptEnvOverrides(command)
	{
		var configFile = resolveScriptEnvEditorConfigFile(command);
		if (!configFile)
		{
			return {};
		}

		var schema = null;
		try
		{
			schema = await requestAsync({
				action: 'getSeafScriptEnvSchema',
				configPath: state.configPath,
				configFile: configFile
			});
		}
		catch (e)
		{
			await writeLog('error', 'scriptEnvEditor schema load failed', {
				commandId: command && command.id ? command.id : '',
				configFile: configFile,
				error: e.message
			});
			showError('Ошибка конфигурации scriptEnvEditor: ' + e.message);
			return null;
		}

		var initialEnv = {};
		if (schema.mergeGlobalEnv !== false && state.envConfig != null && typeof state.envConfig.env === 'object')
		{
			initialEnv = Object.assign({}, state.envConfig.env);
		}

		if (schema.persist === 'scriptDefaults')
		{
			try
			{
				var defaults = await requestAsync({
					action: 'getSeafScriptEnvDefaults',
					configPath: state.configPath,
					configFile: configFile
				});
				if (defaults && defaults.env && typeof defaults.env === 'object')
				{
					initialEnv = Object.assign(initialEnv, defaults.env);
				}
			}
			catch (defaultsErr)
			{
				await writeLog('warn', 'scriptEnvEditor defaults load failed', {
					commandId: command && command.id ? command.id : '',
					configFile: configFile,
					error: defaultsErr.message
				});
			}
		}

		var dialogResult = await openScriptEnvFieldsDialog({
			title: schema.title || 'Script parameters',
			fields: schema.fields,
			env: initialEnv,
			persist: schema.persist || 'none',
			configFile: configFile
		});

		if (dialogResult == null || dialogResult.cancelled === true)
		{
			return null;
		}

		return dialogResult.env || {};
	}

	function resolvePluginLogLevelForDebug()
	{
		var env = (state.envConfig != null && state.envConfig.env != null &&
			typeof state.envConfig.env === 'object') ? state.envConfig.env : {};
		return String(env.pluginLogLevel || 'none').trim().toLowerCase();
	}

	function openStencilSchemaPickerDialog(dialogOpts)
	{
		return new Promise(function(resolve)
		{
			var opts = dialogOpts || {};
			var listOptions = Array.isArray(opts.options) ? opts.options : [];
			var defaultSchema = (typeof opts.defaultSchema === 'string') ? opts.defaultSchema : '';
			var baseInset = 8;
			var labelGapPx = 12;
			var selectToButtonsGapPx = 28;
			var dialogWidth = 460;
			var dialogHeight = 148;

			var container = document.createElement('div');
			container.style.width = dialogWidth + 'px';
			container.style.boxSizing = 'border-box';
			container.style.padding = baseInset + 'px';
			container.style.overflow = 'hidden';

			var labelWrap = document.createElement('div');
			labelWrap.style.fontWeight = 'bold';
			labelWrap.style.marginBottom = labelGapPx + 'px';
			labelWrap.textContent = 'Выбор объектов для редактирования';
			container.appendChild(labelWrap);

			var select = document.createElement('select');
			select.style.width = '100%';
			select.style.boxSizing = 'border-box';
			select.style.marginBottom = selectToButtonsGapPx + 'px';
			for (var i = 0; i < listOptions.length; i++)
			{
				var rawOpt = listOptions[i];
				var opt = document.createElement('option');
				if (rawOpt != null && typeof rawOpt === 'object' && !Array.isArray(rawOpt))
				{
					opt.value = String(rawOpt.value != null ? rawOpt.value : '');
					opt.textContent = String(rawOpt.label != null ? rawOpt.label : rawOpt.value);
				}
				else
				{
					opt.value = String(rawOpt);
					opt.textContent = String(rawOpt);
				}
				select.appendChild(opt);
			}
			if (defaultSchema.length > 0)
			{
				select.value = defaultSchema;
			}
			else if (listOptions.length > 0)
			{
				var firstOpt = listOptions[0];
				select.value = (firstOpt != null && typeof firstOpt === 'object') ?
					String(firstOpt.value != null ? firstOpt.value : '') : String(firstOpt);
			}
			container.appendChild(select);

			var footer = document.createElement('div');
			footer.style.textAlign = 'right';
			footer.style.whiteSpace = 'nowrap';
			footer.style.marginTop = '4px';
			var cancelBtn = mxUtils.button(mxResources.get('cancel'), function()
			{
				ui.hideDialog();
				resolve({cancelled: true});
			});
			cancelBtn.className = 'geBtn';
			var okBtn = mxUtils.button(mxResources.get('ok'), function()
			{
				var schema = String(select.value || '').trim();
				if (!schema.length)
				{
					showError('Не выбрана группа стенсилов');
					return;
				}
				ui.hideDialog();
				resolve({cancelled: false, stencilSchema: schema});
			});
			okBtn.className = 'geBtn gePrimaryBtn';
			footer.appendChild(okBtn);
			footer.appendChild(cancelBtn);
			container.appendChild(footer);

			ui.showDialog(container, dialogWidth, dialogHeight, true, true, null, true);
		});
	}

	function loadPluginRootScriptOnce(pluginFileName, loadedFlagKey)
	{
		return new Promise(async function(resolve, reject)
		{
			if (state[loadedFlagKey] === true)
			{
				resolve();
				return;
			}
			try
			{
				var pluginFile = await requestAsync({
					action: 'getPluginFile',
					plugin: pluginFileName
				});
				if (pluginFile == null || String(pluginFile).trim().length === 0)
				{
					reject(new Error('plugin file not found: ' + pluginFileName));
					return;
				}
				var cacheBuster = '';
				try
				{
					var stat = await requestAsync({
						action: 'fileStat',
						file: pluginFile
					});
					if (stat != null && Number.isFinite(stat.mtimeMs))
					{
						cacheBuster = '?v=' + Math.round(stat.mtimeMs);
					}
				}
				catch (eStat)
				{
					// ignore stat errors
				}
				var url = 'file://' + pluginFile + cacheBuster;
				var scriptEl = document.createElement('script');
				scriptEl.setAttribute('data-seaf-plugin', pluginFileName);
				scriptEl.type = 'text/javascript';
				scriptEl.src = url;
				scriptEl.onload = function()
				{
					state[loadedFlagKey] = true;
					resolve();
				};
				scriptEl.onerror = function()
				{
					reject(new Error('failed to load script: ' + pluginFileName + ' (' + url + ')'));
				};
				document.head.appendChild(scriptEl);
			}
			catch (e)
			{
				reject(e);
			}
		});
	}

	async function ensureBulkEditDataModuleLoaded()
	{
		if (typeof window.Tabulator !== 'function')
		{
			throw new Error('Tabulator is not provided by draw.io host; update the desktop application');
		}
		if (window.SeafBulkEditData != null && typeof window.SeafBulkEditData.openBulkEditDataDialog === 'function')
		{
			return;
		}
		await loadPluginRootScriptOnce('seaf-bulk-edit-data-module.js', 'bulkEditDataModuleLoaded');
	}

	function getBulkEditDataDeps()
	{
		return {
			ui: ui,
			mxUtils: mxUtils,
			mxResources: mxResources,
			getDataLockForSchema: getDataLockForSchema,
			getDataHiddenForSchema: getDataHiddenForSchema,
			getEditDataModeForSchema: getEditDataModeForSchema,
			getSeafEditDataLockTooltip: getSeafEditDataLockTooltip,
			showError: showError
		};
	}

	async function openBulkEditDataDialogForSchema(schema, layerLabel, schemaObjects)
	{
		await ensureBulkEditDataModuleLoaded();
		if (window.SeafBulkEditData == null || typeof window.SeafBulkEditData.openBulkEditDataDialog !== 'function')
		{
			throw new Error('SeafBulkEditData module is not available (Tabulator=' +
				(typeof window.Tabulator) + ')');
		}
		return window.SeafBulkEditData.openBulkEditDataDialog(getBulkEditDataDeps(), {
			schema: schema,
			layerLabel: layerLabel,
			schemaObjects: schemaObjects
		});
	}

	async function runEditDataApplyCommand(schema, editedRows, schemaObjects)
	{
		var applyCommand = state.commandsById.seafToolsEditDataApply;
		if (applyCommand == null)
		{
			showError('Команда seafToolsEditDataApply не найдена в конфигурации');
			return {status: 'error'};
		}
		var payload = buildPayload(applyCommand);
		if (Array.isArray(schemaObjects))
		{
			payload.schemaObjects = schemaObjects;
		}
		payload.source = 'menu';
		payload.arguments = payload.arguments || {};
		payload.arguments.stencilSchema = schema;
		payload.arguments.editedRows = JSON.stringify(editedRows);
		await writeLog('info', 'Edit Data apply started', {
			commandId: applyCommand.id,
			schema: schema,
			rowsCount: Array.isArray(editedRows) ? editedRows.length : 0
		});
		var response = await requestAsync({
			action: 'runSeafPluginCommand',
			configPath: state.configPath,
			commandId: applyCommand.id,
			payload: payload
		});
		var result = response.result || {};
		var uiResults = executeInteractiveCommands(result);
		if (result.status === 'error')
		{
			if (!resultHasErrorShowMessage(result) &&
				typeof result.message === 'string' && result.message.trim().length > 0)
			{
				showError(formatCommandError(applyCommand.id, result.message));
			}
			return result;
		}
		if (typeof result.message === 'string' && result.message.trim().length > 0)
		{
			showInfo(result.message);
		}
		await writeLog('info', 'Edit Data apply finished', {
			commandId: applyCommand.id,
			schema: schema,
			status: result.status,
			uiCommandResults: uiResults || []
		});
		return result;
	}

	async function executeBulkEditDataCommand(command, source)
	{
		var pickerOverrides = await collectStencilSchemaPickerOverrides(command);
		if (pickerOverrides == null)
		{
			return;
		}
		var schema = String(pickerOverrides.stencilSchema || '').trim();
		var layerLabel = String(pickerOverrides.stencilSchemaLayer || schema);
		if (!schema)
		{
			return;
		}
		var editMode = getEditDataModeForSchema(schema);
		if (editMode === 'standard')
		{
			await writeLog('warn', 'Bulk Edit Data denied by schema policy', {
				commandId: command.id,
				schema: schema,
				layer: layerLabel,
				editMode: editMode
			});
			showError('Для schema "' + schema + '" bulk Edit Data недоступен (edit_data: standard)');
			return;
		}
		var matched = collectSchemaObjectsAcrossPages(schema);
		if (matched.length === 0)
		{
			showInfo('На диаграмме нет объектов для "' + layerLabel + '"');
			return;
		}
		var dialogResult = null;
		try
		{
			dialogResult = await openBulkEditDataDialogForSchema(schema, layerLabel, matched);
		}
		catch (e)
		{
			await writeLog('error', 'Bulk Edit Data dialog failed', {
				commandId: command.id,
				schema: schema,
				error: e.message
			});
			showError(formatCommandError(command.id, e.message));
			return;
		}
		if (dialogResult == null || dialogResult.cancelled === true || dialogResult.save !== true)
		{
			return;
		}
		var editedRows = Array.isArray(dialogResult.editedRows) ? dialogResult.editedRows : [];
		if (editedRows.length === 0)
		{
			showInfo('Нет изменений для сохранения');
			return;
		}
		try
		{
			await runEditDataApplyCommand(schema, editedRows, matched);
		}
		catch (eApply)
		{
			await writeLog('error', 'Edit Data apply invocation failed', {
				commandId: command.id,
				schema: schema,
				error: eApply.message
			});
			showError(formatCommandError(command.id, eApply.message));
		}
	}

	async function collectStencilSchemaPickerOverrides(command)
	{
		await loadStencilsLayerConfig();
		var cfg = state.stencilsLayerConfig;
		var schemas = (cfg != null && cfg.schemas != null && typeof cfg.schemas === 'object' &&
			!Array.isArray(cfg.schemas)) ? cfg.schemas : {};
		var schemaKeys = Object.keys(schemas);
		if (schemaKeys.length === 0)
		{
			showError('Не найдены группы стенсилов в stencils/config.yaml');
			return null;
		}

		schemaKeys.sort(function(a, b)
		{
			var layerA = (schemas[a] && schemas[a].layer) ? String(schemas[a].layer) : a;
			var layerB = (schemas[b] && schemas[b].layer) ? String(schemas[b].layer) : b;
			return layerA.localeCompare(layerB, undefined, {sensitivity: 'base'});
		});

		var listOptions = [];
		for (var i = 0; i < schemaKeys.length; i++)
		{
			var schemaKey = schemaKeys[i];
			var entry = schemas[schemaKey];
			var layerLabel = (entry != null && entry.layer != null) ? String(entry.layer) : schemaKey;
			listOptions.push({value: schemaKey, label: layerLabel});
		}

		var dialogResult = await openStencilSchemaPickerDialog({
			options: listOptions,
			defaultSchema: schemaKeys[0]
		});

		if (dialogResult == null || dialogResult.cancelled === true)
		{
			return null;
		}

		var selectedSchema = String(dialogResult.stencilSchema || '').trim();
		if (!selectedSchema || schemas[selectedSchema] == null)
		{
			showError('Не выбрана группа стенсилов');
			return null;
		}

		var selectedEntry = schemas[selectedSchema];
		var selectedLayer = (selectedEntry.layer != null) ? String(selectedEntry.layer) : selectedSchema;
		var clonedConfig = mxUtils.clone(selectedEntry);
		state.editDataSelection = {
			schema: selectedSchema,
			layer: selectedLayer,
			config: clonedConfig
		};

		var logLevel = resolvePluginLogLevelForDebug();
		if (logLevel === 'debug' || logLevel === 'trace')
		{
			await writeLog('debug', 'Stencil schema group selected', {
				commandId: command && command.id ? command.id : '',
				schema: selectedSchema,
				layer: selectedLayer,
				config: clonedConfig
			});
		}

		return {
			stencilSchema: selectedSchema,
			stencilSchemaLayer: selectedLayer,
			stencilSchemaConfig: JSON.stringify(clonedConfig)
		};
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
		var createRow = function(labelText, field)
		{
			var row = document.createElement('div');
			row.style.marginBottom = '10px';
			var labelWrap = document.createElement('div');
			labelWrap.style.display = 'inline-flex';
			labelWrap.style.alignItems = 'center';
			labelWrap.style.gap = '4px';
			labelWrap.style.marginBottom = '4px';
			var label = document.createElement('div');
			label.style.fontWeight = 'bold';
			label.textContent = labelText;
			labelWrap.appendChild(label);
			appendFieldHelpIcon(labelWrap, field);
			row.appendChild(labelWrap);
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

			var row = createRow(field.label || field.envKey, field);
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

	function findPageById(pageId)
	{
		var targetId = (typeof pageId === 'string') ? pageId.trim() : '';
		if (!targetId || !Array.isArray(ui.pages))
		{
			return null;
		}
		for (var i = 0; i < ui.pages.length; i++)
		{
			var page = ui.pages[i];
			if (page && typeof page.getId === 'function' && page.getId() === targetId)
			{
				return page;
			}
		}
		return null;
	}

	function parseLinkedPageIdFromCell(graph, cell)
	{
		if (!graph || !cell || typeof graph.getLinkForCell !== 'function')
		{
			return '';
		}
		var href = graph.getLinkForCell(cell);
		if (typeof href !== 'string')
		{
			return '';
		}
		var match = href.match(/^data:page\/id,([^#,]+)/i);
		return match ? String(match[1]).trim() : '';
	}

	function findPageByName(pageName)
	{
		var targetName = (typeof pageName === 'string') ? pageName.trim() : '';
		if (!targetName || !Array.isArray(ui.pages))
		{
			return null;
		}
		for (var i = 0; i < ui.pages.length; i++)
		{
			var page = ui.pages[i];
			var name = (page && typeof page.getName === 'function') ? String(page.getName() || '').trim() : '';
			if (name === targetName)
			{
				return page;
			}
		}
		return null;
	}

	function resolveCellForUpdate(graph, objectId)
	{
		if (!graph || !graph.model || typeof objectId !== 'string' || objectId.trim().length === 0)
		{
			return null;
		}
		return graph.model.getCell(objectId.trim());
	}

	function resolveCellsByObjectIds(graph, objectIds)
	{
		if (!graph || !Array.isArray(objectIds))
		{
			return [];
		}
		var out = [];
		for (var i = 0; i < objectIds.length; i++)
		{
			var objectId = String(objectIds[i] || '').trim();
			if (!objectId)
			{
				continue;
			}
			var cell = resolveCellForUpdate(graph, objectId);
			if (cell != null)
			{
				out.push(cell);
			}
		}
		return out;
	}

	function resolveMoveTargetCell(cell, graph)
	{
		if (!cell || !graph || !graph.model)
		{
			return cell || null;
		}
		var model = graph.model;
		var root = (typeof model.getRoot === 'function') ? model.getRoot() : model.root;
		var current = cell;
		var guard = 0;
		while (current && guard < 128)
		{
			guard++;
			var parent = (typeof model.getParent === 'function') ? model.getParent(current) : current.parent;
			if (!parent || parent === root || (typeof model.isLayer === 'function' && model.isLayer(parent)))
			{
				return current;
			}
			current = parent;
		}
		return cell;
	}

	function isGroupStyleText(styleText)
	{
		var style = String(styleText || '').trim();
		if (!style)
		{
			return false;
		}
		if (style === 'group')
		{
			return true;
		}
		if (/(^|;)group(;|$)/i.test(style))
		{
			return true;
		}
		if (/(^|;)shape=group(;|$)/i.test(style))
		{
			return true;
		}
		return false;
	}

	function resolveGroupRootCell(cell, graph)
	{
		if (!cell || !graph || !graph.model)
		{
			return cell || null;
		}
		var model = graph.model;
		var root = (typeof model.getRoot === 'function') ? model.getRoot() : model.root;
		var current = cell;
		var groupRoot = null;
		var guard = 0;
		while (current && guard < 256)
		{
			guard++;
			if (isGroupStyleText(current.style))
			{
				groupRoot = current;
			}
			var parent = (typeof model.getParent === 'function') ? model.getParent(current) : current.parent;
			if (!parent || parent === root || (typeof model.isLayer === 'function' && model.isLayer(parent)))
			{
				break;
			}
			current = parent;
		}
		if (groupRoot)
		{
			return groupRoot;
		}
		return resolveMoveTargetCell(cell, graph);
	}

	function resolveMoveTargetsByObjectIds(graph, objectIds, targetMode)
	{
		if (!graph || !Array.isArray(objectIds))
		{
			return [];
		}
		var mode = (typeof targetMode === 'string') ? targetMode.trim().toLowerCase() : '';
		var useSchemaCell = (mode === 'schemacell');
		var useGroupRoot = (mode === 'grouproot' || mode === 'schemagrouproot');
		var out = [];
		var seen = {};
		for (var i = 0; i < objectIds.length; i++)
		{
			var objectId = String(objectIds[i] || '').trim();
			if (!objectId)
			{
				continue;
			}
			var cell = resolveCellForUpdate(graph, objectId);
			if (!cell)
			{
				continue;
			}
			var target = null;
			if (useSchemaCell)
			{
				target = cell;
			}
			else if (useGroupRoot)
			{
				target = resolveGroupRootCell(cell, graph);
			}
			else
			{
				target = resolveMoveTargetCell(cell, graph);
			}
			if (!target || !target.id || Object.prototype.hasOwnProperty.call(seen, target.id))
			{
				continue;
			}
			seen[target.id] = true;
			out.push(target);
		}
		return out;
	}

	function applyDataUpdateToCell(graph, cell, patchData, mode, useTransaction)
	{
		if (!graph || !graph.model || !cell || patchData == null || typeof patchData !== 'object' || Array.isArray(patchData))
		{
			return false;
		}
		var currentData = extractEditableDataFromCell(cell, graph);
		var nextData = (mode === 'replace') ? Object.assign({}, patchData) : Object.assign({}, currentData, patchData);
		var currentValue = (cell.value != null && typeof cell.value === 'object') ? cell.value : null;
		var clonedValue = null;
		if (currentValue != null && typeof currentValue.cloneNode === 'function')
		{
			clonedValue = currentValue.cloneNode(true);
		}
		else
		{
			var doc = mxUtils.createXmlDocument();
			clonedValue = doc.createElement('object');
			clonedValue.setAttribute('label', graph.convertValueToString(cell) || '');
		}

		var attrsToDelete = [];
		if (mode === 'replace' && clonedValue.attributes)
		{
			for (var i = 0; i < clonedValue.attributes.length; i++)
			{
				var attrName = clonedValue.attributes[i] && clonedValue.attributes[i].nodeName ?
					String(clonedValue.attributes[i].nodeName) : '';
				if (!attrName || attrName === 'label' || attrName === 'schema' || attrName === 'placeholders')
				{
					continue;
				}
				attrsToDelete.push(attrName);
			}
		}
		for (var d = 0; d < attrsToDelete.length; d++)
		{
			clonedValue.removeAttribute(attrsToDelete[d]);
		}

		for (var key in nextData)
		{
			if (!Object.prototype.hasOwnProperty.call(nextData, key) || key === 'placeholders')
			{
				continue;
			}
			var val = nextData[key];
			if (val == null)
			{
				clonedValue.removeAttribute(key);
			}
			else
			{
				clonedValue.setAttribute(key, String(val));
			}
		}

		var ownTx = useTransaction !== false;
		if (ownTx)
		{
			graph.getModel().beginUpdate();
		}
		try
		{
			graph.getModel().setValue(cell, clonedValue);
		}
		finally
		{
			if (ownTx)
			{
				graph.getModel().endUpdate();
			}
		}
		upsertCellInStencilIndex(cell, graph);
		return true;
	}

	function findLayerCellByNameDeep(graph, layerName)
	{
		if (!graph || !graph.model || typeof layerName !== 'string' || layerName.trim().length === 0)
		{
			return null;
		}
		var model = graph.model;
		var root = model.getRoot ? model.getRoot() : model.root;
		var wanted = layerName.trim();
		var stack = [];
		var i;
		for (i = 0; i < model.getChildCount(root); i++)
		{
			var top = model.getChildAt(root, i);
			if (top)
			{
				stack.push(top);
			}
		}
		var guard = 0;
		while (stack.length > 0 && guard < 5000)
		{
			guard++;
			var cell = stack.pop();
			if (!cell)
			{
				continue;
			}
			if (typeof model.isLayer === 'function' && model.isLayer(cell))
			{
				var nm = String(graph.convertValueToString(cell) || '').trim();
				if (nm === wanted)
				{
					return cell;
				}
			}
			var cc = model.getChildCount(cell);
			for (var j = 0; j < cc; j++)
			{
				var ch = model.getChildAt(cell, j);
				if (ch)
				{
					stack.push(ch);
				}
			}
		}
		return null;
	}

	function findLayerByName(graph, layerName)
	{
		return findLayerCellByNameDeep(graph, layerName);
	}

	function ensureLayer(graph, layerName, makeVisible)
	{
		if (!graph || !graph.model)
		{
			return null;
		}
		var model = graph.model;
		var normalizedName = String(layerName || '').trim();
		if (!normalizedName)
		{
			return null;
		}
		var layer = findLayerByName(graph, normalizedName);
		var status = 'existing';
		if (!layer)
		{
			status = 'created';
			var layerCell = new mxCell(normalizedName);
			layer = graph.addCell(layerCell, model.root);
		}

		if (makeVisible === true && layer)
		{
			model.beginUpdate();
			try
			{
				model.setVisible(layer, true);
			}
			finally
			{
				model.endUpdate();
			}
		}

		return {
			status: status,
			layerId: layer && typeof layer.getId === 'function' ? layer.getId() : (layer ? layer.id : null),
			layerName: normalizedName
		};
	}

	function cellMatchesCriteria(cell, graph, criteria)
	{
		var filter = (criteria && typeof criteria === 'object') ? criteria : {};
		var data = extractEditableDataFromCell(cell, graph);
		var schemaMeta = extractShapeSchema(cell, graph);
		var schema = schemaMeta && schemaMeta.schema ? String(schemaMeta.schema).trim() : '';
		if (filter.requireSchema === true)
		{
			var dataSchema = (data && data.schema != null) ? String(data.schema).trim() : '';
			if (schema.length === 0 && dataSchema.length === 0)
			{
				return false;
			}
		}
		if (typeof filter.schema === 'string' && filter.schema.trim().length > 0)
		{
			var schemaMatch = matchSchemaPattern(schema, filter.schema.trim());
			if (schemaMatch.matched !== true)
			{
				return false;
			}
		}
		var attrs = (filter.attributes && typeof filter.attributes === 'object' && !Array.isArray(filter.attributes)) ?
			filter.attributes : {};
		for (var key in attrs)
		{
			if (!Object.prototype.hasOwnProperty.call(attrs, key))
			{
				continue;
			}
			var expected = attrs[key];
			var actual = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
			if (expected == null)
			{
				if (actual != null && String(actual).length > 0)
				{
					return false;
				}
			}
			else if (String(actual || '') !== String(expected))
			{
				return false;
			}
		}
		return true;
	}

	function getCellsByCriteria(graph, criteria, rootOverride)
	{
		if (!graph || !graph.model)
		{
			return [];
		}
		var model = graph.model;
		var root = (rootOverride != null) ? rootOverride :
			(model.getRoot ? model.getRoot() : model.root);
		var cells = [];
		if (typeof model.filterDescendants === 'function')
		{
			cells = model.filterDescendants(function(cell)
			{
				if (!(model.isVertex(cell) || model.isEdge(cell)))
				{
					return false;
				}
				return cellMatchesCriteria(cell, graph, criteria);
			}, root) || [];
		}
		return cells;
	}

	function syncCurrentPageRootFromGraph(graph)
	{
		if (!graph || !graph.model || !ui || !ui.currentPage)
		{
			return;
		}
		try
		{
			ui.currentPage.root = graph.model.getRoot ? graph.model.getRoot() : graph.model.root;
		}
		catch (eSync)
		{
			// ignore sync errors
		}
	}

	function ensurePageRoot(page)
	{
		if (!page || !ui)
		{
			return page;
		}
		if (page.root == null && typeof ui.updatePageRoot === 'function')
		{
			ui.updatePageRoot(page);
		}
		return page;
	}

	function setGraphModelRoot(graph, root)
	{
		if (!graph || !graph.model || root == null)
		{
			return;
		}
		var model = graph.model;
		if (typeof model.setRoot === 'function')
		{
			model.setRoot(root);
		}
		else if (typeof model.rootChanged === 'function')
		{
			model.rootChanged(root);
		}
	}

	function getCellsByCriteriaForPage(graph, page, criteria)
	{
		if (!graph || !graph.model || !page)
		{
			return [];
		}
		ensurePageRoot(page);
		if (page.root == null)
		{
			return [];
		}
		var model = graph.model;
		var previousRoot = model.getRoot ? model.getRoot() : model.root;
		var switched = previousRoot !== page.root;
		if (switched)
		{
			setGraphModelRoot(graph, page.root);
		}
		try
		{
			return getCellsByCriteria(graph, criteria, page.root);
		}
		finally
		{
			if (switched && previousRoot != null)
			{
				setGraphModelRoot(graph, previousRoot);
			}
		}
	}

	function collectCellsByCriteriaAcrossPages(criteria)
	{
		var graph = ui && ui.editor ? ui.editor.graph : null;
		if (!graph || !ui || !Array.isArray(ui.pages))
		{
			return [];
		}
		syncCurrentPageRootFromGraph(graph);
		var out = [];
		var originalPage = ui.currentPage || null;
		for (var i = 0; i < ui.pages.length; i++)
		{
			var page = ui.pages[i];
			if (page == null)
			{
				continue;
			}
			try
			{
				var cells = getCellsByCriteriaForPage(graph, page, criteria);
				var pageId = (typeof page.getId === 'function') ? page.getId() : page.id;
				var pageName = (typeof page.getName === 'function') ? page.getName() : page.name;
				for (var j = 0; j < cells.length; j++)
				{
					if (!cells[j] || !cells[j].id)
					{
						continue;
					}
					out.push({
						pageId: pageId || null,
						pageName: pageName || '',
						cell: cells[j]
					});
				}
			}
			catch (e)
			{
				// ignore page-level lookup errors and continue scanning remaining pages
			}
		}
		try
		{
			if (originalPage != null && typeof ui.selectPage === 'function')
			{
				ui.selectPage(originalPage);
			}
			else if (originalPage != null)
			{
				ensurePageRoot(originalPage);
				setGraphModelRoot(graph, originalPage.root);
			}
		}
		catch (eRestore)
		{
			// ignore restore errors
		}
		return out;
	}

	function collectSchemaObjectsAcrossPages(schemaFilter)
	{
		var graph = ui && ui.editor ? ui.editor.graph : null;
		if (!graph || !ui || !Array.isArray(ui.pages))
		{
			return [];
		}
		syncCurrentPageRootFromGraph(graph);
		var criteria = { requireSchema: true };
		if (typeof schemaFilter === 'string' && schemaFilter.trim().length > 0)
		{
			criteria.schema = schemaFilter.trim();
		}
		var out = [];
		var originalPage = ui.currentPage || null;
		var originalSelection = [];
		try
		{
			originalSelection = (typeof graph.getSelectionCells === 'function') ? (graph.getSelectionCells() || []) : [];
		}
		catch (eSel)
		{
			originalSelection = [];
		}

		for (var i = 0; i < ui.pages.length; i++)
		{
			var page = ui.pages[i];
			if (page == null)
			{
				continue;
			}
			try
			{
				var cells = getCellsByCriteriaForPage(graph, page, criteria);
				var pageId = (typeof page.getId === 'function') ? page.getId() : page.id;
				var pageName = (typeof page.getName === 'function') ? page.getName() : page.name;
				for (var j = 0; j < cells.length; j++)
				{
					var cell = cells[j];
					if (!cell || !cell.id)
					{
						continue;
					}
					var entry = buildIndexEntryFromCell(cell, graph);
					if (entry == null || !entry.schema || String(entry.schema).trim().length === 0)
					{
						continue;
					}
					var linkedPageId = parseLinkedPageIdFromCell(graph, cell);
					out.push({
						pageId: pageId || null,
						pageName: pageName || '',
						objectId: entry.objectId,
						schema: entry.schema,
						oid: entry.oid || '',
						data: entry.data || {},
						linkedPageId: linkedPageId || ''
					});
				}
			}
			catch (ePage)
			{
				// ignore page-level errors and continue
			}
		}

		try
		{
			if (originalPage != null && typeof ui.selectPage === 'function')
			{
				ui.selectPage(originalPage);
			}
			else if (originalPage != null)
			{
				ensurePageRoot(originalPage);
				setGraphModelRoot(graph, originalPage.root);
			}
			if (typeof graph.setSelectionCells === 'function')
			{
				graph.setSelectionCells(originalSelection);
			}
		}
		catch (eRestore)
		{
			// ignore restore errors
		}

		return out;
	}

	function detectOidConflicts(cells, graph, patchData)
	{
		var conflicts = [];
		if (!patchData || typeof patchData !== 'object')
		{
			return conflicts;
		}
		if (!Object.prototype.hasOwnProperty.call(patchData, 'OID'))
		{
			return conflicts;
		}
		var targetOid = String(patchData.OID || '').trim();
		if (!targetOid)
		{
			return conflicts;
		}
		var existing = state.stencilIndex.byOid[targetOid] || {};
		for (var i = 0; i < cells.length; i++)
		{
			var cell = cells[i];
			if (!cell || !cell.id)
			{
				continue;
			}
			for (var objectId in existing)
			{
				if (!Object.prototype.hasOwnProperty.call(existing, objectId) || objectId === cell.id)
				{
					continue;
				}
				var conflictCell = resolveCellForUpdate(graph, objectId);
				var conflictSchema = conflictCell ? extractShapeSchema(conflictCell, graph).schema : '';
				conflicts.push({
					cellId: cell.id,
					OID: targetOid,
					schema: extractShapeSchema(cell, graph).schema,
					conflictWithCellId: objectId,
					conflictWithSchema: conflictSchema
				});
			}
		}
		return conflicts;
	}

	function oidSchemaCode(schema)
	{
		var raw = (typeof schema === 'string') ? schema.trim() : '';
		if (raw.length === 0)
		{
			return 'unknown';
		}
		var parts = raw.split('.');
		var clean = [];
		for (var i = 0; i < parts.length; i++)
		{
			var p = String(parts[i] || '').trim();
			if (p.length > 0)
			{
				clean.push(p);
			}
		}
		if (clean.length < 2)
		{
			return 'unknown';
		}
		return clean[clean.length - 2] + '.' + clean[clean.length - 1];
	}

	function extractOidSequence(oidValue, expectedPrefix)
	{
		var text = String(oidValue || '').trim();
		if (!text || !expectedPrefix || text.indexOf(expectedPrefix) !== 0)
		{
			return -1;
		}
		var suffix = text.slice(expectedPrefix.length);
		if (!/^\d+$/.test(suffix))
		{
			return -1;
		}
		var n = Number(suffix);
		return Number.isFinite(n) ? n : -1;
	}

	function nextOidValue(companyPrefix, schema, knownOids, reservedOids)
	{
		var base = String(companyPrefix || 'company').trim() + '.' + oidSchemaCode(schema) + '.';
		var maxSeq = 0;
		for (var existingOid in knownOids)
		{
			if (!Object.prototype.hasOwnProperty.call(knownOids, existingOid))
			{
				continue;
			}
			var seq = extractOidSequence(existingOid, base);
			if (seq > maxSeq)
			{
				maxSeq = seq;
			}
		}
		var nextSeq = maxSeq + 1;
		while (true)
		{
			var candidate = base + String(nextSeq);
			if (!Object.prototype.hasOwnProperty.call(knownOids, candidate) &&
				!Object.prototype.hasOwnProperty.call(reservedOids, candidate))
			{
				reservedOids[candidate] = true;
				return candidate;
			}
			nextSeq += 1;
		}
	}

	function collectEmptyOidItemsOnPage(graph)
	{
		if (!graph || !graph.model)
		{
			return [];
		}
		var model = graph.model;
		var root = model.getRoot ? model.getRoot() : model.root;
		var out = [];
		var cells = [];
		if (typeof model.filterDescendants === 'function')
		{
			cells = model.filterDescendants(function(cell)
			{
				return model.isVertex(cell) || model.isEdge(cell);
			}, root) || [];
		}
		for (var i = 0; i < cells.length; i++)
		{
			var cell = cells[i];
			if (!cell || !cell.id)
			{
				continue;
			}
			var data = extractEditableDataFromCell(cell, graph);
			if (!Object.prototype.hasOwnProperty.call(data, 'OID'))
			{
				continue;
			}
			var oidValue = String(data.OID || '').trim();
			if (oidValue.length > 0)
			{
				continue;
			}
			var schemaMeta = extractShapeSchema(cell, graph);
			out.push({
				objectId: cell.id,
				schema: (schemaMeta && typeof schemaMeta.schema === 'string') ? schemaMeta.schema.trim() : ''
			});
		}
		return out;
	}

	function buildOidBackfillUpdates(items, companyPrefix)
	{
		var knownOids = {};
		var reservedOids = {};
		var byOid = state && state.stencilIndex ? state.stencilIndex.byOid : {};
		for (var oid in byOid)
		{
			if (Object.prototype.hasOwnProperty.call(byOid, oid))
			{
				knownOids[oid] = true;
			}
		}
		var updates = [];
		for (var i = 0; i < items.length; i++)
		{
			var row = items[i];
			if (!row || !row.objectId)
			{
				continue;
			}
			var next = nextOidValue(companyPrefix, row.schema || '', knownOids, reservedOids);
			updates.push({
				objectId: row.objectId,
				mode: 'merge',
				data: {OID: next}
			});
		}
		return updates;
	}

	function normalizeParentSchemaList(raw)
	{
		var out = [];
		if (typeof raw === 'string')
		{
			var asString = raw.trim();
			if (asString.length > 0)
			{
				out.push(asString);
			}
			return out;
		}
		if (!Array.isArray(raw))
		{
			return out;
		}
		for (var i = 0; i < raw.length; i++)
		{
			var value = String(raw[i] || '').trim();
			if (value.length > 0 && out.indexOf(value) < 0)
			{
				out.push(value);
			}
		}
		return out;
	}

	function buildParentRulesFromStencilConfig()
	{
		var out = {};
		var cfg = state && state.stencilsLayerConfig ? state.stencilsLayerConfig : null;
		var schemas = (cfg && cfg.schemas && typeof cfg.schemas === 'object') ? cfg.schemas : {};
		for (var schema in schemas)
		{
			if (!Object.prototype.hasOwnProperty.call(schemas, schema))
			{
				continue;
			}
			var entry = schemas[schema];
			if (!entry || typeof entry !== 'object' || Array.isArray(entry))
			{
				continue;
			}
			var parent = entry.parent;
			if (!parent || typeof parent !== 'object' || Array.isArray(parent))
			{
				continue;
			}
			var parentSchemas = normalizeParentSchemaList(parent.schema);
			var parentField = (typeof parent.field === 'string') ? parent.field.trim() : '';
			if (parentSchemas.length < 1 || parentField.length < 1)
			{
				continue;
			}
			out[String(schema || '').trim()] = {
				schemas: parentSchemas,
				field: parentField
			};
		}
		return out;
	}

	function collectStencilItemsOnCurrentPage(graph)
	{
		if (!graph || !graph.model)
		{
			return [];
		}
		var model = graph.model;
		var root = (typeof model.getRoot === 'function') ? model.getRoot() : model.root;
		var out = [];
		var seen = {};
		var cells = [];
		if (typeof model.filterDescendants === 'function')
		{
			cells = model.filterDescendants(function(cell)
			{
				return model.isVertex(cell) || model.isEdge(cell);
			}, root) || [];
		}
		for (var i = 0; i < cells.length; i++)
		{
			var cell = cells[i];
			if (!cell || !cell.id || Object.prototype.hasOwnProperty.call(seen, cell.id))
			{
				continue;
			}
			seen[cell.id] = true;
			var data = extractEditableDataFromCell(cell, graph);
			var schemaMeta = extractShapeSchema(cell, graph);
			var schema = (schemaMeta && typeof schemaMeta.schema === 'string') ? schemaMeta.schema.trim() : '';
			var oid = String(data && data.OID ? data.OID : '').trim();
			out.push({
				objectId: String(cell.id),
				schema: schema,
				oid: oid,
				data: data
			});
		}
		return out;
	}

	function buildParentLinkUpdatesForItems(items, parentRules)
	{
		var updates = [];
		var collisions = [];
		var missing = [];
		var skippedNoRule = [];
		if (!Array.isArray(items))
		{
			return {
				updates: updates,
				collisions: collisions,
				missing: missing,
				skippedNoRule: skippedNoRule
			};
		}
		for (var i = 0; i < items.length; i++)
		{
			var child = items[i] || {};
			var childId = String(child.objectId || '').trim();
			var childSchema = String(child.schema || '').trim();
			if (!childId)
			{
				continue;
			}
			var rule = (parentRules && typeof parentRules === 'object') ? parentRules[childSchema] : null;
			if (!childSchema || !rule || typeof rule !== 'object')
			{
				skippedNoRule.push({objectId: childId, schema: childSchema});
				continue;
			}
			var parentSchemas = Array.isArray(rule.schemas) ? rule.schemas.slice() : [];
			var parentField = (typeof rule.field === 'string') ? rule.field.trim() : '';
			if (parentSchemas.length < 1 || parentField.length < 1)
			{
				skippedNoRule.push({objectId: childId, schema: childSchema});
				continue;
			}
			var candidates = [];
			for (var c = 0; c < items.length; c++)
			{
				var candidate = items[c] || {};
				var candidateId = String(candidate.objectId || '').trim();
				if (!candidateId || candidateId === childId)
				{
					continue;
				}
				var candidateSchema = String(candidate.schema || '').trim();
				var candidateOid = String(candidate.oid || '').trim();
				if (parentSchemas.indexOf(candidateSchema) < 0 || candidateOid.length < 1)
				{
					continue;
				}
				candidates.push({
					objectId: candidateId,
					schema: candidateSchema,
					oid: candidateOid
				});
			}
			if (candidates.length === 1)
			{
				updates.push({
					objectId: childId,
					mode: 'merge',
					data: (function()
					{
						var data = {};
						data[parentField] = candidates[0].oid;
						return data;
					})()
				});
				continue;
			}
			if (candidates.length === 0)
			{
				missing.push({
					objectId: childId,
					schema: childSchema,
					expectedParentSchemas: parentSchemas,
					field: parentField
				});
				continue;
			}
			collisions.push({
				objectId: childId,
				schema: childSchema,
				expectedParentSchemas: parentSchemas,
				field: parentField,
				candidateParentObjectIds: candidates.map(function(x){ return x.objectId; }),
				candidateParentSchemas: candidates.map(function(x){ return x.schema; }),
				candidateParentOids: candidates.map(function(x){ return x.oid; })
			});
		}
		return {
			updates: updates,
			collisions: collisions,
			missing: missing,
			skippedNoRule: skippedNoRule
		};
	}

	function performMoveLayerUnderLayer(graph, childLayerName, parentLayerName, makeVisible)
	{
		if (!graph || !graph.model)
		{
			return {status: 'error', reason: 'no_graph'};
		}
		var model = graph.model;
		var root = model.getRoot ? model.getRoot() : model.root;
		var childName = String(childLayerName || '').trim();
		var parentName = String(parentLayerName || '').trim();
		if (!childName || !parentName || childName === parentName)
		{
			return {status: 'skipped', reason: 'invalid_layer_names', childLayerName: childName, parentLayerName: parentName};
		}
		ensureLayer(graph, parentName, makeVisible !== false);
		ensureLayer(graph, childName, makeVisible !== false);
		var parentCell = findLayerCellByNameDeep(graph, parentName);
		var childCell = findLayerCellByNameDeep(graph, childName);
		if (!parentCell || !childCell)
		{
			return {
				status: 'error',
				reason: 'layer_cell_not_found',
				parentLayerName: parentName,
				childLayerName: childName,
				parentFound: !!parentCell,
				childFound: !!childCell
			};
		}
		if (model.getParent(childCell) === parentCell)
		{
			return {
				status: 'noop',
				reason: 'already_under_parent',
				parentLayerId: parentCell.id,
				childLayerId: childCell.id,
				parentLayerName: parentName,
				childLayerName: childName
			};
		}
		var walk = parentCell;
		var guard = 0;
		while (walk && guard < 256)
		{
			guard++;
			if (walk === childCell)
			{
				return {status: 'skipped', reason: 'would_create_cycle', parentLayerName: parentName, childLayerName: childName};
			}
			walk = model.getParent(walk);
			if (!walk || walk === root)
			{
				break;
			}
		}
		model.beginUpdate();
		try
		{
			model.add(parentCell, childCell, model.getChildCount(parentCell));
		}
		finally
		{
			model.endUpdate();
		}
		graph.refresh();
		return {
			status: 'moved',
			parentLayerId: parentCell.id,
			childLayerId: childCell.id,
			parentLayerName: parentName,
			childLayerName: childName
		};
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
		},
		createPage: function(args)
		{
			if (!args || typeof args !== 'object')
			{
				return null;
			}
			var title = (typeof args.title === 'string') ? args.title.trim() : '';
			if (!title)
			{
				return {status: 'skipped', reason: 'title_missing'};
			}
			var existing = findPageByName(title);
			if (existing != null)
			{
				return {
					status: 'existing',
					pageId: (typeof existing.getId === 'function') ? existing.getId() : null,
					pageName: (typeof existing.getName === 'function') ? existing.getName() : title
				};
			}
			if (typeof ui.createPage !== 'function' || typeof ui.insertPage !== 'function' || typeof ui.createPageId !== 'function')
			{
				return {status: 'error', reason: 'page_api_unavailable'};
			}
			var originalPage = ui.currentPage || null;
			var page = ui.createPage(title, ui.createPageId());
			page = ui.insertPage(page);
			if (args.selectCreated !== false && page != null && typeof ui.selectPage === 'function')
			{
				ui.selectPage(page);
			}
			else if (args.selectCreated === false && originalPage != null && typeof ui.selectPage === 'function')
			{
				// Some draw.io builds select inserted page implicitly inside insertPage().
				// Restore original page to keep subsequent commands bound to source object context.
				ui.selectPage(originalPage);
			}
			return {
				status: 'created',
				pageId: page && typeof page.getId === 'function' ? page.getId() : null,
				pageName: page && typeof page.getName === 'function' ? page.getName() : title
			};
		},
		setCellLinkToPage: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return null;
			}
			var objectId = (typeof args.objectId === 'string') ? args.objectId.trim() : '';
			var pageId = (typeof args.targetPageId === 'string') ? args.targetPageId.trim() : '';
			if (!objectId || !pageId)
			{
				return {status: 'skipped', reason: 'missing_target'};
			}
			var targetCell = resolveCellForUpdate(graph, objectId);
			if (targetCell == null)
			{
				return {status: 'skipped', reason: 'cell_not_found', objectId: objectId};
			}
			var href = 'data:page/id,' + pageId;
			graph.getModel().beginUpdate();
			try
			{
				graph.setLinkForCell(targetCell, href);
			}
			finally
			{
				graph.getModel().endUpdate();
			}
			graph.refresh();
			return {status: 'updated', objectId: objectId, pageId: pageId};
		},
		renameLinkedPage: function(args)
		{
			if (!args || typeof args !== 'object')
			{
				return {status: 'error', reason: 'invalid_args'};
			}
			var targetPageId = (typeof args.targetPageId === 'string') ? args.targetPageId.trim() : '';
			var title = (typeof args.title === 'string') ? args.title.trim() : '';
			var objectId = (typeof args.objectId === 'string') ? args.objectId.trim() : '';
			var confirmOnDuplicate = args.confirmOnDuplicate !== false;
			if (!targetPageId || !title)
			{
				return {status: 'skipped', reason: 'missing_target'};
			}
			var page = findPageById(targetPageId);
			if (page == null)
			{
				return {status: 'skipped', reason: 'page_not_found', targetPageId: targetPageId};
			}
			var currentName = (typeof page.getName === 'function') ? String(page.getName() || '').trim() : '';
			if (currentName === title)
			{
				if (objectId.length > 0)
				{
					return uiCommandHandlers.setCellLinkToPage({
						objectId: objectId,
						targetPageId: targetPageId
					});
				}
				return {status: 'noop', reason: 'already_named', pageId: targetPageId, pageName: title};
			}
			var duplicatePage = findPageByName(title);
			var duplicatePageId = (duplicatePage && typeof duplicatePage.getId === 'function') ?
				String(duplicatePage.getId() || '').trim() : '';
			if (duplicatePage != null && duplicatePageId.length > 0 && duplicatePageId !== targetPageId)
			{
				var cacheKey = targetPageId + '|' + title;
				var cache = (state.linkedPageRenameConfirmCache && typeof state.linkedPageRenameConfirmCache === 'object') ?
					state.linkedPageRenameConfirmCache : null;
				var cachedDecision = cache ? cache[cacheKey] : undefined;
				if (cachedDecision === false)
				{
					return {status: 'skipped', reason: 'duplicate_declined', targetPageId: targetPageId, title: title};
				}
				if (cachedDecision !== true)
				{
					var confirmText = 'Страница "' + title + '" уже существует. Переименовать связанную страницу?';
					var proceed = false;
					try
					{
						proceed = (typeof mxUtils !== 'undefined' && mxUtils != null && typeof mxUtils.confirm === 'function') ?
							mxUtils.confirm(confirmText) === true : false;
					}
					catch (confirmErr)
					{
						proceed = false;
					}
					if (cache == null)
					{
						cache = {};
						state.linkedPageRenameConfirmCache = cache;
					}
					cache[cacheKey] = proceed;
					if (!proceed)
					{
						return {status: 'skipped', reason: 'duplicate_declined', targetPageId: targetPageId, title: title};
					}
				}
			}
			try
			{
				if (typeof RenamePage !== 'undefined' && ui && ui.editor && ui.editor.graph && ui.editor.graph.model &&
					typeof ui.editor.graph.model.execute === 'function')
				{
					ui.editor.graph.model.execute(new RenamePage(ui, page, title));
				}
				else if (typeof page.setName === 'function')
				{
					page.setName(title);
					if (ui && ui.editor && ui.editor.graph && typeof ui.editor.graph.updatePlaceholders === 'function')
					{
						ui.editor.graph.updatePlaceholders();
					}
				}
				else
				{
					return {status: 'error', reason: 'rename_api_unavailable'};
				}
			}
			catch (renameErr)
			{
				return {
					status: 'error',
					reason: 'rename_failed',
					message: renameErr && renameErr.message ? renameErr.message : String(renameErr)
				};
			}
			if (objectId.length > 0)
			{
				var linkResult = uiCommandHandlers.setCellLinkToPage({
					objectId: objectId,
					targetPageId: targetPageId
				});
				if (linkResult && linkResult.status === 'updated')
				{
					return {
						status: 'renamed',
						pageId: targetPageId,
						pageName: title,
						objectId: objectId,
						linkStatus: linkResult.status
					};
				}
				return {
					status: 'renamed',
					pageId: targetPageId,
					pageName: title,
					objectId: objectId,
					linkStatus: linkResult && linkResult.status ? linkResult.status : 'link_skipped'
				};
			}
			return {status: 'renamed', pageId: targetPageId, pageName: title};
		},
		assignEmptyOidOnPage: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return {status: 'error', reason: 'invalid_args'};
			}
			var pageId = (typeof args.pageId === 'string') ? args.pageId.trim() : '';
			if (!pageId)
			{
				return {status: 'error', reason: 'page_id_missing'};
			}
			var targetPage = findPageById(pageId);
			if (targetPage == null)
			{
				return {status: 'error', reason: 'page_not_found', pageId: pageId};
			}
			var originalPage = ui.currentPage || null;
			var switchedPage = false;
			if (typeof ui.selectPage === 'function' && ui.currentPage !== targetPage)
			{
				ui.selectPage(targetPage);
				switchedPage = true;
			}
			try
			{
				var companyPrefix = (typeof args.companyPrefix === 'string' && args.companyPrefix.trim().length > 0) ?
					args.companyPrefix.trim() : 'company';
				var items = collectEmptyOidItemsOnPage(graph);
				if (items.length === 0)
				{
					return {status: 'noop', scanned: 0, updated: 0, pageId: pageId};
				}
				var updates = buildOidBackfillUpdates(items, companyPrefix);
				if (updates.length === 0)
				{
					return {status: 'noop', scanned: items.length, updated: 0, pageId: pageId};
				}
				var result = null;
				var cmdArgs = {pageId: pageId, updates: updates};
				if (args.suppressStencilEvents === true)
				{
					result = runWithStencilEventsSuppressed(function()
					{
						return uiCommandHandlers.updateStencilDataBulk(cmdArgs);
					});
				}
				else
				{
					result = uiCommandHandlers.updateStencilDataBulk(cmdArgs);
				}
				var updated = (result && Number.isFinite(result.updated)) ? result.updated : 0;
				var skipped = (result && Number.isFinite(result.skipped)) ? result.skipped : 0;
				return {
					status: 'updated',
					pageId: pageId,
					scanned: items.length,
					updated: updated,
					skipped: skipped,
					errors: (result && Array.isArray(result.errors)) ? result.errors : []
				};
			}
			finally
			{
				if (switchedPage && originalPage != null && ui.currentPage !== originalPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(originalPage);
				}
			}
		},
		autoLinkParentsOnPage: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return {status: 'error', reason: 'invalid_args'};
			}
			var pageId = (typeof args.pageId === 'string') ? args.pageId.trim() : '';
			if (!pageId)
			{
				return {status: 'error', reason: 'page_id_missing'};
			}
			var targetPage = findPageById(pageId);
			if (targetPage == null)
			{
				return {status: 'error', reason: 'page_not_found', pageId: pageId};
			}
			var originalPage = ui.currentPage || null;
			var switchedPage = false;
			if (typeof ui.selectPage === 'function' && ui.currentPage !== targetPage)
			{
				ui.selectPage(targetPage);
				switchedPage = true;
			}
			try
			{
				var items = collectStencilItemsOnCurrentPage(graph);
				var rules = buildParentRulesFromStencilConfig();
				var computed = buildParentLinkUpdatesForItems(items, rules);
				var updates = Array.isArray(computed.updates) ? computed.updates : [];
				if (updates.length < 1)
				{
					return {
						status: 'noop',
						pageId: pageId,
						updated: 0,
						collisionCount: computed.collisions.length,
						missingParentCount: computed.missing.length,
						skippedNoRuleCount: computed.skippedNoRule.length,
						collisions: computed.collisions,
						missingParents: computed.missing,
						skippedNoRule: computed.skippedNoRule
					};
				}
				var bulkArgs = {
					pageId: pageId,
					updates: updates
				};
				var applyResult = null;
				if (args.suppressStencilEvents === true)
				{
					applyResult = runWithStencilEventsSuppressed(function()
					{
						return uiCommandHandlers.updateStencilDataBulk(bulkArgs);
					});
				}
				else
				{
					applyResult = uiCommandHandlers.updateStencilDataBulk(bulkArgs);
				}
				var updated = (applyResult && Number.isFinite(applyResult.updated)) ? Number(applyResult.updated) : 0;
				var skipped = (applyResult && Number.isFinite(applyResult.skipped)) ? Number(applyResult.skipped) : 0;
				return {
					status: updated > 0 ? 'updated' : 'noop',
					pageId: pageId,
					updated: updated,
					skipped: skipped,
					collisionCount: computed.collisions.length,
					missingParentCount: computed.missing.length,
					skippedNoRuleCount: computed.skippedNoRule.length,
					collisions: computed.collisions,
					missingParents: computed.missing,
					skippedNoRule: computed.skippedNoRule,
					errors: (applyResult && Array.isArray(applyResult.errors)) ? applyResult.errors : []
				};
			}
			finally
			{
				if (switchedPage && originalPage != null && ui.currentPage !== originalPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(originalPage);
				}
			}
		},
		insertStencilFromP41ByTitle: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return {status: 'error', reason: 'invalid_args'};
			}
			var mirrorTitle = (typeof args.mirrorTitle === 'string') ? args.mirrorTitle.trim() : '';
			var pageId = (typeof args.pageId === 'string') ? args.pageId.trim() : '';
			if (!mirrorTitle)
			{
				return {status: 'error', reason: 'mirror_title_missing'};
			}
			if (!pageId)
			{
				return {status: 'error', reason: 'page_id_missing', mirrorTitle: mirrorTitle};
			}
			var targetPage = findPageById(pageId);
			if (targetPage == null)
			{
				return {status: 'error', reason: 'page_not_found', pageId: pageId, mirrorTitle: mirrorTitle};
			}
			if (typeof ui.selectPage === 'function' && ui.currentPage !== targetPage)
			{
				ui.selectPage(targetPage);
			}
			var item = findP41LibraryItemByTitle(mirrorTitle);
			if (item == null)
			{
				writeLog('error', 'Mirror stencil item not found in P41 library', {
					mirrorTitle: mirrorTitle,
					pageId: pageId,
					sourceObjectId: args.sourceObjectId || null,
					sourceSchema: args.sourceSchema || null
				});
				return {status: 'error', reason: 'mirror_not_found', mirrorTitle: mirrorTitle, pageId: pageId};
			}
			try
			{
				var rawXml = (typeof item.xml === 'string') ? item.xml : '';
				// Keep library payload exactly as Sidebar does:
				// item.xml may already contain valid mxGraph XML text; extra entity-decoding breaks attribute payload.
				var source = (rawXml.charAt(0) === '<') ? rawXml : Graph.decompress(rawXml);
				var cells = ui.stringToCells(source);
				var templateSchema = extractTemplateSchemaFromCells(cells);
				if (!Array.isArray(cells) || cells.length === 0)
				{
					writeLog('error', 'Mirror stencil insert failed: empty decoded cells', {
						mirrorTitle: mirrorTitle,
						pageId: pageId
					});
					return {status: 'error', reason: 'mirror_cells_empty', mirrorTitle: mirrorTitle, pageId: pageId};
				}
				var x = Number.isFinite(args.x) ? Number(args.x) : 20;
				var y = Number.isFinite(args.y) ? Number(args.y) : 20;
				var inserted = null;
				if (args.suppressStencilEvents === true)
				{
					inserted = runWithStencilEventsSuppressed(function()
					{
						return graph.importCells(cells, x, y, graph.getDefaultParent());
					});
				}
				else
				{
					inserted = graph.importCells(cells, x, y, graph.getDefaultParent());
				}
				if (!Array.isArray(inserted) || inserted.length === 0)
				{
					return {status: 'error', reason: 'insert_failed', mirrorTitle: mirrorTitle, pageId: pageId};
				}
				var sourceSchema = (typeof args.sourceSchema === 'string') ? args.sourceSchema.trim() : '';
				var primary = inserted[0];
				for (var i = 0; i < inserted.length; i++)
				{
					if (inserted[i] && inserted[i].id && (graph.model.isVertex(inserted[i]) || graph.model.isEdge(inserted[i])))
					{
						primary = inserted[i];
						break;
					}
				}
				var primarySchema = extractShapeSchema(primary, graph);
				if (sourceSchema.length > 0)
				{
					var prefer = null;
					var preferSchema = null;
					var seenPrefer = {};
					var qPrefer = inserted.slice();
					while (qPrefer.length > 0)
					{
						var cPrefer = qPrefer.shift();
						if (!cPrefer || !cPrefer.id || seenPrefer[cPrefer.id] === true)
						{
							continue;
						}
						seenPrefer[cPrefer.id] = true;
						var mPrefer = extractShapeSchema(cPrefer, graph);
						var sPrefer = (mPrefer && typeof mPrefer.schema === 'string') ? mPrefer.schema.trim() : '';
						if (sPrefer.length > 0 && sPrefer === sourceSchema)
						{
							prefer = cPrefer;
							preferSchema = mPrefer;
							break;
						}
						if (graph.model && typeof graph.model.getChildCount === 'function' && typeof graph.model.getChildAt === 'function')
						{
							var ccPrefer = graph.model.getChildCount(cPrefer);
							for (var cpi = 0; cpi < ccPrefer; cpi++)
							{
								qPrefer.push(graph.model.getChildAt(cPrefer, cpi));
							}
						}
					}
					if (prefer != null)
					{
						primary = prefer;
						primarySchema = preferSchema;
					}
					else
					{
						writeLog('error', 'Mirror primary with sourceSchema not found', {
							mirrorTitle: mirrorTitle,
							pageId: pageId,
							sourceObjectId: args.sourceObjectId || null,
							sourceSchema: sourceSchema
						});
						return {
							status: 'error',
							reason: 'mirror_not_found',
							mirrorTitle: mirrorTitle,
							pageId: pageId
						};
					}
				}
				if ((!primarySchema || typeof primarySchema.schema !== 'string' || primarySchema.schema.trim().length === 0) &&
					typeof templateSchema === 'string' && templateSchema.trim().length > 0)
				{
					primarySchema = {
						schema: templateSchema.trim(),
						styleText: primarySchema && typeof primarySchema.styleText === 'string' ? primarySchema.styleText : '',
						schemaSource: 'template.schema'
					};
				}
				graph.setSelectionCells(inserted);
				graph.refresh();
				writeLog('debug', 'Mirror stencil inserted', {
					mirrorTitle: mirrorTitle,
					pageId: pageId,
					objectId: primary && primary.id ? primary.id : null,
					schema: primarySchema || null
				});
				return {
					status: 'inserted',
					mirrorTitle: mirrorTitle,
					pageId: pageId,
					objectId: primary && primary.id ? primary.id : null,
					schema: primarySchema || null,
					insertedCount: inserted.length
				};
			}
			catch (e)
			{
				writeLog('error', 'Mirror stencil insert failed', {
					mirrorTitle: mirrorTitle,
					pageId: pageId,
					sourceObjectId: args.sourceObjectId || null,
					sourceSchema: args.sourceSchema || null,
					error: e && e.message ? e.message : String(e)
				});
				return {
					status: 'error',
					reason: 'insert_failed',
					mirrorTitle: mirrorTitle,
					pageId: pageId,
					error: e && e.message ? e.message : String(e)
				};
			}
		},
		ensureLayer: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return null;
			}
			var layerName = typeof args.layerName === 'string' ? args.layerName.trim() : '';
			if (!layerName)
			{
				return null;
			}
			var originalPage = ui.currentPage || null;
			var targetPage = findPageById(args.pageId);
			var switchedPage = false;
			try
			{
				if (targetPage != null && originalPage !== targetPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(targetPage);
					switchedPage = true;
				}
				var result = ensureLayer(graph, layerName, args.makeVisible !== false);
				if (result)
				{
					writeLog('info', 'ensureLayer completed', {
						pageId: args.pageId || null,
						layerName: result.layerName,
						layerId: result.layerId,
						status: result.status
					});
					graph.refresh();
				}
				return result;
			}
			finally
			{
				if (switchedPage && originalPage != null && ui.currentPage !== originalPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(originalPage);
				}
			}
		},
		moveLayerUnderLayer: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return null;
			}
			var childLayerName = typeof args.childLayerName === 'string' ? args.childLayerName.trim() : '';
			var parentLayerName = typeof args.parentLayerName === 'string' ? args.parentLayerName.trim() : '';
			if (!childLayerName || !parentLayerName)
			{
				return {status: 'skipped', reason: 'missing_layer_name', childLayerName: childLayerName, parentLayerName: parentLayerName};
			}
			var originalPage = ui.currentPage || null;
			var targetPage = findPageById(args.pageId);
			var switchedPage = false;
			try
			{
				if (targetPage != null && originalPage !== targetPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(targetPage);
					switchedPage = true;
				}
				var mkVis = args.makeVisible !== false;
				if (args.suppressStencilEvents === true)
				{
					return runWithStencilEventsSuppressed(function()
					{
						return performMoveLayerUnderLayer(graph, childLayerName, parentLayerName, mkVis);
					});
				}
				return performMoveLayerUnderLayer(graph, childLayerName, parentLayerName, mkVis);
			}
			finally
			{
				if (switchedPage && originalPage != null && ui.currentPage !== originalPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(originalPage);
				}
			}
		},
		moveObjectsToLayer: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return null;
			}
			var layerName = typeof args.layerName === 'string' ? args.layerName.trim() : '';
			if (!layerName && args.skipIfLayerMissing === true)
			{
				return {moved: 0, layerName: '', layerId: null, status: 'skipped', reason: 'layer_missing'};
			}
			if (!layerName)
			{
				layerName = 'unknown';
			}
			var originalPage = ui.currentPage || null;
			var targetPage = findPageById(args.pageId);
			var switchedPage = false;
			try
			{
				if (targetPage != null && originalPage !== targetPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(targetPage);
					switchedPage = true;
				}
				var layerResult = null;
				if (args.suppressStencilEvents === true)
				{
					layerResult = runWithStencilEventsSuppressed(function()
					{
						return ensureLayer(graph, layerName, args.makeVisible !== false);
					});
				}
				else
				{
					layerResult = ensureLayer(graph, layerName, args.makeVisible !== false);
				}
				var targetLayer = findLayerByName(graph, layerName);
				if (!targetLayer)
				{
					return {moved: 0, layerName: layerName, layerId: null};
				}
				var moveTargetMode = (typeof args.targetMode === 'string') ? args.targetMode : '';
				var cells = resolveMoveTargetsByObjectIds(graph, args.objectIds || [], moveTargetMode);
				var wantedLayer = layerName.trim();
				var filteredCells = [];
				for (var ci = 0; ci < cells.length; ci++)
				{
					var cMove = cells[ci];
					if (!cMove)
					{
						continue;
					}
					if (getCellLayerDisplayName(graph, cMove) === wantedLayer)
					{
						continue;
					}
					filteredCells.push(cMove);
				}
				cells = filteredCells;
				if (cells.length > 0)
				{
					if (args.suppressStencilEvents === true)
					{
						runWithStencilEventsSuppressed(function()
						{
							graph.moveCells(cells, 0, 0, false, targetLayer);
						});
					}
					else
					{
						graph.moveCells(cells, 0, 0, false, targetLayer);
					}
					graph.refresh();
				}
				return {
					moved: cells.length,
					layerId: layerResult ? layerResult.layerId : null,
					layerName: layerName,
					status: layerResult ? layerResult.status : 'existing'
				};
			}
			finally
			{
				if (switchedPage && originalPage != null && ui.currentPage !== originalPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(originalPage);
				}
			}
		},
		updateStencilData: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return;
			}
			var objectId = (typeof args.objectId === 'string') ? args.objectId.trim() : '';
			var mode = (typeof args.mode === 'string' && args.mode.trim().length > 0) ? args.mode.trim().toLowerCase() : 'merge';
			var patchData = (args.data && typeof args.data === 'object' && !Array.isArray(args.data)) ? args.data : null;
			if (!objectId || patchData == null)
			{
				return;
			}

			var originalPage = ui.currentPage || null;
			var targetPage = findPageById(args.pageId);
			var switchedPage = false;
			try
			{
				if (targetPage != null && originalPage !== targetPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(targetPage);
					switchedPage = true;
				}

				var targetCell = resolveCellForUpdate(graph, objectId);
				if (targetCell == null && switchedPage && originalPage != null && typeof ui.selectPage === 'function')
				{
					ui.selectPage(originalPage);
					switchedPage = false;
					targetCell = resolveCellForUpdate(graph, objectId);
				}
				if (targetCell == null)
				{
					writeLog('warn', 'updateStencilData: target cell not found', {
						objectId: objectId,
						pageId: args.pageId || null
					});
					return;
				}

				var applied = applyDataUpdateToCell(graph, targetCell, patchData, mode === 'replace' ? 'replace' : 'merge');
				if (applied)
				{
					graph.refresh();
					writeLog('info', 'updateStencilData applied', {
						objectId: objectId,
						pageId: args.pageId || null,
						mode: mode === 'replace' ? 'replace' : 'merge'
					});
				}
			}
			finally
			{
				if (switchedPage && originalPage != null && ui.currentPage !== originalPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(originalPage);
				}
			}
		},
		updateStencilDataBulk: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return {updated: 0, skipped: 0, errors: ['invalid_args']};
			}
			var updates = Array.isArray(args.updates) ? args.updates : [];
			if (updates.length === 0)
			{
				return {updated: 0, skipped: 0, errors: []};
			}
			var originalPage = ui.currentPage || null;
			var targetPage = findPageById(args.pageId);
			var switchedPage = false;
			var updated = 0;
			var skipped = 0;
			try
			{
				if (targetPage != null && originalPage !== targetPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(targetPage);
					switchedPage = true;
				}
				var applyBulk = function()
				{
					graph.getModel().beginUpdate();
					try
					{
						for (var i = 0; i < updates.length; i++)
						{
							var row = updates[i] || {};
							var objectId = typeof row.objectId === 'string' ? row.objectId.trim() : '';
							var patchData = (row.data && typeof row.data === 'object' && !Array.isArray(row.data)) ? row.data : null;
							var mode = (typeof row.mode === 'string' && row.mode.trim().length > 0) ? row.mode.trim().toLowerCase() : 'merge';
							if (!objectId || patchData == null)
							{
								skipped += 1;
								continue;
							}
							var cell = resolveCellForUpdate(graph, objectId);
							if (!cell)
							{
								skipped += 1;
								continue;
							}
							if (applyDataUpdateToCell(graph, cell, patchData, mode === 'replace' ? 'replace' : 'merge', false))
							{
								updated += 1;
							}
							else
							{
								skipped += 1;
							}
						}
					}
					finally
					{
						graph.getModel().endUpdate();
					}
				};
				if (args.suppressStencilEvents === true)
				{
					runWithStencilEventsSuppressed(applyBulk);
				}
				else
				{
					applyBulk();
				}
				graph.refresh();
			}
			finally
			{
				if (switchedPage && originalPage != null && ui.currentPage !== originalPage && typeof ui.selectPage === 'function')
				{
					ui.selectPage(originalPage);
				}
			}
			return {updated: updated, skipped: skipped, errors: []};
		},
		bulkUpdateByIds: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return {updated: 0, skipped: 0, errors: ['invalid_args'], conflicts: []};
			}
			var ids = Array.isArray(args.objectIds) ? args.objectIds : [];
			var patchData = (args.data && typeof args.data === 'object' && !Array.isArray(args.data)) ? args.data : null;
			var mode = (typeof args.mode === 'string' && args.mode.trim().length > 0) ? args.mode.trim().toLowerCase() : 'merge';
			if (!patchData || ids.length === 0)
			{
				return {updated: 0, skipped: ids.length, errors: ['empty_input'], conflicts: []};
			}
			var targetCells = [];
			for (var i = 0; i < ids.length; i++)
			{
				var id = String(ids[i] || '').trim();
				if (!id)
				{
					continue;
				}
				var cell = resolveCellForUpdate(graph, id);
				if (cell != null)
				{
					targetCells.push(cell);
				}
			}
			var conflicts = detectOidConflicts(targetCells, graph, patchData);
			if (conflicts.length > 0)
			{
				return {updated: 0, skipped: targetCells.length, errors: ['oid_conflict'], conflicts: conflicts};
			}
			var dryRun = args.dryRun === true;
			var updated = 0;
			var skipped = ids.length - targetCells.length;
			if (!dryRun)
			{
				graph.getModel().beginUpdate();
				try
				{
					for (var j = 0; j < targetCells.length; j++)
					{
						if (applyDataUpdateToCell(graph, targetCells[j], patchData, mode === 'replace' ? 'replace' : 'merge', false))
						{
							updated += 1;
						}
						else
						{
							skipped += 1;
						}
					}
				}
				finally
				{
					graph.getModel().endUpdate();
				}
				graph.refresh();
			}
			return {updated: dryRun ? targetCells.length : updated, skipped: skipped, errors: [], conflicts: []};
		},
		bulkUpdateByCriteria: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return {updated: 0, skipped: 0, errors: ['invalid_args'], conflicts: []};
			}
			var criteria = (args.criteria && typeof args.criteria === 'object') ? args.criteria : {};
			var cells = getCellsByCriteria(graph, criteria);
			var objectIds = [];
			for (var i = 0; i < cells.length; i++)
			{
				if (cells[i] && cells[i].id)
				{
					objectIds.push(cells[i].id);
				}
			}
			return uiCommandHandlers.bulkUpdateByIds({
				objectIds: objectIds,
				data: args.data,
				mode: args.mode,
				dryRun: args.dryRun === true
			});
		},
		mirrorDataByOidAtomic: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return {status: 'error', reason: 'invalid_args', failures: []};
			}
			var schema = (typeof args.schema === 'string') ? args.schema.trim() : '';
			var oid = (typeof args.oid === 'string') ? args.oid.trim() : '';
			var patchData = (args.patch && typeof args.patch === 'object' && !Array.isArray(args.patch)) ? mxUtils.clone(args.patch) : null;
			if (schema.length === 0 || oid.length === 0 || patchData == null)
			{
				return {status: 'error', reason: 'invalid_payload', failures: [{pageName: 'unknown_page', oid: oid || 'unknown_oid', reason: 'invalid_payload'}]};
			}
			var excluded = Array.isArray(args.excludedFields) ? args.excludedFields : [];
			for (var e = 0; e < excluded.length; e++)
			{
				var key = String(excluded[e] || '').trim();
				if (key.length > 0 && Object.prototype.hasOwnProperty.call(patchData, key))
				{
					delete patchData[key];
				}
			}
			if (Object.keys(patchData).length === 0)
			{
				return {status: 'success', updated: 0, skipped: 0, failures: []};
			}
			var targets = collectCellsByCriteriaAcrossPages({
				schema: schema,
				attributes: {OID: oid}
			});
			if (targets.length === 0)
			{
				return {status: 'error', reason: 'targets_not_found', failures: [{pageName: 'unknown_page', oid: oid, reason: 'targets_not_found'}]};
			}
			var snapshots = [];
			var sources = [];
			for (var i = 0; i < targets.length; i++)
			{
				var target = targets[i];
				var currentData = extractEditableDataFromCell(target.cell, graph);
				snapshots.push({
					pageName: target.pageName || '',
					oid: oid,
					cell: target.cell,
					data: currentData
				});
			}
			var sourceRollbacks = Array.isArray(args.sourceRollbacks) ? args.sourceRollbacks : [];
			for (var sr = 0; sr < sourceRollbacks.length; sr++)
			{
				var row = sourceRollbacks[sr];
				if (!row || typeof row !== 'object')
				{
					continue;
				}
				var sourceObjectId = (typeof row.objectId === 'string') ? row.objectId.trim() : '';
				var sourceBefore = (row.dataBefore && typeof row.dataBefore === 'object' && !Array.isArray(row.dataBefore)) ? row.dataBefore : null;
				if (!sourceObjectId || sourceBefore == null)
				{
					continue;
				}
				var sourceCell = resolveCellForUpdate(graph, sourceObjectId);
				if (!sourceCell)
				{
					continue;
				}
				sources.push({
					cell: sourceCell,
					dataBefore: mxUtils.clone(sourceBefore),
					pageName: (typeof row.pageName === 'string') ? row.pageName : '',
					oid: (typeof row.oid === 'string' && row.oid.trim().length > 0) ? row.oid.trim() : oid
				});
			}
			var failures = [];
			var updated = 0;
			var applyAtomic = function()
			{
				graph.getModel().beginUpdate();
				try
				{
					for (var j = 0; j < snapshots.length; j++)
					{
						var snap = snapshots[j];
						if (!applyDataUpdateToCell(graph, snap.cell, patchData, 'merge', false))
						{
							failures.push({
								pageName: snap.pageName || 'unknown_page',
								oid: snap.oid || oid,
								reason: 'apply_failed'
							});
							throw new Error('apply_failed');
						}
						updated += 1;
					}
				}
				catch (applyErr)
				{
					for (var rb = 0; rb < snapshots.length; rb++)
					{
						var rollbackRow = snapshots[rb];
						try
						{
							applyDataUpdateToCell(graph, rollbackRow.cell, rollbackRow.data || {}, 'replace', false);
						}
						catch (rollbackErr)
						{
							failures.push({
								pageName: rollbackRow.pageName || 'unknown_page',
								oid: rollbackRow.oid || oid,
								reason: 'rollback_failed'
							});
						}
					}
					for (var sb = 0; sb < sources.length; sb++)
					{
						var src = sources[sb];
						try
						{
							applyDataUpdateToCell(graph, src.cell, src.dataBefore || {}, 'replace', false);
						}
						catch (sourceRollbackErr)
						{
							failures.push({
								pageName: src.pageName || 'unknown_page',
								oid: src.oid || oid,
								reason: 'source_rollback_failed'
							});
						}
					}
					throw applyErr;
				}
				finally
				{
					graph.getModel().endUpdate();
				}
			};
			try
			{
				if (args.suppressStencilEvents === true)
				{
					runWithStencilEventsSuppressed(applyAtomic);
				}
				else
				{
					applyAtomic();
				}
				graph.refresh();
				return {status: 'success', updated: updated, skipped: 0, failures: []};
			}
			catch (err)
			{
				graph.refresh();
				if (failures.length === 0)
				{
					failures.push({pageName: 'unknown_page', oid: oid, reason: err && err.message ? err.message : 'unknown_error'});
				}
				return {
					status: 'error',
					reason: err && err.message ? err.message : 'mirror_failed',
					updated: 0,
					skipped: snapshots.length,
					failures: failures
				};
			}
		},
		applySeafImportBatch: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return {status: 'error', reason: 'invalid_args', updatedCells: 0, uniqueOidUpdated: 0, oidNotFound: [], failures: []};
			}
			var rows = Array.isArray(args.updates) ? args.updates : [];
			if (rows.length === 0)
			{
				return {status: 'success', updatedCells: 0, uniqueOidUpdated: 0, oidNotFound: [], failures: []};
			}
			var failures = [];
			var oidNotFound = [];
			var uniqueUpdated = {};
			var updatedCells = 0;
			var applyBatch = function()
			{
				graph.getModel().beginUpdate();
				try
				{
					for (var i = 0; i < rows.length; i++)
					{
						var row = rows[i] || {};
						var schema = typeof row.schema === 'string' ? row.schema.trim() : '';
						var oid = typeof row.oid === 'string' ? row.oid.trim() : '';
						var patch = (row.patch && typeof row.patch === 'object' && !Array.isArray(row.patch)) ? row.patch : null;
						if (!schema || !oid || patch == null || Object.keys(patch).length === 0)
						{
							failures.push({schema: schema || '', oid: oid || '', reason: 'invalid_payload'});
							continue;
						}
						var targets = collectCellsByCriteriaAcrossPages({
							schema: schema,
							attributes: {OID: oid}
						});
						if (!targets || targets.length === 0)
						{
							oidNotFound.push({schema: schema, oid: oid});
							continue;
						}
						for (var j = 0; j < targets.length; j++)
						{
							var target = targets[j];
							if (!target || !target.cell)
							{
								continue;
							}
							if (applyDataUpdateToCell(graph, target.cell, patch, 'merge', false))
							{
								updatedCells += 1;
								uniqueUpdated[schema + '|' + oid] = true;
							}
							else
							{
								failures.push({
									schema: schema,
									oid: oid,
									pageName: target.pageName || '',
									reason: 'apply_failed'
								});
							}
						}
					}
				}
				finally
				{
					graph.getModel().endUpdate();
				}
			};
			if (args.suppressStencilEvents === true)
			{
				runWithStencilEventsSuppressed(applyBatch);
			}
			else
			{
				applyBatch();
			}
			graph.refresh();
			return {
				status: failures.length > 0 ? 'partial' : 'success',
				updatedCells: updatedCells,
				uniqueOidUpdated: Object.keys(uniqueUpdated).length,
				oidNotFound: oidNotFound,
				failures: failures
			};
		},
		findBySchema: function(args)
		{
			var schema = args && typeof args.schema === 'string' ? args.schema.trim() : '';
			if (!schema)
			{
				return [];
			}
			var bySchema = state.stencilIndex.bySchema[schema] || {};
			return Object.keys(bySchema);
		},
		findByAttributes: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return [];
			}
			var criteria = {
				schema: typeof args.schema === 'string' ? args.schema : '',
				attributes: (args.attributes && typeof args.attributes === 'object' && !Array.isArray(args.attributes)) ? args.attributes : {}
			};
			var cells = getCellsByCriteria(graph, criteria);
			var out = [];
			for (var i = 0; i < cells.length; i++)
			{
				if (cells[i] && cells[i].id)
				{
					out.push(cells[i].id);
				}
			}
			return out;
		}
	};

	function runUiCommand(cmd)
	{
		var args = cmd.args || {};
		var handler = uiCommandHandlers[cmd.name];
		if (typeof handler === 'function')
		{
			var value = handler(args);
			if (value != null)
			{
				return {
					name: cmd.name,
					value: value
				};
			}
			return null;
		}
		writeLog('warn', 'Unknown UI command ignored', {command: cmd});
		return null;
	}

	function findLastUiCommandResult(collected, commandName)
	{
		if (!Array.isArray(collected) || typeof commandName !== 'string' || commandName.trim().length === 0)
		{
			return null;
		}
		for (var i = collected.length - 1; i >= 0; i--)
		{
			var row = collected[i];
			if (row && row.name === commandName)
			{
				return row.value || null;
			}
		}
		return null;
	}

	function enrichUiCommandBeforeRun(cmd, collected)
	{
		if (!cmd || typeof cmd !== 'object')
		{
			return cmd;
		}
		var args = (cmd.args && typeof cmd.args === 'object') ? mxUtils.clone(cmd.args) : {};
		var changed = false;
		var commandName = (typeof cmd.name === 'string') ? cmd.name : '';

		function resolvePageRef()
		{
			var pageRef = (typeof args.pageIdFrom === 'string') ? args.pageIdFrom.trim() : '';
			if (!pageRef || (typeof args.pageId === 'string' && args.pageId.trim().length > 0))
			{
				return;
			}
			var source = findLastUiCommandResult(collected, pageRef);
			var pageId = (source && typeof source.pageId === 'string') ? source.pageId.trim() : '';
			if (pageId.length > 0)
			{
				args.pageId = pageId;
				changed = true;
			}
			delete args.pageIdFrom;
		}

		function resolveObjectRef()
		{
			var objectRef = (typeof args.objectIdFrom === 'string') ? args.objectIdFrom.trim() : '';
			if (objectRef.length > 0)
			{
				var source = findLastUiCommandResult(collected, objectRef);
				var objectId = (source && typeof source.objectId === 'string') ? source.objectId.trim() : '';
				if (objectId.length > 0)
				{
					args.objectId = objectId;
					changed = true;
				}
				delete args.objectIdFrom;
			}

			var objectIdsRef = (typeof args.objectIdsFrom === 'string') ? args.objectIdsFrom.trim() : '';
			if (objectIdsRef.length > 0)
			{
				var sourceList = findLastUiCommandResult(collected, objectIdsRef);
				var firstObject = (sourceList && typeof sourceList.objectId === 'string') ? sourceList.objectId.trim() : '';
				if (firstObject.length > 0)
				{
					args.objectIds = [firstObject];
					changed = true;
				}
				delete args.objectIdsFrom;
			}
		}

		resolvePageRef();
		resolveObjectRef();

		if (commandName === 'setCellLinkToPage')
		{
			var targetPageId = (typeof args.targetPageId === 'string') ? args.targetPageId.trim() : '';
			if (targetPageId.length === 0)
			{
				var createResult = findLastUiCommandResult(collected, 'createPage');
				var createdPageId = (createResult && typeof createResult.pageId === 'string') ? createResult.pageId.trim() : '';
				if (createdPageId.length > 0)
				{
					args.targetPageId = createdPageId;
					changed = true;
				}
			}
			if (Object.prototype.hasOwnProperty.call(args, 'targetPageTitle'))
			{
				delete args.targetPageTitle;
				changed = true;
			}
		}

		if (commandName === 'moveObjectsToLayer' && args.layerFromInsertedSchema === true)
		{
			// Backward-compatible cleanup only: layer resolution is handled by python handlers.
			delete args.layerFromInsertedSchema;
			changed = true;
		}

		if (commandName === 'moveObjectsToLayer')
		{
			var layerNameArg = (typeof args.layerName === 'string') ? args.layerName.trim() : '';
			if (layerNameArg.length === 0)
			{
				args.skipIfLayerMissing = true;
				changed = true;
			}
		}

		if (commandName === 'moveLayerUnderLayer')
		{
			var childArg = (typeof args.childLayerName === 'string') ? args.childLayerName.trim() : '';
			var parentArg = (typeof args.parentLayerName === 'string') ? args.parentLayerName.trim() : '';
			if (childArg !== args.childLayerName || parentArg !== args.parentLayerName)
			{
				args.childLayerName = childArg;
				args.parentLayerName = parentArg;
				changed = true;
			}
		}

		if (commandName === 'updateStencilDataBulk' && Array.isArray(args.updates))
		{
			for (var i = 0; i < args.updates.length; i++)
			{
				var row = args.updates[i];
				if (row == null || typeof row !== 'object' || Array.isArray(row))
				{
					continue;
				}
				var rowRef = (typeof row.objectIdFrom === 'string') ? row.objectIdFrom.trim() : '';
				if (!rowRef || (typeof row.objectId === 'string' && row.objectId.trim().length > 0))
				{
					if (Object.prototype.hasOwnProperty.call(row, 'objectIdFrom'))
					{
						delete row.objectIdFrom;
						changed = true;
					}
					continue;
				}
				var rowSource = findLastUiCommandResult(collected, rowRef);
				var rowObjectId = (rowSource && typeof rowSource.objectId === 'string') ? rowSource.objectId.trim() : '';
				if (rowObjectId.length > 0)
				{
					row.objectId = rowObjectId;
					changed = true;
				}
				delete row.objectIdFrom;
			}
		}

		if (!changed)
		{
			return cmd;
		}
		return {
			name: cmd.name,
			args: args
		};
	}

	function validateSeafAddPageUiResults(result)
	{
		if (result == null || !Array.isArray(result.commands))
		{
			return;
		}
		var hasCreate = false;
		var hasLink = false;
		for (var i = 0; i < result.commands.length; i++)
		{
			var name = result.commands[i] && result.commands[i].name;
			hasCreate = hasCreate || name === 'createPage';
			hasLink = hasLink || name === 'setCellLinkToPage';
		}
		if (!hasCreate || !hasLink)
		{
			return;
		}
		var rows = (result.payload && Array.isArray(result.payload.uiCommandResults)) ? result.payload.uiCommandResults : [];
		var createValue = findLastUiCommandResult(rows, 'createPage');
		var createStatus = (createValue && typeof createValue.status === 'string') ? createValue.status : '';
		var createPageId = (createValue && typeof createValue.pageId === 'string') ? createValue.pageId.trim() : '';
		if ((createStatus !== 'created' && createStatus !== 'existing') || createPageId.length === 0)
		{
			result.status = 'error';
			result.message = 'Создание страницы не вернуло валидный pageId; привязка ссылки отменена.';
			if (!Array.isArray(result.errors))
			{
				result.errors = [];
			}
			result.errors.push('create_page_result_invalid');
			return;
		}
		var linkValue = findLastUiCommandResult(rows, 'setCellLinkToPage');
		var linkStatus = (linkValue && typeof linkValue.status === 'string') ? linkValue.status : '';
		if (linkStatus !== 'updated')
		{
			var reason = (linkValue && typeof linkValue.reason === 'string' && linkValue.reason.trim().length > 0) ?
				linkValue.reason.trim() : 'unknown';
			result.status = 'error';
			result.message = 'Не удалось установить ссылку на страницу: ' + reason;
			if (!Array.isArray(result.errors))
			{
				result.errors = [];
			}
			result.errors.push('set_cell_link_failed');
			return;
		}

		var hasOidBackfill = false;
		for (var jb = 0; jb < result.commands.length; jb++)
		{
			hasOidBackfill = hasOidBackfill || (result.commands[jb] && result.commands[jb].name === 'assignEmptyOidOnPage');
		}
		if (hasOidBackfill)
		{
			var oidValue = findLastUiCommandResult(rows, 'assignEmptyOidOnPage');
			var oidStatus = (oidValue && typeof oidValue.status === 'string') ? oidValue.status : '';
			if (oidStatus !== 'updated' && oidStatus !== 'noop')
			{
				result.status = 'error';
				result.message = 'Не удалось заполнить пустые OID на созданной странице.';
				if (!Array.isArray(result.errors))
				{
					result.errors = [];
				}
				result.errors.push('assign_oid_failed');
				return;
			}
		}

		var hasParentAutolink = false;
		for (var ja = 0; ja < result.commands.length; ja++)
		{
			hasParentAutolink = hasParentAutolink || (result.commands[ja] && result.commands[ja].name === 'autoLinkParentsOnPage');
		}
		if (hasParentAutolink)
		{
			var parentLinkValue = findLastUiCommandResult(rows, 'autoLinkParentsOnPage');
			var parentLinkStatus = (parentLinkValue && typeof parentLinkValue.status === 'string') ? parentLinkValue.status : '';
			if (parentLinkStatus !== 'updated' && parentLinkStatus !== 'noop')
			{
				result.status = 'error';
				result.message = 'Не удалось выполнить автосвязь с родителем на созданной странице.';
				if (!Array.isArray(result.errors))
				{
					result.errors = [];
				}
				result.errors.push('parent_autolink_failed');
				return;
			}
		}

		var hasMirrorInsert = false;
		for (var j = 0; j < result.commands.length; j++)
		{
			hasMirrorInsert = hasMirrorInsert || (result.commands[j] && result.commands[j].name === 'insertStencilFromP41ByTitle');
		}
		if (!hasMirrorInsert)
		{
			return;
		}

		var insertValue = findLastUiCommandResult(rows, 'insertStencilFromP41ByTitle');
		var insertStatus = (insertValue && typeof insertValue.status === 'string') ? insertValue.status : '';
		if (insertStatus !== 'inserted')
		{
			var mirrorTitle = (insertValue && typeof insertValue.mirrorTitle === 'string' && insertValue.mirrorTitle.trim().length > 0) ?
				insertValue.mirrorTitle.trim() : 'mirror';
			result.status = 'error';
			result.message = 'Не возможно добавить элемент ' + mirrorTitle + ' на страницу';
			if (!Array.isArray(result.errors))
			{
				result.errors = [];
			}
			result.errors.push('mirror_insert_failed');
			return;
		}

		var syncValue = findLastUiCommandResult(rows, 'updateStencilDataBulk');
		var syncUpdated = (syncValue && Number.isFinite(syncValue.updated)) ? Number(syncValue.updated) : 0;
		if (syncUpdated < 1)
		{
			result.status = 'error';
			result.message = 'Не удалось синхронизировать данные mirror-элемента.';
			if (!Array.isArray(result.errors))
			{
				result.errors = [];
			}
			result.errors.push('mirror_sync_failed');
			return;
		}

		var layerValue = findLastUiCommandResult(rows, 'moveObjectsToLayer');
		var moved = (layerValue && Number.isFinite(layerValue.moved)) ? Number(layerValue.moved) : 0;
		if (moved < 1)
		{
			result.status = 'error';
			result.message = 'Не удалось назначить слой mirror-элементу.';
			if (!Array.isArray(result.errors))
			{
				result.errors = [];
			}
			result.errors.push('mirror_layer_failed');
		}
	}

	function validateDataMirrorUiResults(result)
	{
		if (result == null || result.payload == null || typeof result.payload !== 'object')
		{
			return;
		}
		if (result.payload.handler !== 'data_mirror')
		{
			return;
		}
		var rows = Array.isArray(result.payload.uiCommandResults) ? result.payload.uiCommandResults : [];
		var failures = [];
		for (var i = 0; i < rows.length; i++)
		{
			var row = rows[i];
			if (!row || row.name !== 'mirrorDataByOidAtomic')
			{
				continue;
			}
			var value = (row.value && typeof row.value === 'object') ? row.value : {};
			if (value.status === 'success')
			{
				continue;
			}
			var rowFailures = Array.isArray(value.failures) ? value.failures : [];
			if (rowFailures.length === 0)
			{
				failures.push({pageName: 'unknown_page', oid: 'unknown_oid', reason: value.reason || 'mirror_failed'});
				continue;
			}
			for (var j = 0; j < rowFailures.length; j++)
			{
				var failure = rowFailures[j];
				failures.push({
					pageName: failure && failure.pageName ? String(failure.pageName) : 'unknown_page',
					oid: failure && failure.oid ? String(failure.oid) : 'unknown_oid',
					reason: failure && failure.reason ? String(failure.reason) : 'mirror_failed'
				});
			}
		}
		if (failures.length === 0)
		{
			result.message = '';
			return;
		}
		var lines = [];
		for (var k = 0; k < failures.length; k++)
		{
			lines.push('[page=' + failures[k].pageName + '] [OID=' + failures[k].oid + '] ' + failures[k].reason);
		}
		result.status = 'error';
		result.message = 'Синхронизация данных не выполнена:\n' + lines.join('\n');
		if (result.payload == null || typeof result.payload !== 'object')
		{
			result.payload = {};
		}
		result.payload.errorPolicy = {userVisible: true};
		if (!Array.isArray(result.errors))
		{
			result.errors = [];
		}
		result.errors.push('data_mirror_sync_failed');
	}

	function resultHasErrorShowMessage(result)
	{
		if (result == null || !Array.isArray(result.commands))
		{
			return false;
		}
		for (var i = 0; i < result.commands.length; i++)
		{
			var cmd = result.commands[i];
			if (cmd != null && cmd.name === 'showMessage' && cmd.args != null && cmd.args.level === 'error')
			{
				return true;
			}
		}
		return false;
	}

	function executeInteractiveCommands(result)
	{
		if (result == null || !Array.isArray(result.commands))
		{
			return [];
		}
		state.linkedPageRenameConfirmCache = {};
		var collected = [];
		for (var i = 0; i < result.commands.length; i++)
		{
			var prepared = enrichUiCommandBeforeRun(result.commands[i], collected);
			var commandResult = runUiCommand(prepared);
			if (commandResult != null)
			{
				collected.push(commandResult);
			}
		}
		if (collected.length > 0)
		{
			if (result.payload == null || typeof result.payload !== 'object')
			{
				result.payload = {};
			}
			result.payload.uiCommandResults = collected;
		}
		validateSeafAddPageUiResults(result);
		validateDataMirrorUiResults(result);
		return collected;
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
						if (updateOutcome.level === 'bootstrap_failed')
						{
							await openPythonBootstrapFailureDialog(updateOutcome);
						}
						else if (updateOutcome.level === 'error')
						{
							showError(updateOutcome.message);
						}
						else
						{
							showInfo(updateOutcome.message);
						}
					}
					else if (completedResult && completedResult.status === 'error')
					{
						if (!resultHasErrorShowMessage(completedResult) &&
							typeof completedResult.message === 'string' && completedResult.message.trim().length > 0)
						{
							showError(formatCommandError(command.id, completedResult.message));
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

	var NETCONF_PAGE_NAME = 'netconf_perser';
	var NETCONF_DIAGRAM_FILENAME = 'network_diagram.drawio';
	var NETCONF_READY_PREFIX = 'SEAF_NETCONF_DIAGRAM_READY ';

	function stripTerminalAnsi(text)
	{
		return String(text || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
	}

	function joinDirFile(dirPath, fileName)
	{
		var base = String(dirPath || '').replace(/[\\/]+$/, '');
		var file = String(fileName || '').replace(/^[\\/]+/, '');
		if (!base)
		{
			return file;
		}
		return base + '/' + file;
	}

	function parseNetconfDiagramReady(terminalText)
	{
		var text = stripTerminalAnsi(terminalText);
		if (!text)
		{
			return null;
		}
		var lines = text.split(/\r?\n/);
		for (var i = lines.length - 1; i >= 0; i--)
		{
			var line = String(lines[i] || '').trim();
			if (!line.startsWith(NETCONF_READY_PREFIX))
			{
				continue;
			}
			try
			{
				var parsed = JSON.parse(line.slice(NETCONF_READY_PREFIX.length));
				if (parsed && typeof parsed.diagramPath === 'string' && parsed.diagramPath.trim().length > 0)
				{
					return {
						diagramPath: parsed.diagramPath.trim(),
						pageName: (typeof parsed.pageName === 'string' && parsed.pageName.trim().length > 0) ?
							parsed.pageName.trim() : NETCONF_PAGE_NAME
					};
				}
			}
			catch (ignored)
			{
				// ignore malformed marker line
			}
		}
		return null;
	}

	function resolveNetconfDiagramPath(scriptEnv, terminalText)
	{
		var fromMarker = parseNetconfDiagramReady(terminalText);
		if (fromMarker != null)
		{
			return fromMarker;
		}
		var outputDir = (scriptEnv && typeof scriptEnv.netconfOutputDir === 'string') ?
			scriptEnv.netconfOutputDir.trim() : '';
		if (!outputDir)
		{
			return null;
		}
		return {
			diagramPath: joinDirFile(outputDir, NETCONF_DIAGRAM_FILENAME),
			pageName: NETCONF_PAGE_NAME
		};
	}

	function clearCurrentPageGraphContent(graph)
	{
		if (!graph || !graph.model || typeof graph.getDefaultParent !== 'function')
		{
			return;
		}
		var parent = graph.getDefaultParent();
		var children = graph.model.getChildren(parent);
		if (children != null && children.length > 0)
		{
			graph.removeCells(children);
		}
		graph.refresh();
	}

	function getOrCreateNetconfPage(pageName)
	{
		var title = (typeof pageName === 'string' && pageName.trim().length > 0) ?
			pageName.trim() : NETCONF_PAGE_NAME;
		var existing = findPageByName(title);
		if (existing != null)
		{
			return {status: 'existing', pageName: title, page: existing};
		}
		if (typeof ui.createPage !== 'function' || typeof ui.insertPage !== 'function' ||
			typeof ui.createPageId !== 'function')
		{
			return {status: 'error', reason: 'page_api_unavailable', page: null};
		}
		var page = ui.createPage(title, ui.createPageId());
		page = ui.insertPage(page);
		return {status: 'created', pageName: title, page: page};
	}

	async function restoreInteractiveTerminalFocus(sessionId)
	{
		if (typeof sessionId !== 'string' || sessionId.trim().length === 0)
		{
			return;
		}

		try
		{
			await requestAsync({
				action: 'focusSeafInteractiveTerminalSession',
				sessionId: sessionId
			});
		}
		catch (e)
		{
			await writeLog('debug', 'Interactive terminal refocus skipped', {
				sessionId: sessionId,
				error: e.message
			});
		}
	}

	async function importNetconfDiagramToPage(command, scriptEnv, terminalText, sessionId)
	{
		var resolved = resolveNetconfDiagramPath(scriptEnv, terminalText);
		if (resolved == null || !resolved.diagramPath)
		{
			await writeLog('warn', 'NetConf diagram import skipped: path not resolved', {
				commandId: command && command.id ? command.id : ''
			});
			return {status: 'skipped', reason: 'path_not_resolved'};
		}
		if (typeof ui.importXml !== 'function')
		{
			showError(formatCommandError(command.id, 'importXml is not available in this draw.io build'));
			return {status: 'error', reason: 'import_xml_unavailable'};
		}

		var diagramXml = null;
		try
		{
			diagramXml = await requestAsync({
				action: 'readFile',
				filename: resolved.diagramPath,
				encoding: 'utf8'
			});
		}
		catch (e)
		{
			await writeLog('warn', 'NetConf diagram import skipped: read failed', {
				commandId: command && command.id ? command.id : '',
				diagramPath: resolved.diagramPath,
				error: e.message
			});
			return {status: 'skipped', reason: 'read_failed', error: e.message};
		}

		if (typeof diagramXml !== 'string' || diagramXml.trim().length === 0)
		{
			return {status: 'skipped', reason: 'empty_diagram'};
		}

		var originalPage = ui.currentPage || null;
		var pageResult = getOrCreateNetconfPage(resolved.pageName);
		if (pageResult.status === 'error' || pageResult.page == null)
		{
			showError(formatCommandError(command.id, 'Unable to create or select page "' + resolved.pageName + '"'));
			await restoreInteractiveTerminalFocus(sessionId);
			return pageResult;
		}

		var switchedPage = false;
		if (typeof ui.selectPage === 'function' && ui.currentPage !== pageResult.page)
		{
			ui.selectPage(pageResult.page);
			switchedPage = true;
		}

		var graph = ui && ui.editor ? ui.editor.graph : null;
		if (!graph)
		{
			if (switchedPage && originalPage != null && typeof ui.selectPage === 'function' &&
				ui.currentPage !== originalPage)
			{
				ui.selectPage(originalPage);
			}
			await restoreInteractiveTerminalFocus(sessionId);
			showError(formatCommandError(command.id, 'Graph is not available'));
			return {status: 'error', reason: 'graph_unavailable'};
		}

		clearCurrentPageGraphContent(graph);
		try
		{
			ui.importXml(diagramXml, 0, 0, true, true, false);
		}
		catch (e)
		{
			if (switchedPage && originalPage != null && typeof ui.selectPage === 'function' &&
				ui.currentPage !== originalPage)
			{
				ui.selectPage(originalPage);
			}
			await restoreInteractiveTerminalFocus(sessionId);
			await writeLog('error', 'NetConf diagram import failed', {
				commandId: command && command.id ? command.id : '',
				diagramPath: resolved.diagramPath,
				pageName: resolved.pageName,
				error: e.message
			});
			showError(formatCommandError(command.id, 'Diagram import failed: ' + e.message));
			return {status: 'error', reason: 'import_failed', error: e.message};
		}

		graph.refresh();
		if (switchedPage && originalPage != null && typeof ui.selectPage === 'function' &&
			ui.currentPage !== originalPage)
		{
			ui.selectPage(originalPage);
		}
		await restoreInteractiveTerminalFocus(sessionId);
		await writeLog('info', 'NetConf diagram imported to page', {
			commandId: command && command.id ? command.id : '',
			diagramPath: resolved.diagramPath,
			pageName: resolved.pageName,
			pageStatus: pageResult.status,
			restoredOriginalPage: originalPage != null
		});
		return {
			status: 'imported',
			diagramPath: resolved.diagramPath,
			pageName: resolved.pageName,
			pageStatus: pageResult.status
		};
	}

	async function executeInteractiveTerminalCommand(command, source)
	{
		var scriptEnvOverrides = await collectScriptEnvOverrides(command);
		if (scriptEnvOverrides == null)
		{
			return;
		}

		var payload = buildPayload(command);
		applyScriptEnvToPayload(payload, scriptEnvOverrides);
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

			var netconfImportDone = false;
			state.interactiveSessionHandlers[sessionId] = function(event)
			{
				if (event.type === 'process-exit' && event.status === 'completed' &&
					command.id === 'seafToolsNetConfParser' && !netconfImportDone)
				{
					netconfImportDone = true;
					var terminalText = (typeof event.outputTail === 'string') ? event.outputTail : '';
					importNetconfDiagramToPage(command, scriptEnvOverrides, terminalText, sessionId).catch(function(e)
					{
						writeLog('error', 'NetConf diagram import handler failed', {
							commandId: command.id,
							sessionId: sessionId,
							error: e.message
						});
					});
				}
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

	async function executeCommand(command, source, sourceCell)
	{
		var preflightAllowed = await runCommandDescriptionPreflight(command);
		if (preflightAllowed !== true)
		{
			await writeLog('info', 'Command execution cancelled by description preflight', {
				commandId: command && command.id ? command.id : '',
				source: source
			});
			return;
		}

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

		if (command && command.clientAction === 'bulkEditData')
		{
			await executeBulkEditDataCommand(command, source);
			return;
		}

		if (command && command.clientAction === 'seafEditData')
		{
			try
			{
				var graphSeaf = ui && ui.editor ? ui.editor.graph : null;
				var sourceCellResolved = sourceCell || (graphSeaf ? (state.contextMenuLastCell || graphSeaf.getSelectionCell() || null) : null);
				var seafIntent = buildEditDataIntent(sourceCellResolved, graphSeaf, 'seaf_menu_client_action');
				if (seafIntent && seafIntent.targetCell)
				{
					showSeafEditDataDialog(seafIntent.targetCell);
				}
			}
			catch (seafErr)
			{
				await writeLog('error', 'SEAF Edit Data client action failed', {
					commandId: command.id,
					source: source,
					error: seafErr && seafErr.message ? seafErr.message : String(seafErr)
				});
				showError(formatCommandError(command.id, seafErr && seafErr.message ? seafErr.message : String(seafErr)));
			}
			return;
		}

		var scriptEnvOverrides = null;
		if (command && command.clientAction === 'stencilSchemaPicker')
		{
			scriptEnvOverrides = await collectStencilSchemaPickerOverrides(command);
		}
		else
		{
			scriptEnvOverrides = await collectScriptEnvOverrides(command);
		}
		if (scriptEnvOverrides == null)
		{
			return;
		}

		var payload = buildPayload(command, sourceCell || null);
		applyScriptEnvToPayload(payload, scriptEnvOverrides);
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
			var uiResults = executeInteractiveCommands(result);
			if (command && command.id === 'seafAddPage')
			{
				await writeLog('debug', 'seafAddPage uiCommandResults', {
					uiCommandResults: uiResults || [],
					finalStatus: result && result.status ? result.status : 'unknown',
					finalMessage: result && result.message ? result.message : ''
				});
			}

			if (result.status === 'error')
			{
				if (!resultHasErrorShowMessage(result) &&
					typeof result.message === 'string' && result.message.trim().length > 0)
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
				if (updateOutcome.level === 'bootstrap_failed')
				{
					await openPythonBootstrapFailureDialog(updateOutcome);
				}
				else if (updateOutcome.level === 'error')
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

	async function ensurePythonEnvironmentAuto()
	{
		try
		{
			var result = await requestAsync({
				action: 'ensureSeafPythonEnv',
				configPath: state.configPath,
				source: 'plugin_init'
			});
			await writeLog('info', 'Python environment auto-bootstrap completed', Object.assign({
				runtimeVersion: state.runtimeVersion || 'unknown',
				configPath: state.configPath
			}, result || {ok: true}));
		}
		catch (e)
		{
			await writeLog('error', 'Python environment auto-bootstrap failed', {
				error: e.message,
				runtimeVersion: state.runtimeVersion || 'unknown',
				configPath: state.configPath
			});
			showError('SEAF Python environment setup failed: ' + e.message +
				'\nRuntime: v' + (state.runtimeVersion || 'unknown') +
				'\nConfig: ' + (state.configPath || 'unknown') +
				'\nУкажите корректный Python executable в Edit Config и повторите запуск.');
		}
	}

	function contextMatches(command, graph, cell)
	{
		var cfg = (command && command.menu && command.menu.context && typeof command.menu.context === 'object') ?
			command.menu.context : null;
		if (cfg == null || cfg.enabled !== true)
		{
			return false;
		}
		var target = cfg.target || 'any';
		var selection = graph.getSelectionCells();
		var first = cell || graph.getSelectionCell();
		var scope = (typeof cfg.scope === 'string') ? cfg.scope.trim().toLowerCase() : '';
		var targetMatched = true;

		if (scope === 'canvas' && first != null)
		{
			return false;
		}
		if (scope === 'stencil' && first == null)
		{
			return false;
		}

		if (target === 'selection_non_empty')
		{
			targetMatched = selection.length > 0;
		}
		else if (target === 'selection_multi')
		{
			targetMatched = selection.length > 1;
		}
		else if (target === 'selection_single')
		{
			targetMatched = selection.length === 1;
		}
		else if (target === 'vertex')
		{
			targetMatched = first != null && graph.model.isVertex(first);
		}
		else if (target === 'edge')
		{
			targetMatched = first != null && graph.model.isEdge(first);
		}

		if (!targetMatched)
		{
			return false;
		}

		var schemaPattern = cfg.schemaPattern;
		if (schemaPattern != null)
		{
			if (first == null)
			{
				return false;
			}
			var schema = '';
			try
			{
				var resolvedTarget = resolveEditDataTarget(first, graph);
				schema = (resolvedTarget && typeof resolvedTarget.schema === 'string') ? resolvedTarget.schema.trim() : '';
			}
			catch (schemaResolveErr)
			{
				schema = '';
			}
			if (!schema)
			{
				var schemaMeta = extractShapeSchema(first, graph);
				schema = schemaMeta && typeof schemaMeta.schema === 'string' ? schemaMeta.schema.trim() : '';
			}
			if (!schema)
			{
				return false;
			}
			var patterns = Array.isArray(schemaPattern) ? schemaPattern : [schemaPattern];
			var normalizedPatterns = [];
			for (var p = 0; p < patterns.length; p++)
			{
				var normalizedPattern = (typeof patterns[p] === 'string') ? patterns[p].trim() : '';
				if (normalizedPattern)
				{
					normalizedPatterns.push(normalizedPattern);
				}
			}
			if (normalizedPatterns.length === 0)
			{
				return false;
			}
			var matched = false;
			for (var i = 0; i < normalizedPatterns.length; i++)
			{
				var pattern = normalizedPatterns[i];
				var match = matchSchemaPattern(schema, pattern);
				if (match && match.matched === true)
				{
					matched = true;
					break;
				}
			}
			if (!matched)
			{
				return false;
			}
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
		var rootItems = [];
		var submenuBuckets = {};
		var submenuOrder = [];

		var normalizeSubmenu = function(value)
		{
			var out = (typeof value === 'string') ? value.trim().toLowerCase() : '';
			return out;
		};

		var submenuMenuId = function(submenuKey)
		{
			return 'seafSubmenu_' + submenuKey.replace(/[^a-z0-9_]/gi, '_');
		};

		for (var i = 0; i < commands.length; i++)
		{
			var cmd = commands[i];
			if (cmd.id === 'seafUpdatePlugin' || cmd.id === 'seafSystemUpdatePlugin')
			{
				continue;
			}
			var mainCfg = (cmd.menu && cmd.menu.main) ? cmd.menu.main : {};
			if (mainCfg.enabled !== true)
			{
				continue;
			}

			var submenuKey = normalizeSubmenu(mainCfg.submenu);
			if (submenuKey === 'examples')
			{
				continue;
			}

			if (submenuKey.length > 0)
			{
				if (submenuBuckets[submenuKey] == null)
				{
					submenuBuckets[submenuKey] = {
						title: submenuKey,
						items: [],
						menuId: submenuMenuId(submenuKey)
					};
					submenuOrder.push(submenuKey);
				}
				var bucket = submenuBuckets[submenuKey];
				if (typeof mainCfg.submenuTitle === 'string' && mainCfg.submenuTitle.trim().length > 0)
				{
					bucket.title = mainCfg.submenuTitle.trim();
				}
				if (mxUtils.indexOf(bucket.items, cmd.id) < 0)
				{
					bucket.items.push(cmd.id);
				}
			}
			else if (mxUtils.indexOf(rootItems, cmd.id) < 0)
			{
				rootItems.push(cmd.id);
			}
		}

		for (var s = 0; s < submenuOrder.length; s++)
		{
			var submenuKeyAt = submenuOrder[s];
			var bucketData = submenuBuckets[submenuKeyAt];
			(function(items, menuId)
			{
				ui.menus.put(menuId, new Menu(function(menuObj, parent)
				{
					if (items.length > 0)
					{
						ui.menus.addMenuItems(menuObj, items, parent);
					}
				}));
			})(bucketData.items, bucketData.menuId);
			mxResources.parse(bucketData.menuId + '=' + bucketData.title);
		}

		var seafMenu = ui.menus.get('seaf');
		if (seafMenu != null)
		{
			var oldFunct = seafMenu.funct;
			seafMenu.funct = function(menuObj, parent)
			{
				oldFunct.apply(this, arguments);
				if (rootItems.length > 0)
				{
					ui.menus.addMenuItems(menuObj, ['-'].concat(rootItems), parent);
					menuObj.addSeparator(parent);
				}
				for (var si = 0; si < submenuOrder.length; si++)
				{
					var submenuKeyRender = submenuOrder[si];
					var submenuBucket = submenuBuckets[submenuKeyRender];
					if (submenuBucket != null && submenuBucket.items.length > 0)
					{
						ui.menus.addSubmenu(submenuBucket.menuId, menuObj, parent, mxResources.get(submenuBucket.menuId));
					}
				}
				if (rootItems.length > 0 || submenuOrder.length > 0)
				{
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
			var graph = ui.editor.graph;
			state.contextMenuLastCell = cell || null;
			var intent = buildEditDataIntent(cell, graph, 'context_menu');
			var applySchemaPolicy = false;
			var shouldHideNativeEditData = false;
			try
			{
				if (intent == null)
				{
					intent = {targetCell: cell, mode: 'standard', schema: '', policySource: 'hard-default'};
				}
				applySchemaPolicy = (intent.targetCell != null);
				shouldHideNativeEditData = (intent.targetCell != null && intent.mode === 'seaf');
			}
			catch (eMode)
			{
				intent = {targetCell: cell, mode: 'standard', schema: '', policySource: 'hard-default'};
				applySchemaPolicy = false;
				shouldHideNativeEditData = false;
			}

			// In seaf-mode hide the standard "Edit Data" before the base call assembles the menu.
			// Restored after the base call so other entry points (Edit menu, etc.) are unaffected.
			var prevHiddenItems = ui.menus.hiddenMenuItems;
			var hiddenOverridden = false;
			try
			{
				if (shouldHideNativeEditData)
				{
					var merged = {};
					if (prevHiddenItems != null && typeof prevHiddenItems === 'object')
					{
						for (var hk in prevHiddenItems)
						{
							if (Object.prototype.hasOwnProperty.call(prevHiddenItems, hk))
							{
								merged[hk] = prevHiddenItems[hk];
							}
						}
					}
					merged.editData = true;
					ui.menus.hiddenMenuItems = merged;
					hiddenOverridden = true;
				}
			}
			catch (eHide)
			{
				hiddenOverridden = false;
			}
			try
			{
				state.contextMenuBaseCreatePopupMenu.apply(this, arguments);
			}
			finally
			{
				if (hiddenOverridden)
				{
					ui.menus.hiddenMenuItems = prevHiddenItems;
				}
			}

			var standardLabel = mxResources.get('editData');
			var seafLabel = mxResources.get('seafEditData');
			var standardState = ContextMenuPresenter.getItemStateByLabel(menu, standardLabel);
			var seafStateBefore = ContextMenuPresenter.getItemStateByLabel(menu, seafLabel);
			var selectionCount = 0;
			var statePresent = false;
			var isEditable = false;
			try
			{
				selectionCount = (graph && typeof graph.getSelectionCount === 'function') ? graph.getSelectionCount() : 0;
				statePresent = (graph && graph.view && typeof graph.view.getState === 'function') ?
					(graph.view.getState(intent.targetCell) != null) : false;
				isEditable = (graph && typeof graph.isCellEditable === 'function') ?
					graph.isCellEditable(intent.targetCell) : false;
			}
			catch (eMenuState)
			{
				selectionCount = 0;
				statePresent = false;
				isEditable = false;
			}
			writeLog('debug', 'context menu edit_data mode resolved', {
				clickedCellId: (cell && cell.id) ? String(cell.id) : null,
				resolvedCellId: intent.targetCellId || null,
				schema: intent.schema,
				mode: intent.mode,
				policySource: intent.policySource,
				policyApplied: applySchemaPolicy,
				standardVisible: standardState.present === true,
				standardEnabled: standardState.enabled === true,
				seafVisibleBefore: seafStateBefore.present === true,
				seafEnabledBefore: seafStateBefore.enabled === true,
				selectionCount: selectionCount,
				statePresent: statePresent,
				isEditable: isEditable
			});

			var standardStateAfter = ContextMenuPresenter.getItemStateByLabel(menu, standardLabel);
			var seafStateAfter = ContextMenuPresenter.getItemStateByLabel(menu, seafLabel);
			writeLog('debug', 'context menu edit_data policy result', {
				mode: intent.mode,
				policySource: intent.policySource,
				policyApplied: applySchemaPolicy,
				standardVisible: standardStateAfter.present === true,
				standardEnabled: standardStateAfter.enabled === true,
				seafVisible: seafStateAfter.present === true,
				seafEnabled: seafStateAfter.enabled === true
			});
			if ((intent.mode === 'standard' || intent.mode === 'both') && applySchemaPolicy &&
				standardStateAfter.present !== true)
			{
				writeLog('warn', 'standard editData item is absent after base popup', {
					mode: intent.mode,
					cellId: intent.targetCellId || null
				});
			}

			var inserted = false;
			var commands = state.config.commands || [];
			var contextCommands = [];
			var matchedEditDataCommandIds = [];

			for (var c = 0; c < commands.length; c++)
			{
				var contextCfg = (commands[c] && commands[c].menu && commands[c].menu.context &&
					typeof commands[c].menu.context === 'object') ? commands[c].menu.context : null;
				if (contextCfg != null && contextCfg.enabled === true)
				{
					contextCommands.push(commands[c]);
				}
			}

			for (var i = 0; i < contextCommands.length; i++)
			{
				if (contextMatches(contextCommands[i], graph, cell))
				{
					if (contextCommands[i] && contextCommands[i].clientAction === 'seafEditData')
					{
						matchedEditDataCommandIds.push(String(contextCommands[i].id || ''));
					}
					if (!inserted)
					{
						this.addMenuItems(menu, ['-'], null, evt);
						inserted = true;
					}

					this.addMenuItems(menu, [contextCommands[i].id], null, evt);
				}
			}
			writeLog('debug', 'context menu seaf edit-data command matches', {
				cellId: (cell && cell.id) ? String(cell.id) : null,
				mode: intent && intent.mode ? intent.mode : 'standard',
				matchedCommandIds: matchedEditDataCommandIds
			});
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

		// SEAF Edit Data action: explicit entry-point for the SEAF dialog (used in context menu and elsewhere).
		mxResources.parse('seafEditData=Редактировать данные (SEAF)…');
		if (ui.actions.get('seafEditData') == null)
		{
			ui.actions.addAction('seafEditData', function()
			{
				try
				{
					var graph = ui && ui.editor ? ui.editor.graph : null;
				var sourceCell = graph ? (state.contextMenuLastCell || graph.getSelectionCell() ||
					(graph.getModel ? graph.getModel().getRoot() : null)) : null;
					var intent = buildEditDataIntent(sourceCell, graph, 'seaf_action');
					var cell = intent && intent.targetCell ? intent.targetCell : sourceCell;
					if (cell != null)
					{
						showSeafEditDataDialog(cell);
					}
				}
				catch (e)
				{
					writeLog('error', 'seafEditData action failed', {
						error: e && e.message ? e.message : String(e)
					});
				}
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
						var graph = ui && ui.editor ? ui.editor.graph : null;
						var sourceCell = graph ? (graph.getSelectionCell() || state.contextMenuLastCell || null) : null;
						executeCommand(command, 'menu', sourceCell);
					});
				}
			})(commands[i]);
		}
		state.actionsRegistered = true;
	}

	async function init()
	{
		async function runInitStep(stepName, fn, isCritical)
		{
			try
			{
				await fn();
			}
			catch (stepErr)
			{
				await writeLog('error', 'Initialization step failed', {
					step: stepName,
					error: stepErr && stepErr.message ? stepErr.message : String(stepErr)
				});
				if (isCritical !== false)
				{
					throw stepErr;
				}
			}
		}

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
			refreshFeatureFlagsFromEnv();
			try
			{
				state.eventConfig = await requestAsync({
					action: 'getSeafEventConfig',
					configPath: state.configPath
				});
			}
			catch (eventCfgErr)
			{
				state.eventConfig = {events: {enabled: false, stencilLists: [], rules: []}};
			}
			state.logging = computeUiLoggingFromEnv(state.config ? state.config.logging : null, state.envConfig);

			await writeLog('info', 'Plugin initialization started', {
				configPath: state.configPath,
				commandsCount: Array.isArray(state.config.commands) ? state.config.commands.length : 0,
				runtimeVersion: state.runtimeVersion || 'unknown',
				features: state.features
			});
			await runInitStep('python_env_bootstrap', ensurePythonEnvironmentAuto, false);
			await runInitStep('stencil_libraries_load', loadSeafStencilLibraries, false);
			await runInitStep('load_stencils_layer_config', loadStencilsLayerConfig, false);
			await runInitStep('stencil_index_rebuild', function()
			{
				rebuildStencilIndex();
				return Promise.resolve();
			}, false);
			await runInitStep('install_stencil_index_lifecycle_hooks', function()
			{
				installStencilIndexLifecycleHooks();
				return Promise.resolve();
			}, false);
			await runInitStep('install_stencil_model_listener', installStencilModelListener, false);
			await runInitStep('install_edit_data_session_hide_hook', installEditDataSessionHideHook, false);
			await runInitStep('install_edit_data_dialog_router', function()
			{
				installEditDataDialogRouter();
				return Promise.resolve();
			}, false);

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
			try
			{
				await writeLog('error', 'Plugin initialization failed', {
					error: e && e.message ? e.message : String(e),
					stack: e && e.stack ? String(e.stack) : null,
					configPath: state.configPath || null,
					runtimeVersion: state.runtimeVersion || 'unknown'
				});
			}
			catch (logErr)
			{
				try
				{
					console.error('SEAF plugin init writeLog failed', logErr);
				}
				catch (ignored2)
				{
					// ignore
				}
			}

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
