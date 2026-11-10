import assert from 'node:assert/strict';
import test from 'node:test';
import { preferenceKey } from '../custom_components/setup_code_manager/www/preferences.js';

// Synthetic DOM models focus and dialog state; geometry/popovers are checked in
// the browser. No live HA instance, real code or external storage is used.
const elements = new Map();
globalThis.customElements = { get:name => elements.get(name), define:(name, value) => elements.set(name, value) };
globalThis.HTMLElement = class {
  attachShadow() {
    this.shadowRoot = { listeners:new Map(), addEventListener(type, listener) { this.listeners.set(type,listener); } };
  }
};
globalThis.window = {};
globalThis.document = {};
await import('../custom_components/setup_code_manager/www/panel.js');
const Panel = elements.get('setup-code-manager-panel');
const record = (id, fields = {}) => ({ id, name:`Synthetic ${id}`, location:'Office', codes:[], links:[], archived:false, notes:'', ...fields });
const value = (field, selected) => ({ target:{ dataset:{ field }, value:selected } });

function memoryStorage() {
  const values = new Map();
  return { values, getItem:key => values.get(key) ?? null, setItem:(key, item) => values.set(key,item) };
}
function fixture({ storage = memoryStorage(), user = 'synthetic-user', failViewWrites = false } = {}) {
  const panel = new Panel();
  panel._hass = { language:'en', user:user ? { id:user } : {} };
  panel._instance = 'synthetic-ha'; panel._loading = false; panel._connected = true;
  panel._devices = [record('a'),record('b',{ location:'Kitchen' }),record('archive',{ archived:true })];
  const state = { renders:0, modalRenders:0, toasts:[], focused:null, hidden:false, expanded:'true', downloads:[], viewPreferences:new Map(), viewWrites:[], failViewWrites };
  const filter = { hidden:false, hidePopover() { state.hidden = true; } };
  const button = { setAttribute(name, item) { if (name === 'aria-expanded') state.expanded = item; }, focus() { state.focused = 'filter'; } };
  const search = { focus() { state.focused = 'search'; } };
  const modalRoot = { innerHTML:'' };
  panel.shadowRoot.getElementById = id => id === 'filter-panel' ? filter : id === 'modal-root' ? modalRoot : null;
  panel.shadowRoot.querySelector = selector => selector === '[data-action="toggle-filters"]' ? button : selector === '[data-field="search"]' ? search : null;
  panel.shadowRoot.querySelectorAll = () => [];
  panel._renderMain = () => { state.renders++; };
  panel._renderModal = () => { state.modalRenders++; };
  panel._toast = message => { state.toasts.push(message); };
  panel._api = async (command,data) => {
    assert.equal(command,'save_view_preferences');
    state.viewWrites.push(structuredClone(data));
    if (state.failViewWrites) throw { code:'preferences_save_failed' };
    const key = preferenceKey(panel._instance,panel._hass.user?.id);
    const current = state.viewPreferences.get(key) || { revision:0, views:[], defaultViewId:'' };
    assert.equal(data.expected_revision,current.revision);
    const saved = { revision:current.revision + 1, ...structuredClone(data.preferences) };
    state.viewPreferences.set(key,saved);
    return structuredClone(saved);
  };
  globalThis.window = { innerWidth:1200, innerHeight:900, localStorage:storage, confirm:() => true, addEventListener() {}, removeEventListener() {} };
  globalThis.document = { addEventListener() {}, removeEventListener() {}, body:{ appendChild() {} }, createElement(tag) {
    assert.equal(tag,'a');
    return { click() { state.downloads.push({ href:this.href, filename:this.download }); }, remove() {} };
  } };
  panel._loadViewPreferences({ revision:0, views:[], defaultViewId:'' });
  return { panel,state,storage,filter,button };
}
function escape(panel) {
  const event = { key:'Escape', prevented:false, stopped:false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  panel.shadowRoot.listeners.get('keydown')(event);
  return event;
}
function click(panel, action, fields = {}) {
  return panel._onClick({ target:{ closest:() => ({ disabled:false, dataset:{ action,...fields } }) } });
}

test('saving a view sends current structured controls to HA but never the code search or inventory', async () => {
  const { panel,state,storage } = fixture();
  panel._query = 'MT:SYNTHETIC-PRIVATE-SEARCH'; panel._viewName = 'Office missing codes';
  panel._room = 'room:Office'; panel._codeStatusFilter = 'missing'; panel._sort = 'updated-desc'; panel._group = 'room';
  await panel._saveView();
  assert.equal(panel._savedViews.length,1);
  assert.equal(panel._activeViewId,panel._savedViews[0].id);
  assert.equal(panel._savedViews[0].settings.sort,'updated-desc');
  assert.equal(panel._savedViews[0].settings.room,'room:Office');
  assert.equal(panel._query,'MT:SYNTHETIC-PRIVATE-SEARCH');
  const stored = JSON.stringify(state.viewWrites[0]);
  assert.doesNotMatch(stored,/SYNTHETIC-PRIVATE-SEARCH|"query":|"devices":|"notes":|"codes":/);
  assert.equal(storage.values.size,0);
  assert.equal(state.toasts.length,1);
});

test('missing user and server write failures leave saved views untouched', async () => {
  for (const config of [{ user:'' }, { failViewWrites:true }]) {
    const { panel,state } = fixture(config);
    panel._savedViews = [{ id:'existing', name:'Existing', settings:{} }];
    panel._viewName = 'New view';
    await panel._saveView();
    assert.deepEqual(panel._savedViews.map(view => view.id),['existing']);
    assert.equal(panel._activeViewId,'');
    assert.equal(state.viewWrites.length,config.user === '' ? 0 : 1);
    assert.equal(state.toasts.length,config.user === '' ? 0 : 1);
  }
});

test('saved views remain separated when the current HA user or instance changes', async () => {
  const { panel,state } = fixture();
  const load = () => panel._loadViewPreferences(state.viewPreferences.get(preferenceKey(panel._instance,panel._hass.user.id)) || { revision:0, views:[], defaultViewId:'' });
  panel._viewName = 'User one'; await panel._saveView();
  panel._hass.user.id = 'other-user'; await load();
  assert.deepEqual(panel._savedViews,[]);
  assert.equal(panel._activeViewId,'');
  assert.equal(panel._viewName,'');
  panel._hass.user.id = 'synthetic-user'; await load();
  assert.deepEqual(panel._savedViews.map(view => view.name),['User one']);
  panel._instance = 'other-ha'; await load();
  assert.deepEqual(panel._savedViews,[]);
  assert.equal(state.viewPreferences.size,1);
});

test('applying a saved view clears transient search, selection and collapsed groups', () => {
  const { panel } = fixture();
  const settings = { tab:'archive', protocol:'matter', codeStatus:'missing', room:'room:Office', floor:'floor:upper', label:'label:work', sort:'room', group:'room' };
  panel._savedViews = [{ id:'saved', name:'Archive view', settings }];
  panel._query = 'sensitive search'; panel._selection.add('a'); panel._selectedId = 'a'; panel._collapsedGroups.add('["Office"]');
  panel._applyView('saved');
  assert.deepEqual(panel._viewSettings(),settings);
  assert.equal(panel._query,'');
  assert.equal(panel._selection.size,0);
  assert.equal(panel._selectedId,null);
  assert.equal(panel._collapsedGroups.size,0);
  assert.equal(panel._activeViewId,'saved');
});

test('updating an active view preserves its identity and refuses another view with the same name', async () => {
  const { panel,state } = fixture();
  panel._viewName = 'Work'; await panel._saveView();
  const id = panel._activeViewId;
  panel._room = 'room:Kitchen'; await panel._saveView();
  assert.equal(panel._savedViews.length,1);
  assert.equal(panel._savedViews[0].id,id);
  assert.equal(panel._savedViews[0].settings.room,'room:Kitchen');
  panel._activeViewId = ''; panel._viewName = 'work';
  await panel._saveView();
  assert.equal(panel._savedViews.length,1);
  assert.equal(state.toasts.length,3);
});

test('removing a saved view requires confirmation and retains it when persistence fails', async () => {
  const { panel,state } = fixture();
  panel._viewName = 'Work'; await panel._saveView();
  globalThis.window.confirm = () => false;
  await panel._deleteView();
  assert.equal(panel._savedViews.length,1);
  globalThis.window.confirm = () => true;
  state.failViewWrites = true;
  await panel._deleteView();
  assert.equal(panel._savedViews.length,1);
  state.failViewWrites = false;
  await panel._deleteView();
  assert.deepEqual(panel._savedViews,[]);
  assert.equal(panel._activeViewId,'');
});

test('Escape dismisses the filters before details and restores focus to their trigger', () => {
  const { panel,state,filter } = fixture();
  panel._selectedId = 'a'; panel._filtersOpen = true;
  const first = escape(panel);
  assert.equal(first.prevented,true); assert.equal(first.stopped,true);
  assert.equal(panel._filtersOpen,false); assert.equal(filter.hidden,true);
  assert.equal(panel._selectedId,'a'); assert.equal(state.focused,'filter'); assert.equal(state.expanded,'false');
  escape(panel);
  assert.equal(panel._selectedId,null);
});

test('Escape does not dismiss filters or selected details underneath an editor dialog', () => {
  const { panel } = fixture();
  panel._filtersOpen = true; panel._selectedId = 'a'; panel._modal = { kind:'editor' };
  const event = escape(panel);
  assert.equal(event.prevented,false);
  assert.equal(panel._filtersOpen,true);
  assert.equal(panel._selectedId,'a');
});

test('desktop outside-click dismisses filters while inside clicks and mobile inline filters stay open', () => {
  const { panel,filter,button } = fixture();
  panel._filtersOpen = true;
  panel._outsideFilters({ composedPath:() => [filter] });
  panel._outsideFilters({ composedPath:() => [button] });
  assert.equal(panel._filtersOpen,true);
  panel._outsideFilters({ composedPath:() => [] });
  assert.equal(panel._filtersOpen,false);
  globalThis.window.innerWidth = 390; panel._filtersOpen = true;
  panel._outsideFilters({ composedPath:() => [] });
  assert.equal(panel._filtersOpen,true);
});

test('active chips count only structured filters, while code-status choices remain available in the panel', () => {
  const { panel } = fixture();
  panel._query = 'secret search'; panel._sort = 'room'; panel._group = 'room';
  assert.equal(panel._structuredFilters().length,0);
  panel._room = 'room:Office'; panel._protocol = 'matter'; panel._codeStatusFilter = 'missing'; panel._floor = 'floor:upper'; panel._label = 'label:work';
  assert.deepEqual(panel._structuredFilters().map(chip => chip[0]),['room','floor','label','protocol','status']);
  const html = panel._renderFilters(0,2);
  assert.match(html,/aria-expanded="false"/);
  for (const status of ['all','has','missing']) assert.match(html,new RegExp(`option value="${status}"`));
  assert.match(html,/data-action="remove-filter" data-filter="status"/);
});

test('reset clears all filters and current selection while keeping the tab, sort and grouping', () => {
  const { panel,state } = fixture();
  panel._tab = 'archive'; panel._sort = 'updated-desc'; panel._group = 'room'; panel._query = 'secret search';
  panel._room = 'room:Office'; panel._floor = 'floor:upper'; panel._label = 'label:work'; panel._protocol = 'matter'; panel._codeStatusFilter = 'missing'; panel._activeViewId = 'view'; panel._viewName = 'Name'; panel._selection.add('a');
  panel._resetFilters();
  assert.equal(panel._query,''); assert.equal(panel._structuredFilters().length,0);
  assert.equal(panel._selection.size,0); assert.equal(panel._activeViewId,''); assert.equal(panel._viewName,'');
  assert.equal(panel._tab,'archive'); assert.equal(panel._sort,'updated-desc'); assert.equal(panel._group,'room');
  assert.equal(state.focused,'search');
});

test('selected export candidates include only still-visible selected records', () => {
  const { panel } = fixture();
  panel._selection = new Set(['a','b','archive','removed']); panel._room = 'room:Office';
  assert.deepEqual(panel._selectionRecords().map(item => item.id),['a']);
  panel._tab = 'archive';
  assert.deepEqual(panel._selectionRecords().map(item => item.id),['archive']);
});

test('room groups hide only their own records and never duplicate a multi-room entry', () => {
  const { panel } = fixture();
  panel._devices[1].location = 'Kitchen';
  panel._devices.push(record('multi',{ links:[{ location:'Office' },{ location:'Kitchen' }] }));
  panel._group = 'room';
  let html = panel._renderDeviceTable(panel._visibleDevices());
  assert.equal((html.match(/class="row-open"/g)||[]).length,3);
  panel._collapsedGroups.add('["Office"]');
  html = panel._renderDeviceTable(panel._visibleDevices());
  assert.doesNotMatch(html,/Synthetic a<\/button>/);
  assert.match(html,/Synthetic b<\/button>/);
  assert.match(html,/Synthetic multi<\/button>/);
  assert.equal((html.match(/class="row-open"/g)||[]).length,2);
});


test('export dialog freezes visible and selected scopes independently of later filter or selection changes', () => {
  const { panel } = fixture();
  panel._room = 'room:Office'; panel._selection = new Set(['a','b','archive']);
  panel._openExport('selected');
  assert.deepEqual(panel._exportScopes,{ all:null, visible:['a'], selected:['a'] });
  panel._room = 'room:Kitchen'; panel._selection.clear();
  assert.deepEqual(panel._exportScopes,{ all:null, visible:['a'], selected:['a'] });
  assert.equal(panel._exportScope,'selected');
});

for (const scope of ['visible','selected','all']) {
  test(`${scope} export sends exactly the displayed snapshot and downloads only that response`, async () => {
    const { panel,state } = fixture();
    panel._room = 'room:Office'; panel._selection.add('a'); panel._openExport(scope);
    panel._exportFormat = 'csv';
    const calls = [];
    panel._api = async (command,payload) => { calls.push({ command,payload }); return { content:'synthetic-csv', mime:'text/csv', filename:'synthetic-selection.csv' }; };
    await panel._export();
    assert.deepEqual(calls,[{ command:'export', payload:{ format:'csv',...(scope === 'all' ? {} : { record_ids:['a'] }) } }]);
    assert.equal(state.downloads.length,1);
    assert.equal(state.downloads[0].filename,'synthetic-selection.csv');
    assert.equal(panel._busy,false); assert.equal(panel._modal,null);
  });
}

for (const scope of ['visible','selected','unknown']) {
  test(`empty or invalid ${scope} export never silently falls back to the entire inventory`, async () => {
    const { panel,state } = fixture();
    panel._room = 'room:Does not exist'; panel._openExport(scope);
    let calls = 0;
    panel._api = async () => { calls++; throw new Error('must not export all'); };
    await panel._export();
    assert.equal(calls,0); assert.equal(state.downloads.length,0);
    assert.equal(panel._modal.kind,'export'); assert.equal(panel._busy,false);
    assert.ok(panel._modalError);
  });
}

test('expired subset export reports the failure without retrying all records', async () => {
  const { panel,state } = fixture();
  panel._openExport('visible'); let calls = 0;
  panel._api = async (command,payload) => { calls++; assert.deepEqual(payload.record_ids,['a','b']); throw { code:'not_found' }; };
  await panel._export();
  assert.equal(calls,1); assert.equal(state.downloads.length,0);
  assert.equal(panel._modal.kind,'export'); assert.ok(panel._modalError);
});

test('capture candidates respect the room and query while ignoring the previous protocol/status and excluding archives', () => {
  const { panel } = fixture();
  panel._devices = [
    record('target',{ name:'Lamp target', codes:[{ protocol:'homekit', value:'11122333' }] }),
    record('complete',{ name:'Lamp complete', codes:[{ protocol:'matter', value:'MT:SYNTHETIC' }] }),
    record('other-room',{ name:'Lamp kitchen', location:'Kitchen' }),
    record('other-name',{ name:'Sensor' }),
    record('archive',{ name:'Lamp archived', archived:true }),
  ];
  panel._room = 'room:Office'; panel._query = 'Lamp'; panel._protocol = 'homekit'; panel._codeStatusFilter = 'has';
  assert.deepEqual(panel._captureCandidates('matter').map(item => item.id),['target']);
  panel._tab = 'archive';
  assert.deepEqual(panel._captureCandidates('matter'),[]);
});

test('capture starts with a frozen ordered queue and a pristine draft for its target code', () => {
  const { panel } = fixture();
  panel._captureProtocol = 'matter'; panel._startCaptureQueue();
  assert.deepEqual(panel._captureQueue,{ ids:['a','b'], index:0, saved:0, skipped:0, protocol:'matter' });
  assert.equal(panel._draft.id,'a');
  assert.equal(panel._draft.codes[0].protocol,'matter'); assert.equal(panel._draft.codes[0].value,'');
  assert.equal(panel._dirty,false);
  panel._room = 'room:Kitchen';
  assert.deepEqual(panel._captureQueue.ids,['a','b']);
  globalThis.window.confirm = () => { throw new Error('A pristine step must skip without asking to discard edits'); };
  panel._skipCapture();
  assert.equal(panel._captureQueue.index,1); assert.equal(panel._draft.id,'b');
});

test('capture skip confirms real edits, does not save them, and advances only after accepting discard', () => {
  const { panel } = fixture();
  panel._captureProtocol = 'matter'; panel._startCaptureQueue();
  panel._onInput({ target:{ dataset:{ field:'code-value',index:'0' }, value:'MT:SYNTHETIC-NOT-SAVED' } });
  let saves = 0; panel._api = async () => { saves++; };
  globalThis.window.confirm = () => false; panel._skipCapture();
  assert.equal(panel._captureQueue.index,0); assert.equal(panel._draft.id,'a');
  globalThis.window.confirm = () => true; panel._skipCapture();
  assert.equal(panel._captureQueue.index,1); assert.equal(panel._captureQueue.skipped,1); assert.equal(panel._draft.id,'b');
  assert.equal(saves,0);
});

test('capture automatically skips targets removed, archived or completed since the queue was opened', () => {
  const { panel,state } = fixture();
  panel._captureQueue = { ids:['removed','archive','complete','remaining'], index:0, saved:0, skipped:0, protocol:'matter' };
  panel._devices = [record('archive',{ archived:true }),record('complete',{ codes:[{ protocol:'matter',value:'MT:SYNTHETIC' }] }),record('remaining')];
  panel._openCaptureStep();
  assert.equal(panel._captureQueue.index,3); assert.equal(panel._captureQueue.skipped,3); assert.equal(panel._draft.id,'remaining');
  panel._dirty = false; panel._skipCapture();
  assert.equal(panel._captureQueue,null); assert.equal(panel._draft,null); assert.equal(panel._selectedId,null);
  assert.equal(state.toasts.length,1);
});

test('capture refuses a blank target code or a draft for a different queue record', async () => {
  const { panel } = fixture();
  panel._captureProtocol = 'matter'; panel._startCaptureQueue();
  let calls = 0; panel._api = async () => { calls++; };
  await panel._save();
  assert.equal(calls,0); assert.equal(panel._captureQueue.index,0); assert.ok(panel._draftError);
  panel._draft.id = 'different'; panel._draft.codes[0].value = 'MT:SYNTHETIC';
  await panel._save();
  assert.equal(calls,0); assert.equal(panel._captureQueue.index,0);
});

test('capture save failure retains the code and current step for retry', async () => {
  const { panel } = fixture();
  panel._captureProtocol = 'matter'; panel._startCaptureQueue();
  panel._draft.codes[0].value = 'MT:SYNTHETIC';
  panel._api = async () => { throw { code:'conflict' }; };
  await panel._save();
  assert.equal(panel._captureQueue.index,0); assert.equal(panel._captureQueue.saved,0);
  assert.equal(panel._draft.codes[0].value,'MT:SYNTHETIC');
  assert.equal(panel._draftErrorCode,'conflict'); assert.equal(panel._modal.kind,'editor'); assert.equal(panel._busy,false);
});

test('capture advances only after a successful save and refresh, preserving the original target', async () => {
  const { panel } = fixture();
  panel._captureProtocol = 'matter'; panel._startCaptureQueue();
  panel._draft.codes[0].value = 'MT:SYNTHETIC';
  let finishSave; const saved = new Promise(resolve => { finishSave = resolve; });
  let refreshed = false;
  panel._api = async (command,payload) => { assert.equal(command,'save'); assert.equal(payload.record.id,'a'); return saved; };
  panel._refresh = async () => { refreshed = true; return { devices:panel._devices, revision:2 }; };
  const pending = panel._save();
  assert.equal(panel._captureQueue.index,0); assert.equal(panel._captureQueue.saved,0); assert.equal(panel._busy,true);
  finishSave({ id:'a' }); await pending;
  assert.equal(refreshed,true); assert.equal(panel._captureQueue.index,1); assert.equal(panel._captureQueue.saved,1);
  assert.equal(panel._draft.id,'b');
});

test('disconnect cancels a capture queue and a late save cannot advance a later session queue', async () => {
  const { panel } = fixture();
  panel._captureProtocol = 'matter'; panel._startCaptureQueue();
  panel._draft.codes[0].value = 'MT:SYNTHETIC';
  let finishSave; const saved = new Promise(resolve => { finishSave = resolve; });
  panel._api = async () => saved; panel._refresh = async () => {};
  const pending = panel._save();
  panel.disconnectedCallback();
  assert.equal(panel._captureQueue,null); assert.equal(panel._draft,null);
  panel._connected = true; panel._devices = [record('new-a'),record('new-b')]; panel._startCaptureQueue();
  const newQueue = panel._captureQueue, newDraft = panel._draft;
  finishSave({ id:'a' }); await pending;
  assert.strictEqual(panel._captureQueue,newQueue);
  assert.equal(panel._captureQueue.index,0); assert.equal(panel._captureQueue.saved,0);
  assert.strictEqual(panel._draft,newDraft); assert.equal(panel._draft.id,'new-a');
});


test('changing structured filters clears hidden selection while sorting keeps the selected visible records', () => {
  const { panel } = fixture();
  panel._selection = new Set(['a','b']);
  panel._onChange(value('sort-filter','name-desc'));
  assert.deepEqual([...panel._selection],['a','b']);
  assert.deepEqual(panel._visibleDevices().map(item => item.id),['b','a']);
  panel._onChange(value('room-filter','room:Office'));
  assert.equal(panel._selection.size,0);
  assert.deepEqual(panel._visibleDevices().map(item => item.id),['a']);
  panel._floor = 'floor:upper'; panel._label = 'label:work';
  panel._onChange(value('floor-filter','')); panel._onChange(value('label-filter',''));
  assert.equal(panel._floor,''); assert.equal(panel._label,'');
});

test('removing an active status chip leaves the room filter and returns focus to Filter', async () => {
  const { panel,state } = fixture();
  panel._room = 'room:Office'; panel._codeStatusFilter = 'missing'; panel._selection.add('a');
  await click(panel,'remove-filter',{ filter:'status' });
  assert.equal(panel._codeStatusFilter,'all'); assert.equal(panel._room,'room:Office');
  assert.equal(panel._selection.size,0); assert.equal(state.focused,'filter');
  assert.deepEqual(panel._structuredFilters().map(chip => chip[0]),['room']);
});

test('capture stops after a stored code cannot be refreshed instead of resaving a stale draft', async () => {
  const { panel,state } = fixture();
  panel._captureProtocol = 'matter'; panel._startCaptureQueue(); panel._draft.codes[0].value = 'MT:SYNTHETIC';
  let saves = 0;
  panel._api = async command => { assert.equal(command,'save'); saves++; return { id:'a' }; };
  panel._refresh = async () => undefined;
  await panel._save();
  assert.equal(saves,1); assert.equal(panel._captureQueue,null); assert.equal(panel._draft,null);
  assert.equal(panel._busy,false); assert.equal(panel._modal,null); assert.equal(state.toasts.length,1);
  await panel._save();
  assert.equal(saves,1);
});

test('a failed late save cannot replace the new session editor with an old capture error', async () => {
  const { panel } = fixture();
  panel._captureProtocol = 'matter'; panel._startCaptureQueue(); panel._draft.codes[0].value = 'MT:SYNTHETIC';
  let failSave; const failure = new Promise((resolve,reject) => { failSave = reject; });
  panel._api = async () => failure;
  const pending = panel._save();
  panel.disconnectedCallback(); panel._connected = true; panel._devices = [record('new-a'),record('new-b')]; panel._startCaptureQueue();
  const queue = panel._captureQueue, draft = panel._draft, modal = panel._modal;
  failSave({ code:'conflict' }); await pending;
  assert.strictEqual(panel._captureQueue,queue); assert.equal(queue.index,0); assert.equal(queue.saved,0);
  assert.strictEqual(panel._draft,draft); assert.strictEqual(panel._modal,modal); assert.equal(panel._draftError,'');
});

for (const outcome of ['success','failure']) {
  test(`late export ${outcome} after disconnect cannot download data or replace a new editor`, async () => {
    const { panel,state } = fixture();
    panel._openExport('visible');
    let resolveExport, rejectExport;
    panel._api = async () => new Promise((resolve,reject) => { resolveExport = resolve; rejectExport = reject; });
    const pending = panel._export();
    panel.disconnectedCallback(); panel._connected = true;
    panel._newDraft(record('new-session')); panel._openModal('editor'); panel._busy = true;
    const draft = panel._draft, modal = panel._modal;
    if (outcome === 'success') resolveExport({ content:'SYNTHETIC-SENSITIVE-EXPORT', mime:'application/json', filename:'old-session.json' });
    else rejectExport({ code:'not_found' });
    await pending;
    assert.equal(state.downloads.length,0);
    assert.strictEqual(panel._draft,draft); assert.strictEqual(panel._modal,modal);
    assert.equal(panel._modalError,''); assert.equal(panel._busy,true);
  });
}

for (const firstReply of ['older','latest']) {
  test(`capture awaits the latest inventory when a subscription refresh supersedes its post-save refresh (${firstReply} reply first)`, async () => {
    const { panel } = fixture();
    panel._captureProtocol = 'matter'; panel._startCaptureQueue(); panel._draft.codes[0].value = 'MT:SYNTHETIC';
    const queue = panel._captureQueue;
    let olderReply, latestReply, started;
    const firstStarted = new Promise(resolve => { started = resolve; });
    let listCalls = 0;
    panel._api = async command => {
      if (command === 'save') return { id:'a' };
      assert.equal(command,'list'); listCalls++;
      if (listCalls === 1) return new Promise(resolve => { olderReply = resolve; started(); });
      if (listCalls === 2) return new Promise(resolve => { latestReply = resolve; });
      throw new Error('unexpected repeated refresh');
    };
    const records = [record('a',{ codes:[{ id:'saved',protocol:'matter',value:'MT:SYNTHETIC' }] }),record('b')];
    const pendingSave = panel._save();
    await firstStarted;
    // This is the same call issued by the debounced subscription callback.
    const eventRefresh = panel._refresh(false);
    if (firstReply === 'older') {
      olderReply({ devices:records, revision:2, instance_id:'synthetic-ha' });
      await new Promise(resolve => setImmediate(resolve));
      assert.strictEqual(panel._captureQueue,queue);
      assert.equal(queue.index,0); assert.equal(queue.saved,0); assert.equal(panel._busy,true);
      latestReply({ devices:records, revision:3, instance_id:'synthetic-ha' });
    } else {
      latestReply({ devices:records, revision:3, instance_id:'synthetic-ha' });
      await eventRefresh;
      olderReply({ devices:records, revision:2, instance_id:'synthetic-ha' });
    }
    await Promise.all([pendingSave,eventRefresh]);
    assert.strictEqual(panel._captureQueue,queue);
    assert.equal(queue.index,1); assert.equal(queue.saved,1);
    assert.equal(panel._draft.id,'b'); assert.equal(panel._baseRevision,3); assert.equal(panel._busy,false);
  });
}

test('capture reports an actual latest-refresh failure after an older response is superseded', async () => {
  const { panel,state } = fixture();
  panel._captureProtocol = 'matter'; panel._startCaptureQueue(); panel._draft.codes[0].value = 'MT:SYNTHETIC';
  let olderReply, failLatest, started;
  const firstStarted = new Promise(resolve => { started = resolve; });
  let listCalls = 0;
  panel._api = async command => {
    if (command === 'save') return { id:'a' };
    if (++listCalls === 1) return new Promise(resolve => { olderReply = resolve; started(); });
    return new Promise((resolve,reject) => { failLatest = reject; });
  };
  const pendingSave = panel._save(); await firstStarted;
  const eventRefresh = panel._refresh(false);
  olderReply({ devices:panel._devices, revision:2, instance_id:'synthetic-ha' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(panel._captureQueue); assert.equal(panel._busy,true);
  failLatest({ code:'not_loaded' });
  await Promise.all([pendingSave,eventRefresh]);
  assert.equal(panel._captureQueue,null); assert.equal(panel._draft,null); assert.equal(panel._busy,false);
  assert.ok(panel._loadError); assert.equal(state.toasts.length,1);
});

for (const outcome of ['success','failure']) {
  test(`disconnect during inventory refresh resolves without self-adoption or stale UI writes (${outcome})`, async () => {
    const { panel,state } = fixture();
    let finish, fail;
    panel._api = async () => new Promise((resolve,reject) => { finish = resolve; fail = reject; });
    const devices = panel._devices;
    const pending = panel._refresh(false);
    panel.disconnectedCallback();
    const renders = state.renders;
    if (outcome === 'success') finish({ devices:[record('late')], revision:100, instance_id:'different-ha' });
    else fail({ code:'not_loaded' });
    assert.equal(await pending,undefined);
    assert.strictEqual(panel._devices,devices);
    assert.equal(panel._instance,'synthetic-ha'); assert.equal(state.renders,renders);
  });
}

test('a scan from another code family cannot alter the current capture target or enable protocol changes', () => {
  const { panel } = fixture();
  panel._captureProtocol = 'matter'; panel._startCaptureQueue();
  const before = structuredClone(panel._draft), queue = panel._captureQueue;
  panel._receiveScan('X-HM://SYNTHETIC');
  assert.deepEqual(panel._draft,before); assert.strictEqual(panel._captureQueue,queue);
  assert.equal(queue.index,0); assert.equal(queue.saved,0);
  assert.equal(panel._activeProtocol,'matter'); assert.equal(panel._dirty,false);
  assert.ok(panel._draftError); assert.equal(panel._modal.kind,'editor');
  assert.match(panel._renderEditor(),/<select data-field="code-protocol"[^>]*disabled/);
});
