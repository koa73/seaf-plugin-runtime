/**
 * SEAF bulk Edit Data table (Tabulator). Loaded by seaf.plugin.js on demand.
 */
(function(global)
{
	'use strict';

	var META_FIELDS = ['objectId', 'pageId', 'pageName', 'schema', 'oid'];

	function cloneData(obj)
	{
		try
		{
			return JSON.parse(JSON.stringify(obj || {}));
		}
		catch (e)
		{
			return {};
		}
	}

	function collectFieldNames(rows, hiddenSet)
	{
		var names = {};
		var hidden = hiddenSet || {};
		for (var i = 0; i < rows.length; i++)
		{
			var data = (rows[i] && rows[i].data) ? rows[i].data : {};
			for (var key in data)
			{
				if (!Object.prototype.hasOwnProperty.call(data, key))
				{
					continue;
				}
				var name = String(key).trim();
				if (!name || hidden[name] === true)
				{
					continue;
				}
				names[name] = true;
			}
		}
		return Object.keys(names).sort(function(a, b)
		{
			return a.localeCompare(b, undefined, {sensitivity: 'base'});
		});
	}

	function buildTableRows(schemaObjects)
	{
		var out = [];
		for (var i = 0; i < schemaObjects.length; i++)
		{
			var item = schemaObjects[i] || {};
			var data = (item.data && typeof item.data === 'object') ? item.data : {};
			var row = {
				objectId: item.objectId || '',
				pageId: item.pageId || '',
				pageName: item.pageName || '',
				schema: item.schema || '',
				oid: item.oid || data.OID || '',
				__snapshot: {
					data: cloneData(data),
					linkedPageId: item.linkedPageId || ''
				}
			};
			for (var key in data)
			{
				if (Object.prototype.hasOwnProperty.call(data, key))
				{
					row[key] = data[key];
				}
			}
			out.push(row);
		}
		return out;
	}

	function buildEditedRowsPayload(tableRows, hiddenSet)
	{
		var hidden = hiddenSet || {};
		var out = [];
		for (var i = 0; i < tableRows.length; i++)
		{
			var row = tableRows[i] || {};
			var snapshot = (row.__snapshot && row.__snapshot.data) ? row.__snapshot.data : {};
			var data = cloneData(snapshot);
			for (var key in row)
			{
				if (!Object.prototype.hasOwnProperty.call(row, key))
				{
					continue;
				}
				if (META_FIELDS.indexOf(key) >= 0 || key.indexOf('__') === 0)
				{
					continue;
				}
				data[key] = row[key];
			}
			for (var hiddenKey in hidden)
			{
				if (Object.prototype.hasOwnProperty.call(hidden, hiddenKey) && hidden[hiddenKey] === true &&
					Object.prototype.hasOwnProperty.call(snapshot, hiddenKey))
				{
					data[hiddenKey] = snapshot[hiddenKey];
				}
			}
			out.push({
				objectId: String(row.objectId || '').trim(),
				schema: String(row.schema || '').trim(),
				oid: String(row.oid || data.OID || '').trim(),
				data: data
			});
		}
		return out;
	}

	function buildColumns(deps, schema, fieldNames, lockSet, hiddenSet, showHidden, optionalVisible)
	{
		var columns = [];
		var lockTooltip = deps.getSeafEditDataLockTooltip ? deps.getSeafEditDataLockTooltip() : '';
		columns.push({
			title: 'Страница',
			field: 'pageName',
			width: 140,
			headerSort: true,
			editable: false,
			frozen: true
		});
		columns.push({
			title: 'OID',
			field: 'oid',
			width: 120,
			headerSort: true,
			editable: lockSet.oid !== true,
			editor: lockSet.oid === true ? false : 'input',
			tooltip: lockSet.oid === true ? lockTooltip : undefined
		});

		for (var i = 0; i < fieldNames.length; i++)
		{
			var field = fieldNames[i];
			var isHidden = hiddenSet[field] === true;
			var isLocked = lockSet[field] === true;
			var visible = true;
			if (isHidden)
			{
				visible = showHidden === true;
			}
			else if (optionalVisible && optionalVisible[field] === false)
			{
				visible = false;
			}
			columns.push({
				title: field,
				field: field,
				headerSort: true,
				visible: visible,
				editable: !isLocked,
				editor: isLocked ? false : 'input',
				tooltip: isLocked ? lockTooltip : undefined,
				minWidth: 90
			});
		}
		return columns;
	}

	function openBulkEditDataDialog(deps, opts)
	{
		return new Promise(function(resolve)
		{
			var ui = deps.ui;
			var schema = opts && opts.schema ? String(opts.schema) : '';
			var layerLabel = opts && opts.layerLabel ? String(opts.layerLabel) : schema;
			var schemaObjects = opts && Array.isArray(opts.schemaObjects) ? opts.schemaObjects : [];
			if (!ui || !schema || schemaObjects.length === 0)
			{
				resolve({cancelled: true});
				return;
			}

			var lockList = deps.getDataLockForSchema(schema);
			var hiddenList = deps.getDataHiddenForSchema(schema);
			var lockSet = {};
			var hiddenSet = {};
			var li;
			for (li = 0; li < lockList.length; li++) { lockSet[lockList[li]] = true; }
			for (li = 0; li < hiddenList.length; li++) { hiddenSet[hiddenList[li]] = true; }
			lockSet.oid = true;
			lockSet.OID = true;
			lockSet.schema = true;

			var fieldNames = collectFieldNames(schemaObjects, hiddenSet);
			var optionalVisible = {};
			for (li = 0; li < fieldNames.length; li++)
			{
				optionalVisible[fieldNames[li]] = true;
			}

			var tableRows = buildTableRows(schemaObjects);
			var showHidden = false;
			var dialogWidth = 920;
			var dialogHeight = 560;
			var baseInset = 8;

			var container = document.createElement('div');
			container.style.width = dialogWidth + 'px';
			container.style.height = dialogHeight + 'px';
			container.style.boxSizing = 'border-box';
			container.style.padding = baseInset + 'px';
			container.style.display = 'flex';
			container.style.flexDirection = 'column';
			container.style.overflow = 'hidden';

			var header = document.createElement('div');
			header.style.fontWeight = 'bold';
			header.style.marginBottom = '6px';
			header.textContent = 'Edit Data: ' + layerLabel + ' (' + tableRows.length + ')';
			container.appendChild(header);

			var toolbar = document.createElement('div');
			toolbar.style.display = 'flex';
			toolbar.style.flexWrap = 'wrap';
			toolbar.style.gap = '8px';
			toolbar.style.alignItems = 'center';
			toolbar.style.marginBottom = '6px';

			var showHiddenCb = document.createElement('input');
			showHiddenCb.type = 'checkbox';
			showHiddenCb.id = 'seaf-bulk-show-hidden';
			var showHiddenLabel = document.createElement('label');
			showHiddenLabel.setAttribute('for', 'seaf-bulk-show-hidden');
			showHiddenLabel.appendChild(showHiddenCb);
			showHiddenLabel.appendChild(document.createTextNode(' Показать скрытые (data_hidden)'));
			toolbar.appendChild(showHiddenLabel);

			var columnsBtn = deps.mxUtils.button('Колонки...', function(){});
			columnsBtn.className = 'geBtn';
			toolbar.appendChild(columnsBtn);
			container.appendChild(toolbar);

			var tableHost = document.createElement('div');
			tableHost.style.flex = '1';
			tableHost.style.minHeight = '320px';
			tableHost.style.overflow = 'hidden';
			container.appendChild(tableHost);

			var footer = document.createElement('div');
			footer.style.textAlign = 'right';
			footer.style.marginTop = '8px';
			footer.style.whiteSpace = 'nowrap';
			container.appendChild(footer);

			var tabulator = null;
			var rebuildColumns = function()
			{
				if (!tabulator)
				{
					return;
				}
				tabulator.setColumns(buildColumns(deps, schema, fieldNames, lockSet, hiddenSet, showHidden, optionalVisible));
			};

			showHiddenCb.onchange = function()
			{
				showHidden = showHiddenCb.checked === true;
				rebuildColumns();
			};

			columnsBtn.onclick = function()
			{
				var pickerWrap = document.createElement('div');
				pickerWrap.style.maxHeight = '240px';
				pickerWrap.style.overflowY = 'auto';
				pickerWrap.style.minWidth = '280px';
				for (li = 0; li < fieldNames.length; li++)
				{
					var fname = fieldNames[li];
					if (hiddenSet[fname] === true)
					{
						continue;
					}
					var row = document.createElement('label');
					row.style.display = 'block';
					row.style.marginBottom = '4px';
					var cb = document.createElement('input');
					cb.type = 'checkbox';
					cb.checked = optionalVisible[fname] !== false;
					cb.setAttribute('data-field', fname);
					cb.onchange = function()
					{
						var f = cb.getAttribute('data-field');
						optionalVisible[f] = cb.checked === true;
					};
					row.appendChild(cb);
					row.appendChild(document.createTextNode(' ' + fname));
					pickerWrap.appendChild(row);
				}
				var pickerDlg = document.createElement('div');
				pickerDlg.style.padding = '8px';
				pickerDlg.appendChild(pickerWrap);
				var okPick = deps.mxUtils.button('OK', function()
				{
					ui.hideDialog();
					rebuildColumns();
				});
				okPick.className = 'geBtn gePrimaryBtn';
				var cancelPick = deps.mxUtils.button(deps.mxResources.get('cancel'), function()
				{
					ui.hideDialog();
				});
				cancelPick.className = 'geBtn';
				var pickFooter = document.createElement('div');
				pickFooter.style.textAlign = 'right';
				pickFooter.style.marginTop = '8px';
				pickFooter.appendChild(okPick);
				pickFooter.appendChild(cancelPick);
				pickerDlg.appendChild(pickFooter);
				ui.showDialog(pickerDlg, 320, 300, true, true);
			};

			var cancelBtn = deps.mxUtils.button(deps.mxResources.get('cancel'), function()
			{
				ui.hideDialog();
				resolve({cancelled: true});
			});
			cancelBtn.className = 'geBtn';

			var saveLabel = 'Сохранить';
			try
			{
				if (deps.mxResources && typeof deps.mxResources.get === 'function')
				{
					var saveRes = deps.mxResources.get('save');
					if (typeof saveRes === 'string' && saveRes.length > 0 && saveRes !== 'save')
					{
						saveLabel = saveRes;
					}
				}
			}
			catch (eSaveLabel)
			{
				// keep default
			}
			var saveBtn = deps.mxUtils.button(saveLabel, function()
			{
				var currentRows = tabulator ? tabulator.getData() : tableRows;
				ui.hideDialog();
				resolve({
					cancelled: false,
					save: true,
					editedRows: buildEditedRowsPayload(currentRows, hiddenSet),
					schema: schema
				});
			});
			saveBtn.className = 'geBtn gePrimaryBtn';
			footer.appendChild(saveBtn);
			footer.appendChild(cancelBtn);

			ui.showDialog(container, dialogWidth, dialogHeight, true, true, null, true);

			if (typeof global.Tabulator !== 'function')
			{
				if (deps.showError)
				{
					deps.showError('Tabulator не загружен');
				}
				ui.hideDialog();
				resolve({cancelled: true});
				return;
			}

			tabulator = new global.Tabulator(tableHost, {
				data: tableRows,
				layout: 'fitDataStretch',
				height: '100%',
				pagination: tableRows.length > 100 ? true : false,
				paginationSize: 50,
				paginationSizeSelector: [25, 50, 100],
				movableColumns: true,
				columns: buildColumns(deps, schema, fieldNames, lockSet, hiddenSet, showHidden, optionalVisible)
			});
		});
	}

	global.SeafBulkEditData = {
		openBulkEditDataDialog: openBulkEditDataDialog,
		buildEditedRowsPayload: buildEditedRowsPayload
	};
})(typeof window !== 'undefined' ? window : this);
