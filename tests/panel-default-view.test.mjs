import assert from 'node:assert/strict';
import test from 'node:test';
import { VIEW_SETTINGS_DEFAULTS, preferenceKey, saveViewPreferences, sanitizeViewSettings } from '../custom_components/setup_code_manager/www/preferences.js';

// Synthetic HA accounts share a mock server. Each panel has independent legacy
// browser storage; no live HA instance, inventory or external storage is used.
const elements = new Map();
globalThis.customElements = { get:name => elements.get(name), define:(name,value) => elements.set(name,value) };
globalThis.HTMLElement = class {
  attachShadow() {
    this.shadowRoot = { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
  }
};
globalThis.window = {}; globalThis.document = {};
await import('../custom_components/setup_code_manager/www/panel.js');
const Panel = elements.get('setup-code-manager-panel'), copy = value => structuredClone(value);
const view = (id,settings = {}) => ({ id,name:`Synthetic ${id}`,settings:sanitizeViewSettings(settings) });
const home = view('home',{ tab:'linked',protocol:'matter',codeStatus:'has',room:'room:Office',floor:'floor:upper',label:'label:work',sort:'updated-desc',group:'room' });
const work = view('work',{ tab:'unlinked',protocol:'homekit',codeStatus:'missing',room:'room:Kitchen',sort:'room' });
const empty = () => ({ revision:0,views:[],defaultViewId:'' });
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise,resolve }; };
function memoryStorage() {
  const values = new Map(); return { values,getItem:key => values.get(key) ?? null,setItem:(key,value) => values.set(key,value) };
}
function mockServer() {
  const catalogs = new Map(), calls = [], key = (user,instance) => `${instance}:${user}`;
  const server = {
    calls,failWrites:false,failReads:false,writes:0,
    get(user = 'synthetic-user',instance = 'synthetic-ha') { return copy(catalogs.get(key(user,instance)) || empty()); },
    seed(user = 'synthetic-user',preferences = { revision:1,views:[home,work],defaultViewId:'home' },instance = 'synthetic-ha') { catalogs.set(key(user,instance),copy(preferences)); },
    async call(user,instance,command,data = {}) {
      calls.push({ user,instance,command,data:copy(data) });
      if (command === 'list') {
        const result = { instance_id:instance,revision:1,devices:[] };
        return server.failReads ? { ...result,view_preferences_error:'preferences_unavailable' } : { ...result,view_preferences:server.get(user,instance) };
      }
      if (command === 'view_preferences') return server.get(user,instance);
      assert.equal(command,'save_view_preferences');
      if (server.failWrites) throw { code:'preferences_save_failed' };
      const current = server.get(user,instance);
      if (data.expected_revision !== current.revision) throw { code:'preferences_conflict' };
      const saved = { revision:current.revision + 1,views:copy(data.preferences.views),defaultViewId:data.preferences.defaultViewId };
      catalogs.set(key(user,instance),saved); server.writes++; return copy(saved);
    },
  }; return server;
}
function fixture({ server = mockServer(),storage = memoryStorage(),user = 'synthetic-user',instance = 'synthetic-ha' } = {}) {
  globalThis.window = { localStorage:storage,confirm:() => true };
  const panel = new Panel(), state = { renders:0,toasts:[],instance };
  panel._hass = { language:'en',user:{ id:user } }; panel._connected = true;
  panel._renderMain = () => { state.renders++; }; panel._toast = message => { state.toasts.push(message); };
  panel._viewStorage = () => storage;
  panel._api = (command,data) => server.call(panel._hass.user.id,state.instance,command,data);
  return { panel,state,storage,server };
}
const click = (panel,action) => panel._onClick({ target:{ closest:() => ({ disabled:false,dataset:{ action } }) } });

