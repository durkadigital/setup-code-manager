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
// Synthetic CHIP test payload, never a real device credential.
const MATTER = 'MT:Y.K9042C00KA0648G00';
const MANUAL = '34970112332';
const FORMATTED = '3497-011-2332';
const code = (overrides = {}) => ({ id: 'matter-a', protocol: 'matter', value: MATTER, label: 'Synthetic', manual_value: MANUAL, ...overrides });
const record = (id, codes) => ({ id, name: `Synthetic device ${id}`, codes, links: [], archived: false, notes: '', location: '' });

function globalValue(t, key, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
}
function fixture(language = 'de') {
  const panel = new Panel();
  panel._t = translator(language);
  panel._devices = [record('a', [code()]), record('b', [code({ id: 'homekit-b', protocol: 'homekit', value: '03145154', manual_value: undefined })])];
  panel._loading = false;
  panel._revision = 7;
  const state = { html: '', detail: null, main: null, toasts: [], focused: null };
  const app = {};
  Object.defineProperty(app, 'innerHTML', { set(html) {
    state.html = html;
    state.detail = panel._devices.some(item => item.id === panel._selectedId) ? { scrollTop: 0 } : null;
    state.main = { scrollTop: 0, getClientRects: () => [{}] };
  } });
  const modalRoot = { innerHTML: '' };
  panel.shadowRoot.getElementById = id => id === 'app' ? app : id === 'modal-root' ? modalRoot : null;
  panel.shadowRoot.querySelector = selector => {
    if (selector === '.detail-body' || selector === '.details') return state.detail;
    if (selector === '.main') return state.main;
    if (selector === '.detail-heading h2') return { setAttribute() {}, focus() { state.focused = 'heading'; } };
    if (selector === '[data-field="search"]') return { focus() { state.focused = 'search'; } };
    return null;
  };
  panel.shadowRoot.querySelectorAll = selector => selector === '.row-open'
    ? panel._visibleDevices().map(item => ({ dataset: { id: item.id }, focus() { state.focused = item.id; } })) : [];
  panel._toast = message => state.toasts.push(message);
  return { panel, state };
}
const click = (panel, action, data = {}) => panel._onClick({ target: { closest: () => ({ disabled: false, dataset: { action, ...data } }) } });

function clipboard(t, writeText) { globalValue(t, 'navigator', { clipboard: { writeText } }); }
function fallbackDocument(t, panel, { succeeds = true, throws = false } = {}) {
  const state = { appended: [], removed: 0, commands: [], focus: [] };
  const focused = { dataset: {}, focus(options) { state.focus.push(options); } };
  panel.shadowRoot.activeElement = focused;
  panel.shadowRoot.appendChild = node => state.appended.push(node);
  const textarea = { value: '', style: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, focus() {}, select() {}, setSelectionRange() {}, remove() { state.removed++; } };
  globalValue(t, 'navigator', {});
  globalValue(t, 'document', {
    activeElement: focused,
    body: { appendChild(node) { state.appended.push(node); }, append(node) { state.appended.push(node); } },
    createElement(tag) { assert.equal(tag, 'textarea'); return textarea; },
    execCommand(command) { state.commands.push(command); if (throws) throw new Error(`Sensitive diagnostic ${MANUAL}`); return succeeds; },
  });
  return { state, textarea };
}

test('derived Matter code is masked in the detail DOM without replacing the original QR', async () => {
  const { panel, state } = fixture();
  await click(panel, 'select', { id: 'a' });
  assert.match(state.html, /Manueller Einrichtungscode/);
  assert.match(state.html, /Aus dem QR-Code berechnet/);
  assert.match(state.html, /data-action="reveal-manual"/);
  assert.match(state.html, /data-action="copy-manual"/);
  assert.match(state.html, /data-action="qr"/);
  for (const secret of [MATTER, MANUAL, FORMATTED]) assert.ok(!state.html.includes(secret));
  assert.equal(panel._devices[0].codes.length, 1);
  assert.equal(panel._devices[0].codes[0].value, MATTER);
});

