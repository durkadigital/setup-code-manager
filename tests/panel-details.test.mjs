import assert from 'node:assert/strict';
import test from 'node:test';

// Behaviour tests for the production panel. Browser geometry/overflow is tested
// separately: this DOM surface models replacement and focus, not CSS layout.
const elements = new Map();
globalThis.customElements = {
  get: name => elements.get(name),
  define: (name, element) => elements.set(name, element),
};
globalThis.window = {};
globalThis.HTMLElement = class {
  attachShadow() {
    this.shadowRoot = {
      listeners: new Map(),
      addEventListener(type, listener) { this.listeners.set(type, listener); },
    };
  }
  scrollIntoView() {}
};
await import(new URL('../custom_components/setup_code_manager/www/panel.js', import.meta.url));
const Panel = elements.get('setup-code-manager-panel');
const record = id => ({
  id, name: `Synthetic device ${id}`, codes: [{ id: `code-${id}`, protocol: 'homekit', value: '03145154', label: 'Synthetic' }],
  links: [], archived: false, notes: 'Synthetic note', location: 'Test location',
});

function fixture({ mobile = false } = {}) {
  const panel = new Panel();
  panel._devices = [record('a'), record('b')];
  panel._loading = false;
  const state = { detail: null, main: null, focused: null, renders: 0, html: '' };
  const search = { focus() { state.focused = 'search'; } };
  const app = {};
  Object.defineProperty(app, 'innerHTML', {
    set(html) {
      state.html = html;
      state.renders++;
      // innerHTML replaces the scrolling element, just as in the browser.
      state.detail = panel._devices.some(item => item.id === panel._selectedId) ? { scrollTop: 0 } : null;
      const hidden = mobile && !!state.detail;
      let mainScroll = 0;
      state.main = { getClientRects: () => hidden ? [] : [{}] };
      Object.defineProperty(state.main, 'scrollTop', {
        get: () => hidden ? 0 : mainScroll,
        set: value => { mainScroll = hidden ? 0 : value; },
      });
    },
  });
  panel.shadowRoot.getElementById = id => id === 'app' ? app : null;
  panel.shadowRoot.querySelector = selector => {
    if (selector === '.detail-body' || selector === '.details') return state.detail;
    if (selector === '.main') return state.main;
    if (selector === '[data-field="search"]') return search;
    if (selector === '.detail-heading h2') return { setAttribute() {}, focus() { state.focused = 'detail-heading'; } };
    return null;
  };
  panel.shadowRoot.querySelectorAll = selector => selector === '.row-open'
    ? panel._visibleDevices().map(item => ({ dataset: { id: item.id }, focus() { state.focused = item.id; } }))
    : [];
  return { panel, state };
}

function click(panel, action, data = {}) {
  return panel._onClick({ target: { closest: () => ({ disabled: false, dataset: { action, ...data } }) } });
}

