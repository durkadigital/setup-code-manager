/** Setup Code Manager: local, administrator-only inventory panel. */
import { translator, protocolNames } from './i18n.js';
import { icon, deviceIcon } from './icons.js';
import { startScanner, scanImage } from './scanner.js';
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
    this._tab = 'all'; this._query = ''; this._protocol = ''; this._missing = false;
    this._revealed = new Set(); this._formRevealed = new Set(); this._compareRevealed = new Set();
    this._loading = true; this._busy = false; this._loadSequence = 0; this._dialogGeneration = 0;
    this._onClick = this._onClick.bind(this);
    this._onInput = this._onInput.bind(this);
    this._onChange = this._onChange.bind(this);
    this.shadowRoot.addEventListener('click', this._onClick);
    this.shadowRoot.addEventListener('input', this._onInput);
    this.shadowRoot.addEventListener('change', this._onChange);
    this.shadowRoot.addEventListener('submit', event => { event.preventDefault(); if (event.target.id === 'record-form') this._save(); });
    this.shadowRoot.addEventListener('keydown', event => { if (event.key === 'Escape' && !this._modal && this._selectedId) { this._selectedId = null; this._renderMain(); } });
  }
  set hass(value) {
    const languageChanged = this._hass?.language !== value?.language;
    this._hass = value;
    this._t = translator(value?.language);
    if (languageChanged && this._started) { this._renderMain(); if (this._modal?.kind !== 'scanner') this._renderModal(); }
    this._start();
  }
  get hass() { return this._hass; }
  set narrow(value) { this._narrow = value; this.toggleAttribute('narrow', !!value); }
  set panel(value) { this._panel = value; }
  set route(value) { this._route = value; }
  connectedCallback() { this._connected = true; this._start(); }
  disconnectedCallback() {
    this._connected = false; this._started = false; this._loadSequence++; this._dialogGeneration++; this._draft = null; this._modal = null; this._busy = false;
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
  async _refresh(showLoading = true) {
    const sequence = ++this._loadSequence;
    if (showLoading && !this._devices.length) { this._loading = true; this._renderMain(); }
    try {
      const result = await this._api('list');
      if (sequence !== this._loadSequence || !this._connected) return;
      this._devices = result.devices || []; this._revision = result.revision;
      this._instance = result.instance_id; this._legacyAvailable = !!result.legacy_available;
      this._loadError = ''; this._loading = false;
      if (this._selectedId && !this._devices.some(record => record.id === this._selectedId)) this._selectedId = null;
      this._renderMain();
      return result;
    } catch (error) {
      if (sequence !== this._loadSequence) return;
      this._loading = false; this._loadError = this._errorText(error, 'loadFailed'); this._renderMain();
    }
  }
  _errorText(error, fallback = 'saveFailed') {
    const map = { conflict:'revisionConflict', device_removed:'deviceRemoved', duplicate_link:'duplicateLink', archived_target:'archivedTarget', invalid_code:'invalidCode', validation_error:'validationError', unauthorized:'accessDenied', not_allowed:'accessDenied', forbidden:'accessDenied', save_failed:'saveFailed', not_loaded:'loadFailed', insecure_context:'cameraSecure', camera_denied:'cameraDenied', camera_unavailable:'cameraMissing', unsupported_code:'unsupportedQR', image_too_large:'imageTooLarge', image_unreadable:'imageUnreadable', unsupported_image:'unsupportedImage', decoder_unavailable:'decoderMissing', preview_expired:'previewExpired' };
    return this._t(map[error?.code] || fallback);
  }
  _busyBlocks(action) { return this._busy && !(this._readingPhoto && action === 'close-modal'); }
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
  _visibleDevices() {
    const query = this._query.trim().toLocaleLowerCase();
    return this._devices.filter(record => {
      if (this._tab === 'archive' ? !record.archived : record.archived) return false;
      if (this._tab === 'linked' && !isLinked(record)) return false;
      if (this._tab === 'unlinked' && isLinked(record)) return false;
      if (this._protocol && !this._missing && !displayProtocols(record).includes(this._protocol)) return false;
      if (this._missing && hasCode(record, this._protocol)) return false;
      return !query || [record.name, record.location, record.manufacturer, record.model, record.serial_number].join(' ').toLocaleLowerCase().includes(query);
    }).sort((a,b) => (a.name || '').localeCompare(b.name || '', this._hass?.language));
  }
  _status(record) {
    const linked = isLinked(record);
    const available = record.available;
    return `<div class="link-status ${linked ? '' : 'unlinked'}">${icon(linked ? 'link' : 'unlink')}${esc(this._t(linked ? 'linked' : 'unlinked'))}</div>${linked ? `<div class="availability"><span class="dot ${available === true ? 'online' : available === false ? 'offline' : ''}"></span>${esc(this._t(available === true ? 'reachable' : available === false ? 'unavailable' : 'unknownAvailability'))}</div>` : ''}`;
  }
  _renderMain() {
    const snapshot = this._focusSnapshot();
    const t = this._t;
    const active = this._devices.filter(record => !record.archived);
    const counts = { all:active.length, linked:active.filter(isLinked).length, unlinked:active.filter(record => !isLinked(record)).length, archive:this._devices.filter(record => record.archived).length };
    const selected = this._devices.find(record => record.id === this._selectedId);
    const rows = this._visibleDevices();
    let content;
    if (this._hass?.user?.is_admin === false) content = this._notice(t('accessDenied'), 'error');
    else if (this._loading) content = `<div class="loading" role="status"><span class="spinner"></span>${esc(t('loading'))}</div>`;
    else if (!rows.length) {
      const filtered = !!(this._query || this._protocol || this._missing);
      const title = filtered ? 'noResults' : this._tab === 'archive' ? 'emptyArchive' : this._tab === 'linked' ? 'emptyLinked' : this._tab === 'unlinked' && this._devices.length ? 'emptyUnlinked' : 'emptyTitle';
      content = `<div class="empty">${icon(this._tab === 'archive' ? 'archive' : 'key')}<h2>${esc(t(title))}</h2><p>${esc(t(filtered ? 'noResultsBody' : this._tab === 'archive' ? 'emptyArchiveBody' : 'emptyBody'))}</p>${this._button(filtered ? 'reset-filters' : 'add', t(filtered ? 'resetFilters' : 'add'), filtered ? 'filter' : 'plus', filtered ? '' : 'primary')}</div>`;
    } else content = `<div class="table-wrap"><table class="device-table"><colgroup><col class="device-col" style="width:34%"><col class="location-column" style="width:19%"><col class="codes-col" style="width:21%"><col class="status-col" style="width:26%"></colgroup><thead><tr><th scope="col">${esc(t('device'))}</th><th scope="col" class="location-column">${esc(t('location'))}</th><th scope="col">${esc(t('codes'))}</th><th scope="col">Home Assistant</th></tr></thead><tbody>${rows.map(record => `<tr data-action="select" data-id="${esc(record.id)}" class="${selected?.id === record.id ? 'selected' : ''}"><td><div class="device-name">${icon(deviceIcon(record))}<div><button type="button" class="row-open" data-action="select" data-id="${esc(record.id)}">${esc(record.name)}</button><div class="mobile-meta">${esc([record.location, displayProtocols(record).map(p => protocolNames[p]).join(', ')].filter(Boolean).join(' · '))}${!recordCodes(record).length ? ` · ${esc(t('noCode'))}` : ''}</div><div class="mobile-codes">${this._status(record)}</div></div></div></td><td class="location-column">${esc(record.location || '—')}</td><td><div class="code-summary">${esc(displayProtocols(record).map(p => protocolNames[p]).join(', ') || '—')}<div class="muted">${esc(t(recordCodes(record).length ? 'stored' : 'noCode'))}</div></div></td><td>${this._status(record)}</td></tr>`).join('')}</tbody></table></div>`;
    this.shadowRoot.getElementById('app').innerHTML = `<div class="app"><div class="workspace ${selected ? 'has-details' : ''}"><main class="main"><header class="topbar"><button type="button" class="icon-button menu-button" data-action="ha-menu" aria-label="${esc(t('menu'))}">${icon('menu')}</button><h1>Setup Code Manager</h1><span class="refresh-action">${this._iconButton('refresh', t('refresh'), 'refresh')}</span><span class="mobile-toolbar">${this._iconButton('menu', t('menu'), 'more')}</span></header><div class="toolbar">${this._button('add',t('add'),'plus','primary')}${this._button('import',t('import'),'download','secondary-action')}${this._button('export',t('export'),'upload','secondary-action')}</div><nav class="tabs" aria-label="${esc(t('device'))}">${['all','linked','unlinked','archive'].map(tab => `<button type="button" class="tab ${this._tab === tab ? 'active' : ''}" data-action="tab" data-tab="${tab}" aria-pressed="${this._tab === tab}">${esc(t(tab))}<span class="count">${counts[tab]}</span></button>`).join('')}</nav><p class="caption">${esc(t(this._tab === 'archive' ? 'archiveHint' : 'activeHint'))}</p><div class="filters"><label class="search">${icon('search')}<input type="search" data-field="search" data-focus="search" placeholder="${esc(t('search'))}" aria-label="${esc(t('search'))}" value="${esc(this._query)}"></label><select data-field="protocol-filter" aria-label="${esc(t('protocol'))}" data-focus="protocol-filter"><option value="">${esc(t('allProtocols'))}</option>${PROTOCOLS.map(p => `<option value="${p}" ${this._protocol === p ? 'selected' : ''}>${protocolNames[p]}</option>`).join('')}</select><label class="check-label"><input type="checkbox" data-field="missing" ${this._missing ? 'checked' : ''}>${esc(t('missingOnly'))}</label></div>${this._loadError ? this._notice(this._loadError, 'error', `<div>${this._button('refresh',t('retry'),'refresh','text')}</div>`) : ''}${content}${this._legacyAvailable ? `<div class="banner">${this._notice(t('legacyHint'),'',`<div>${this._button('legacy',t('legacyAction'),'download','text')}</div>`)}</div>` : ''}</main>${selected ? this._renderDetails(selected) : ''}</div></div>`;
    this._restoreFocus(snapshot);
  }
  _renderDetails(record) {
    const t = this._t;
    const links = record.links || [];
    return `<aside class="details" aria-label="${esc(record.name)}"><div class="detail-heading"><div><h2>${esc(record.name)}</h2><p>${esc([record.location,record.model].filter(Boolean).join(' · ') || record.manufacturer || '')}</p>${record.archived ? `<span class="badge">${icon('archive')}${esc(t('archived'))}</span>` : ''}</div>${this._iconButton('close-details',t('close'),'close')}</div><div class="detail-actions">${this._button('edit',t('edit'),'','text',`data-id="${esc(record.id)}"`)}</div><section class="detail-section"><h3>Home Assistant</h3><div class="detail-status">${this._status(record)}</div>${links.some(link => link.active === false) ? `<p class="muted small" style="margin-top:12px">${esc(t('removedHint'))}</p>` : ''}${links.filter(link => link.active !== false).map(link => `<div class="link-item"><span class="small muted">${esc(link.name || record.name)}</span><a class="button" href="/config/devices/device/${encodeURIComponent(link.ha_device_id)}">${icon('external')}${esc(t('openDevice'))}</a></div>`).join('')}${this._button('edit-links',t(links.length ? 'changeLinks' : 'linkDevice'),'link','text',`data-id="${esc(record.id)}"`)}</section><section class="detail-section"><h3>${esc(t('setupCodes'))}</h3>${recordCodes(record).length ? recordCodes(record).map(code => `<div class="code-card"><div class="code-title"><div><strong>${esc(protocolNames[code.protocol] || code.protocol)}</strong><small>${esc(code.label || t('originalCode'))}</small></div><div class="code-actions">${this._iconButton('reveal',t(this._revealed.has(code.id) ? 'hide' : 'reveal'),'eye',`data-code="${esc(code.id)}"`)}${this._iconButton('copy',t('copy'),'copy',`data-code="${esc(code.id)}"`)}${this._canQR(code) ? this._iconButton('qr',t('qr'),'qr',`data-code="${esc(code.id)}"`) : ''}</div></div><div class="secret ${this._revealed.has(code.id) ? '' : 'masked'}">${this._revealed.has(code.id) ? esc(code.value) : '••••••••••••'}</div></div>`).join('') : `<p class="muted">${esc(t('noCode'))}</p>`}${this._button('edit-codes',t('addCode'),'plus','text',`data-id="${esc(record.id)}"`)}</section><section class="detail-section"><h3>${esc(t('note'))}</h3><p class="muted">${esc(record.notes || t('noNote'))}</p>${record.manufacturer || record.serial_number ? `<p class="small muted" style="margin-top:16px">${esc([record.manufacturer, record.serial_number].filter(Boolean).join(' · '))}</p>` : ''}</section><section class="detail-section detail-bottom">${this._button('archive',t(record.archived ? 'restore' : 'archiveAction'),record.archived ? 'restore' : 'archive','text',`data-id="${esc(record.id)}"`)}${this._button('delete',t('delete'),'trash','text danger',`data-id="${esc(record.id)}"`)}</section></aside>`;
  }
  _canQR(code) { return /^(MT:|X-HM:\/\/)/.test(code.value || '') || code.protocol === 'zwave' && /^90\d{30,}$/.test(code.value || ''); }
  _newDraft(record) {
    this._dialogGeneration++;
    this._draft = clone(record || blankRecord()); this._baseRecord = clone(this._draft);
    this._baseRevision = this._revision; this._dirty = false; this._detected = null; this._moreOpen = false; this._draftError = ''; this._draftErrorCode = '';
    this._formRevealed.clear(); this._compareRevealed.clear(); this._activeProtocol = this._protocol || 'matter';
  }
  _openModal(kind, data = {}) {
    this._stopCamera(); this._modalError = ''; this._modal = { kind,...data };
    this._renderModal();
  }
  _closeModal(force = false) {
    if (this._busyBlocks('close-modal')) return;
    if (this._readingPhoto) {
      this._photoController?.abort(); this._photoController = null; this._readingPhoto = false; this._busy = false;
    }
    if (!force && this._draft && this._dirty && ['editor','picker','choose-record','code-conflict','scanner','start','revision','duplicate'].includes(this._modal?.kind) && !window.confirm(this._t('discard'))) { this._renderModal(); return; }
    this._dialogGeneration++; this._stopCamera(); this._photoController?.abort(); this._photoController = null; this._readingPhoto = false; this.shadowRoot.querySelector('dialog')?.close();
    this.shadowRoot.getElementById('modal-root').innerHTML = ''; this._modal = null;
    this._draft = null; this._pendingCodes = null; this._preview = null; this._importSource = null;
    this._formRevealed.clear(); this._compareRevealed.clear();
    this.shadowRoot.querySelector(this._selectedId ? '[data-action="edit"]' : '[data-action="add"]')?.focus();
  }
  _modalFrame(title, body, footer = '', wide = false) {
    return `<dialog ${wide ? 'class="wide"' : ''} aria-labelledby="dialog-title"><div class="dialog-shell"><header class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2>${this._iconButton('close-modal',this._t('close'),'close')}</header><div class="dialog-body">${this._modalError ? this._notice(this._modalError,'error') : ''}${body}</div>${footer ? `<footer class="dialog-foot">${footer}</footer>` : ''}</div></dialog>`;
  }
  _renderModal() {
    if (!this._modal) return;
    const snapshot = this._focusSnapshot();
    const more = this.shadowRoot.querySelector('details.more');
    if (more) this._moreOpen = more.open;
    const t = this._t; const kind = this._modal.kind;
    const cancel = this._button('close-modal',t('cancel'));
    let html = '';
    if (kind === 'start') html = this._modalFrame(t('addTitle'), `<p>${esc(t(this._canLiveScan() ? 'addIntro' : 'photoHint'))}</p><div class="choice-list">${[['start-scan',this._canLiveScan() ? 'scan' : 'takePhoto','camera'],['start-photo','photo','image'],['start-manual','manual','keyboard']].map(([action,label,image]) => `<button type="button" class="choice" data-action="${action}">${icon(image)}<span class="grow">${esc(t(label))}</span>${icon('chevron')}</button>`).join('')}</div><p class="small muted" style="margin-top:22px">${esc(t('noPairing'))}</p>`);
    else if (kind === 'menu') html = this._modalFrame(t('menu'),`<div class="choice-list">${this._button('import',t('import'),'download')}${this._button('export',t('export'),'upload')}${this._button('refresh-menu',t('refresh'),'refresh')}</div>`);
    else if (kind === 'editor') html = this._renderEditor();
    else if (kind === 'scanner') html = this._modalFrame(t('scanTitle'), `<p>${esc(t('scanHint'))}</p><div id="scanner-error"></div><div class="scanner-frame"><video id="scan-video" autoplay muted playsinline></video><div class="scan-guide"></div><div class="camera-status" id="camera-status">${esc(t('cameraLoading'))}</div></div><p class="small">${esc(t('noPairing'))}</p><div class="scanner-buttons">${this._button('scan-capture',t('takePhoto'),'camera')}${this._button('scan-photo',t('photo'),'image')}${this._button('scan-manual',t('enterCode'),'keyboard')}</div>`);
    else if (kind === 'picker') html = this._renderPicker();
    else if (kind === 'choose-record') html = this._modalFrame(t('selectRecord'), `<p>${esc(t('selectRecordHint'))}</p><div class="choice-list">${this._modal.records.map(record => `<button type="button" class="choice" data-action="use-record" data-id="${esc(record.id)}">${icon(record.archived ? 'archive' : 'key')}<span class="grow">${esc(record.name)}<small class="muted" style="display:block">${esc([record.location,displayProtocols(record).map(p => protocolNames[p]).join(', ')].filter(Boolean).join(' · '))}</small>${record.archived ? `<small class="muted" style="display:block;margin-top:7px">${esc(t('archivedTarget'))}</small>` : ''}</span>${icon('chevron')}</button>`).join('')}</div>`,this._button('back-picker',t('back')));
    else if (kind === 'code-conflict') html = this._modalFrame(t('existingCodeTitle'), `<p>${esc(t('existingCodeHint'))}</p><h3>${esc(protocolNames[this._modal.current.protocol])}</h3><div class="compare-grid">${this._compareCode(this._modal.current,t('existing'),'existing')}${this._compareCode(this._modal.incoming,t('incoming'),'incoming')}</div>`,this._button('keep-code',t('keepExisting'))+this._button('replace-code',t('useIncoming'),'','primary'));
    else if (kind === 'duplicate') html = this._modalFrame(t('duplicateTitle'),this._notice(t('duplicateBody',{names:this._modal.names.join(', ')}),'warning'),this._button('back-editor',t('back'))+this._button('save-anyway',t('saveAnyway'),'','primary'));
    else if (kind === 'delete') html = this._modalFrame(t('deleteTitle'),`<p>${esc(t('deleteBody',{name:this._modal.record.name,count:recordCodes(this._modal.record).length}))}</p>`,cancel+this._button('confirm-delete',t('delete'),'trash','primary danger'));
    else if (kind === 'qr') html = this._modalFrame(t('qr'),`<div id="qr-display" class="qr-display"></div><p style="text-align:center">${esc(this._modal.name)} · ${esc(protocolNames[this._modal.code.protocol])}</p>`,this._button('close-modal',t('close')));
    else if (kind === 'export') html = this._modalFrame(t('exportTitle'),`<p>${esc(t('exportScope'))}</p><div class="export-options">${[['json','fullBackup','JSON'],['csv','tableFormat','CSV']].map(([format,label,description]) => `<label class="export-option"><input type="radio" name="export-format" data-field="export-format" value="${format}" ${(this._exportFormat || 'json') === format ? 'checked' : ''}><div><strong>${esc(t(label))}</strong><small>${description}</small></div></label>`).join('')}</div><p class="small">${esc(t('exportHint'))}</p>${this._notice(t('exportWarning'),'warning')}`,cancel+this._button('download-export',t(this._busy ? 'exporting' : 'export'),'upload','primary'));
    else if (kind === 'import') html = this._modalFrame(t('importTitle'),`<p>${esc(t('importIntro'))}</p><div class="choice-list">${this._button('pick-import',t('chooseFile'),'download')}${this._legacyAvailable ? this._button('legacy',t('legacyAction'),'archive') : ''}</div>`);
    else if (kind === 'preview') html = this._renderPreview();
    else if (kind === 'revision') html = this._renderRevision();
    this.shadowRoot.querySelector('dialog')?.close();
    this.shadowRoot.getElementById('modal-root').innerHTML = html;
    const dialog = this.shadowRoot.querySelector('dialog');
    if (!dialog) return;
    dialog.addEventListener('cancel',event => { event.preventDefault(); this._closeModal(); });
    dialog.showModal();
    if (this._busy) dialog.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = this._busyBlocks(control.dataset.action); });
    if (snapshot && snapshot.key !== 'search') this._restoreFocus(snapshot);
    else if (kind === 'editor') this.shadowRoot.querySelector('[data-field="name"]')?.focus({preventScroll:true});
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
    const t = this._t; const draft = this._draft;
    const errorExtra = this._draftErrorCode === 'conflict' ? `<div>${this._button('compare-revision',t('compareCurrent'),'refresh','text')}</div>` : this._draftErrorCode === 'device_removed' ? `<div>${this._button('unlink-save',t('withoutLinkSave'),'unlink','text')}${this._button('picker',t('pickerTitle'),'link','text')}</div>` : this._draftErrorCode === 'duplicate_link' || this._draftErrorCode === 'archived_target' ? `<div>${this._button('picker',t('pickerTitle'),'link','text')}</div>` : '';
    const body = `${this._readingPhoto ? `<div class="notice" role="status"><span class="spinner" aria-hidden="true"></span>${esc(t('readingPhoto'))}</div>` : ''}<form id="record-form">${this._detected ? this._notice(t('codeDetected',{protocol:protocolNames[this._detected]}),'success') : ''}${draft.archived ? this._notice(t('archivedTarget')) : ''}${this._draftError ? this._notice(this._draftError,'error',errorExtra) : ''}${this._field('name')}${this._field('location')}<details class="more" ${this._moreOpen ? 'open' : ''}><summary>${esc(t('moreDetails'))}</summary><div><div class="field-row">${this._field('manufacturer')}${this._field('model')}</div>${this._field('serial_number')}${this._field('notes','textarea')}</div></details><section class="editor-section"><h3>${esc(t('setupCodes'))}</h3>${draft.codes.map((code,index) => `<div class="editor-code"><div class="code-title"><select data-field="code-protocol" data-index="${index}" aria-label="${esc(t('protocol'))}">${PROTOCOLS.map(p => `<option value="${p}" ${code.protocol === p ? 'selected' : ''} ${draft.codes.some((other,i) => i !== index && other.protocol === p) ? 'disabled' : ''}>${protocolNames[p]}</option>`).join('')}</select>${this._iconButton('remove-code',t('removeCode'),'trash',`data-index="${index}"`)}</div><label class="field"><span>${esc(t('codeValue'))}</span><div class="input-secret"><input type="${this._formRevealed.has(code.id) ? 'text' : 'password'}" data-field="code-value" data-focus="code-${index}" data-index="${index}" value="${esc(code.value)}" autocomplete="off" spellcheck="false" maxlength="4096">${this._iconButton('form-reveal',t(this._formRevealed.has(code.id) ? 'hide' : 'reveal'),'eye',`data-index="${index}"`)}</div></label><div class="code-tools">${this._button('code-scan',t(this._canLiveScan() ? (code.value ? 'rescan' : 'scan') : 'takePhoto'),'camera','text',`data-protocol="${code.protocol}"`)}${this._button('code-photo',t('photo'),'image','text',`data-protocol="${code.protocol}"`)}</div><label class="field"><span>${esc(t('codeLabel'))}</span><input type="text" data-field="code-label" data-focus="label-${index}" data-index="${index}" value="${esc(code.label)}" placeholder="${esc(t('codeLabelPlaceholder'))}" maxlength="256"></label></div>`).join('')}${draft.codes.length < PROTOCOLS.length ? this._button('add-slot',t('addCode'),'plus','text') : ''}</section><section class="editor-section"><h3>Home Assistant</h3><div class="link-box">${draft.links?.length ? draft.links.map((link,index) => `<div class="link-item">${icon('link')}<span>${esc(link.name || this._haDevices.find(d => d.id === link.ha_device_id)?.name || this._devices.find(r => r.links?.some(l => l.ha_device_id === link.ha_device_id))?.name || link.ha_device_id)}${link.active === false ? `<small class="muted" style="display:block">${esc(t('unlinked'))}</small>` : ''}</span>${this._iconButton('remove-link',t('removeLink'),'close',`data-index="${index}"`)}</div>`).join('') : `<p class="muted">${esc(t('noLink'))}</p>`}${this._button('picker',t(draft.links?.length ? 'changeLinks' : 'linkDevice'),'link','text')}<p class="muted">${esc(t('linkLater'))}</p></div></section></form>`;
    return this._modalFrame(t(draft.id ? 'editTitle' : 'addTitle'),body,this._button('close-modal',t('cancel'))+`<button type="submit" form="record-form" class="button primary" ${this._busy ? 'disabled' : ''}>${this._busy && !this._readingPhoto ? '<span class="spinner"></span>' : ''}${esc(t(this._busy && !this._readingPhoto ? 'saving' : 'save'))}</button>`);
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
    if (selectedLink) Object.assign(selectedLink,{active:true,name:device.name,available:device.available});
    else this._draft.links.push({ ha_device_id:device.id, name:device.name, active:true, available:device.available });
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
    const form = this.shadowRoot.getElementById('record-form');
    if (form && !form.reportValidity()) return;
    const record = Object.fromEntries(['id','name','manufacturer','model','serial_number','location','notes','archived','codes','links','created_at','updated_at','source_refs'].filter(key => this._draft[key] !== undefined).map(key => [key,clone(this._draft[key])]));
    record.links = (record.links || []).map(link => ({ha_device_id:link.ha_device_id,...(typeof link.active === 'boolean' ? {active:link.active} : {})}));
    record.name = record.name.trim();
    record.codes = record.codes.filter(code => code.value?.trim()).map(code => ({...code,value:code.value.trim()}));
    if (!record.name) { this._draftError = this._t('validationError'); this._openModal('editor'); return; }
    if (!ignoreDuplicates) {
      const matches = this._devices.filter(other => other.id !== record.id && recordCodes(other).some(code => record.codes.some(incoming => incoming.protocol === code.protocol && incoming.value === code.value)));
      if (matches.length) { this._openModal('duplicate',{names:matches.map(item => item.name)}); return; }
    }
    this._busy = true; this._modal = {kind:'editor'}; this._renderModal();
    try {
      const result = await this._api('save',{record,expected_revision:this._baseRevision});
      this._busy = false; this._dirty = false;
      this._selectedId = result.id || result.record?.id || record.id;
      this._closeModal(true); await this._refresh(false); this._toast(this._t('saved'));
    } catch (error) {
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
  async _export() {
    this._busy = true; this._renderModal();
    try {
      const result = await this._api('export',{format:this._exportFormat || 'json'});
      const blob = new Blob([result.content],{type:result.mime});
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = result.filename; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url),1000);
      this._busy = false; this._closeModal(true);
    } catch (error) { this._busy = false; this._modalError = this._errorText(error,'saveFailed'); this._renderModal(); }
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
    if (field === 'search') { this._query = el.value; this._renderMain(); }
    else if (field === 'picker-search') { this._pickerQuery = el.value; this._renderModal(); }
    else if (this._draft && ['name','location','manufacturer','model','serial_number','notes'].includes(field)) { this._draft[field] = el.value; this._dirty = true; }
    else if (this._draft && ['code-value','code-label'].includes(field)) {
      const code = this._draft.codes[Number(el.dataset.index)];
      if (code) { code[field === 'code-value' ? 'value' : 'label'] = el.value; this._dirty = true; this._activeProtocol = code.protocol; }
    }
  }
  _onChange(event) {
    const el = event.target; const field = el.dataset.field;
    if (field === 'protocol-filter') { this._protocol = el.value; this._renderMain(); }
    else if (field === 'missing') { this._missing = el.checked; this._renderMain(); }
    else if (field === 'code-protocol' && this._draft) { this._draft.codes[Number(el.dataset.index)].protocol = el.value; this._activeProtocol = el.value; this._dirty = true; this._renderModal(); }
    else if (field === 'export-format') this._exportFormat = el.value;
    else if (field === 'import-choice') { this._decisions[el.dataset.key] = el.checked ? 'add' : 'skip'; this._renderModal(); }
    else if (field === 'resolve-import') { this._decisions[el.dataset.key] = el.value; this._renderModal(); }
  }
  async _onClick(event) {
    const button = event.target.closest?.('[data-action]');
    if (!button || button.disabled || this._busyBlocks(button.dataset.action)) return;
    const action = button.dataset.action;
    const id = button.dataset.id;
    const record = this._devices.find(item => item.id === (id || this._selectedId));
    const code = record?.codes?.find(item => item.id === button.dataset.code);
    try {
      if (action === 'ha-menu') this.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));
      else if (action === 'refresh') await this._refresh();
      else if (action === 'refresh-menu') { this._closeModal(true); await this._refresh(); }
      else if (action === 'tab') { this._tab = button.dataset.tab; this._selectedId = null; this._renderMain(); }
      else if (action === 'reset-filters') { this._query = ''; this._protocol = ''; this._missing = false; this._renderMain(); }
      else if (action === 'select') { this._selectedId = id; this._revealed.clear(); this._renderMain(); this.scrollIntoView({block:'start',behavior:'instant'}); this.shadowRoot.querySelector('.detail-heading h2')?.setAttribute('tabindex','-1'); this.shadowRoot.querySelector('.detail-heading h2')?.focus({preventScroll:true}); }
      else if (action === 'close-details') { this._selectedId = null; this._revealed.clear(); this._renderMain(); [...this.shadowRoot.querySelectorAll('.row-open')].find(el => el.dataset.id === record?.id)?.focus(); }
      else if (action === 'menu') this._openModal('menu');
      else if (action === 'add') { this._newDraft(); this._openModal('start'); }
      else if (['edit','edit-links','edit-codes'].includes(action) && record) {
        this._newDraft(record);
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
      else if (action === 'remove-link') { this._draft.links.splice(Number(button.dataset.index),1); this._dirty = true; this._renderModal(); }
      else if (action === 'form-reveal') { const key = this._draft.codes[Number(button.dataset.index)].id; this._formRevealed.has(key) ? this._formRevealed.delete(key) : this._formRevealed.add(key); this._renderModal(); }
      else if (action === 'reveal' && code) { this._revealed.has(code.id) ? this._revealed.delete(code.id) : this._revealed.add(code.id); this._renderMain(); }
      else if (action === 'copy' && code) { try { await navigator.clipboard.writeText(code.value); this._toast(this._t('copied')); } catch { this._toast(this._t('copyFailed')); } }
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
      else if (action === 'export') { this._dialogGeneration++; this._exportFormat = 'json'; this._openModal('export'); }
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
