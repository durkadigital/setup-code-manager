/** Setup Code Manager: local, administrator-only inventory panel. */
import { translator, protocolNames } from './i18n.js';
import { icon, deviceIcon } from './icons.js';
import { startScanner, scanImage } from './scanner.js';
import { filterRecords, availableRooms, availableFloors, availableLabels, groupRecordsByRoom, SORTS } from './filters.js';
import { sanitizeViewSettings, preferenceKey, loadViewPreferences, normalizeViewPreferences, mergeLocalViews, MAX_SAVED_VIEWS } from './preferences.js';
import { downloadPDF, MAX_PDF_RECORDS } from './pdf.js';
import './qr.js';

const DOMAIN = 'setup_code_manager';
const PROTOCOLS = Object.keys(protocolNames);
const cssURL = new URL('./panel.css', import.meta.url).href;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const isLinked = record => record.linked ?? (record.links || []).some(link => link.active !== false);
const recordCodes = record => (record.codes || []).filter(code => code.value?.trim());
const hasCode = (record, protocol) => recordCodes(record).some(code => !protocol || code.protocol === protocol);
const displayProtocols = record => [...new Set([...(record.protocols || []), ...recordCodes(record).map(code => code.protocol)])].filter(p => PROTOCOLS.includes(p));
const protocolFrom = value => value.startsWith('MT:') ? 'matter' : value.startsWith('X-HM://') ? 'homekit' : /^90\d{30,}$/.test(value) ? 'zwave' : null;
const blankRecord = () => ({ name:'', location:'', manufacturer:'', model:'', serial_number:'', notes:'', archived:false, codes:[], links:[] });

class SetupCodeManagerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode:'open' });
    this.shadowRoot.innerHTML = `<link rel="stylesheet" href="${cssURL}"><div id="app"></div><div id="modal-root"></div><div id="toast-root" aria-live="polite" role="status"></div>`;
    this._t = translator('en');
    this._devices = []; this._haDevices = []; this._revision = 0;
    this._tab = 'all'; this._query = ''; this._protocol = ''; this._codeStatusFilter = 'all'; this._room = '';
    this._floor = ''; this._label = ''; this._sort = 'name-asc'; this._group = 'none'; this._filtersOpen = false; this._advancedFiltersOpen = false; this._viewsOpen = false;
    this._savedViews = []; this._defaultViewId = ''; this._activeViewId = ''; this._viewName = ''; this._preferenceScope = null;
    this._viewsRevision = -1; this._viewsReady = false; this._viewsBusy = false; this._viewsLoadError = ''; this._appliedPreferenceScope = null; this._legacyPreferences = {views:[],defaultViewId:''};
    this._selection = new Set(); this._selecting = false; this._collapsedGroups = new Set();
    this._revealed = new Set(); this._revealedManual = new Set(); this._formRevealed = new Set(); this._compareRevealed = new Set();
    this._loading = true; this._busy = false; this._loadSequence = 0; this._dialogGeneration = 0;
    this._onClick = this._onClick.bind(this);
    this._onInput = this._onInput.bind(this);
    this._onChange = this._onChange.bind(this);
    this.shadowRoot.addEventListener('click', this._onClick);
    this.shadowRoot.addEventListener('input', this._onInput);
    this.shadowRoot.addEventListener('change', this._onChange);
    this.shadowRoot.addEventListener('submit', event => { event.preventDefault(); if (event.target.id === 'record-form') this._save(); });
    this.shadowRoot.addEventListener('keydown', event => { if (event.key !== 'Escape' || this._modal) return; if (this._filtersOpen) { event.preventDefault(); event.stopPropagation(); this._closeFilters(true); } else if (this._selectedId) { event.preventDefault(); event.stopPropagation(); this._closeDetails(); } });
    this.shadowRoot.addEventListener('toggle',event => { const id = event.target.id; if (this.shadowRoot.getElementById?.(id) !== event.target) return; if (id === 'advanced-filters') this._advancedFiltersOpen = event.target.open; if (id === 'saved-views') this._viewsOpen = event.target.open; if (this._filtersOpen && (id === 'advanced-filters' || id === 'saved-views')) this._positionFilterPanel(); },true);
    this._outsideFilters = event => { if (!this._filtersOpen || this._inlineFilters()) return; const path = event.composedPath?.() || []; if (!path.includes(this.shadowRoot.getElementById?.('filter-panel')) && !path.includes(this.shadowRoot.querySelector('[data-action="toggle-filters"]'))) this._closeFilters(); };
    this._resizeFilters = () => { if (this._filtersOpen) this._setupFilterPanel(); };
    this.shadowRoot.addEventListener('focusout',event => {
      if (event.target.localName === 'select' && event.target.closest?.('#inventory-filters')) {
        queueMicrotask(() => { if (this._connected && this._filterControlsPending) this._syncFilterControls(); });
      }
    });
  }
  set hass(value) {
    const languageChanged = this._hass?.language !== value?.language;
    const userChanged = this._hass?.user?.id !== value?.user?.id;
    this._hass = value;
    this._t = translator(value?.language);
    if (userChanged && this._started) {
      if (this._modal?.kind === 'pdf') this._closeModal(true);
      this._preferenceScope = null; this._appliedPreferenceScope = null; this._viewsReady = false; this._viewsBusy = false;
      this._viewsWriteSequence = (this._viewsWriteSequence || 0) + 1; this._viewMigration = null;
      this._savedViews = []; this._defaultViewId = ''; this._activeViewId = ''; this._viewName = ''; this._legacyPreferences = {views:[],defaultViewId:''};
      const defaults = sanitizeViewSettings({});
      this._tab = defaults.tab; this._protocol = defaults.protocol; this._codeStatusFilter = defaults.codeStatus; this._room = defaults.room; this._floor = defaults.floor; this._label = defaults.label; this._sort = defaults.sort; this._group = defaults.group;
      this._query = ''; this._selection.clear(); this._selectedId = null; this._collapsedGroups.clear(); this._revealed.clear(); this._revealedManual.clear();
      this._closeFilters(); this._renderMain();
    }
    if (languageChanged && this._started) { this._renderMain(); if (this._modal?.kind !== 'scanner') this._renderModal(); }
    if (userChanged && this._started) this._refresh(false);
    this._start();
  }
  get hass() { return this._hass; }
  set narrow(value) { this._narrow = value; this.toggleAttribute('narrow', !!value); }
  set panel(value) { this._panel = value; }
  set route(value) { this._route = value; }
  connectedCallback() { this._connected = true; globalThis.document?.addEventListener?.('pointerdown',this._outsideFilters,true); window.addEventListener?.('resize',this._resizeFilters); this._start(); }
  disconnectedCallback() {
    globalThis.document?.removeEventListener?.('pointerdown',this._outsideFilters,true); window.removeEventListener?.('resize',this._resizeFilters);
    this._closeFilters(); this._captureQueue = null; this._pdfRecords = null; this._pdfNotes = false; this._pdfPending = false; this._selection.clear(); this._selectedId = null;
    this._connected = false; this._started = false; this._loadSequence++; this._refreshRequest = null; this._dialogGeneration++; this._draft = null; this._modal = null; this._busy = false;
    this._appliedPreferenceScope = null; this._viewsBusy = false; this._viewMigration = null; this._viewsWriteSequence = (this._viewsWriteSequence || 0) + 1;
    this._revealed.clear(); this._revealedManual.clear();
    this._unsubscribe?.(); this._unsubscribe = null;
    clearTimeout(this._eventTimer); clearTimeout(this._toastTimer);
    this._stopCamera(); this._photoController?.abort(); this._photoController = null; this._readingPhoto = false;
    this.shadowRoot.querySelector('dialog')?.close();
  }
  async _start() {
    if (!this._connected || !this._hass?.callWS || this._started) return;
    this._started = true; this._renderMain();
    await this._refresh();
    if (!this._connected) return;
    if (this._hass.connection?.subscribeEvents && !this._unsubscribe) {
      try {
        const unsubscribe = await this._hass.connection.subscribeEvents(() => {
          clearTimeout(this._eventTimer);
          this._eventTimer = setTimeout(() => this._refresh(false), 150);
        }, `${DOMAIN}_updated`);
        if (!this._connected) unsubscribe(); else this._unsubscribe = unsubscribe;
      } catch { /* Manual refresh remains available when event subscription fails. */ }
    }
  }
  _api(command, data = {}) { return this._hass.callWS({ type:`${DOMAIN}/${command}`, ...data }); }
  _refresh(showLoading = true) {
    const sequence = ++this._loadSequence;
    const promise = this._runRefresh(sequence,showLoading);
    this._refreshRequest = {sequence,promise};
    return promise;
  }
  _latestRefreshResult(sequence) {
    const latest = this._refreshRequest;
    return this._connected && latest?.sequence > sequence ? latest.promise : undefined;
  }
  async _runRefresh(sequence,showLoading) {
    const userId = this._hass?.user?.id;
    if (showLoading && !this._devices.length) { this._loading = true; this._renderMain(); }
    try {
      const result = await this._api('list');
      if (!this._connected || this._hass?.user?.id !== userId) return;
      if (sequence !== this._loadSequence) return this._latestRefreshResult(sequence);
      this._instance = result.instance_id;
      await this._loadViewPreferences(result.view_preferences,result.view_preferences_error);
      if (!this._connected || this._hass?.user?.id !== userId) return;
      if (sequence !== this._loadSequence) return this._latestRefreshResult(sequence);
      this._devices = result.devices || []; this._revision = result.revision;
      const currentIds = new Set(this._devices.map(record => record.id)); this._selection = new Set([...this._selection].filter(id => currentIds.has(id)));
      this._loadError = ''; this._loading = false;
      const previousIdentity = this._draft && JSON.stringify([this._draft.name,this._draft.location]);
      this._applyDraftIdentity();
      if (this._draft && previousIdentity !== JSON.stringify([this._draft.name,this._draft.location]) && this._modal?.kind === 'editor' && !this._busy) this._renderModal();
      if (this._selectedId && !this._devices.some(record => record.id === this._selectedId)) this._selectedId = null;
      this._renderMain();
      return result;
    } catch (error) {
      if (sequence !== this._loadSequence) return this._latestRefreshResult(sequence);
      this._loading = false; this._loadError = this._errorText(error, 'loadFailed'); this._renderMain();
    }
  }
  _errorText(error, fallback = 'saveFailed') {
    const map = { conflict:'revisionConflict', device_removed:'deviceRemoved', duplicate_link:'duplicateLink', archived_target:'archivedTarget', invalid_code:'invalidCode', validation_error:'validationError', unauthorized:'accessDenied', not_allowed:'accessDenied', forbidden:'accessDenied', save_failed:'saveFailed', not_loaded:'loadFailed', insecure_context:'cameraSecure', camera_denied:'cameraDenied', camera_unavailable:'cameraMissing', unsupported_code:'unsupportedQR', image_too_large:'imageTooLarge', image_unreadable:'imageUnreadable', unsupported_image:'unsupportedImage', decoder_unavailable:'decoderMissing', preview_expired:'previewExpired' };
    return this._t(map[error?.code] || fallback);
  }
  _busyBlocks(action) {
    if (['save-view','delete-view','set-default-view','clear-default-view','import-local-views'].includes(action) && (!this._viewsReady || this._viewsBusy)) return true;
    return this._busy && !((this._readingPhoto || this._pdfPending) && action === 'close-modal');
  }
  _button(action, label, image = '', style = '', attrs = '') {
    return `<button type="button" class="button ${style}" data-action="${action}" ${attrs} ${this._busyBlocks(action) ? 'disabled' : ''}>${image ? icon(image) : ''}${esc(label)}</button>`;
  }
  _iconButton(action, label, image, attrs = '') {
    return `<button type="button" class="icon-button" data-action="${action}" title="${esc(label)}" aria-label="${esc(label)}" ${attrs} ${this._busyBlocks(action) ? 'disabled' : ''}>${icon(image)}</button>`;
  }
  _notice(text, style = '', extra = '') { return `<div class="notice ${style}" ${style === 'error' ? 'role="alert"' : ''}>${icon(style === 'success' ? 'check' : style === 'error' || style === 'warning' ? 'warning' : 'info')}<div class="grow">${esc(text)}${extra}</div></div>`; }
  _toast(message) {
    clearTimeout(this._toastTimer);
    this.shadowRoot.getElementById('toast-root').innerHTML = `<div class="toast">${esc(message)}</div>`;
    this._toastTimer = setTimeout(() => { this.shadowRoot.getElementById('toast-root').innerHTML = ''; }, 4200);
  }
  _focusSnapshot() {
    const el = this.shadowRoot.activeElement;
    return el?.dataset.focus ? { key:el.dataset.focus, start:el.selectionStart, end:el.selectionEnd } : null;
  }
  _restoreFocus(snapshot) {
    if (!snapshot) return;
    const el = [...this.shadowRoot.querySelectorAll('[data-focus]')].find(node => node.dataset.focus === snapshot.key);
    if (!el) return;
    el.focus({ preventScroll:true });
    if (typeof snapshot.start === 'number') { try { el.setSelectionRange(snapshot.start, snapshot.end); } catch { /* Select controls have no selection range. */ } }
  }
  _viewSettings() {
    return sanitizeViewSettings({tab:this._tab, protocol:this._protocol, codeStatus:this._codeStatusFilter, room:this._room, floor:this._floor, label:this._label, sort:this._sort, group:this._group});
  }
  _viewStorage() { try { return window.localStorage; } catch { return null; } }
  async _loadViewPreferences(server, error = '') {
    const scope = preferenceKey(this._instance,this._hass?.user?.id);
    if (scope !== this._preferenceScope) {
      this._preferenceScope = scope; this._activeViewId = ''; this._viewName = '';
      this._viewsRevision = -1; this._viewsReady = false; this._viewsBusy = false;
      this._viewsWriteSequence = (this._viewsWriteSequence || 0) + 1;
      this._legacyPreferences = loadViewPreferences(this._viewStorage(),this._instance,this._hass?.user?.id);
      this._savedViews = []; this._defaultViewId = ''; this._viewMigration = null;
    }
    if (!scope) return;
    if (error || !server || !Number.isSafeInteger(server.revision) || server.revision < 0) {
      this._viewsReady = false; this._viewsLoadError = this._t('viewLoadFailed'); return;
    }
    if (server.revision < this._viewsRevision) return;
    // Only a never-written account is auto-migrated. A cleared central account
    // must not resurrect the untouched legacy browser backup on the next load.
    if (server.revision === 0 && !server.views?.length && this._legacyPreferences.views.length) {
      if (this._viewMigration?.scope !== scope) {
        const preferences = clone(this._legacyPreferences);
        const promise = this._api('save_view_preferences',{preferences,expected_revision:0}).catch(err => {
          if (['conflict','preferences_conflict'].includes(err?.code)) return this._api('view_preferences');
          throw err;
        });
        this._viewMigration = {scope,promise};
      }
      try { server = await this._viewMigration.promise; }
      catch {
        if (this._connected && this._preferenceScope === scope) { this._viewsReady = false; this._viewsLoadError = this._t('viewMigrationFailed'); this._viewMigration = null; }
        return;
      }
    }
    if (!this._connected || this._preferenceScope !== scope || preferenceKey(this._instance,this._hass?.user?.id) !== scope) return;
    this._acceptViewPreferences(server);
    if (this._viewsReady && this._appliedPreferenceScope !== scope) {
      this._appliedPreferenceScope = scope;
      if (this._defaultViewId) this._applyView(this._defaultViewId,false);
    }
  }
  _acceptViewPreferences(server) {
    if (!server || !Number.isSafeInteger(server.revision) || server.revision < 0 || server.revision < this._viewsRevision) return false;
    const preferences = normalizeViewPreferences(server);
    this._savedViews = preferences.views; this._defaultViewId = preferences.defaultViewId;
    this._viewsRevision = server.revision; this._viewsReady = true; this._viewsLoadError = '';
    if (this._activeViewId && !this._savedViews.some(view => view.id === this._activeViewId)) { this._activeViewId = ''; this._viewName = ''; }
    return true;
  }
  async _persistViews(views,defaultViewId) {
    if (!this._viewsReady || this._viewsBusy || !this._preferenceScope) return false;
    const scope = this._preferenceScope, sequence = this._viewsWriteSequence = (this._viewsWriteSequence || 0) + 1;
    const current = () => this._connected && this._preferenceScope === scope && preferenceKey(this._instance,this._hass?.user?.id) === scope && this._viewsWriteSequence === sequence;
    this._viewsBusy = true; this._renderMain();
    try {
      const result = await this._api('save_view_preferences',{preferences:{views:clone(views),defaultViewId},expected_revision:this._viewsRevision});
      if (!current()) return false;
      return this._acceptViewPreferences(result);
    } catch (error) {
      if (!current()) return false;
      if (['conflict','preferences_conflict'].includes(error?.code)) {
        try { const latest = await this._api('view_preferences'); if (current()) this._acceptViewPreferences(latest); } catch { /* Keep the last known catalog and report the conflict. */ }
        if (current()) this._toast(this._t('viewConflict'));
      } else this._toast(this._t('viewStorageFailed'));
      return false;
    } finally {
      if (current()) { this._viewsBusy = false; this._renderMain(); }
    }
  }
  async _saveView() {
    const name = this._viewName.trim();
    if (!name) { this._toast(this._t('viewNameRequired')); return; }
    const existing = this._savedViews.find(view => view.id === this._activeViewId && view.name === name);
    if (this._savedViews.some(view => view.id !== existing?.id && view.name.toLocaleLowerCase() === name.toLocaleLowerCase())) { this._toast(this._t('viewNameExists')); return; }
    if (!existing && this._savedViews.length >= MAX_SAVED_VIEWS) { this._toast(this._t('viewLimit')); return; }
    const view = {id:existing?.id || uid(),name,settings:this._viewSettings()};
    const views = existing ? this._savedViews.map(item => item.id === existing.id ? view : item) : [...this._savedViews,view];
    if (!await this._persistViews(views,this._defaultViewId)) return;
    this._activeViewId = view.id; this._viewName = view.name; this._renderMain(); this.shadowRoot.querySelector('[data-field="view-name"]')?.focus({preventScroll:true}); this._toast(this._t('viewSaved'));
  }
  _applyView(id, render = true) {
    const view = this._savedViews.find(item => item.id === id);
    if (!view) return;
    const s = sanitizeViewSettings(view.settings);
    this._tab = s.tab; this._protocol = s.protocol; this._codeStatusFilter = s.codeStatus; this._room = s.room; this._floor = s.floor; this._label = s.label; this._sort = s.sort; this._group = s.group;
    this._query = ''; this._activeViewId = view.id; this._viewName = view.name; this._advancedFiltersOpen = !!(s.floor || s.label || s.group !== 'none');
    this._selection.clear(); this._selectedId = null; this._collapsedGroups.clear(); if (render) this._renderMain();
  }
  async _deleteView() {
    const view = this._savedViews.find(item => item.id === this._activeViewId);
    if (!view || !window.confirm(this._t('deleteViewConfirm',{name:view.name}))) return;
    const views = this._savedViews.filter(item => item.id !== view.id);
    if (!await this._persistViews(views,this._defaultViewId === view.id ? '' : this._defaultViewId)) return;
    this._activeViewId = ''; this._viewName = ''; this._renderMain();
  }
  async _setDefaultView() {
    if (!this._savedViews.some(view => view.id === this._activeViewId)) return;
    await this._persistDefaultView(this._activeViewId);
  }
  async _clearDefaultView() { await this._persistDefaultView(''); }
  async _persistDefaultView(id) {
    if (await this._persistViews(this._savedViews,id)) this._toast(this._t(id ? 'defaultViewSaved' : 'defaultViewCleared'));
  }
  async _importLocalViews() {
    const merged = mergeLocalViews(this._savedViews,this._legacyPreferences.views);
    if (merged.added && await this._persistViews(merged.views,this._defaultViewId)) this._toast(this._t(merged.remaining ? 'localViewsPartial' : 'localViewsImported',{count:merged.added}));
  }
  _visibleDevices() {
    return filterRecords(this._devices, {...this._viewSettings(),query:this._query}, this._hass?.language);
  }
  _structuredFilters() {
    const t = this._t;
    const metadataName = (items,selection,prefix,fallback) => items.find(item => `${prefix}${item.id}` === selection)?.name || t(fallback);
    return [
      this._room && ['room',this._room === 'unassigned' ? t('withoutRoom') : this._room.slice(5)],
      this._floor && ['floor',this._floor === 'unassigned' ? t('withoutFloor') : metadataName(availableFloors(this._devices),this._floor,'floor:','unknownFloor')],
      this._label && ['label',this._label === 'unassigned' ? t('withoutLabel') : metadataName(availableLabels(this._devices),this._label,'label:','unknownLabel')],
      this._protocol && ['protocol',protocolNames[this._protocol]],
      this._codeStatusFilter !== 'all' && ['status',t(this._codeStatusFilter === 'has' ? 'codePresent' : 'missingOnly')],
    ].filter(Boolean);
  }
  _hasFilters() { return !!(this._query.trim() || this._structuredFilters().length); }
  _selectField(field,label,choices,value) {
    return `<label class="filter-field"><span>${esc(label)}</span><select data-field="${field}" data-focus="${field}" ${field === 'saved-view' && (!this._viewsReady || this._viewsBusy) ? 'disabled' : ''}>${choices.map(([id,name]) => `<option value="${esc(id)}" ${value === id ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`;
  }
  _inlineFilters() { return (this.getBoundingClientRect?.().width || window.innerWidth || 1200) <= 800; }
  _renderFilters(count,total) {
    const t = this._t, chips = this._structuredFilters();
    const localViews = mergeLocalViews(this._savedViews,this._legacyPreferences.views);
    const rooms = availableRooms(this._devices,this._hass?.language);
    if (this._room.startsWith('room:') && !rooms.includes(this._room.slice(5))) rooms.push(this._room.slice(5));
    const metadataChoices = (items,prefix,selection,all,none,unknown) => {
      const choices = [['',t(all)],['unassigned',t(none)],...items.map(item => [`${prefix}${item.id}`,item.name])];
      if (selection.startsWith(prefix) && !choices.some(([id]) => id === selection)) choices.push([selection,t(unknown)]);
      return choices;
    };
    const panel = `<section id="filter-panel" class="filter-panel ${this._inlineFilters() ? 'inline' : 'floating'}" aria-label="${esc(t('filters'))}" ${this._filtersOpen ? '' : 'hidden'} ${this._inlineFilters() ? '' : 'popover="auto"'}>
      <div class="filter-panel-heading"><strong>${esc(t('filters'))}</strong>${this._button('close-filters',t('done'),'','text')}</div>
      <div class="filter-options">
        ${this._selectField('room-filter',t('room'),[['',t('allRooms')],['unassigned',t('withoutRoom')],...rooms.map(room => [`room:${room}`,room])],this._room)}
        ${this._selectField('protocol-filter',t('protocol'),[['',t('allProtocols')],...PROTOCOLS.map(p => [p,protocolNames[p]])],this._protocol)}
        ${this._selectField('code-status-filter',t('codeStatus'),[['all',t('allCodes')],['has',t('codePresent')],['missing',t('missingOnly')]],this._codeStatusFilter)}
        <details id="advanced-filters" class="filter-disclosure advanced-filters" ${this._advancedFiltersOpen ? 'open' : ''}><summary>${esc(t('moreFilters'))}</summary><div class="filter-options">
        ${this._selectField('floor-filter',t('floor'),metadataChoices(availableFloors(this._devices,this._hass?.language),'floor:',this._floor,'allFloors','withoutFloor','unknownFloor'),this._floor)}
        ${this._selectField('label-filter',t('haLabel'),metadataChoices(availableLabels(this._devices,this._hass?.language),'label:',this._label,'allLabels','withoutLabel','unknownLabel'),this._label)}
        ${this._selectField('group-filter',t('groupBy'),[['none',t('noGrouping')],['room',t('room')]],this._group)}
        </div><p class="small muted">${esc(t('haFilterHint'))}</p></details>
      </div>
      <details id="saved-views" class="filter-disclosure saved-views" ${this._viewsOpen ? 'open' : ''}><summary>${esc(t('savedViews'))}${this._savedViews.length ? ` (${this._savedViews.length})` : ''}</summary><div class="saved-view-fields">
        ${this._selectField('saved-view',t('savedViews'),[['',t('chooseView')],...this._savedViews.map(view => [view.id,view.id === this._defaultViewId ? `${view.name} (${t('defaultView')})` : view.name])],this._activeViewId)}
        <label class="filter-field"><span>${esc(t('viewName'))}</span><input data-field="view-name" data-focus="view-name" maxlength="80" value="${esc(this._viewName)}" autocomplete="off" ${!this._viewsReady || this._viewsBusy ? 'disabled' : ''}></label>
        <div id="view-actions" class="view-actions">${this._button('save-view',t(this._savedViews.some(view => view.id === this._activeViewId && view.name === this._viewName.trim()) ? 'updateView' : 'saveView'),'','text')}${this._activeViewId ? this._button('delete-view',t('deleteView'),'','text') : ''}${this._activeViewId && this._activeViewId !== this._defaultViewId ? this._button('set-default-view',t('setDefaultView'),'','text') : ''}${this._defaultViewId ? this._button('clear-default-view',t('clearDefaultView'),'','text') : ''}${localViews.added ? this._button('import-local-views',t('importLocalViews',{count:localViews.added}),'','text') : ''}</div>
        <p id="views-load-status" class="small muted" role="status" ${this._viewsLoadError || this._viewsBusy ? '' : 'hidden'}>${esc(this._viewsLoadError || t('viewsSaving'))}</p>
        <p id="default-view-status" class="small muted" ${this._defaultViewId ? '' : 'hidden'}>${esc(t('defaultViewHint',{name:this._savedViews.find(view => view.id === this._defaultViewId)?.name || ''}))}</p>
        <p class="small muted">${esc(t('viewStorageHint'))}</p>
      </div></details>
      <div class="filter-footer">${this._button('reset-filters',t('resetFilters'),'','text')}${this._button('close-filters',t('done'),'','text')}</div>
    </section>`;
    return `<div id="inventory-filters" class="filters">
      <div class="search-row"><label class="search">${icon('search')}<input type="search" data-field="search" data-focus="search" placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}" value="${esc(this._query)}" autocomplete="off" spellcheck="false"></label>
      <button type="button" class="button filter-toggle" data-action="toggle-filters" data-focus="filter-toggle" aria-expanded="${this._filtersOpen}" aria-controls="filter-panel">${icon('filter')}${esc(t('filters'))}${chips.length ? `<span class="count">${chips.length}</span>` : ''}</button>
      ${this._selectField('sort-filter',t('sortBy'),SORTS.map(sort => [sort,t(`sort_${sort}`)]),this._sort)}</div>
      ${panel}
      <div id="active-filter-chips" class="active-filters" ${chips.length ? '' : 'hidden'} aria-label="${esc(t('activeFilters'))}">${chips.map(([key,label]) => `<button type="button" class="chip active" data-action="remove-filter" data-filter="${key}" aria-label="${esc(t('removeFilter',{name:label}))}">${esc(label)}${icon('close')}</button>`).join('')}</div>
      <div id="list-action-summary" class="list-actions"><span class="filter-count" role="status" aria-live="polite">${esc(t('filteredCount',{count,total}))}</span><div>${this._hasFilters() ? this._button('reset-filters',t('resetFilters'),'','text') : ''}${this._button('toggle-selection',t(this._selecting ? 'finishSelection' : 'selectRecords'),'','text')}</div></div>
    </div>`;
  }
  _syncFilterControls() {
    const root = this.shadowRoot.getElementById('inventory-filters');
    if (!root) return;
    const desired = document.createElement('div');
    desired.innerHTML = this._renderFilters(this._visibleDevices().length, this._devices.filter(record => this._tab === 'archive' ? record.archived : !record.archived && (this._tab === 'all' || (this._tab === 'linked') === isLinked(record))).length);
    root.querySelector('#filter-panel').setAttribute('aria-label',this._t('filters'));
    this._filterControlsPending = false;
    for (const el of root.querySelectorAll('[data-field]')) {
      const next = desired.querySelector(`[data-field="${el.dataset.field}"]`);
      if (!next) continue;
      const activeSelect = el.localName === 'select' && this.shadowRoot.activeElement === el;
      if (el.localName === 'select') {
        const signature = node => JSON.stringify([...node.options].map(option => [option.value,option.label,option.disabled]));
        if (signature(el) !== signature(next)) {
          if (activeSelect) this._filterControlsPending = true;
          else el.innerHTML = next.innerHTML;
        }
      }
      if (el.value !== next.value) {
        if (activeSelect) this._filterControlsPending = true;
        else el.value = next.value;
      }
      if (el.disabled !== next.disabled) el.disabled = next.disabled;
      for (const attr of ['aria-label','placeholder']) {
        const value = next.getAttribute(attr);
        if (value !== null) el.setAttribute(attr,value);
      }
      const label = el.parentElement?.querySelector('span');
      const nextLabel = next.parentElement?.querySelector('span');
      if (label && nextLabel) label.textContent = nextLabel.textContent;
    }
    for (const selector of ['#active-filter-chips','#list-action-summary','#view-actions','#views-load-status','#default-view-status','.filter-panel-heading','.filter-footer','#advanced-filters > summary','#saved-views > summary','#advanced-filters p','#saved-views .saved-view-fields > p:last-child']) {
      const el = root.querySelector(selector), next = desired.querySelector(selector);
      if (!el || !next) continue;
      el.innerHTML = next.innerHTML; el.hidden = next.hidden;
      const label = next.getAttribute('aria-label'); if (label !== null) el.setAttribute('aria-label',label);
    }
    for (const [id,open] of [['advanced-filters',this._advancedFiltersOpen],['saved-views',this._viewsOpen]]) {
      const disclosure = root.querySelector(`#${id}`); if (disclosure && disclosure.open !== open) disclosure.open = open;
    }
    const trigger = root.querySelector('[data-action="toggle-filters"]');
    const nextTrigger = desired.querySelector('[data-action="toggle-filters"]');
    trigger.innerHTML = nextTrigger.innerHTML; trigger.setAttribute('aria-expanded',String(this._filtersOpen));
  }
  _setupFilterPanel() {
    const panel = this.shadowRoot.getElementById?.('filter-panel');
    if (!panel) return;
    const inline = this._inlineFilters();
    panel.classList.toggle('inline',inline); panel.classList.toggle('floating',!inline);
    if (inline) {
      try { panel.hidePopover?.(); } catch { /* Already inline. */ }
      panel.removeAttribute('popover'); panel.style.cssText = '';
    } else panel.setAttribute('popover','auto');
    panel.hidden = !this._filtersOpen;
    if (!this._filtersOpen || inline) return;
    // Keep the same top-layer element while results and options are updated.
    if (this._boundFilterPanel !== panel) {
      this._boundFilterPanel = panel;
      panel.addEventListener('toggle',event => { if (event.newState === 'closed' && !panel.matches(':popover-open') && !this._inlineFilters() && this.shadowRoot.getElementById?.('filter-panel') === panel && this._filtersOpen) this._closeFilters(); });
    }
    try { if (panel.showPopover && !panel.matches(':popover-open')) panel.showPopover(); } catch { /* Older clients use the same fixed panel. */ }
    this._positionFilterPanel();
  }
  _positionFilterPanel() {
    const panel = this.shadowRoot.getElementById?.('filter-panel');
    if (!panel || !this._filtersOpen || this._inlineFilters()) return;
    const button = this.shadowRoot.querySelector('[data-action="toggle-filters"]');
    const rect = button?.getBoundingClientRect();
    if (rect) {
      const width = Math.min(470,window.innerWidth - 24);
      const below = window.innerHeight-rect.bottom-20, above = rect.top-20;
      const openBelow = below >= 260 || below >= above;
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${Math.max(120,openBelow ? below : above)}px`;
      panel.style.left = `${Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12))}px`;
      panel.style.top = `${openBelow ? rect.bottom+8 : Math.max(12,rect.top-panel.getBoundingClientRect().height-8)}px`;
    }
  }
  _closeFilters(restoreFocus = false) {
    this._filtersOpen = false;
    const panel = this.shadowRoot.getElementById?.('filter-panel');
    try { panel?.hidePopover?.(); } catch { /* Already closed. */ }
    if (panel) panel.hidden = true;
    const button = this.shadowRoot.querySelector('[data-action="toggle-filters"]');
    button?.setAttribute('aria-expanded','false');
    if (restoreFocus) button?.focus({preventScroll:true});
  }
  _resetFilters() {
    this._query = ''; this._protocol = ''; this._codeStatusFilter = 'all'; this._room = ''; this._floor = ''; this._label = ''; this._activeViewId = ''; this._viewName = '';
    this._selection.clear(); this._renderMain(); this.shadowRoot.querySelector('[data-field="search"]')?.focus({preventScroll:true});
  }
  _renderListRow(record,selected) {
    const t = this._t;
    const action = this._selecting ? 'toggle-record' : 'select';
    const id = esc(record.id);
    const protocols = displayProtocols(record).map(protocol => protocolNames[protocol]).join(', ');
    const codeStatus = this._codeStatus(record, { showMissingIcon: true });
    const haStatus = this._status(record);
    return `<tr data-action="${action}" data-id="${id}" class="${selected?.id === record.id ? 'selected' : ''}">
      <td><div class="device-name">
        ${this._selecting ? `<label class="record-check" data-action="ignore-selection"><input type="checkbox" data-field="record-selection" data-focus="record-selection-${id}" data-id="${id}" aria-label="${esc(t('selectDevice',{name:record.name}))}" ${this._selection.has(record.id) ? 'checked' : ''}></label>` : icon(deviceIcon(record))}
        <div><button type="button" class="row-open" data-focus="record-row-${id}" data-action="${action}" data-id="${id}">${esc(record.name)}</button>
          <div class="mobile-device-meta">
            <div><div class="mobile-meta">${esc([record.location,protocols].filter(Boolean).join(' · '))}</div>
              <div class="mobile-ha-status">${haStatus}</div>
            </div>
            <span class="mobile-code-status">${codeStatus}</span>
          </div>
        </div>
      </div></td>
      <td class="location-column">${esc(record.location || '—')}</td>
      <td>${codeStatus}${protocols ? `<div class="code-protocols">${esc(protocols)}</div>` : ''}</td>
      <td>${haStatus}</td>
    </tr>`;
  }
  _renderDeviceTable(rows,selected) {
    const t = this._t;
    const body = this._group === 'room' ? groupRecordsByRoom(rows,this._hass?.language).map(group => `<tr class="room-group"><td colspan="4"><button type="button" data-action="toggle-group" data-group="${esc(group.key)}" data-focus="room-group-${esc(group.key)}" aria-expanded="${!this._collapsedGroups.has(group.key)}">${icon('chevron')}<strong>${esc(group.roomNames.length > 1 ? t('multipleRooms',{rooms:group.roomNames.join(' · ')}) : group.roomNames[0] || t('withoutRoom'))}</strong><span class="count">${group.records.length}</span></button></td></tr>${this._collapsedGroups.has(group.key) ? '' : group.records.map(record => this._renderListRow(record,selected)).join('')}`).join('') : rows.map(record => this._renderListRow(record,selected)).join('');
    return `<div class="table-wrap"><table class="device-table"><colgroup><col class="device-col" style="width:34%"><col class="location-column" style="width:19%"><col class="codes-col" style="width:21%"><col class="status-col" style="width:26%"></colgroup><thead><tr><th scope="col">${esc(t('device'))}</th><th scope="col" class="location-column">${esc(t('location'))}</th><th scope="col">${esc(t('codes'))}</th><th scope="col">Home Assistant</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  _selectionRecords() { return this._visibleDevices().filter(record => this._selection.has(record.id)); }
  _renderSelectionBar(rows) {
    if (!this._selecting) return '';
    const t = this._t, selected = this._selectionRecords();
    return `<div class="selection-bar"><strong>${esc(t('selectedCount',{count:selected.length}))}</strong>${this._button('select-results',t(rows.length && rows.every(record => this._selection.has(record.id)) ? 'deselectAll' : 'selectResults'),'','text')}${this._button('export-selected',t('export'),'upload','',selected.length ? '' : 'disabled')}${this._button('pdf-selected',t('pdfCards'),'pdf','',selected.length && selected.length <= MAX_PDF_RECORDS ? '' : 'disabled')}</div>`;
  }
  _codeStatus(record, { showMissingIcon = false } = {}) {
    const stored = hasCode(record);
    const symbol = stored || showMissingIcon ? icon(stored ? 'check' : 'warning') : '';
    return `<span class="code-status ${stored ? 'stored' : 'missing'}">${symbol}${esc(this._t(stored ? 'codeStored' : 'noCode'))}</span>`;
  }
  _identityManaged(record = this._draft) { return !!record?.links?.some(link => link.active !== false); }
  _applyDraftIdentity() {
    if (!this._identityManaged()) return;
    const links = this._draft.links.filter(link => link.active !== false);
    const sources = links.map(link => {
      const live = this._devices.flatMap(record => record.links || []).find(item => item.ha_device_id === link.ha_device_id && item.active !== false);
      const cached = this._haDevices.find(device => device.id === link.ha_device_id);
      return live && typeof live.location === 'string' ? live : cached || link;
    });
    if (!sources.every(source => source.name && typeof source.location === 'string')) return;
    const combined = key => [...new Set(sources.map(source => source[key]).filter(Boolean))].sort((a,b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0).join(' / ').slice(0,256);
    this._draft.name = combined('name'); this._draft.location = combined('location');
  }
  _renderIdentity() {
    if (!this._identityManaged()) return this._field('name') + this._field('location');
    const t = this._t;
    return `<section class="record-identity" aria-label="${esc(t('haIdentity'))}"><dl><dt>${esc(t('name'))}</dt><dd>${esc(this._draft.name)}</dd><dt>${esc(t('location'))}</dt><dd>${esc(this._draft.location || t('noArea'))}</dd></dl><p class="small muted">${esc(t('haIdentityHint'))}</p></section>`;
  }
  _status(record) {
    const linked = isLinked(record);
    const available = record.available;
    return `<div class="link-status ${linked ? '' : 'unlinked'}">${icon(linked ? 'link' : 'unlink')}${esc(this._t(linked ? 'linked' : 'unlinked'))}</div>${linked ? `<div class="availability"><span class="dot ${available === true ? 'online' : available === false ? 'offline' : ''}"></span>${esc(this._t(available === true ? 'reachable' : available === false ? 'unavailable' : 'unknownAvailability'))}</div>` : ''}`;
  }
  _renderMain() {
    const snapshot = this._focusSnapshot();
    const listKey = JSON.stringify([this._viewSettings(),this._query]);
    const previousMain = this.shadowRoot.querySelector('.main');
    if (this._renderedListKey !== listKey) this._listScrollTop = 0;
    // Mobile details hide the list; its scrollTop then reads zero. Keep the last
    // visible offset until the same list becomes visible again.
    else if (previousMain?.getClientRects().length) this._listScrollTop = previousMain.scrollTop;
    const detailScroll = this._selectedId && this._renderedSelectedId === this._selectedId
      ? (this.shadowRoot.querySelector('.detail-body') || this.shadowRoot.querySelector('.details'))?.scrollTop : undefined;
    const t = this._t;
    const active = this._devices.filter(record => !record.archived);
    const counts = { all:active.length, linked:active.filter(isLinked).length, unlinked:active.filter(record => !isLinked(record)).length, archive:this._devices.filter(record => record.archived).length };
    const selected = this._devices.find(record => record.id === this._selectedId);
    const rows = this._visibleDevices();
    let content;
    if (this._hass?.user?.is_admin === false) content = this._notice(t('accessDenied'), 'error');
    else if (this._loading) content = `<div class="loading" role="status"><span class="spinner"></span>${esc(t('loading'))}</div>`;
    else if (!rows.length) {
      const filtered = this._hasFilters();
      const title = filtered ? 'noResults' : this._tab === 'archive' ? 'emptyArchive' : this._tab === 'linked' ? 'emptyLinked' : this._tab === 'unlinked' && this._devices.length ? 'emptyUnlinked' : 'emptyTitle';
      content = `<div class="empty">${icon(this._tab === 'archive' ? 'archive' : 'key')}<h2>${esc(t(title))}</h2><p>${esc(t(filtered ? 'noResultsBody' : this._tab === 'archive' ? 'emptyArchiveBody' : 'emptyBody'))}</p>${filtered ? '' : this._button('add',t('add'),'plus','primary')}</div>`;
    } else content = this._renderDeviceTable(rows,selected);
    const markup = `<div class="app"><div id="inventory-workspace" class="workspace ${selected ? 'has-details' : ''}"><main class="main"><header id="inventory-header" class="topbar"><button type="button" class="icon-button menu-button" data-action="ha-menu" aria-label="${esc(t('menu'))}">${icon('menu')}</button><h1>Setup Code Manager</h1><span class="refresh-action">${this._iconButton('refresh', t('refresh'), 'refresh')}</span><span class="mobile-toolbar">${this._iconButton('menu', t('menu'), 'more')}</span></header><div id="inventory-toolbar" class="toolbar">${this._button('add',t('add'),'plus','primary')}${this._button('import',t('import'),'download','secondary-action')}${this._button('export',t('export'),'upload','secondary-action')}${this._button('capture-start',t('captureAction'),'camera','secondary-action')}</div><nav id="inventory-tabs" class="tabs" aria-label="${esc(t('device'))}">${['all','linked','unlinked','archive'].map(tab => `<button type="button" class="tab ${this._tab === tab ? 'active' : ''}" data-action="tab" data-tab="${tab}" aria-pressed="${this._tab === tab}">${esc(t(tab))}<span class="count">${counts[tab]}</span></button>`).join('')}</nav><p id="inventory-caption" class="caption">${esc(t(this._tab === 'archive' ? 'archiveHint' : 'activeHint'))}</p>${this._renderFilters(rows.length, counts[this._tab])}<div id="inventory-error">${this._loadError ? this._notice(this._loadError, 'error', `<div>${this._button('refresh',t('retry'),'refresh','text')}</div>`) : ''}</div><div id="inventory-selection">${this._renderSelectionBar(rows)}</div><div id="inventory-results">${content}</div></main>${selected ? this._renderDetails(selected) : '<aside id="inventory-details" class="details" hidden></aside>'}</div></div>`;
    const incremental = !!this.shadowRoot.getElementById('inventory-results');
    if (incremental) {
      const update = (id,html) => { this.shadowRoot.getElementById(id).innerHTML = html; };
      const desired = document.createElement('div');
      desired.innerHTML = markup;
      for (const id of ['inventory-header','inventory-toolbar','inventory-tabs','inventory-caption','inventory-error','inventory-selection','inventory-results']) update(id,desired.querySelector(`#${id}`).innerHTML);
      this.shadowRoot.getElementById('inventory-tabs').setAttribute('aria-label',t('device'));
      this.shadowRoot.getElementById('inventory-workspace').classList.toggle('has-details',!!selected);
      const detail = this.shadowRoot.getElementById('inventory-details');
      const nextDetail = desired.querySelector('#inventory-details');
      detail.hidden = !selected; detail.innerHTML = nextDetail.innerHTML;
      if (selected) detail.setAttribute('aria-label',selected.name); else detail.removeAttribute('aria-label');
      this._syncFilterControls();
    } else this.shadowRoot.getElementById('app').innerHTML = markup;
    this._renderedListKey = listKey;
    const main = this.shadowRoot.querySelector('.main');
    if (main) main.scrollTop = this._listScrollTop || 0;
    this._renderedSelectedId = selected?.id || null;
    if (detailScroll !== undefined && selected) {
      const scrollBody = this.shadowRoot.querySelector('.detail-body') || this.shadowRoot.querySelector('.details');
      if (scrollBody) scrollBody.scrollTop = detailScroll;
    }
    this._setupFilterPanel();
    // Retained controls already own focus, including while iOS dismisses its picker.
    const filterFocus = ['search','filter-toggle','sort-filter','room-filter','protocol-filter','code-status-filter','floor-filter','label-filter','group-filter','saved-view','view-name'];
    if (!incremental || !filterFocus.includes(snapshot?.key)) this._restoreFocus(snapshot);
  }
  _closeDetails() {
    const id = this._selectedId;
    if (!id) return;
    this._selectedId = null; this._revealed.clear(); this._revealedManual.clear(); this._renderMain();
    const row = [...this.shadowRoot.querySelectorAll('.row-open')].find(element => element.dataset.id === id);
    (row || this.shadowRoot.querySelector('[data-field="search"]'))?.focus();
  }
  _renderDetails(record) {
    const t = this._t;
    const links = record.links || [];
    return `<aside id="inventory-details" class="details" aria-label="${esc(record.name)}"><div class="detail-heading"><div><h2 title="${esc(record.name)}">${esc(record.name)}</h2></div>${this._iconButton('close-details',t('close'),'close')}</div><div class="detail-body"><div class="detail-meta">${this._codeStatus(record)}<p>${esc([record.location,record.model].filter(Boolean).join(' · ') || record.manufacturer || '')}</p>${record.archived ? `<span class="badge">${icon('archive')}${esc(t('archived'))}</span>` : ''}</div><div class="detail-actions">${this._button('edit',t('edit'),'','text',`data-id="${esc(record.id)}"`)}${this._button('pdf-record',t('pdfCard'),'pdf','text',`data-id="${esc(record.id)}"`)}</div><section class="detail-section"><h3>Home Assistant</h3><div class="detail-status">${this._status(record)}</div>${links.some(link => link.active === false) ? `<p class="muted small" style="margin-top:12px">${esc(t('removedHint'))}</p>` : ''}${links.filter(link => link.active !== false).map(link => `<div class="link-item"><span class="small muted">${esc(link.name || record.name)}</span><a class="button" href="/config/devices/device/${encodeURIComponent(link.ha_device_id)}">${icon('external')}${esc(t('openDevice'))}</a></div>`).join('')}${this._button('edit-links',t(links.length ? 'changeLinks' : 'linkDevice'),'link','text',`data-id="${esc(record.id)}"`)}</section><section class="detail-section"><h3>${esc(t('setupCodes'))}</h3>${recordCodes(record).length ? recordCodes(record).map(code => this._renderCode(code)).join('') : `<p class="muted">${esc(t('noCode'))}</p>`}${this._button('edit-codes',t('addCode'),'plus','text',`data-id="${esc(record.id)}" data-focus="detail-code-editor-${esc(record.id)}"`)}</section><section class="detail-section"><h3>${esc(t('note'))}</h3><p class="muted">${esc(record.notes || t('noNote'))}</p>${record.manufacturer || record.serial_number ? `<p class="small muted" style="margin-top:16px">${esc([record.manufacturer, record.serial_number].filter(Boolean).join(' · '))}</p>` : ''}</section><section class="detail-section detail-bottom">${this._button('archive',t(record.archived ? 'restore' : 'archiveAction'),record.archived ? 'restore' : 'archive','text',`data-id="${esc(record.id)}"`)}${this._button('delete',t('delete'),'trash','text danger',`data-id="${esc(record.id)}"`)}</section></div></aside>`;
  }
  _manualValue(code) {
    return code?.protocol === 'matter' && code.value?.startsWith('MT:') && typeof code.manual_value === 'string' && /^(?:[0-9]{11}|[0-9]{21})$/.test(code.manual_value) ? code.manual_value : '';
  }
  _renderManualCode(code) {
    const value = this._manualValue(code);
    if (!value) return '';
    const t = this._t; const revealed = this._revealedManual.has(code.id);
    const formatted = value.length === 11 ? `${value.slice(0,4)}-${value.slice(4,7)}-${value.slice(7)}` : `${value.slice(0,4)}-${value.slice(4,7)}-${value.slice(7,10)}-${value.slice(10,15)}-${value.slice(15,20)}-${value.slice(20)}`;
    return `<div class="manual-code"><div class="code-title"><div><strong>${esc(t('manualCode'))}</strong><small>${esc(t('manualDerived'))}</small></div><div class="code-actions">${this._iconButton('reveal-manual',t(revealed ? 'manualHide' : 'manualReveal'),'eye',`data-code="${esc(code.id)}"`)}${this._iconButton('copy-manual',t('manualCopy'),'copy',`data-code="${esc(code.id)}"`)}</div></div><div class="secret ${revealed ? '' : 'masked'}">${revealed ? esc(formatted) : '••••••••••••'}</div></div>`;
  }
  _renderCode(code) {
    const t = this._t;
    return `<div class="code-card"><div class="code-title"><div><strong>${esc(protocolNames[code.protocol] || code.protocol)}</strong><small>${esc(code.label || t('originalCode'))}</small></div><div class="code-actions">${this._iconButton('reveal',t(this._revealed.has(code.id) ? 'hide' : 'reveal'),'eye',`data-code="${esc(code.id)}"`)}${this._iconButton('copy',t('copy'),'copy',`data-code="${esc(code.id)}"`)}${this._canQR(code) ? this._iconButton('qr',t('qr'),'qr',`data-code="${esc(code.id)}"`) : ''}</div></div>${this._manualValue(code) ? `<div class="code-value-label">${esc(t('qrContent'))}</div>` : ''}<div class="secret ${this._revealed.has(code.id) ? '' : 'masked'}">${this._revealed.has(code.id) ? esc(code.value) : '••••••••••••'}</div>${this._renderManualCode(code)}</div>`;
  }
  async _copyCodeValue(value, successKey = 'copied', failureKey = 'copyFailed') {
    if (!value) return;
    try {
      if (typeof navigator.clipboard?.writeText === 'function') await navigator.clipboard.writeText(value);
      else {
        // Native copy still works during a user click on local HTTP installations.
        const previous = this.shadowRoot.activeElement;
        const input = document.createElement('textarea');
        input.value = value; input.readOnly = true;
        input.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
        this.shadowRoot.appendChild(input);
        try {
          input.focus({preventScroll:true}); input.select();
          if (!document.execCommand?.('copy')) throw new Error('copy_unavailable');
        } finally { input.remove(); previous?.focus({preventScroll:true}); }
      }
      this._toast(this._t(successKey));
    } catch { this._toast(this._t(failureKey)); }
  }
  _canQR(code) { return /^(MT:|X-HM:\/\/)/.test(code.value || '') || code.protocol === 'zwave' && /^90\d{30,}$/.test(code.value || ''); }
  _newDraft(record, fromCodeAction = false) {
    this._dialogGeneration++;
    this._codeEditorFromDetails = fromCodeAction;
    this._draft = clone(record || blankRecord()); this._baseRecord = clone(this._draft);
    this._baseRevision = this._revision; this._dirty = false; this._detected = null; this._moreOpen = false; this._draftError = ''; this._draftErrorCode = '';
    this._formRevealed.clear(); this._compareRevealed.clear(); this._activeProtocol = this._protocol || 'matter';
  }
  _openModal(kind, data = {}) {
    this._closeFilters(); this._stopCamera(); this._modalError = ''; this._modal = { kind,...data };
    this._renderModal();
  }
  _closeModal(force = false, preserveCapture = false) {
    if (this._busyBlocks('close-modal')) return;
    const closingPDF = this._modal?.kind === 'pdf';
    if (this._readingPhoto) {
      this._photoController?.abort(); this._photoController = null; this._readingPhoto = false; this._busy = false;
    }
    if (!force && this._draft && this._dirty && ['editor','picker','choose-record','code-conflict','scanner','start','revision','duplicate'].includes(this._modal?.kind) && !window.confirm(this._t('discard'))) { this._renderModal(); return; }
    const returnToCodeAction = this._codeEditorFromDetails && this._selectedId && this._selectedId === this._draft?.id;
    this._dialogGeneration++; this._stopCamera(); this._photoController?.abort(); this._photoController = null; this._readingPhoto = false; this.shadowRoot.querySelector('dialog')?.close();
    this.shadowRoot.getElementById('modal-root').innerHTML = ''; this._modal = null;
    this._draft = null; this._pendingCodes = null; this._preview = null; this._importSource = null; this._pdfRecords = null; this._pdfNotes = false; this._pdfPending = false;
    this._codeEditorFromDetails = false;
    if (closingPDF) this._busy = false;
    if (!preserveCapture) this._captureQueue = null;
    this._formRevealed.clear(); this._compareRevealed.clear();
    const returnAction = returnToCodeAction ? 'edit-codes' : this._selectedId ? 'edit' : 'add';
    this.shadowRoot.querySelector(`[data-action="${returnAction}"]`)?.focus();
  }
  _modalFrame(title, body, footer = '', wide = false) {
    return `<dialog ${wide ? 'class="wide"' : ''} aria-labelledby="dialog-title"><div class="dialog-shell"><header class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2>${this._iconButton('close-modal',this._t('close'),'close')}</header><div class="dialog-body">${this._modalError ? this._notice(this._modalError,'error') : ''}${body}</div>${footer ? `<footer class="dialog-foot">${footer}</footer>` : ''}</div></dialog>`;
  }
  _renderModal() {
    if (!this._modal) return;
    const snapshot = this._focusSnapshot();
    const previousDialog = this.shadowRoot.querySelector('dialog');
    const more = this.shadowRoot.querySelector('details.more');
    if (more) this._moreOpen = more.open;
    const t = this._t; const kind = this._modal.kind;
    const codeProtocol = kind === 'editor' ? this._captureQueue?.protocol || (this._codeEditorFromDetails ? this._activeProtocol : '') : '';
    const editorScroll = codeProtocol && snapshot && previousDialog?.contains(this.shadowRoot.activeElement)
      && previousDialog.querySelector('[data-focus="code-editor-entry"]')
      ? previousDialog.querySelector('.dialog-body').scrollTop : undefined;
    const cancel = this._button('close-modal',t('cancel'));
    let html = '';
    if (kind === 'start') html = this._modalFrame(t('addTitle'), `<p>${esc(t(this._canLiveScan() ? 'addIntro' : 'photoHint'))}</p><div class="choice-list">${[['start-scan',this._canLiveScan() ? 'scan' : 'takePhoto','camera'],['start-photo','photo','image'],['start-manual','manual','keyboard']].map(([action,label,image]) => `<button type="button" class="choice" data-action="${action}">${icon(image)}<span class="grow">${esc(t(label))}</span>${icon('chevron')}</button>`).join('')}</div><p class="small muted" style="margin-top:22px">${esc(t('noPairing'))}</p>`);
    else if (kind === 'menu') html = this._modalFrame(t('menu'),`<div class="choice-list">${this._button('import',t('import'),'download')}${this._button('export',t('export'),'upload')}${this._button('capture-start',t('captureMissing'),'camera')}${this._button('pdf-filtered',t('pdfCards'),'pdf')}${this._button('refresh-menu',t('refresh'),'refresh')}</div>`);
    else if (kind === 'editor') html = this._renderEditor();
    else if (kind === 'scanner') html = this._modalFrame(t('scanTitle'), `<p>${esc(t('scanHint'))}</p><div id="scanner-error"></div><div class="scanner-frame"><video id="scan-video" autoplay muted playsinline></video><div class="scan-guide"></div><div class="camera-status" id="camera-status">${esc(t('cameraLoading'))}</div></div><p class="small">${esc(t('noPairing'))}</p><div class="scanner-buttons">${this._button('scan-capture',t('takePhoto'),'camera')}${this._button('scan-photo',t('photo'),'image')}${this._button('scan-manual',t('enterCode'),'keyboard')}</div>`);
    else if (kind === 'picker') html = this._renderPicker();
    else if (kind === 'choose-record') html = this._modalFrame(t('selectRecord'), `<p>${esc(t('selectRecordHint'))}</p><div class="choice-list">${this._modal.records.map(record => `<button type="button" class="choice" data-action="use-record" data-id="${esc(record.id)}">${icon(record.archived ? 'archive' : 'key')}<span class="grow">${esc(record.name)}<small class="muted" style="display:block">${esc([record.location,displayProtocols(record).map(p => protocolNames[p]).join(', ')].filter(Boolean).join(' · '))}</small>${record.archived ? `<small class="muted" style="display:block;margin-top:7px">${esc(t('archivedTarget'))}</small>` : ''}</span>${icon('chevron')}</button>`).join('')}</div>`,this._button('back-picker',t('back')));
    else if (kind === 'code-conflict') html = this._modalFrame(t('existingCodeTitle'), `<p>${esc(t('existingCodeHint'))}</p><h3>${esc(protocolNames[this._modal.current.protocol])}</h3><div class="compare-grid">${this._compareCode(this._modal.current,t('existing'),'existing')}${this._compareCode(this._modal.incoming,t('incoming'),'incoming')}</div>`,this._button('keep-code',t('keepExisting'))+this._button('replace-code',t('useIncoming'),'','primary'));
    else if (kind === 'duplicate') html = this._modalFrame(t('duplicateTitle'),this._notice(t('duplicateBody',{names:this._modal.names.join(', ')}),'warning'),this._button('back-editor',t('back'))+this._button('save-anyway',t('saveAnyway'),'','primary'));
    else if (kind === 'delete') html = this._modalFrame(t('deleteTitle'),`<p>${esc(t('deleteBody',{name:this._modal.record.name,count:recordCodes(this._modal.record).length}))}</p>`,cancel+this._button('confirm-delete',t('delete'),'trash','primary danger'));
    else if (kind === 'qr') html = this._modalFrame(t('qr'),`<div id="qr-display" class="qr-display"></div><p style="text-align:center">${esc(this._modal.name)} · ${esc(protocolNames[this._modal.code.protocol])}</p>`,this._button('close-modal',t('close')));
    else if (kind === 'export') html = this._renderExport();
    else if (kind === 'pdf') html = this._renderPDF();
    else if (kind === 'capture-setup') html = this._renderCaptureSetup();
    else if (kind === 'import') html = this._modalFrame(t('importTitle'),`<p>${esc(t('importIntro'))}</p><div class="choice-list">${this._button('pick-import',t('chooseFile'),'download')}</div>`);
    else if (kind === 'preview') html = this._renderPreview();
    else if (kind === 'revision') html = this._renderRevision();
    previousDialog?.close();
    this.shadowRoot.getElementById('modal-root').innerHTML = html;
    const dialog = this.shadowRoot.querySelector('dialog');
    if (!dialog) return;
    let codeEntryTarget, editorAlert;
    if (codeProtocol) {
      const index = this._draft.codes.findIndex(code => code.protocol === codeProtocol);
      const card = dialog.querySelector(`[data-field="code-value"][data-index="${index}"]`)?.closest('.editor-code');
      editorAlert = dialog.querySelector('[role="alert"]');
      codeEntryTarget = editorAlert || card || dialog.querySelector('.editor-section h3');
      if (codeEntryTarget) {
        // Set the native dialog's initial focus before showModal runs its focus steps.
        codeEntryTarget.setAttribute('tabindex','-1');
        codeEntryTarget.setAttribute('autofocus','');
        codeEntryTarget.setAttribute('data-focus','code-editor-entry');
        if (codeEntryTarget === card) {
          card.setAttribute('role','group');
          card.setAttribute('aria-label',protocolNames[codeProtocol]);
        }
      }
    }
    dialog.addEventListener('cancel',event => { event.preventDefault(); this._closeModal(); });
    dialog.showModal();
    if (this._busy) dialog.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = this._busyBlocks(control.dataset.action); });
    if (codeProtocol) {
      if (editorScroll !== undefined && !editorAlert) {
        dialog.querySelector('.dialog-body').scrollTop = editorScroll;
        this._restoreFocus(snapshot);
      } else if (codeEntryTarget) {
        if (this.shadowRoot.activeElement !== codeEntryTarget) codeEntryTarget.focus({preventScroll:true});
        codeEntryTarget.scrollIntoView({block:'start',behavior:'instant'});
      }
    } else if (snapshot && snapshot.key !== 'search') this._restoreFocus(snapshot);
    else if (kind === 'editor') this.shadowRoot.querySelector(this._identityManaged() ? '[data-field="notes"]' : '[data-field="name"]')?.focus({preventScroll:true});
    else if (kind === 'picker') this.shadowRoot.querySelector('[data-field="picker-search"]')?.focus({preventScroll:true});
    if (kind === 'qr') {
      try { this.shadowRoot.getElementById('qr-display').innerHTML = window.SetupCodesQR.renderSVG(this._modal.code.value,{pixelSize:6,whiteColor:'#ffffff',blackColor:'#000000'}); }
      catch { this.shadowRoot.getElementById('qr-display').textContent = t('qrError'); }
    }
  }
  _field(key,type='text',placeholder='') {
    return `<label class="field"><span>${esc(this._t(key === 'notes' ? 'note' : key === 'serial_number' ? 'serial' : key))}${key === 'name' ? ' *' : ''}</span>${type === 'textarea' ? `<textarea data-field="${key}" data-focus="${key}" maxlength="10000">${esc(this._draft[key])}</textarea>` : `<input type="${type}" data-field="${key}" data-focus="${key}" value="${esc(this._draft[key])}" ${key === 'name' ? 'required' : ''} maxlength="256" placeholder="${esc(placeholder)}" autocomplete="off">`}</label>`;
  }
  _renderEditor() {
    this._applyDraftIdentity();
    const t = this._t; const draft = this._draft;
    const errorExtra = this._draftErrorCode === 'conflict' ? `<div>${this._button('compare-revision',t('compareCurrent'),'refresh','text')}</div>` : this._draftErrorCode === 'device_removed' ? `<div>${this._button('unlink-save',t('withoutLinkSave'),'unlink','text')}${this._button('picker',t('pickerTitle'),'link','text')}</div>` : this._draftErrorCode === 'duplicate_link' || this._draftErrorCode === 'archived_target' ? `<div>${this._button('picker',t('pickerTitle'),'link','text')}</div>` : '';
    const body = `${this._captureQueue ? `<div class="capture-progress" role="status">${esc(t('captureProgress',{current:this._captureQueue.index+1,total:this._captureQueue.ids.length,protocol:protocolNames[this._captureQueue.protocol]}))}</div>` : ''}${this._readingPhoto ? `<div class="notice" role="status"><span class="spinner" aria-hidden="true"></span>${esc(t('readingPhoto'))}</div>` : ''}<form id="record-form">${this._detected ? this._notice(t('codeDetected',{protocol:protocolNames[this._detected]}),'success') : ''}${draft.archived ? this._notice(t('archivedTarget')) : ''}${this._draftError ? this._notice(this._draftError,'error',errorExtra) : ''}${this._renderIdentity()}${this._field('notes','textarea')}<details class="more" ${this._moreOpen ? 'open' : ''}><summary>${esc(t('moreDetails'))}</summary><div><div class="field-row">${this._field('manufacturer')}${this._field('model')}</div>${this._field('serial_number')}</div></details><section class="editor-section"><h3>${esc(t('setupCodes'))}</h3>${draft.codes.map((code,index) => `<div class="editor-code"><div class="code-title"><select data-field="code-protocol" data-index="${index}" aria-label="${esc(t('protocol'))}" ${this._captureQueue ? 'disabled' : ''}>${PROTOCOLS.map(p => `<option value="${p}" ${code.protocol === p ? 'selected' : ''} ${draft.codes.some((other,i) => i !== index && other.protocol === p) ? 'disabled' : ''}>${protocolNames[p]}</option>`).join('')}</select>${this._iconButton('remove-code',t('removeCode'),'trash',`data-index="${index}"`)}</div><label class="field"><span>${esc(t('codeValue'))}</span><div class="input-secret"><input type="${this._formRevealed.has(code.id) ? 'text' : 'password'}" data-field="code-value" data-focus="code-${index}" data-index="${index}" value="${esc(code.value)}" autocomplete="off" spellcheck="false" maxlength="4096">${this._iconButton('form-reveal',t(this._formRevealed.has(code.id) ? 'hide' : 'reveal'),'eye',`data-index="${index}"`)}</div></label><div class="code-tools">${this._button('code-scan',t(this._canLiveScan() ? (code.value ? 'rescan' : 'scan') : 'takePhoto'),'camera','text',`data-protocol="${code.protocol}"`)}${this._button('code-photo',t('photo'),'image','text',`data-protocol="${code.protocol}"`)}</div><label class="field"><span>${esc(t('codeLabel'))}</span><input type="text" data-field="code-label" data-focus="label-${index}" data-index="${index}" value="${esc(code.label)}" placeholder="${esc(t('codeLabelPlaceholder'))}" maxlength="256"></label></div>`).join('')}${draft.codes.length < PROTOCOLS.length ? this._button('add-slot',t('addCode'),'plus','text') : ''}</section><section class="editor-section"><h3>Home Assistant</h3><div class="link-box">${draft.links?.length ? draft.links.map((link,index) => `<div class="link-item">${icon('link')}<span>${esc(link.name || this._haDevices.find(d => d.id === link.ha_device_id)?.name || this._devices.find(r => r.links?.some(l => l.ha_device_id === link.ha_device_id))?.name || link.ha_device_id)}${link.active === false ? `<small class="muted" style="display:block">${esc(t('unlinked'))}</small>` : ''}</span>${this._iconButton('remove-link',t('removeLink'),'close',`data-index="${index}"`)}</div>`).join('') : `<p class="muted">${esc(t('noLink'))}</p>`}${this._captureQueue ? '' : this._button('picker',t(draft.links?.length ? 'changeLinks' : 'linkDevice'),'link','text')}<p class="muted">${esc(t('linkLater'))}</p></div></section></form>`;
    return this._modalFrame(t(draft.id ? 'editTitle' : 'addTitle'),body,this._button('close-modal',t(this._captureQueue ? 'endCapture' : 'cancel'))+(this._captureQueue ? this._button('capture-skip',t('skipCapture')) : '')+`<button type="submit" form="record-form" class="button primary" ${this._busy ? 'disabled' : ''}>${this._busy && !this._readingPhoto ? '<span class="spinner"></span>' : ''}${esc(t(this._busy && !this._readingPhoto ? 'saving' : this._captureQueue ? 'saveNext' : 'save'))}</button>`);
  }
  _pickerRecords(device) { return this._devices.filter(record => (device.record_ids || []).includes(record.id) || record.links?.some(link => link.ha_device_id === device.id)); }
  _pickerMissing(device) { return !this._pickerRecords(device).some(record => hasCode(record,this._activeProtocol)); }
  _renderPicker() {
    const t = this._t;
    const query = (this._pickerQuery || '').trim().toLocaleLowerCase();
    const devices = this._haDevices.filter(device => (this._pickerAll || this._pickerMissing(device)) && (!query || [device.name,device.location,device.manufacturer,device.model,...(device.integration_names || [])].join(' ').toLocaleLowerCase().includes(query)))
      .sort((a,b) => Number(b.protocols?.includes(this._activeProtocol)) - Number(a.protocols?.includes(this._activeProtocol)) || (a.name || '').localeCompare(b.name || '',this._hass?.language));
    const body = `<label class="search">${icon('search')}<input type="search" data-field="picker-search" data-focus="picker-search" value="${esc(this._pickerQuery || '')}" placeholder="${esc(t('pickerSearch'))}" aria-label="${esc(t('pickerSearch'))}"></label><div class="picker-filters"><button type="button" class="chip ${this._pickerAll ? '' : 'active'}" data-action="picker-missing" aria-pressed="${!this._pickerAll}">${esc(t('missingProtocol',{protocol:protocolNames[this._activeProtocol]}))}</button><button type="button" class="chip ${this._pickerAll ? 'active' : ''}" data-action="picker-all" aria-pressed="${!!this._pickerAll}">${esc(t('allHA'))}</button></div>${this._pickerLoading ? `<div class="loading"><span class="spinner"></span>${esc(t('loading'))}</div>` : `<div class="picker-list">${devices.length ? devices.map(device => {
      const records = this._pickerRecords(device);
      const others = [...new Set(records.flatMap(record => recordCodes(record).filter(code => code.protocol !== this._activeProtocol).map(code => protocolNames[code.protocol])))];
      return `<button type="button" class="picker-item" data-action="pick-device" data-id="${esc(device.id)}">${icon(deviceIcon(device))}<span class="grow"><strong>${esc(device.name)}</strong><small>${esc([device.location,[device.manufacturer,device.model].filter(Boolean).join(' '),(device.integration_names || []).join(', ')].filter(Boolean).join(' · '))}</small><small class="status-text">${esc(t(this._pickerMissing(device) ? 'missingProtocolStatus' : 'hasProtocolStatus',{protocol:protocolNames[this._activeProtocol]}))}${others.length ? ` · ${esc(t('otherCodes',{protocols:others.join(', ')}))}` : ''}</small>${device.via_device_id ? `<small>${esc(t('childDevice'))}</small>` : ''}${records.some(record => record.archived) ? `<small>${esc(t('archived'))}</small>` : ''}</span>${icon('chevron')}</button>`;
    }).join('') : `<div class="empty"><h2>${esc(t('noHA'))}</h2><p>${esc(t('noHAHint'))}</p>${this._button('picker-all',t('allHA'),'','text')}</div>`}</div>`}`;
    return this._modalFrame(t('pickerTitle'),body,this._button('back-editor',t('back'))+this._button('without-link',t('withoutLink'),'','text'));
  }
  async _openPicker() {
    this._pickerQuery = ''; this._pickerAll = false; this._pickerLoading = true;
    this._openModal('picker');
    try {
      const [result] = await Promise.all([this._api('ha_devices'),this._refresh(false)]);
      if (this._modal?.kind !== 'picker') return;
      this._haDevices = result.devices || []; this._pickerLoading = false; this._renderModal();
    } catch (error) {
      if (this._modal?.kind !== 'picker') return;
      this._pickerLoading = false; this._modalError = this._errorText(error,'loadFailed'); this._renderModal();
    }
  }
  _selectHADevice(id) {
    const device = this._haDevices.find(item => item.id === id);
    if (!device) return;
    this._pendingDevice = device;
    const records = this._pickerRecords(device);
    if (records.length > 1 || records.some(record => record.archived) || records.length && this._draft.id && records[0].id !== this._draft.id) {
      this._openModal('choose-record',{records}); return;
    }
    this._useHADevice(device,records[0]);
  }
  _useHADevice(device,record) {
    const originalDraft = this._draft;
    const changedCodes = recordCodes(originalDraft).filter(code => !this._baseRecord?.id || !this._baseRecord.codes?.some(base => base.protocol === code.protocol && base.value === code.value && base.label === code.label));
    if (record && record.id !== originalDraft.id) {
      this._draft = clone(record);
      this._baseRecord = clone(record); this._baseRevision = this._revision;
      // Existing inventory metadata is authoritative; only explicitly entered codes are carried over.
      this._pendingCodes = changedCodes.map(code => clone(code));
    } else {
      this._pendingCodes = [];
      for (const key of ['name','location','manufacturer','model','serial_number']) if (!this._draft[key]) this._draft[key] = device[key] || '';
    }
    this._draft.links ||= [];
    const selectedLink = this._draft.links.find(link => link.ha_device_id === device.id);
    if (selectedLink) Object.assign(selectedLink,{active:true,name:device.name,location:device.location,available:device.available});
    else this._draft.links.push({ ha_device_id:device.id, name:device.name, location:device.location, active:true, available:device.available });
    this._applyDraftIdentity();
    this._dirty = true; this._draftError = ''; this._draftErrorCode = '';
    this._applyPendingCodes();
  }
  _applyPendingCodes() {
    while (this._pendingCodes?.length) {
      const incoming = this._pendingCodes.shift();
      const current = this._draft.codes.find(code => code.protocol === incoming.protocol);
      if (current?.value && current.value !== incoming.value) { this._openModal('code-conflict',{current,incoming}); return; }
      if (current) { if (!current.value) Object.assign(current,{value:incoming.value,label:incoming.label || current.label}); }
      else this._draft.codes.push({...incoming,id:uid()});
    }
    this._openModal('editor');
  }
  _compareCode(code,title,key) {
    const visible = this._compareRevealed.has(key);
    return `<div class="compare-box"><h3>${esc(title)}</h3><div class="secret ${visible ? '' : 'masked'}">${visible ? esc(code?.value || '—') : '••••••••••••'}</div>${this._button('compare-reveal',this._t(visible ? 'hide' : 'reveal'),'eye','text',`data-key="${esc(key)}"`)}</div>`;
  }
  _compareRecord(record,title,key) {
    if (!record) return `<div class="compare-box"><h3>${esc(title)}</h3><p>—</p></div>`;
    const t = this._t;
    return `<div class="compare-box"><h3>${esc(title)}</h3><dl>${[['name','name'],['location','location'],['manufacturer','manufacturer'],['model','model'],['serial_number','serial'],['notes','note']].map(([field,label]) => `<dt>${esc(t(label))}</dt><dd>${esc(record[field] || '—')}</dd>`).join('')}<dt>${esc(t('archive'))}</dt><dd>${esc(t(record.archived ? 'archived' : 'activeHint'))}</dd></dl>${recordCodes(record).map((code,index) => `<div style="margin-top:12px"><strong class="small">${esc(protocolNames[code.protocol] || code.protocol)}</strong><div class="secret ${this._compareRevealed.has(`${key}-${index}`) ? '' : 'masked'}">${this._compareRevealed.has(`${key}-${index}`) ? esc(code.value) : '••••••••••••'}</div>${code.label ? `<small class="muted">${esc(code.label)}</small>` : ''}${this._button('compare-reveal',t(this._compareRevealed.has(`${key}-${index}`) ? 'hide' : 'reveal'),'eye','text',`data-key="${esc(`${key}-${index}`)}"`)}</div>`).join('')}</div>`;
  }
  _renderRevision() {
    const t = this._t;
    const current = this._modal.current;
    return this._modalFrame(t('conflictRecords'),this._notice(t(current ? 'concurrentHint' : 'recordDeleted'),'warning')+`<div class="compare-grid">${this._compareRecord(current,t('newerData'),'revision-current')}${this._compareRecord(this._draft,t('incoming'),'revision-draft')}</div>`,this._button('back-editor',t('back'))+(current ? this._button('load-current',t('useCurrent')) : '')+this._button(current ? 'keep-draft' : 'save-as-new',t(current ? 'keepDraft' : 'saveNew'),'','primary'),true);
  }
  _addSlot(protocol = '') {
    const next = protocol || PROTOCOLS.find(p => !this._draft.codes.some(code => code.protocol === p));
    if (!next || this._draft.codes.some(code => code.protocol === next)) return;
    this._draft.codes.push({id:uid(),protocol:next,value:'',label:''}); this._dirty = true; this._activeProtocol = next;
  }
  _canLiveScan() {
    return globalThis.isSecureContext !== false && typeof globalThis.navigator?.mediaDevices?.getUserMedia === 'function';
  }
  async _startCamera(protocol) {
    // Keep the capture picker inside the original tap; iOS requires user activation.
    if (!this._canLiveScan()) { this._choosePhoto(protocol, true); return; }
    if (protocol) this._activeProtocol = protocol;
    this._openModal('scanner');
    const controller = new AbortController(); this._cameraController = controller;
    const video = this.shadowRoot.getElementById('scan-video');
    const onError = error => {
      if (controller.signal.aborted || this._modal?.kind !== 'scanner') return;
      const el = this.shadowRoot.getElementById('scanner-error');
      if (el) el.innerHTML = this._notice(this._errorText(error,'scanFailed'),'error');
      this.shadowRoot.querySelector('.scanner-frame')?.setAttribute('hidden','');
      this.shadowRoot.getElementById('camera-status')?.setAttribute('hidden','');
    };
    try {
      const stop = await startScanner(video, value => {
        if (controller.signal.aborted || this._modal?.kind !== 'scanner') return;
        this._receiveScan(value);
      },onError,{signal:controller.signal});
      if (controller.signal.aborted || this._modal?.kind !== 'scanner') { stop(); return; }
      this._cameraStop = stop;
      this.shadowRoot.getElementById('camera-status')?.setAttribute('hidden','');
    } catch (error) { if (error?.code !== 'cancelled') onError(error); }
  }
  _stopCamera() {
    this._cameraController?.abort(); this._cameraController = null;
    this._cameraStop?.(); this._cameraStop = null;
  }
  _receiveScan(value) {
    this._stopCamera();
    const protocol = protocolFrom(value);
    if (!protocol) { this._draftError = this._t('unsupportedQR'); this._openModal('editor'); return; }
    if (this._captureQueue && protocol !== this._captureQueue.protocol) { this._draftError = this._t('captureWrongProtocol',{expected:protocolNames[this._captureQueue.protocol],actual:protocolNames[protocol]}); this._openModal('editor'); return; }
    this._activeProtocol = protocol; this._detected = protocol; this._dirty = true;
    this._pendingCodes = [{id:uid(),protocol,value,label:''}];
    this._applyPendingCodes();
  }
  _chooseFile(accept,onFile,{capture = false} = {}) {
    const input = document.createElement('input'); input.type = 'file'; input.accept = accept;
    if (capture) input.setAttribute('capture','environment');
    input.style.display = 'none'; this.shadowRoot.appendChild(input);
    input.addEventListener('change',() => { const file = input.files?.[0]; input.remove(); if (file) onFile(file); },{once:true});
    input.addEventListener('cancel',() => input.remove(),{once:true});
    input.click();
  }
  _choosePhoto(protocol,capture = false) {
    const generation = this._dialogGeneration;
    if (protocol) this._activeProtocol = protocol;
    this._chooseFile('image/*',async file => {
      if (generation !== this._dialogGeneration || !this._draft) return;
      this._photoController?.abort();
      const controller = new AbortController(); this._photoController = controller;
      this._stopCamera(); this._busy = true; this._readingPhoto = true; this._draftError = '';
      if (this._modal?.kind !== 'editor') this._openModal('editor');
      else this._renderModal();
      try {
        const value = await scanImage(file,{signal:controller.signal});
        if (generation !== this._dialogGeneration || !this._draft || controller.signal.aborted) return;
        this._busy = false; this._readingPhoto = false; this._receiveScan(value);
      } catch (error) {
        if (generation !== this._dialogGeneration || !this._draft || controller.signal.aborted) return;
        this._busy = false; this._readingPhoto = false; this._draftError = this._errorText(error,'scanFailed'); this._openModal('editor');
      } finally { if (this._photoController === controller) this._photoController = null; }
    },{capture});
  }
  async _save(ignoreDuplicates = false) {
    if (!this._draft || this._busy) return;
    this._applyDraftIdentity();
    const form = this.shadowRoot.getElementById('record-form');
    if (form && !form.reportValidity()) return;
    const record = Object.fromEntries(['id','name','manufacturer','model','serial_number','location','notes','archived','codes','links','created_at','updated_at','source_refs'].filter(key => this._draft[key] !== undefined).map(key => [key,clone(this._draft[key])]));
    record.links = (record.links || []).map(link => ({ha_device_id:link.ha_device_id,...(typeof link.active === 'boolean' ? {active:link.active} : {})}));
    record.name = record.name.trim();
    record.codes = record.codes.filter(code => code.value?.trim()).map(({id,protocol,value,label}) => ({id,protocol,value:value.trim(),label}));
    if (this._captureQueue && (record.id !== this._captureQueue.ids[this._captureQueue.index] || !hasCode(record,this._captureQueue.protocol))) { this._draftError = this._t('captureCodeRequired',{protocol:protocolNames[this._captureQueue.protocol]}); this._openModal('editor'); return; }
    if (!record.name) { this._draftError = this._t('validationError'); this._openModal('editor'); return; }
    if (!ignoreDuplicates) {
      const matches = this._devices.filter(other => other.id !== record.id && recordCodes(other).some(code => record.codes.some(incoming => incoming.protocol === code.protocol && incoming.value === code.value)));
      if (matches.length) { this._openModal('duplicate',{names:matches.map(item => item.name)}); return; }
    }
    const generation = this._dialogGeneration, draft = this._draft, queue = this._captureQueue || null;
    this._busy = true; this._modal = {kind:'editor'}; this._renderModal();
    try {
      const result = await this._api('save',{record,expected_revision:this._baseRevision});
      if (generation !== this._dialogGeneration || draft !== this._draft) return;
      this._busy = false; this._dirty = false;
      this._selectedId = result.id || result.record?.id || record.id;
      this._closeModal(true,!!queue); const closedGeneration = this._dialogGeneration; this._busy = true;
      const refreshed = await this._refresh(false);
      if (closedGeneration !== this._dialogGeneration || (this._captureQueue || null) !== queue) return;
      this._busy = false;
      if (queue && !refreshed) { this._captureQueue = null; this._renderMain(); this._toast(this._t('captureRefreshFailed')); }
      else if (queue) { queue.index++; queue.saved++; this._openCaptureStep(); }
      else { this._renderMain(); this._toast(this._t('saved')); }
    } catch (error) {
      if (generation !== this._dialogGeneration || draft !== this._draft) return;
      this._busy = false; this._draftError = this._errorText(error); this._draftErrorCode = error?.code || '';
      this._modal = {kind:'editor'}; this._renderModal();
    }
  }
  async _archiveRecord(record) {
    this._busy = true; this._renderMain();
    try {
      await this._api('archive',{record_id:record.id,archived:!record.archived,expected_revision:this._revision});
      this._selectedId = null; this._busy = false; await this._refresh(false); this._toast(this._t(record.archived ? 'restored' : 'archived'));
    } catch (error) { this._busy = false; this._loadError = this._errorText(error); await this._refresh(false); this._toast(this._errorText(error)); }
  }
  async _deleteRecord() {
    const record = this._modal.record; const expected = this._modal.revision;
    this._busy = true; this._renderModal();
    try {
      await this._api('delete',{record_id:record.id,expected_revision:expected});
      this._busy = false; this._selectedId = null; this._closeModal(true); await this._refresh(false); this._toast(this._t('deleted'));
    } catch (error) { this._busy = false; this._modalError = this._errorText(error); this._renderModal(); }
  }
  _openExport(scope = 'all') {
    this._closeFilters(); this._dialogGeneration++; this._exportFormat = 'json'; this._exportScope = scope;
    this._exportScopes = {all:null,visible:this._visibleDevices().map(record => record.id),selected:this._selectionRecords().map(record => record.id)};
    this._openModal('export');
  }
  _renderExport() {
    const t = this._t;
    const scopes = [['all',t('exportScope'),this._devices.length],['visible',t('exportFiltered'),this._exportScopes.visible.length],['selected',t('exportSelected'),this._exportScopes.selected.length]];
    const body = `<fieldset class="scope-options"><legend>${esc(t('exportWhich'))}</legend>${scopes.map(([value,label,count]) => `<label class="check-label"><input type="radio" name="export-scope" data-field="export-scope" value="${value}" ${this._exportScope === value ? 'checked' : ''} ${!count ? 'disabled' : ''}>${esc(label)} <span class="count">${count}</span></label>`).join('')}</fieldset><div class="export-options">${[['json','jsonBackup','JSON'],['csv','tableFormat','CSV']].map(([format,label,description]) => `<label class="export-option"><input type="radio" name="export-format" data-field="export-format" value="${format}" ${(this._exportFormat || 'json') === format ? 'checked' : ''}><div><strong>${esc(t(label))}</strong><small>${description}</small></div></label>`).join('')}</div><p class="small">${esc(t('exportHint'))}</p>${this._notice(t('exportWarning'),'warning')}`;
    const valid = this._exportScope === 'all' || this._exportScopes[this._exportScope]?.length;
    return this._modalFrame(t('exportTitle'),body,this._button('close-modal',t('cancel'))+this._button('download-export',t(this._busy ? 'exporting' : 'export'),'upload','primary',valid ? '' : 'disabled'));
  }
  _openPDF(records) {
    this._closeFilters();
    if (!Array.isArray(records) || !records.length || records.length > MAX_PDF_RECORDS || records.some(record => typeof record?.id !== 'string' || !record.id) || new Set(records.map(record => record.id)).size !== records.length) { this._toast(this._t('pdfLimit',{count:MAX_PDF_RECORDS})); return; }
    // The confirmation needs names and IDs only. Readable codes stay on HA
    // until the explicit request produces the downloadable file.
    this._pdfRecords = records.map(record => ({id:record.id,name:record.name})); this._pdfNotes = false; this._pdfPending = false; this._openModal('pdf');
  }
  _renderPDF() {
    const t = this._t;
    return this._modalFrame(t('pdfCards'),`<p>${esc(t('pdfScope',{count:this._pdfRecords.length}))}</p><p class="small muted">${esc(this._pdfRecords.map(record => record.name).join(', '))}</p><label class="check-label"><input type="checkbox" data-field="pdf-notes" ${this._pdfNotes ? 'checked' : ''} ${this._busy ? 'disabled' : ''}>${esc(t('pdfNotes'))}</label><p class="small">${esc(t('pdfHint'))}</p>${this._notice(t('pdfWarning'),'warning')}`,this._button('close-modal',t('cancel'))+this._button('pdf-confirm',t(this._busy ? 'pdfCreating' : 'createPDF'),'pdf','primary'));
  }
  async _createPDF() {
    if (this._busy || !this._pdfRecords?.length) return;
    const generation = this._dialogGeneration, modal = this._modal, records = this._pdfRecords, userId = this._hass?.user?.id;
    const current = () => this._connected && generation === this._dialogGeneration && modal === this._modal && records === this._pdfRecords && userId === this._hass?.user?.id;
    this._busy = true; this._pdfPending = true; this._renderModal();
    try {
      const result = await this._api('pdf',{record_ids:records.map(record => record.id),include_notes:this._pdfNotes === true,language:this._hass?.language?.toLowerCase().startsWith('de') ? 'de' : 'en'});
      if (!current()) return;
      downloadPDF(result,{expectedCount:records.length});
      this._busy = false; this._pdfPending = false; this._closeModal(true); this._toast(this._t('pdfDownloadStarted'));
    } catch (error) {
      if (!current()) return;
      this._busy = false; this._pdfPending = false;
      this._modalError = this._t(error?.code === 'not_found' ? 'selectionExpired' : error?.code === 'pdf_too_large' ? 'pdfTooLarge' : 'pdfFailed'); this._renderModal();
    }
  }
  _captureCandidates(protocol) {
    return filterRecords(this._devices,{...this._viewSettings(),protocol:'',codeStatus:'all',query:this._query},this._hass?.language).filter(record => !record.archived && !hasCode(record,protocol));
  }
  _renderCaptureSetup() {
    const t = this._t, count = this._captureCandidates(this._captureProtocol).length;
    return this._modalFrame(t('captureMissing'),`<p>${esc(t('captureIntro'))}</p>${this._selectField('capture-protocol',t('protocol'),PROTOCOLS.map(p => [p,protocolNames[p]]),this._captureProtocol)}<p role="status">${esc(t('captureCandidateCount',{count,protocol:protocolNames[this._captureProtocol]}))}</p><p class="small muted">${esc(t('captureScopeHint'))}</p>`,this._button('close-modal',t('cancel'))+this._button('capture-begin',t('beginCapture'),'camera','primary',count ? '' : 'disabled'));
  }
  _startCaptureQueue() {
    const ids = this._captureCandidates(this._captureProtocol).map(record => record.id);
    if (!ids.length) return;
    this._captureQueue = {ids,index:0,saved:0,skipped:0,protocol:this._captureProtocol};
    this._openCaptureStep();
  }
  _openCaptureStep() {
    const queue = this._captureQueue;
    if (!queue) return;
    while (queue.index < queue.ids.length) {
      const record = this._devices.find(item => item.id === queue.ids[queue.index]);
      if (record && !record.archived && !hasCode(record,queue.protocol)) {
        this._selectedId = null; this._newDraft(record); this._activeProtocol = queue.protocol; this._addSlot(queue.protocol); this._dirty = false; this._openModal('editor'); return;
      }
      queue.index++; queue.skipped++;
    }
    this._captureQueue = null; this._closeModal(true); this._selectedId = null; this._renderMain();
    this._toast(this._t('captureFinished',{saved:queue.saved,skipped:queue.skipped}));
  }
  _skipCapture() {
    if (!this._captureQueue || this._busy) return;
    if (this._dirty && !window.confirm(this._t('discard'))) return;
    this._closeModal(true,true); this._captureQueue.index++; this._captureQueue.skipped++; this._openCaptureStep();
  }
  async _export() {
    const generation = this._dialogGeneration, modal = this._modal;
    this._busy = true; this._renderModal();
    try {
      const ids = this._exportScope === 'all' ? null : this._exportScopes?.[this._exportScope];
      if (this._exportScope !== 'all' && !ids?.length) throw {code:'empty_selection'};
      const result = await this._api('export',{format:this._exportFormat || 'json',...(ids ? {record_ids:ids} : {})});
      if (generation !== this._dialogGeneration || modal !== this._modal) return;
      const blob = new Blob([result.content],{type:result.mime});
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = result.filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url),1000);
      this._busy = false; this._closeModal(true);
    } catch (error) { if (generation !== this._dialogGeneration || modal !== this._modal) return; this._busy = false; this._modalError = this._t(error?.code === 'not_found' ? 'selectionExpired' : error?.code === 'empty_selection' ? 'selectionEmpty' : 'saveFailed'); this._renderModal(); }
  }
  _chooseImport() {
    const generation = this._dialogGeneration;
    this._chooseFile('.json,.csv,application/json,text/csv',async file => {
      if (generation !== this._dialogGeneration || this._modal?.kind !== 'import') return;
      if (file.size > 16 * 1024 * 1024) { this._modalError = this._t('fileTooLarge'); this._renderModal(); return; }
      const format = /\.csv$/i.test(file.name) ? 'csv' : /\.json$/i.test(file.name) ? 'json' : null;
      if (!format) { this._modalError = this._t('invalidFile'); this._renderModal(); return; }
      try { const content = await file.text(); if (generation !== this._dialogGeneration || this._modal?.kind !== 'import') return; this._importSource = {format,content,name:file.name}; await this._loadPreview(); }
      catch { if (generation !== this._dialogGeneration) return; this._modalError = this._t('invalidFile'); this._renderModal(); }
    });
  }
  async _loadPreview() {
    if (!this._importSource) return;
    const generation = this._dialogGeneration;
    this._busy = true; this._modalError = ''; this._renderModal();
    try {
      const {format,content} = this._importSource;
      const result = await this._api('preview_import',{format,...(content !== undefined ? {content} : {})});
      if (generation !== this._dialogGeneration || !this._modal) return;
      this._preview = result; this._decisions = Object.fromEntries(result.rows.map(row => [row.key,row.status === 'new' ? 'add' : 'skip']));
      this._importCompare = null; this._compareRevealed.clear(); this._busy = false; this._importErrorCode = '';
      this._openModal('preview');
    } catch (error) { if (generation !== this._dialogGeneration) return; this._busy = false; this._modalError = this._errorText(error,'importFailed'); this._renderModal(); }
  }
  _renderPreview() {
    const t = this._t; const rows = this._preview.rows;
    const counts = Object.fromEntries(['new','unchanged','conflict','invalid'].map(status => [status,rows.filter(row => row.status === status).length]));
    const selected = rows.filter(row => ['add','replace'].includes(this._decisions[row.key])).length;
    const compare = rows.find(row => row.key === this._importCompare);
    const body = `<p>${esc(this._importSource?.name || t('legacyTitle'))}</p><div class="import-summary"><strong>${rows.length} ${esc(t('records'))}</strong>${Object.entries(counts).map(([status,count]) => `<span class="badge status-${status}">${count} ${esc(t(status))}</span>`).join('')}</div><p>${esc(t('previewHint'))}</p>${rows.length ? `<div class="table-wrap"><table class="import-table"><thead><tr><th scope="col">${esc(t('device'))}</th><th scope="col">${esc(t('result'))}</th><th scope="col">${esc(t('action'))}</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.name || '—')}${row.reason ? `<small class="row-reason">${esc(row.reason)}</small>` : ''}</td><td class="status-${row.status}">${esc(t(row.status))}</td><td>${row.status === 'new' ? `<label class="check-label"><input type="checkbox" data-field="import-choice" data-key="${esc(row.key)}" ${this._decisions[row.key] === 'add' ? 'checked' : ''} ${this._busy ? 'disabled' : ''}>${esc(t('addImport'))}</label>` : row.status === 'conflict' ? this._button('import-compare',t(this._decisions[row.key] === 'replace' ? 'replace' : 'compare'),'','',`data-key="${esc(row.key)}"`) : esc(t('skip'))}</td></tr>`).join('')}</tbody></table></div>` : this._notice(t('noImportRows'))}${compare ? `<section class="import-conflict"><h3>${esc(t('conflictRecords'))} · ${esc(compare.name)}</h3><p class="muted small">${esc(t('compareHint'))}</p><div class="compare-grid">${this._compareRecord(compare.existing,t('existing'),'import-existing')}${this._compareRecord(compare.incoming,t('fromFile'),'import-incoming')}</div><div class="compare-choices"><label class="check-label"><input type="radio" name="resolve-${esc(compare.key)}" data-field="resolve-import" data-key="${esc(compare.key)}" value="skip" ${this._decisions[compare.key] === 'skip' ? 'checked' : ''}>${esc(t('keepExisting'))}</label><label class="check-label"><input type="radio" name="resolve-${esc(compare.key)}" data-field="resolve-import" data-key="${esc(compare.key)}" value="replace" ${this._decisions[compare.key] === 'replace' ? 'checked' : ''}>${esc(t('replace'))}</label></div></section>` : ''}<p class="small muted" style="margin-top:15px">${esc(t('skipNotice'))}</p>${['conflict','preview_expired'].includes(this._importErrorCode) ? this._button('preview-again',t('previewAgain'),'refresh') : ''}`;
    return this._modalFrame(t('previewTitle'),body,this._button('close-modal',t('cancel'))+this._button('commit-import',t(this._busy ? 'importing' : 'importSelected',{count:selected}),'','primary',selected && !['conflict','preview_expired'].includes(this._importErrorCode) ? '' : 'disabled'),true);
  }
  async _commitImport() {
    if (this._busy || !this._preview) return;
    const changes = Object.values(this._decisions).filter(value => value !== 'skip').length;
    if (!changes) return;
    this._busy = true; this._renderModal();
    try {
      const result = await this._api('import',{token:this._preview.token,expected_revision:this._preview.revision,decisions:this._decisions});
      this._busy = false; this._closeModal(true); await this._refresh(false); this._toast(this._t('imported',{count:result.imported}));
    } catch (error) {
      this._busy = false; this._importErrorCode = error?.code || '';
      this._modalError = this._t(error?.code === 'conflict' ? 'importConflict' : error?.code === 'preview_expired' ? 'previewExpired' : 'importFailed'); this._renderModal();
    }
  }
  _onInput(event) {
    const el = event.target; const field = el.dataset.field;
    if (['name','location'].includes(field) && this._identityManaged()) return;
    if (field === 'search') { this._query = el.value; this._selection.clear(); this._renderMain(); }
    else if (field === 'view-name') this._viewName = el.value;
    else if (field === 'picker-search') { this._pickerQuery = el.value; this._renderModal(); }
    else if (this._draft && ['name','location','manufacturer','model','serial_number','notes'].includes(field)) { this._draft[field] = el.value; this._dirty = true; }
    else if (this._draft && ['code-value','code-label'].includes(field)) {
      const code = this._draft.codes[Number(el.dataset.index)];
      if (code) { code[field === 'code-value' ? 'value' : 'label'] = el.value; this._dirty = true; this._activeProtocol = code.protocol; }
    }
  }
  _onChange(event) {
    const el = event.target; const field = el.dataset.field;
    const filters = {'protocol-filter':'_protocol','code-status-filter':'_codeStatusFilter','room-filter':'_room','floor-filter':'_floor','label-filter':'_label','sort-filter':'_sort','group-filter':'_group'};
    if (filters[field]) { this[filters[field]] = el.value; if (!['sort-filter','group-filter'].includes(field)) this._selection.clear(); this._renderMain(); }
    else if (field === 'saved-view') this._applyView(el.value);
    else if (field === 'record-selection') { el.checked ? this._selection.add(el.dataset.id) : this._selection.delete(el.dataset.id); this._renderMain(); }
    else if (field === 'export-scope') { this._exportScope = el.value; this._renderModal(); }
    else if (field === 'pdf-notes') this._pdfNotes = el.checked;
    else if (field === 'capture-protocol') { this._captureProtocol = el.value; this._renderModal(); }
    else if (field === 'code-protocol' && this._draft) { this._draft.codes[Number(el.dataset.index)].protocol = el.value; this._activeProtocol = el.value; this._dirty = true; this._renderModal(); }
    else if (field === 'export-format') this._exportFormat = el.value;
    else if (field === 'import-choice') { this._decisions[el.dataset.key] = el.checked ? 'add' : 'skip'; this._renderModal(); }
    else if (field === 'resolve-import') { this._decisions[el.dataset.key] = el.value; this._renderModal(); }
  }
  async _onClick(event) {
    const button = event.target.closest?.('[data-action]');
    if (!button || button.disabled || this._busyBlocks(button.dataset.action)) return;
    const action = button.dataset.action;
    if (action === 'ignore-selection') return;
    const id = button.dataset.id;
    const record = this._devices.find(item => item.id === (id || this._selectedId));
    const code = record?.codes?.find(item => item.id === button.dataset.code);
    try {
      if (action === 'ha-menu') this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));
      else if (action === 'refresh') await this._refresh();
      else if (action === 'refresh-menu') { this._closeModal(true); await this._refresh(); }
      else if (action === 'tab') { this._closeFilters(); this._tab = button.dataset.tab; this._selectedId = null; this._selection.clear(); this._activeViewId = ''; this._renderMain(); }
      else if (action === 'toggle-filters') { if (this._filtersOpen) this._closeFilters(true); else { this._filtersOpen = true; this.shadowRoot.querySelector('[data-action="toggle-filters"]')?.setAttribute('aria-expanded','true'); this._setupFilterPanel(); } }
      else if (action === 'close-filters') this._closeFilters(true);
      else if (action === 'reset-filters') this._resetFilters();
      else if (action === 'remove-filter') { const fields = {room:'_room',floor:'_floor',label:'_label',protocol:'_protocol',status:'_codeStatusFilter'}; const field = fields[button.dataset.filter]; if (field) { this[field] = field === '_codeStatusFilter' ? 'all' : ''; this._selection.clear(); this._renderMain(); this.shadowRoot.querySelector('[data-action="toggle-filters"]')?.focus({preventScroll:true}); } }
      else if (action === 'save-view') await this._saveView();
      else if (action === 'delete-view') await this._deleteView();
      else if (action === 'set-default-view') await this._setDefaultView();
      else if (action === 'clear-default-view') await this._clearDefaultView();
      else if (action === 'import-local-views') await this._importLocalViews();
      else if (action === 'toggle-group') { const key = button.dataset.group; this._collapsedGroups.has(key) ? this._collapsedGroups.delete(key) : this._collapsedGroups.add(key); this._renderMain(); }
      else if (action === 'toggle-selection') { this._selecting = !this._selecting; this._selection.clear(); this._renderMain(); }
      else if (action === 'toggle-record') { this._selection.has(id) ? this._selection.delete(id) : this._selection.add(id); this._renderMain(); }
      else if (action === 'select-results') { const rows = this._visibleDevices(); if (rows.every(item => this._selection.has(item.id))) this._selection.clear(); else this._selection = new Set(rows.map(item => item.id)); this._renderMain(); }
      else if (action === 'export-selected') this._openExport('selected');
      else if (action === 'pdf-selected') this._openPDF(this._selectionRecords());
      else if (action === 'pdf-filtered') this._openPDF(this._visibleDevices());
      else if (action === 'pdf-record' && record) this._openPDF([record]);
      else if (action === 'pdf-confirm') await this._createPDF();
      else if (action === 'capture-start') { this._captureProtocol = this._protocol || 'matter'; this._openModal('capture-setup'); }
      else if (action === 'capture-begin') this._startCaptureQueue();
      else if (action === 'capture-skip') this._skipCapture();
      else if (action === 'select') { this._closeFilters(); this._selectedId = id; this._revealed.clear(); this._revealedManual.clear(); this._renderMain(); this.scrollIntoView({block:'start',behavior:'instant'}); this.shadowRoot.querySelector('.detail-heading h2')?.setAttribute('tabindex','-1'); this.shadowRoot.querySelector('.detail-heading h2')?.focus({preventScroll:true}); }
      else if (action === 'close-details') this._closeDetails();
      else if (action === 'menu') this._openModal('menu');
      else if (action === 'add') { this._newDraft(); this._openModal('start'); }
      else if (['edit','edit-links','edit-codes'].includes(action) && record) {
        this._newDraft(record,action === 'edit-codes');
        if (action === 'edit-codes') this._addSlot();
        if (action === 'edit-links') await this._openPicker(); else this._openModal('editor');
      }
      else if (action === 'close-modal') this._closeModal();
      else if (action === 'start-manual') { this._addSlot(); this._openModal('editor'); }
      else if (action === 'start-scan') await this._startCamera();
      else if (action === 'start-photo') this._choosePhoto();
      else if (action === 'code-scan') await this._startCamera(button.dataset.protocol);
      else if (action === 'code-photo') this._choosePhoto(button.dataset.protocol);
      else if (action === 'scan-capture') this._choosePhoto(undefined,true);
      else if (action === 'scan-photo') this._choosePhoto();
      else if (action === 'scan-manual') { this._addSlot(this._activeProtocol); this._openModal('editor'); }
      else if (action === 'back-editor') this._openModal('editor');
      else if (action === 'add-slot') { this._addSlot(); this._renderModal(); }
      else if (action === 'remove-code') { this._draft.codes.splice(Number(button.dataset.index),1); this._dirty = true; this._renderModal(); }
      else if (action === 'remove-link') { this._draft.links.splice(Number(button.dataset.index),1); this._applyDraftIdentity(); this._dirty = true; this._renderModal(); }
      else if (action === 'form-reveal') { const key = this._draft.codes[Number(button.dataset.index)].id; this._formRevealed.has(key) ? this._formRevealed.delete(key) : this._formRevealed.add(key); this._renderModal(); }
      else if (action === 'reveal' && code) { this._revealed.has(code.id) ? this._revealed.delete(code.id) : this._revealed.add(code.id); this._renderMain(); }
      else if (action === 'reveal-manual' && this._manualValue(code)) { this._revealedManual.has(code.id) ? this._revealedManual.delete(code.id) : this._revealedManual.add(code.id); this._renderMain(); }
      else if (action === 'copy-manual' && this._manualValue(code)) await this._copyCodeValue(this._manualValue(code),'manualCopied','manualCopyFailed');
      else if (action === 'copy' && code) await this._copyCodeValue(code.value);
      else if (action === 'qr' && code) this._openModal('qr',{code,name:record.name});
      else if (action === 'archive' && record) await this._archiveRecord(record);
      else if (action === 'delete' && record) this._openModal('delete',{record,revision:this._revision});
      else if (action === 'confirm-delete') await this._deleteRecord();
      else if (action === 'picker') await this._openPicker();
      else if (action === 'picker-all' || action === 'picker-missing') { this._pickerAll = action === 'picker-all'; this._renderModal(); }
      else if (action === 'pick-device') this._selectHADevice(id);
      else if (action === 'use-record') this._useHADevice(this._pendingDevice,this._devices.find(item => item.id === id));
      else if (action === 'back-picker') this._openModal('picker');
      else if (action === 'without-link') { this._draft.links = []; this._dirty = true; this._openModal('editor'); }
      else if (action === 'keep-code') this._applyPendingCodes();
      else if (action === 'replace-code') { Object.assign(this._modal.current,{value:this._modal.incoming.value,label:this._modal.incoming.label || this._modal.current.label}); this._dirty = true; this._applyPendingCodes(); }
      else if (action === 'compare-reveal') { const key = button.dataset.key; this._compareRevealed.has(key) ? this._compareRevealed.delete(key) : this._compareRevealed.add(key); this._renderModal(); }
      else if (action === 'save-anyway') await this._save(true);
      else if (action === 'compare-revision') { const result = await this._refresh(false); if (result) this._openModal('revision',{current:result.devices.find(item => item.id === this._draft.id),revision:result.revision}); }
      else if (action === 'load-current') { const comparedRevision = this._modal.revision; this._newDraft(this._modal.current); this._baseRevision = comparedRevision; this._openModal('editor'); }
      else if (action === 'keep-draft') { this._baseRevision = this._modal.revision; this._baseRecord = clone(this._modal.current); this._draftError = ''; this._draftErrorCode = ''; this._openModal('editor'); }
      else if (action === 'save-as-new') { delete this._draft.id; this._draft.links = []; this._baseRevision = this._modal.revision; this._baseRecord = blankRecord(); this._draftError = ''; this._draftErrorCode = ''; this._openModal('editor'); }
      else if (action === 'unlink-save') { this._draft.links = []; this._dirty = true; this._draftError = ''; this._draftErrorCode = ''; this._openModal('editor'); await this._save(); }
      else if (action === 'export') this._openExport();
      else if (action === 'download-export') await this._export();
      else if (action === 'import') { this._dialogGeneration++; this._openModal('import'); }
      else if (action === 'pick-import') this._chooseImport();
      else if (action === 'legacy') { this._importSource = {format:'legacy',name:this._t('legacyTitle')}; this._openModal('import'); await this._loadPreview(); }
      else if (action === 'import-compare') { this._importCompare = button.dataset.key; this._compareRevealed.clear(); this._renderModal(); this.shadowRoot.querySelector('.import-conflict')?.scrollIntoView({block:'nearest'}); }
      else if (action === 'preview-again') await this._loadPreview();
      else if (action === 'commit-import') await this._commitImport();
    } catch (error) {
      this._busy = false;
      if (this._modal && this._modal.kind !== 'scanner') { this._modalError = this._errorText(error); this._renderModal(); }
      else this._toast(this._errorText(error));
    }
  }
}
if (!customElements.get('setup-code-manager-panel')) customElements.define('setup-code-manager-panel',SetupCodeManagerPanel);