test('the first resolved server catalog applies its account default and clears transient selections', async () => {
  const { panel,server } = fixture(); server.seed();
  panel._query = 'SYNTHETIC-TRANSIENT-SEARCH'; panel._selection.add('synthetic-record'); panel._selectedId = 'synthetic-record'; panel._collapsedGroups.add('["Office"]');
  await panel._loadViewPreferences(); assert.equal(panel._defaultViewId,''); assert.equal(panel._room,'');
  await panel._refresh();
  assert.equal(panel._instance,'synthetic-ha'); assert.equal(panel._viewsReady,true); assert.equal(panel._viewsRevision,1);
  assert.equal(panel._defaultViewId,'home'); assert.equal(panel._activeViewId,'home'); assert.equal(panel._viewName,home.name);
  assert.deepEqual(panel._viewSettings(),home.settings); assert.equal(panel._query,''); assert.equal(panel._selection.size,0); assert.equal(panel._selectedId,null); assert.equal(panel._collapsedGroups.size,0);
});

test('independent browsers share saved views and the default through the same HA account', async () => {
  const server = mockServer(); server.seed(); const first = fixture({ server }), second = fixture({ server });
  assert.notEqual(first.storage,second.storage); await first.panel._refresh();
  first.panel._applyView('work'); await first.panel._setDefaultView(); await second.panel._refresh();
  assert.equal(second.panel._defaultViewId,'work'); assert.deepEqual(second.panel._viewSettings(),work.settings);
  second.panel._activeViewId = ''; second.panel._viewName = 'Shared new view'; await second.panel._saveView(); await first.panel._refresh(false);
  assert.deepEqual(first.panel._savedViews,second.panel._savedViews); assert.equal(first.panel._savedViews.at(-1).name,'Shared new view');
  assert.equal(first.storage.values.size,0); assert.equal(second.storage.values.size,0);
});

test('new catalogs refresh saved views without resetting temporary filters or reapplying their changed default', async () => {
  const { panel,server } = fixture(); server.seed(); await panel._refresh();
  panel._onChange({ target:{ dataset:{ field:'room-filter' },value:'room:Kitchen' } });
  panel._onChange({ target:{ dataset:{ field:'sort-filter' },value:'name-desc' } });
  panel._onInput({ target:{ dataset:{ field:'search' },value:'SYNTHETIC-SEARCH' } }); const temporary = panel._viewSettings();
  server.seed('synthetic-user',{ revision:2,views:[home,work,view('extra')],defaultViewId:'work' }); await panel._refresh(false); await panel._refresh(false);
  assert.deepEqual(panel._viewSettings(),temporary); assert.equal(panel._query,'SYNTHETIC-SEARCH'); assert.equal(panel._defaultViewId,'work'); assert.equal(panel._savedViews.length,3); assert.equal(panel._viewsRevision,2);
});

test('HA account and instance scopes load their own defaults without changing other catalogs', async () => {
  const { panel,server,state } = fixture(); server.seed();
  server.seed('other-user',{ revision:4,views:[work],defaultViewId:'work' }); server.seed('other-user',{ revision:2,views:[home],defaultViewId:'home' },'other-ha');
  await panel._refresh(); panel._hass.user.id = 'other-user'; await panel._refresh(false);
  assert.equal(panel._defaultViewId,'work'); assert.deepEqual(panel._viewSettings(),work.settings); assert.deepEqual(panel._savedViews,[work]);
  state.instance = 'other-ha'; await panel._refresh(false);
  assert.equal(panel._defaultViewId,'home'); assert.deepEqual(panel._viewSettings(),home.settings); assert.equal(panel._viewsRevision,2); assert.equal(server.get().defaultViewId,'home'); assert.equal(server.writes,0);
});

test('set and clear actions persist the shared default without deleting views or applying a new filter', async () => {
  const { panel,server } = fixture(); server.seed(); await panel._refresh(); panel._applyView('work'); panel._room = 'room:Temporary';
  await click(panel,'set-default-view'); assert.equal(panel._defaultViewId,'work'); assert.equal(server.get().defaultViewId,'work'); assert.equal(panel._room,'room:Temporary');
  await click(panel,'clear-default-view'); assert.equal(panel._defaultViewId,''); assert.equal(panel._activeViewId,'work'); assert.equal(panel._room,'room:Temporary');
  assert.deepEqual(server.get(),{ revision:3,views:[home,work],defaultViewId:'' });
});

test('deleting the shared default clears its reference while preserving other saved views', async () => {
  const { panel,server } = fixture(); server.seed(); await panel._refresh(); await panel._deleteView();
  assert.equal(panel._defaultViewId,''); assert.equal(panel._activeViewId,''); assert.deepEqual(panel._savedViews,[work]); assert.deepEqual(server.get(),{ revision:2,views:[work],defaultViewId:'' });
});

