/**
 * SEAF plugin for draw.io desktop runtime.
 * Runtime script version: 0.3.25
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
		eventConfig: null,
		stencilModelListenerInstalled: false,
		stencilEventDispatchInFlight: false,
		pendingStencilBatches: [],
		editDataSessionActive: false,
		editDataBeforeByCell: {},
		editDataDialogRouterInstalled: false,
		originalShowDataDialog: null,
		contextMenuLastCell: null,
		stencilsLayerConfig: null,
		stencilIndex: {
			ready: false,
			byObjectId: {},
			bySchema: {},
			byOid: {},
			total: 0,
			lastRebuildAt: null
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

	function getStencilsConfigPath()
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
		var runtimeRoot = normalized.slice(0, normalized.length - suffix.length);
		return joinPathFragments(runtimeRoot, 'conf', 'stencils', 'libraries.json');
	}

	function getStencilsLayerConfigPath()
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
		var runtimeRoot = normalized.slice(0, normalized.length - suffix.length);
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
			var rawText = await requestAsync({
				action: 'readFile',
				filename: path,
				encoding: 'utf8'
			});
			var parsed = parseStencilsConfigYaml(typeof rawText === 'string' ? rawText : '');
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
				sample: sample
			});
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
		var entry = cfg.schemas[key];
		return (entry != null && typeof entry === 'object' && !Array.isArray(entry)) ? entry : null;
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

	function getEditDataModeForSchema(schema)
	{
		var entry = getSchemaConfigEntry(schema);
		if (entry == null)
		{
			return isSeafPrefixedSchema(schema) ? 'seaf' : 'standard';
		}
		var raw = entry.edit_data;
		if (typeof raw === 'string')
		{
			var v = raw.trim().toLowerCase();
			if (v === 'standard' || v === 'seaf' || v === 'both')
			{
				return v;
			}
		}
		return 'seaf';
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

	function buildIndexEntryFromCell(cell, graph)
	{
		if (!cell || !cell.id || !graph)
		{
			return null;
		}
		var data = extractEditableDataFromCell(cell, graph);
		var schemaMeta = extractShapeSchema(cell, graph);
		var schema = schemaMeta && typeof schemaMeta.schema === 'string' ? schemaMeta.schema.trim() : '';
		var oid = getOidFromData(data);
		return {
			objectId: cell.id,
			schema: schema,
			schemaCode: parseSchemaCode(schema),
			oid: oid,
			data: sanitizeForIpc(data)
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
		state.stencilIndex.total = Object.keys(state.stencilIndex.byObjectId).length;
		state.stencilIndex.ready = true;
		state.stencilIndex.lastRebuildAt = new Date().toISOString();
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
		return {
			total: state.stencilIndex.total,
			bySchema: bySchema,
			byOid: byOid
		};
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
			oid: getOidFromData(data),
			companyPrefix: getCompanyPrefix(),
			schemaCode: parseSchemaCode(meta.schema),
			value: sanitizeForIpc(cell.value)
		};
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

	async function runStencilEventCommand(commandId, eventPayload)
	{
		if (typeof commandId !== 'string' || commandId.trim().length === 0)
		{
			return null;
		}
		var response = await requestAsync({
			action: 'runSeafPluginCommand',
			configPath: state.configPath,
			commandId: commandId.trim(),
			payload: {
				commandId: commandId.trim(),
				source: 'stencil_event_processor',
				timestamp: new Date().toISOString(),
				selection: [],
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
				commandId: commandId.trim(),
				error: uiErr && uiErr.message ? uiErr.message : String(uiErr)
			});
		}
		if (uiResults.length > 0)
		{
			await writeLog('info', 'Stencil event UI commands executed', {
				commandId: commandId.trim(),
				count: uiResults.length
			});
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
				if (change.parent != null && (change.previous == null || change.previous !== change.parent))
				{
					operation = 'add';
				}
				if (change.parent == null && change.previous != null)
				{
					operation = 'remove';
				}
				if (operation != null)
				{
					var targets = (operation === 'add') ? collectAddSnapshotTargets(change.child, graph) : [change.child];
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

			if (state.editDataSessionActive === true && change.cell && Object.prototype.hasOwnProperty.call(change, 'value'))
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
				var beforeJson = JSON.stringify(beforeValue);
				var afterJson = JSON.stringify(afterValue);
				if (beforeJson !== afterJson)
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
			finally
			{
				if (state.editDataSessionActive)
				{
					state.editDataSessionActive = false;
					state.editDataBeforeByCell = {};
				}
			}
		});
		state.stencilModelListenerInstalled = true;
	}

	function ensureSeafEditDataResources()
	{
		if (typeof mxResources !== 'undefined' && typeof mxResources.parse === 'function')
		{
			mxResources.parse('seafEditDataLockTooltip=Поле защищено data_lock и недоступно для изменения или удаления');
			mxResources.parse('seafEditDataLockedAddAlert=Имя свойства защищено data_lock и не может быть добавлено');
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

	// SEAF Edit Data dialog. Mirrors the standard EditDataDialog UX (XML object node attributes,
	// Apply/Cancel/Export, optional placeholders checkbox), but with first-class support for:
	//   - data_lock list per schema (locked rows are disabled and have no remove button)
	//   - blocking add of properties whose name is in data_lock
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
				uiRef.hideDialog.apply(uiRef, arguments);

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
						if (lockSet[an] === true) continue;
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

				// Snapshot before-state so existing event processor sees a "modify" for this set
				try
				{
					state.editDataSessionActive = true;
					state.editDataBeforeByCell = captureEditDataBeforeSnapshots(graph);
				}
				catch (eSnap) { /* ignore */ }

				if (model && typeof model.setValue === 'function')
				{
					model.setValue(cell, clone);
				}
			}
			catch (e)
			{
				mxUtils.alert(e && e.message ? e.message : String(e));
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
			state.editDataSessionActive = true;
			state.editDataBeforeByCell = captureEditDataBeforeSnapshots(graph);
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
				var graph = ui && ui.editor ? ui.editor.graph : null;
			var resolved = resolveEditDataTarget(cell, graph);
			var targetCell = (resolved && resolved.cell) ? resolved.cell : cell;
			var targetSchema = (resolved && typeof resolved.schema === 'string') ? resolved.schema : '';
			var targetMode = getEditDataModeForSchema(targetSchema);
			if (targetCell != null && (targetMode === 'seaf' || targetMode === 'both'))
				{
					writeLog('debug', 'showDataDialog routed to SEAF dialog', {
					cellId: (targetCell && targetCell.id) ? String(targetCell.id) : null,
					mode: targetMode
					});
				showSeafEditDataDialog(targetCell);
					return;
				}
			}
			catch (e)
			{
				writeLog('error', 'showDataDialog router failed; falling back to standard dialog', {
					error: e && e.message ? e.message : String(e)
				});
			}
			state.editDataSessionActive = true;
			state.editDataBeforeByCell = captureEditDataBeforeSnapshots(ui && ui.editor ? ui.editor.graph : null);
			return originalShowDataDialog(cell);
		};
		state.editDataDialogRouterInstalled = true;
		writeLog('info', 'showDataDialog router installed', {});
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
			var helpText = (field && typeof field.helpText === 'string') ? field.helpText.trim() : '';
			if (helpText.length > 0)
			{
				if (typeof Editor !== 'undefined' && Editor != null && typeof Editor.helpImage === 'string' && Editor.helpImage.length > 0)
				{
					var helpIcon = document.createElement('img');
					helpIcon.setAttribute('src', Editor.helpImage);
					helpIcon.setAttribute('title', helpText);
					helpIcon.setAttribute('aria-label', helpText);
					helpIcon.className = 'geHelpIcon';
					labelWrap.appendChild(helpIcon);
				}
				else
				{
					var helpFallback = document.createElement('span');
					helpFallback.textContent = '?';
					helpFallback.setAttribute('title', helpText);
					helpFallback.setAttribute('aria-label', helpText);
					helpFallback.style.display = 'inline-block';
					helpFallback.style.width = '14px';
					helpFallback.style.height = '14px';
					helpFallback.style.lineHeight = '14px';
					helpFallback.style.textAlign = 'center';
					helpFallback.style.borderRadius = '50%';
					helpFallback.style.border = '1px solid #909090';
					helpFallback.style.fontSize = '10px';
					helpFallback.style.fontWeight = 'bold';
					helpFallback.style.cursor = 'help';
					labelWrap.appendChild(helpFallback);
				}
			}
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

	function resolveMoveTargetsByObjectIds(graph, objectIds)
	{
		if (!graph || !Array.isArray(objectIds))
		{
			return [];
		}
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
			var target = resolveMoveTargetCell(cell, graph);
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

	function findLayerByName(graph, layerName)
	{
		if (!graph || !graph.model || typeof layerName !== 'string' || layerName.trim().length === 0)
		{
			return null;
		}
		var model = graph.model;
		var root = model.root;
		var wanted = layerName.trim();
		for (var i = 0; i < model.getChildCount(root); i++)
		{
			var candidate = model.getChildAt(root, i);
			if (!candidate || (typeof model.isLayer === 'function' && !model.isLayer(candidate)))
			{
				continue;
			}
			var name = graph.convertValueToString(candidate);
			if (String(name || '').trim() === wanted)
			{
				return candidate;
			}
		}
		return null;
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

	function getCellsByCriteria(graph, criteria)
	{
		if (!graph || !graph.model)
		{
			return [];
		}
		var model = graph.model;
		var root = model.getRoot ? model.getRoot() : model.root;
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
		moveObjectsToLayer: function(args)
		{
			var graph = ui && ui.editor ? ui.editor.graph : null;
			if (!graph || !args || typeof args !== 'object')
			{
				return null;
			}
			var layerName = typeof args.layerName === 'string' ? args.layerName.trim() : '';
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
				var layerResult = ensureLayer(graph, layerName, args.makeVisible !== false);
				var targetLayer = findLayerByName(graph, layerName);
				if (!targetLayer)
				{
					return {moved: 0, layerName: layerName, layerId: null};
				}
				var cells = resolveMoveTargetsByObjectIds(graph, args.objectIds || []);
				if (cells.length > 0)
				{
					graph.moveCells(cells, 0, 0, false, targetLayer);
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

	function executeInteractiveCommands(result)
	{
		if (result == null || !Array.isArray(result.commands))
		{
			return [];
		}
		var collected = [];
		for (var i = 0; i < result.commands.length; i++)
		{
			var commandResult = runUiCommand(result.commands[i]);
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
			var schemaMeta = extractShapeSchema(first, graph);
			var schema = schemaMeta && typeof schemaMeta.schema === 'string' ? schemaMeta.schema.trim() : '';
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
		var p41Items = [];
		var toolsItems = [];
		var examplesItems = [];

		var normalizeSubmenu = function(value)
		{
			var out = (typeof value === 'string') ? value.trim().toLowerCase() : '';
			return out;
		};

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

			var title = (typeof cmd.title === 'string') ? cmd.title : '';
			var submenu = normalizeSubmenu(mainCfg.submenu);
			var target = rootItems;

			if (title.indexOf('SEAF') === 0 || submenu === 'examples')
			{
				target = examplesItems;
			}
			else if (submenu === 'p41')
			{
				target = p41Items;
			}
			else if (submenu === 'tools')
			{
				target = toolsItems;
			}

			if (mxUtils.indexOf(target, cmd.id) < 0)
			{
				target.push(cmd.id);
			}
		}

		ui.menus.put('seafP41', new Menu(function(menuObj, parent)
		{
			if (p41Items.length > 0)
			{
				ui.menus.addMenuItems(menuObj, p41Items, parent);
			}
		}));
		ui.menus.put('seafTools', new Menu(function(menuObj, parent)
		{
			if (toolsItems.length > 0)
			{
				ui.menus.addMenuItems(menuObj, toolsItems, parent);
			}
		}));
		ui.menus.put('seafExamples', new Menu(function(menuObj, parent)
		{
			if (examplesItems.length > 0)
			{
				ui.menus.addMenuItems(menuObj, examplesItems, parent);
			}
		}));
		mxResources.parse('seafP41=P41');
		mxResources.parse('seafTools=Tools');
		mxResources.parse('seafExamples=Examples');

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
				ui.menus.addSubmenu('seafP41', menuObj, parent, mxResources.get('seafP41'));
				ui.menus.addSubmenu('seafTools', menuObj, parent, mxResources.get('seafTools'));
				ui.menus.addSubmenu('seafExamples', menuObj, parent, mxResources.get('seafExamples'));
				menuObj.addSeparator(parent);
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
			// Resolve edit-data mode for the right-clicked cell (used both for hiding standard item
			// and for inserting SEAF replacement entry).
			var resolvedMode = 'standard';
		var resolvedCell = cell;
			try
			{
				if (cell != null)
				{
				var target = resolveEditDataTarget(cell, graph);
				resolvedCell = target && target.cell ? target.cell : cell;
				var schemaKey = target && typeof target.schema === 'string' ? target.schema : '';
					resolvedMode = getEditDataModeForSchema(schemaKey);
				}
			}
			catch (eMode)
			{
				resolvedMode = 'standard';
			}

			// In seaf-mode hide the standard "Edit Data" before the base call assembles the menu.
			// Restored after the base call so other entry points (Edit menu, etc.) are unaffected.
			var prevHiddenItems = ui.menus.hiddenMenuItems;
			var hiddenOverridden = false;
			try
			{
				if (resolvedMode === 'seaf')
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

			// Insert explicit SEAF Edit Data entry for seaf/both modes immediately after the base items.
		if (resolvedCell != null && (resolvedMode === 'seaf' || resolvedMode === 'both'))
			{
				try
				{
				var seafLabel = mxResources.get('seafEditData');
				menu.addItem(seafLabel, null, function()
				{
					var action = ui.actions.get('seafEditData');
					if (action != null && typeof action.funct === 'function')
					{
						action.funct(evt);
					}
				}, null, null, true);
					writeLog('debug', 'seafEditData menu item inserted', {
						mode: resolvedMode,
					cellId: (resolvedCell && resolvedCell.id) ? String(resolvedCell.id) : null
					});
				}
				catch (eInsert)
				{
					writeLog('error', 'seafEditData menu item insertion failed', {
						error: eInsert && eInsert.message ? eInsert.message : String(eInsert)
					});
				}
			}

			var inserted = false;
			var commands = state.config.commands || [];
			var contextCommands = [];

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
					if (!inserted)
					{
						this.addMenuItems(menu, ['-'], null, evt);
						inserted = true;
					}

					this.addMenuItems(menu, [contextCommands[i].id], null, evt);
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

		// SEAF Edit Data action: explicit entry-point for the SEAF dialog (used in context menu and elsewhere).
		mxResources.parse('seafEditData=Редактировать данные (SEAF)…');
		if (ui.actions.get('seafEditData') == null)
		{
			ui.actions.addAction('seafEditData', function()
			{
				try
				{
					var graph = ui && ui.editor ? ui.editor.graph : null;
				var sourceCell = graph ? (graph.getSelectionCell() || state.contextMenuLastCell ||
					(graph.getModel ? graph.getModel().getRoot() : null)) : null;
				var target = resolveEditDataTarget(sourceCell, graph);
				var cell = target && target.cell ? target.cell : sourceCell;
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
						executeCommand(command, 'menu');
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
				runtimeVersion: state.runtimeVersion || 'unknown'
			});
			await runInitStep('python_env_auto', ensurePythonEnvironmentAuto, true);
			await runInitStep('stencil_libraries_load', loadSeafStencilLibraries, false);
			await runInitStep('load_stencils_layer_config', loadStencilsLayerConfig, false);
			await runInitStep('stencil_index_rebuild', function()
			{
				rebuildStencilIndex();
				return Promise.resolve();
			}, false);
			await runInitStep('install_stencil_model_listener', installStencilModelListener, false);
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