test('original and manual values reveal independently while preserving detail scroll', async () => {
  const { panel, state } = fixture();
  await click(panel, 'select', { id: 'a' });
  state.detail.scrollTop = 260;
  await click(panel, 'reveal-manual', { code: 'matter-a' });
  assert.match(state.html, /3497-011-2332/);
  assert.ok(!state.html.includes(MATTER));
  assert.equal(panel._revealed.has('matter-a'), false);
  assert.equal(state.detail.scrollTop, 260);
  await click(panel, 'reveal', { code: 'matter-a' });
  assert.ok(state.html.includes(MATTER));
  assert.ok(state.html.includes(FORMATTED));
  await click(panel, 'reveal-manual', { code: 'matter-a' });
  assert.ok(state.html.includes(MATTER));
  assert.ok(!state.html.includes(FORMATTED));
  assert.equal(panel._revealed.has('matter-a'), true);
  assert.equal(panel._revealedManual.has('matter-a'), false);
  assert.equal(state.detail.scrollTop, 260);
});

test('21-digit metadata is displayed fully and copied without separators', async t => {
  const { panel, state } = fixture();
  const copied = [];
  clipboard(t, async value => copied.push(value));
  // UI shape fixture; validity of derived metadata is a backend responsibility.
  panel._devices[0].codes[0].manual_value = '123456789012345678901';
  await click(panel, 'select', { id: 'a' });
  await click(panel, 'reveal-manual', { code: 'matter-a' });
  assert.ok(state.html.includes('1234-567-890-12345-67890-1'));
  await click(panel, 'copy-manual', { code: 'matter-a' });
  assert.deepEqual(copied, ['123456789012345678901']);
});

for (const language of ['de', 'en']) {
  test(`manual copy uses raw digits, leaves the QR unchanged and reports localized success (${language})`, async t => {
    const { panel, state } = fixture(language);
    const copied = [];
    clipboard(t, async value => copied.push(value));
    await click(panel, 'select', { id: 'a' });
    await click(panel, 'copy-manual', { code: 'matter-a' });
    assert.deepEqual(copied, [MANUAL]);
    assert.equal(panel._devices[0].codes[0].value, MATTER);
    assert.equal(panel._revealedManual.size, 0);
    assert.ok(!state.html.includes(MANUAL));
    assert.deepEqual(state.toasts, [panel._t('manualCopied')]);
    assert.notEqual(state.toasts[0], 'manualCopied');
    await click(panel, 'copy', { code: 'matter-a' });
    assert.deepEqual(copied, [MANUAL, MATTER]);
  });
}

test('modern clipboard denial reports a safe manual-copy failure without trying the HTTP fallback', async t => {
  const { panel, state } = fixture();
  clipboard(t, async () => { throw new Error(`${MANUAL} ${MATTER}`); });
  globalValue(t, 'document', { execCommand: assert.fail });
  await click(panel, 'select', { id: 'a' });
  await click(panel, 'copy-manual', { code: 'matter-a' });
  assert.deepEqual(state.toasts, [panel._t('manualCopyFailed')]);
  assert.notEqual(state.toasts[0], 'manualCopyFailed');
  assert.ok(!state.toasts[0].includes(MANUAL));
  assert.ok(!state.toasts[0].includes(MATTER));
});

for (const [action, expected] of [['copy-manual', MANUAL], ['copy', MATTER]]) {
  test(`HTTP clipboard fallback copies ${action} and removes the temporary field`, async t => {
    const { panel, state } = fixture();
    const fallback = fallbackDocument(t, panel);
    await click(panel, 'select', { id: 'a' });
    await click(panel, action, { code: 'matter-a' });
    assert.deepEqual(fallback.state.commands, ['copy']);
    assert.equal(fallback.state.appended.length, 1);
    assert.equal(fallback.textarea.value, expected);
    assert.equal(fallback.textarea.readOnly, true);
    assert.equal(fallback.state.removed, 1);
    assert.deepEqual(fallback.state.focus, [{ preventScroll: true }]);
    assert.deepEqual(state.toasts, [panel._t(action === 'copy-manual' ? 'manualCopied' : 'copied')]);
  });
}

for (const throws of [false, true]) {
  test(`HTTP manual-copy fallback failure cleans up and restores focus (${throws ? 'throws' : 'returns false'})`, async t => {
    const { panel, state } = fixture();
    const fallback = fallbackDocument(t, panel, { succeeds: false, throws });
    await click(panel, 'select', { id: 'a' });
    await click(panel, 'copy-manual', { code: 'matter-a' });
    assert.deepEqual(fallback.state.commands, ['copy']);
    assert.equal(fallback.state.removed, 1);
    assert.deepEqual(fallback.state.focus, [{ preventScroll: true }]);
    assert.deepEqual(state.toasts, [panel._t('manualCopyFailed')]);
    assert.ok(!state.toasts[0].includes(MANUAL));
    assert.ok(!state.toasts[0].includes(MATTER));
  });
}