test('failed writes and a cancelled delete leave the catalog, default and active view unchanged', async () => {
  const { panel,server,state } = fixture(); server.seed(); await panel._refresh();
  window.confirm = () => false; await panel._deleteView(); assert.equal(server.writes,0); window.confirm = () => true; server.failWrites = true;
  panel._applyView('work'); await panel._setDefaultView(); assert.equal(panel._defaultViewId,'home'); await panel._clearDefaultView(); assert.equal(panel._defaultViewId,'home');
  panel._applyView('home'); await panel._deleteView(); assert.equal(panel._activeViewId,'home'); assert.deepEqual(panel._savedViews,[home,work]); assert.equal(panel._viewsRevision,1);
  assert.deepEqual(server.get(),{ revision:1,views:[home,work],defaultViewId:'home' }); assert.equal(state.toasts.length,3);
});

test('unavailable preference reads keep inventory usable and prevent preference writes', async () => {
  const { panel,server } = fixture(); server.failReads = true; await panel._refresh(); assert.equal(panel._loading,false); assert.equal(panel._viewsReady,false);
  panel._viewName = 'Must not save'; await panel._saveView(); await panel._setDefaultView(); await panel._clearDefaultView();
  assert.equal(server.calls.filter(call => call.command === 'save_view_preferences').length,0); assert.deepEqual(panel._savedViews,[]);
});

test('an older preference revision cannot replace a newer catalog received while a list was pending', async () => {
  const { panel,server } = fixture(); server.seed('synthetic-user',{ revision:5,views:[home,work],defaultViewId:'home' }); await panel._refresh();
  await panel._loadViewPreferences({ revision:7,views:[work],defaultViewId:'work' }); const settings = panel._viewSettings();
  await panel._loadViewPreferences({ revision:6,views:[home],defaultViewId:'home' });
  assert.equal(panel._viewsRevision,7); assert.deepEqual(panel._savedViews,[work]); assert.equal(panel._defaultViewId,'work'); assert.deepEqual(panel._viewSettings(),settings);
});

test('CAS conflicts fetch the winning catalog and never retry an overwrite', async () => {
  const { panel,server } = fixture(); server.seed(); await panel._refresh(); panel._applyView('work');
  const winner = { revision:2,views:[home,view('winner')],defaultViewId:'winner' }; server.seed('synthetic-user',winner); await panel._setDefaultView();
  assert.deepEqual(server.get(),winner); assert.equal(server.writes,0); assert.equal(server.calls.filter(call => call.command === 'save_view_preferences').length,1); assert.equal(server.calls.filter(call => call.command === 'view_preferences').length,1);
  assert.deepEqual(panel._savedViews,winner.views); assert.equal(panel._defaultViewId,'winner'); assert.equal(panel._viewsRevision,2); assert.deepEqual(panel._viewSettings(),work.settings);
});

test('first-use migration transfers the full legacy v1 catalog once and retains the local backup', async () => {
  const { panel,storage,server } = fixture(); saveViewPreferences(storage,'synthetic-ha','synthetic-user',{ views:[home,work],defaultViewId:'work' });
  const backup = storage.getItem(preferenceKey('synthetic-ha','synthetic-user')); await panel._refresh(); await panel._refresh(false);
  assert.deepEqual(server.get(),{ revision:1,views:[home,work],defaultViewId:'work' }); assert.deepEqual(panel._viewSettings(),work.settings); assert.equal(server.writes,1); assert.equal(storage.getItem(preferenceKey('synthetic-ha','synthetic-user')),backup);
});

test('a competing first-use migration reads the winner rather than overwriting another browser catalog', async () => {
  const server = mockServer(), first = fixture({ server }), second = fixture({ server });
  saveViewPreferences(first.storage,'synthetic-ha','synthetic-user',{ views:[home],defaultViewId:'home' }); saveViewPreferences(second.storage,'synthetic-ha','synthetic-user',{ views:[work],defaultViewId:'work' });
  await Promise.all([first.panel._refresh(),second.panel._refresh()]);
  assert.equal(server.writes,1); assert.deepEqual(first.panel._savedViews,server.get().views); assert.deepEqual(second.panel._savedViews,server.get().views); assert.equal(first.panel._defaultViewId,server.get().defaultViewId); assert.equal(second.panel._defaultViewId,server.get().defaultViewId);
});

