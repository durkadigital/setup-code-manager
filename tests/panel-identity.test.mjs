import assert from 'node:assert/strict';
import test from 'node:test';
import { translator } from '../custom_components/setup_code_manager/www/i18n.js';

const elements = new Map();
globalThis.customElements = { get: name => elements.get(name), define: (name, element) => elements.set(name, element) };
globalThis.window = {};
globalThis.HTMLElement = class {
  attachShadow() { this.shadowRoot = { listeners: new Map(), addEventListener(type, listener) { this.listeners.set(type, listener); } }; }
  scrollIntoView() {}
};
await import(new URL('../custom_components/setup_code_manager/www/panel.js', import.meta.url));
const Panel = elements.get('setup-code-manager-panel');
const MATTER = 'MT:Y.K9042C00KA0648G00';
const record = (overrides = {}) => ({ id: 'a', name: 'Own device name', location: 'Own room', manufacturer: '', model: '', serial_number: '', notes: 'Keep my note', archived: false, codes: [{ id: 'matter-a', protocol: 'matter', value: MATTER, label: 'Synthetic' }], links: [], ...overrides });
const haDevice = (overrides = {}) => ({ id: 'ha-a', name: 'HA device', location: 'HA room', manufacturer: 'Synthetic', model: 'Demo', serial_number: '', protocols: ['matter'], ...overrides });

function globalValue(t, key, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
}
function fixture(item = record()) {
  const panel = new Panel();
  panel._t = translator('de');
  panel._devices = [item];
  panel._loading = false;
  panel._revision = 3;
  const state = { html: '', detail: null, main: null, modalRenders: 0 };
  const app = {};
  Object.defineProperty(app, 'innerHTML', { set(html) {
    state.html = html;
    state.detail = panel._devices.some(device => device.id === panel._selectedId) ? { scrollTop: 0 } : null;
    state.main = { scrollTop: 0, getClientRects: () => [{}] };
  } });
  const modal = { innerHTML: '' };
  panel.shadowRoot.getElementById = id => id === 'app' ? app : id === 'modal-root' ? modal : null;
  panel.shadowRoot.querySelector = selector => {
    if (selector === '.detail-body' || selector === '.details') return state.detail;
    if (selector === '.main') return state.main;
    if (selector === '.detail-heading h2') return { setAttribute() {}, focus() {} };
    return null;
  };
  panel.shadowRoot.querySelectorAll = () => [];
  panel._renderModal = () => { state.modalRenders++; };
  panel._toast = () => {};
  return { panel, state };
}
const click = (panel, action, data = {}) => panel._onClick({ target: { closest: () => ({ disabled: false, dataset: { action, ...data } }) } });
const input = (panel, field, value) => panel._onInput({ target: { dataset: { field }, value } });

for (const [protocol, value] of [['matter', MATTER], ['homekit', '03145154'], ['zwave', '12345-23456-34567-45678-56789-01234-02345-03456']]) {
  test(`a nonblank ${protocol} code shows the stored status with a check`, () => {
    const { panel } = fixture();
    const html = panel._codeStatus(record({ codes: [{ protocol, value }] }));
    assert.match(html, /class="code-status stored"/);
    assert.match(html, /<svg/);
    assert.match(html, /Code gespeichert/);
    assert.ok(!html.includes(value));
  });
}

test('no code and blank slots remain neutral even if they have derived metadata', () => {
  const { panel } = fixture();
  for (const codes of [[], [{ protocol: 'matter', value: '' }], [{ protocol: 'homekit', value: ' \n ' }], [{ protocol: 'matter', value: '', manual_value: '34970112332' }]]) {
    const html = panel._codeStatus(record({ codes }));
    assert.match(html, /class="code-status missing"/);
    assert.match(html, /Code fehlt/);
    assert.ok(!html.includes('<svg'));
  }
});

test('stored status is rendered in desktop, mobile and selected-record details', () => {
  const { panel, state } = fixture();
  panel._selectedId = 'a';
  panel._renderMain();
  assert.equal((state.html.match(/class="code-status stored"/g) || []).length, 3);
});

test('a reachable device with a missing code has a separate, labelled warning in both list layouts', () => {
  const item = record({ codes: [], available: true, links: [{ ha_device_id: 'ha-a', active: true }] });
  const { panel } = fixture(item);
  const html = panel._renderListRow(item);
  assert.match(html, /class="mobile-ha-status"[^]*class="dot online"[^]*Erreichbar/);
  assert.match(html, /class="mobile-code-status"><span class="code-status missing"><svg[^]*Code fehlt<\/span><\/span>/);
  assert.match(html, /<td><span class="code-status missing"><svg[^]*Code fehlt<\/span>/);
  assert.doesNotMatch(html, /Code gespeichert/);
});