function escape(panel) {
  const event = { key: 'Escape', prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  panel.shadowRoot.listeners.get('keydown')(event);
  return event;
}

for (const action of ['button', 'Escape']) {
  test(`${action} closes details, masks revealed codes, and returns focus to its list row`, async () => {
    const { panel, state } = fixture();
    await click(panel, 'select', { id: 'b' });
    assert.equal(state.focused, 'detail-heading');
    panel._revealed.add('code-b');
    if (action === 'button') await click(panel, 'close-details');
    else {
      const event = escape(panel);
      assert.equal(event.prevented, true);
      assert.equal(event.stopped, true);
    }
    assert.equal(panel._selectedId, null);
    assert.equal(panel._revealed.size, 0);
    assert.equal(state.detail, null);
    assert.equal(state.focused, 'b');
  });
}

test('closing details falls back to search when its record is no longer in the active list', async () => {
  const { panel, state } = fixture();
  await click(panel, 'select', { id: 'a' });
  // A registry/import change may archive a record while it remains selected.
  panel._devices[0].archived = true;
  panel._renderMain();
  await click(panel, 'close-details');
  assert.equal(state.focused, 'search');
  assert.equal(panel._selectedId, null);
});

test('Escape leaves selected details alone while a separate dialog is open', async () => {
  const { panel, state } = fixture();
  await click(panel, 'select', { id: 'a' });
  panel._modal = { kind: 'editor' };
  const renders = state.renders;
  const event = escape(panel);
  assert.equal(panel._selectedId, 'a');
  assert.equal(state.renders, renders);
  assert.equal(event.prevented, false);
});

test('revealing a code preserves the current detail scroll after DOM replacement', async () => {
  const { panel, state } = fixture();
  await click(panel, 'select', { id: 'a' });
  const previousElement = state.detail;
  state.detail.scrollTop = 412;
  await click(panel, 'reveal', { code: 'code-a' });
  assert.equal(panel._revealed.has('code-a'), true);
  assert.notStrictEqual(state.detail, previousElement);
  assert.equal(state.detail.scrollTop, 412);
});

test('refreshing the same selected record preserves detail scroll', async () => {
  const { panel, state } = fixture();
  await click(panel, 'select', { id: 'a' });
  state.detail.scrollTop = 281;
  panel._connected = true;
  panel._api = async command => {
    assert.equal(command, 'list');
    return { devices: panel._devices.map(item => ({ ...item, notes: 'Updated synthetic note' })), revision: 2 };
  };
  await panel._refresh(false);
  assert.equal(state.detail.scrollTop, 281);
  assert.equal(panel._devices[0].notes, 'Updated synthetic note');
});

test('selecting another device starts at its top rather than inheriting the previous scroll', async () => {
  const { panel, state } = fixture();
  await click(panel, 'select', { id: 'a' });
  state.detail.scrollTop = 412;
  await click(panel, 'select', { id: 'b' });
  assert.equal(panel._selectedId, 'b');
  assert.equal(state.detail.scrollTop, 0);
});

test('reopening a closed record starts at its top', async () => {
  const { panel, state } = fixture();
  await click(panel, 'select', { id: 'a' });
  state.detail.scrollTop = 412;
  await click(panel, 'close-details');
  await click(panel, 'select', { id: 'a' });
  assert.equal(state.detail.scrollTop, 0);
});


test('refreshing an unchanged list preserves its own scroll position', async () => {
  const { panel, state } = fixture();
  panel._renderMain();
  const previousMain = state.main;
  state.main.scrollTop = 364;
  panel._connected = true;
  panel._api = async () => ({ devices: panel._devices.map(item => ({ ...item })), revision: 2 });
  await panel._refresh(false);
  assert.notStrictEqual(state.main, previousMain);
  assert.equal(state.main.scrollTop, 364);
});

test('mobile details retain list scroll while the hidden list clamps scrollTop to zero', async () => {
  const { panel, state } = fixture({ mobile: true });
  panel._renderMain();
  state.main.scrollTop = 325;
  await click(panel, 'select', { id: 'b' });
  assert.equal(state.main.scrollTop, 0);
  assert.equal(state.main.getClientRects().length, 0);
  state.detail.scrollTop = 123;
  await click(panel, 'reveal', { code: 'code-b' });
  panel._renderMain();
  assert.equal(state.detail.scrollTop, 123);
  assert.equal(state.main.scrollTop, 0);
  await click(panel, 'close-details');
  assert.equal(state.main.scrollTop, 325);
  assert.equal(state.focused, 'b');
});

test('desktop list and details preserve independent scroll positions', async () => {
  const { panel, state } = fixture();
  panel._renderMain();
  state.main.scrollTop = 180;
  await click(panel, 'select', { id: 'a' });
  state.main.scrollTop = 432;
  state.detail.scrollTop = 87;
  await click(panel, 'reveal', { code: 'code-a' });
  assert.equal(state.main.scrollTop, 432);
  assert.equal(state.detail.scrollTop, 87);
});

for (const [name, change] of [
  ['tab', panel => click(panel, 'tab', { tab: 'unlinked' })],
  ['search', panel => panel._onInput({ target: { dataset: { field: 'search' }, value: 'device b' } })],
  ['protocol', panel => panel._onChange({ target: { dataset: { field: 'protocol-filter' }, value: 'homekit' } })],
  ['code status', panel => panel._onChange({ target: { dataset: { field: 'code-status-filter' }, value: 'missing' } })],
  ['room', panel => panel._onChange({ target: { dataset: { field: 'room-filter' }, value: 'room:Test location' } })],
]) {
  test(`changing ${name} resets the list to its top`, async () => {
    const { panel, state } = fixture();
    panel._renderMain();
    state.main.scrollTop = 364;
    await change(panel);
    assert.equal(state.main.scrollTop, 0);
    state.main.scrollTop = 96;
    panel._renderMain();
    assert.equal(state.main.scrollTop, 96);
  });
}


test('notes and manual Matter codes filter the panel through its search input', () => {
  const { panel } = fixture();
  panel._devices[0].notes = 'Spare label in blue drawer';
  panel._devices[0].codes = [{ protocol:'matter', value:'MT:Y.K9042C00KA0648G00', manual_value:'03497011233' }];
  for (const query of ['blue drawer', 'mt:y.k9042', '0349-701-1233']) {
    panel._onInput({ target:{ dataset:{ field:'search' }, value:query } });
    assert.deepEqual(panel._visibleDevices().map(item => item.id), ['a']);
  }
});

test('room, protocol and code status compose, and reset restores the current tab', async () => {
  const { panel, state } = fixture();
  panel._tab = 'unlinked';
  panel._devices[0].codes = [];
  panel._devices[1].location = 'Other room';
  for (const [field, value] of [['room-filter','room:Test location'],['protocol-filter','matter'],['code-status-filter','missing']]) {
    panel._onChange({ target:{ dataset:{ field }, value } });
  }
  assert.deepEqual(panel._visibleDevices().map(item => item.id), ['a']);
  assert.match(state.html, /1 of 2 devices/);
  assert.match(state.html, /value="room:Test location" selected/);
  assert.match(state.html, /value="missing" selected/);
  panel._query = 'no match';
  panel._renderMain();
  assert.match(state.html, /No matching devices/);
  await click(panel, 'reset-filters');
  assert.equal(panel._query, '');
  assert.equal(panel._room, '');
  assert.equal(panel._protocol, '');
  assert.equal(panel._codeStatusFilter, 'all');
  assert.equal(panel._tab, 'unlinked');
  assert.equal(state.focused, 'search');
  assert.deepEqual(panel._visibleDevices().map(item => item.id), ['a','b']);
  assert.doesNotMatch(state.html, /filter-summary/);
});

test('room options escape labels and preserve a selected room across a registry move', () => {
  const { panel } = fixture();
  panel._devices[0].location = 'Kids "room" <upstairs>';
  panel._room = 'room:Former room';
  const html = panel._renderFilters(0, 2);
  assert.match(html, /value="room:Kids &quot;room&quot; &lt;upstairs&gt;"/);
  assert.match(html, /value="room:Former room" selected/);
  assert.doesNotMatch(html, /<upstairs>/);
});