for (const transition of ['close', 'switch', 'disconnect']) {
  test(`${transition} clears manual and original reveal state`, async () => {
    const { panel } = fixture();
    await click(panel, 'select', { id: 'a' });
    await click(panel, 'reveal', { code: 'matter-a' });
    await click(panel, 'reveal-manual', { code: 'matter-a' });
    assert.equal(panel._revealedManual.size, 1);
    if (transition === 'close') await click(panel, 'close-details');
    else if (transition === 'switch') await click(panel, 'select', { id: 'b' });
    else panel.disconnectedCallback();
    assert.equal(panel._revealedManual.size, 0);
    assert.equal(panel._revealed.size, 0);
  });
}

test('already saved manual codes and unsupported protocols do not get a duplicate derived code', () => {
  const { panel } = fixture();
  for (const item of [code({ value: MANUAL }), code({ protocol: 'homekit' }), code({ protocol: 'zwave' }), code({ value: 'https://example.com' }), code({ value: null })]) {
    assert.equal(panel._manualValue(item), '');
    assert.equal(panel._renderManualCode(item), '');
  }
});

test('missing or malformed metadata never produces a bogus manual value or clipboard action', async t => {
  const { panel } = fixture();
  const copied = [];
  clipboard(t, async value => copied.push(value));
  for (const value of [undefined, null, '', 34970112332, {}, '3497011233', '349701123322', '3497-011-2332', ' 34970112332', '34970112332\n', '３４９７０１１２３３２', '<img src=x>']) {
    const item = code({ manual_value: value });
    assert.equal(panel._manualValue(item), '');
    assert.equal(panel._renderManualCode(item), '');
    panel._devices[0].codes = [item];
    await click(panel, 'select', { id: 'a' });
    await click(panel, 'copy-manual', { code: 'matter-a' });
    await click(panel, 'reveal-manual', { code: 'matter-a' });
    assert.equal(panel._revealedManual.size, 0);
  }
  assert.deepEqual(copied, []);
});

test('editing and saving a decorated record preserves the original QR and strips computed metadata', async () => {
  const { panel } = fixture();
  panel._newDraft(panel._devices[0]);
  panel._onInput({ target: { dataset: { field: 'name' }, value: 'Renamed synthetic device' } });
  const saves = [];
  panel._renderModal = () => {};
  panel._refresh = async () => {};
  panel._api = async (command, payload) => { assert.equal(command, 'save'); saves.push(payload); return { id: 'a' }; };
  await panel._save();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].expected_revision, 7);
  assert.equal(saves[0].record.codes.length, 1);
  assert.equal(saves[0].record.codes[0].value, MATTER);
  assert.equal(saves[0].record.name, 'Renamed synthetic device');
  assert.deepEqual(Object.keys(saves[0].record.codes[0]).sort(), ['id', 'label', 'protocol', 'value']);
});

test('demo decorates only its known synthetic QR and never persists derived metadata', async t => {
  const preview = {};
  globalValue(t, 'location', { search: '' });
  globalValue(t, 'innerWidth', 1000);
  globalValue(t, 'window', { addEventListener() {} });
  globalValue(t, 'document', { querySelector: () => preview, getElementById: () => ({ addEventListener() {} }) });
  await import(new URL('../dev/demo.js', import.meta.url));
  const demo = window.setupCodeManagerDemo;
  const listing = await demo.callWS({ type: 'setup_code_manager/list' });
  const derived = listing.devices.flatMap(item => item.codes).filter(item => item.manual_value !== undefined);
  assert.equal(derived.length, 1);
  assert.equal(derived[0].value, MATTER);
  assert.equal(derived[0].manual_value, MANUAL);
  assert.ok(demo.snapshot().devices.flatMap(item => item.codes).every(item => !('manual_value' in item)));
  const edited = listing.devices.find(item => item.id === 'demo-1');
  edited.codes[0].value = MANUAL;
  await demo.callWS({ type: 'setup_code_manager/save', expected_revision: listing.revision, record: edited });
  assert.ok(demo.snapshot().devices.flatMap(item => item.codes).every(item => !('manual_value' in item)));
  const refreshed = await demo.callWS({ type: 'setup_code_manager/list' });
  const saved = refreshed.devices.find(item => item.id === edited.id).codes[0];
  assert.equal(saved.value, MANUAL);
  assert.ok(!('manual_value' in saved));
});