test('linked identity is read-only, escapes text, and accepts an explicitly empty HA area', () => {
  const item = record({ links: [{ ha_device_id: 'ha-a', active: true, name: '<b>HA lamp</b>', location: '' }] });
  const { panel } = fixture(item);
  panel._newDraft(item);
  panel._applyDraftIdentity();
  assert.equal(panel._identityManaged(), true);
  assert.equal(panel._draft.location, '');
  const html = panel._renderIdentity();
  assert.ok(!html.includes('<input'));
  assert.match(html, /&lt;b&gt;HA lamp&lt;\/b&gt;/);
  assert.ok(!html.includes('<b>HA lamp</b>'));
  assert.ok(html.includes(panel._t('noArea')));
  assert.ok(html.includes(panel._t('haIdentityHint')));
  input(panel, 'name', 'Ignored manual name');
  input(panel, 'location', 'Ignored manual room');
  assert.equal(panel._draft.name, '<b>HA lamp</b>');
  assert.equal(panel._draft.location, '');
  assert.equal(panel._dirty, false);
});

test('standalone inventory identity remains editable', () => {
  const { panel } = fixture();
  panel._newDraft(record());
  assert.equal(panel._identityManaged(), false);
  const html = panel._renderIdentity();
  assert.match(html, /<input[^>]*data-field="name"/);
  assert.match(html, /<input[^>]*data-field="location"/);
  input(panel, 'name', 'New own name');
  input(panel, 'location', 'New own room');
  assert.equal(panel._draft.name, 'New own name');
  assert.equal(panel._draft.location, 'New own room');
});

test('notes are always editable outside collapsed additional details', () => {
  const item = record({ links: [{ ha_device_id: 'ha-a', active: true, name: 'HA device', location: 'HA room' }] });
  const { panel } = fixture(item);
  panel._newDraft(item);
  const html = panel._renderEditor();
  const notes = html.indexOf('data-field="notes"');
  const moreStart = html.indexOf('<details class="more"');
  const moreEnd = html.indexOf('</details>', moreStart);
  assert.ok(notes >= 0);
  assert.ok(notes < moreStart || notes > moreEnd);
  assert.match(html, /<textarea[^>]*data-field="notes"/);
  input(panel, 'notes', 'A personal updated note');
  panel._applyDraftIdentity();
  assert.equal(panel._draft.notes, 'A personal updated note');
  assert.equal(panel._dirty, true);
});

test('selecting an HA device replaces manual name and room while retaining notes and codes', () => {
  const { panel } = fixture();
  panel._haDevices = [haDevice()];
  panel._newDraft(record());
  panel._selectHADevice('ha-a');
  assert.equal(panel._draft.name, 'HA device');
  assert.equal(panel._draft.location, 'HA room');
  assert.equal(panel._draft.notes, 'Keep my note');
  assert.equal(panel._draft.codes[0].value, MATTER);
  assert.equal(panel._draft.links[0].ha_device_id, 'ha-a');
  assert.equal(panel._draft.links[0].location, 'HA room');
  assert.equal(panel._identityManaged(), true);
});

test('multiple active HA identities are deduplicated, sorted and bounded; removed links do not contribute', () => {
  const { panel } = fixture();
  panel._devices = [];
  panel._newDraft(record({ links: [
    { ha_device_id: 'z', active: true, name: 'Zulu', location: 'Office' },
    { ha_device_id: 'a', active: true, name: 'Alpha', location: 'Hall' },
    { ha_device_id: 'a2', active: true, name: 'Alpha', location: 'Hall' },
    { ha_device_id: 'old', active: false, name: 'Old', location: 'Cellar' },
  ] }));
  panel._applyDraftIdentity();
  assert.equal(panel._draft.name, 'Alpha / Zulu');
  assert.equal(panel._draft.location, 'Hall / Office');
  panel._draft.links[0].name = 'Z'.repeat(256);
  panel._draft.links[0].location = 'Z'.repeat(256);
  panel._applyDraftIdentity();
  assert.equal(panel._draft.name.length, 256);
  assert.equal(panel._draft.location.length, 256);
});

test('incomplete runtime identity keeps the last serialized name and room', () => {
  const item = record({ links: [{ ha_device_id: 'unknown', active: true, name: 'Partial metadata' }] });
  const { panel } = fixture(item);
  panel._newDraft(item);
  panel._applyDraftIdentity();
  assert.equal(panel._draft.name, 'Own device name');
  assert.equal(panel._draft.location, 'Own room');
  assert.equal(panel._identityManaged(), true);
});

test('removing the last link restores editing without losing last known identity or notes', async () => {
  const item = record({ name: 'Last HA name', location: 'Last HA room', links: [{ ha_device_id: 'ha-a', active: true, name: 'Last HA name', location: 'Last HA room' }] });
  const { panel } = fixture(item);
  panel._newDraft(item);
  await click(panel, 'remove-link', { index: '0' });
  assert.equal(panel._identityManaged(), false);
  assert.equal(panel._draft.name, 'Last HA name');
  assert.equal(panel._draft.location, 'Last HA room');
  assert.equal(panel._draft.notes, 'Keep my note');
  assert.match(panel._renderIdentity(), /<input[^>]*data-field="name"/);
});

