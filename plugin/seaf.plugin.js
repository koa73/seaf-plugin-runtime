/**
 * SEAF plugin for draw.io desktop runtime.
 * Runtime script version: 0.2.22
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
		seafStencilPaletteIds: []
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
			out.push({
				id: cell.id,
				isVertex: graph.model.isVertex(cell),
				isEdge: graph.model.isEdge(cell),
				label: graph.convertValueToString(cell),
				style: sanitizeForIpc(graph.getCellStyle(cell)),
				geometry: sanitizeForIpc(graph.getCellGeometry(cell))
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
			state.logging = computeUiLoggingFromEnv(state.config ? state.config.logging : null, state.envConfig);

			await writeLog('info', 'Plugin initialization started', {
				configPath: state.configPath,
				commandsCount: Array.isArray(state.config.commands) ? state.config.commands.length : 0,
				runtimeVersion: state.runtimeVersion || 'unknown'
			});
			await runInitStep('python_env_auto', ensurePythonEnvironmentAuto, true);
			await runInitStep('stencil_libraries_load', loadSeafStencilLibraries, false);

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