test('a previously cleared central catalog never resurrects the retained legacy browser backup', async () => {
  const { panel,storage,server } = fixture();
  server.seed('synthetic-user',{ revision:8,views:[],defaultViewId:'' });
  saveViewPreferences(storage,'synthetic-ha','synthetic-user',{ views:[home,work],defaultViewId:'home' });
  const backup = storage.getItem(preferenceKey('synthetic-ha','synthetic-user'));
  await panel._refresh(); await panel._refresh(false);
  assert.deepEqual(panel._savedViews,[]); assert.equal(panel._defaultViewId,''); assert.equal(panel._viewsRevision,8); assert.equal(panel._viewsReady,true);
  assert.equal(server.writes,0); assert.equal(storage.getItem(preferenceKey('synthetic-ha','synthetic-user')),backup);
});

test('a failed first-use transfer leaves the local backup untouched and preference writes disabled', async () => {
  const { panel,storage,server } = fixture(); server.failWrites = true;
  saveViewPreferences(storage,'synthetic-ha','synthetic-user',{ views:[home],defaultViewId:'home' });
  const backup = storage.getItem(preferenceKey('synthetic-ha','synthetic-user'));
  await panel._refresh();
  assert.equal(panel._loading,false); assert.equal(panel._viewsReady,false); assert.deepEqual(panel._savedViews,[]); assert.equal(panel._defaultViewId,'');
  assert.equal(storage.getItem(preferenceKey('synthetic-ha','synthetic-user')),backup); assert.equal(server.writes,0);
});

test('overlapping first-use loads reuse one pending transfer for the same account scope', async () => {
  const { panel,storage } = fixture();
  saveViewPreferences(storage,'synthetic-ha','synthetic-user',{ views:[home],defaultViewId:'home' });
  panel._instance = 'synthetic-ha'; const pending = deferred(); let writes = 0;
  panel._api = (command,data) => { assert.equal(command,'save_view_preferences'); assert.equal(data.expected_revision,0); writes++; return pending.promise; };
  const first = panel._loadViewPreferences(empty()), second = panel._loadViewPreferences(empty());
  assert.equal(writes,1); pending.resolve({ revision:1,views:[home],defaultViewId:'home' }); await Promise.all([first,second]);
  assert.equal(panel._defaultViewId,'home'); assert.deepEqual(panel._savedViews,[home]); assert.equal(panel._viewsRevision,1);
});

test('local views join an existing central catalog only after an explicit import and keep its default', async () => {
  const { panel,storage,server } = fixture(); server.seed('synthetic-user',{ revision:2,views:[home],defaultViewId:'home' });
  saveViewPreferences(storage,'synthetic-ha','synthetic-user',{ views:[work],defaultViewId:'work' });
  await panel._refresh(); assert.deepEqual(panel._savedViews,[home]); assert.equal(server.writes,0);
  await panel._importLocalViews(); assert.deepEqual(server.get(),{ revision:3,views:[home,work],defaultViewId:'home' });
  assert.equal(panel._defaultViewId,'home'); assert.equal(storage.values.size,1);
});

test('a pending write blocks duplicate actions and cannot replace preferences after an account switch', async () => {
  const { panel,server } = fixture(); server.seed(); server.seed('other-user',{ revision:3,views:[work],defaultViewId:'work' }); await panel._refresh();
  const pending = deferred(), realApi = panel._api; let writes = 0;
  panel._api = (command,data) => command === 'save_view_preferences' ? (writes++,pending.promise) : realApi(command,data);
  panel._applyView('work'); const saving = panel._setDefaultView(); assert.equal(panel._viewsBusy,true); await panel._clearDefaultView(); assert.equal(writes,1);
  panel._hass.user.id = 'other-user'; await panel._refresh(false); pending.resolve({ revision:2,views:[home],defaultViewId:'home' }); await saving;
  assert.deepEqual(panel._savedViews,[work]); assert.equal(panel._defaultViewId,'work'); assert.equal(panel._viewsRevision,3);
});