test('records whose HA devices were removed retain their last identity and are editable', () => {
  const item = record({ name: 'Last HA name', location: 'Last HA room', links: [{ ha_device_id: 'gone', active: false }] });
  const { panel } = fixture(item);
  panel._newDraft(item);
  panel._applyDraftIdentity();
  assert.equal(panel._identityManaged(), false);
  assert.equal(panel._draft.name, 'Last HA name');
  assert.equal(panel._draft.location, 'Last HA room');
  assert.match(panel._renderIdentity(), /<input[^>]*data-field="location"/);
});

for (const dirty of [false, true]) {
  test(`fresh HA identity updates an open editor without replacing notes or changing dirty state (${dirty})`, async () => {
    const old = record({ links: [{ ha_device_id: 'ha-a', active: true, name: 'Old HA name', location: 'Old room' }] });
    const { panel, state } = fixture(old);
    panel._newDraft(old);
    panel._modal = { kind: 'editor' };
    panel._connected = true;
    panel._haDevices = [haDevice({ name: 'Stale picker name', location: 'Stale picker room' })];
    if (dirty) input(panel, 'notes', 'Unsaved personal note');
    const beforeNotes = panel._draft.notes;
    panel._api = async () => ({ revision: 4, devices: [record({ name: 'Renamed in HA', location: '', links: [{ ha_device_id: 'ha-a', active: true, name: 'Renamed in HA', location: '' }] })] });
    await panel._refresh(false);
    assert.equal(panel._draft.name, 'Renamed in HA');
    assert.equal(panel._draft.location, '');
    assert.equal(panel._draft.notes, beforeNotes);
    assert.equal(panel._dirty, dirty);
    assert.equal(panel._baseRevision, 3);
    assert.equal(state.modalRenders, 1);
  });
}

test('save applies current HA identity without changing own notes or the original code', async () => {
  const item = record({ links: [{ ha_device_id: 'ha-a', active: true, name: 'Live HA name', location: 'Live room' }] });
  const { panel } = fixture(item);
  panel._newDraft(item);
  panel._draft.name = 'Stale own name';
  panel._draft.location = 'Stale room';
  input(panel, 'notes', 'Saved own note');
  let saved;
  panel._api = async (command, data) => { assert.equal(command, 'save'); saved = data.record; return { id: 'a' }; };
  panel._refresh = async () => {};
  await panel._save();
  assert.equal(saved.name, 'Live HA name');
  assert.equal(saved.location, 'Live room');
  assert.equal(saved.notes, 'Saved own note');
  assert.equal(saved.codes[0].value, MATTER);
});

test('synthetic HA rename and area controls update runtime identity, save authoritatively and retain it after removal', async t => {
  const preview = {};
  globalValue(t, 'location', { search: '' });
  globalValue(t, 'innerWidth', 1000);
  globalValue(t, 'window', { addEventListener() {} });
  globalValue(t, 'document', { querySelector: () => preview, getElementById: () => ({ addEventListener() {} }) });
  await import(new URL('../dev/demo.js', import.meta.url));
  const demo = window.setupCodeManagerDemo;
  demo.renameHADevice('ha-1', 'Renamed synthetic socket');
  demo.setHAArea('ha-1', 'Synthetic new room');
  const first = await demo.callWS({ type: 'setup_code_manager/list' });
  const edited = first.devices.find(item => item.id === 'demo-1');
  assert.equal(edited.name, 'Renamed synthetic socket');
  assert.equal(edited.location, 'Synthetic new room');
  assert.equal(edited.links[0].location, 'Synthetic new room');
  assert.equal(edited.codes[0].manual_value, '34970112332');
  edited.name = 'Ignored own name';
  edited.location = 'Ignored own room';
  edited.notes = 'Own note survives';
  await demo.callWS({ type: 'setup_code_manager/save', expected_revision: first.revision, record: edited });
  const stored = demo.snapshot().devices.find(item => item.id === edited.id);
  assert.equal(stored.name, 'Renamed synthetic socket');
  assert.equal(stored.location, 'Synthetic new room');
  assert.equal(stored.notes, 'Own note survives');
  assert.ok(!('manual_value' in stored.codes[0]));
  demo.setHAArea('ha-1', '');
  const cleared = await demo.callWS({ type: 'setup_code_manager/list' });
  assert.equal(cleared.devices.find(item => item.id === edited.id).location, '');
  demo.removeHADevice('ha-1');
  const removed = (await demo.callWS({ type: 'setup_code_manager/list' })).devices.find(item => item.id === edited.id);
  assert.equal(removed.name, 'Renamed synthetic socket');
  assert.equal(removed.location, '');
  assert.equal(removed.notes, 'Own note survives');
  assert.equal(removed.codes[0].value, MATTER);
  assert.equal(removed.links[0].active, false);
  assert.equal(removed.linked, false);
});