test('a write that completes after disconnect cannot mutate the detached panel catalog', async () => {
  const { panel,server } = fixture(); server.seed(); await panel._refresh(); const pending = deferred(), realApi = panel._api;
  panel._api = (command,data) => command === 'save_view_preferences' ? pending.promise : realApi(command,data);
  panel._applyView('work'); const saving = panel._setDefaultView(); panel._connected = false; pending.resolve({ revision:2,views:[work],defaultViewId:'work' }); await saving;
  assert.deepEqual(panel._savedViews,[home,work]); assert.equal(panel._defaultViewId,'home'); assert.equal(panel._viewsRevision,1);
});

test('switching HA accounts immediately disables writes and rejects old writes before the new list resolves', async () => {
  const { panel,server,state } = fixture(); server.seed(); await panel._refresh(); panel._started = true;
  const pendingWrite = deferred(), pendingList = deferred(); let writes = 0;
  panel._api = command => {
    if (command === 'list') return pendingList.promise;
    assert.equal(command,'save_view_preferences'); writes++; return pendingWrite.promise;
  };
  panel._applyView('work'); const saving = panel._setDefaultView(); const toasts = state.toasts.length;
  panel.hass = { language:'en',user:{ id:'other-user' } };
  assert.equal(panel._viewsReady,false,'The old account must become unwritable before the new list returns.');
  panel._viewName = 'Must not cross accounts'; await panel._saveView(); assert.equal(writes,1);
  pendingWrite.resolve({ revision:2,views:[home],defaultViewId:'home' }); await saving;
  assert.equal(state.toasts.length,toasts,'Old account completion must not produce a success toast for the new account.');
  assert.notEqual(panel._viewsRevision,2,'The old account response must not become the new account catalog.');
  pendingList.resolve({ instance_id:'synthetic-ha',revision:2,devices:[],view_preferences:{ revision:3,views:[work],defaultViewId:'work' } });
  await panel._refreshRequest.promise;
  assert.deepEqual(panel._savedViews,[work]); assert.equal(panel._defaultViewId,'work'); assert.equal(panel._viewsRevision,3);
});

test('switching to an account without a default resets the previous account filters and transient search', async () => {
  const { panel,server } = fixture(); server.seed();
  server.seed('other-user',{ revision:2,views:[work],defaultViewId:'' });
  await panel._refresh(); panel._started = true; panel._query = 'SYNTHETIC-ACCOUNT-A-SEARCH';
  assert.equal(panel._room,'room:Office');
  panel.hass = { language:'en',user:{ id:'other-user' } }; await panel._refreshRequest.promise;
  assert.deepEqual(panel._viewSettings(),VIEW_SETTINGS_DEFAULTS); assert.equal(panel._query,'');
  assert.equal(panel._activeViewId,''); assert.equal(panel._viewName,''); assert.equal(panel._defaultViewId,''); assert.deepEqual(panel._savedViews,[work]);
});

test('a same-language account switch immediately renders the old catalog away with controls disabled while loading', async () => {
  const { panel,server,state } = fixture(); server.seed(); await panel._refresh(); panel._started = true;
  const pending = deferred(), before = state.renders;
  panel._api = command => { assert.equal(command,'list'); return pending.promise; };
  panel.hass = { language:'en',user:{ id:'other-user' } };
  assert.ok(state.renders > before,'Changing account must render its empty pending state before the list response.');
  assert.equal(panel._viewsReady,false); assert.deepEqual(panel._savedViews,[]); assert.equal(panel._defaultViewId,'');
  const html = panel._renderFilters(0,0);
  assert.doesNotMatch(html,/Synthetic home|Synthetic work/);
  assert.match(html,/<select[^>]*data-field="saved-view"[^>]*disabled/);
  assert.match(html,/<button[^>]*data-action="save-view"[^>]*disabled/);
  pending.resolve({ instance_id:'synthetic-ha',revision:2,devices:[],view_preferences:{ revision:1,views:[],defaultViewId:'' } });
  await panel._refreshRequest.promise; assert.equal(panel._viewsReady,true);
});
