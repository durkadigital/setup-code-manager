import assert from 'node:assert/strict';
import test from 'node:test';
import { loadViewPreferences, preferenceKey, saveViewPreferences, sanitizeViewSettings } from '../custom_components/setup_code_manager/www/preferences.js';

// Only synthetic preferences and list results are used. Rendering is stubbed so
// these tests exercise preference lifecycle independently of browser geometry.
const elements = new Map();
globalThis.customElements = { get:name => elements.get(name), define:(name, value) => elements.set(name,value) };
globalThis.HTMLElement = class {
  attachShadow() {
    this.shadowRoot = {
      addEventListener() {}, getElementById() { return null; },
      querySelector() { return null; }, querySelectorAll() { return []; },
    };
  }
};
globalThis.window = {};
globalThis.document = {};
await import('../custom_components/setup_code_manager/www/panel.js');
const Panel = elements.get('setup-code-manager-panel');
const view = (id, settings = {}) => ({ id, name:`Synthetic ${id}`, settings:sanitizeViewSettings(settings) });
const home = view('home', { tab:'linked', protocol:'matter', codeStatus:'has', room:'room:Office', floor:'floor:upper', label:'label:work', sort:'updated-desc', group:'room' });
const work = view('work', { tab:'unlinked', protocol:'homekit', codeStatus:'missing', room:'room:Kitchen', sort:'room' });

function memoryStorage() {
  const values = new Map();
  return { values, getItem:key => values.get(key) ?? null, setItem:(key,value) => values.set(key,value) };
}
function fixture({ storage = memoryStorage(), user = 'synthetic-user' } = {}) {
  globalThis.window = { localStorage:storage, confirm:() => true };
  const panel = new Panel(), state = { renders:0, toasts:[], calls:0 };
  panel._hass = { language:'en', user:{ id:user } };
  panel._connected = true;
  panel._renderMain = () => { state.renders++; };
  panel._toast = message => { state.toasts.push(message); };
  panel._api = async command => {
    assert.equal(command,'list'); state.calls++;
    return { instance_id:'synthetic-ha', revision:state.calls, devices:[] };
  };
  return { panel,state,storage };
}
function seed(storage, user, views = [home,work], defaultViewId = 'home', instance = 'synthetic-ha') {
  assert.equal(saveViewPreferences(storage,instance,user,{ views,defaultViewId }),true);
}
function click(panel, action) {
  return panel._onClick({ target:{ closest:() => ({ disabled:false, dataset:{ action } }) } });
}

test('the first resolved list loads and applies the saved default for its HA instance and user', async () => {
  const { panel,storage } = fixture();
  seed(storage,'synthetic-user');
  panel._query = 'SYNTHETIC-TRANSIENT-SEARCH';
  panel._selection.add('synthetic-record'); panel._selectedId = 'synthetic-record';
  panel._collapsedGroups.add('["Office"]');
  panel._loadViewPreferences();
  assert.equal(panel._defaultViewId,'');
  assert.equal(panel._activeViewId,'');
  assert.equal(panel._room,'');
  await panel._refresh();
  assert.equal(panel._instance,'synthetic-ha');
  assert.equal(panel._defaultViewId,'home');
  assert.equal(panel._activeViewId,'home');
  assert.equal(panel._viewName,home.name);
  assert.deepEqual(panel._viewSettings(),home.settings);
  assert.equal(panel._query,'');
  assert.equal(panel._selection.size,0);
  assert.equal(panel._selectedId,null);
  assert.equal(panel._collapsedGroups.size,0);
});

test('later HA refreshes in the same scope retain temporary filter choices instead of reapplying the default', async () => {
  const { panel,storage,state } = fixture();
  seed(storage,'synthetic-user');
  await panel._refresh();
  panel._onChange({ target:{ dataset:{ field:'room-filter' }, value:'room:Kitchen' } });
  panel._onChange({ target:{ dataset:{ field:'sort-filter' }, value:'name-desc' } });
  panel._onInput({ target:{ dataset:{ field:'search' }, value:'SYNTHETIC-SEARCH' } });
  const temporary = panel._viewSettings();
  await panel._refresh(false);
  await panel._refresh(false);
  assert.equal(state.calls,3);
  assert.deepEqual(panel._viewSettings(),temporary);
  assert.equal(panel._room,'room:Kitchen');
  assert.equal(panel._sort,'name-desc');
  assert.equal(panel._query,'SYNTHETIC-SEARCH');
  assert.equal(panel._defaultViewId,'home');
  assert.deepEqual(loadViewPreferences(storage,'synthetic-ha','synthetic-user'), { views:[home,work], defaultViewId:'home' });
});

test('resolving another HA user loads that user default and does not write either scope', async () => {
  const { panel,storage } = fixture();
  seed(storage,'synthetic-user');
  seed(storage,'other-user',[home,work],'work');
  const before = new Map(storage.values);
  await panel._refresh();
  panel._hass.user.id = 'other-user';
  await panel._refresh(false);
  assert.equal(panel._defaultViewId,'work');
  assert.equal(panel._activeViewId,'work');
  assert.deepEqual(panel._viewSettings(),work.settings);
  assert.equal(panel._viewName,work.name);
  assert.deepEqual(storage.values,before);
});

test('default actions save the active view and clear the default without removing saved views', async () => {
  const { panel,storage } = fixture();
  seed(storage,'synthetic-user',[home,work],'');
  await panel._refresh();
  panel._applyView('work');
  await click(panel,'set-default-view');
  assert.equal(panel._defaultViewId,'work');
  assert.deepEqual(loadViewPreferences(storage,'synthetic-ha','synthetic-user'), { views:[home,work], defaultViewId:'work' });
  await click(panel,'clear-default-view');
  assert.equal(panel._defaultViewId,'');
  assert.equal(panel._activeViewId,'work');
  assert.deepEqual(loadViewPreferences(storage,'synthetic-ha','synthetic-user'), { views:[home,work], defaultViewId:'' });
});

test('deleting the default clears its reference while keeping other saved views', async () => {
  const { panel,storage } = fixture();
  seed(storage,'synthetic-user');
  await panel._refresh();
  panel._deleteView();
  assert.equal(panel._defaultViewId,'');
  assert.equal(panel._activeViewId,'');
  assert.deepEqual(panel._savedViews,[work]);
  assert.deepEqual(loadViewPreferences(storage,'synthetic-ha','synthetic-user'), { views:[work], defaultViewId:'' });
});

test('storage write failures keep the current default and saved views for set, clear and delete actions', async () => {
  const { panel,storage,state } = fixture();
  seed(storage,'synthetic-user');
  await panel._refresh();
  const stored = storage.getItem(preferenceKey('synthetic-ha','synthetic-user'));
  storage.setItem = () => { throw new Error('synthetic quota'); };
  panel._applyView('work');
  panel._setDefaultView();
  assert.equal(panel._defaultViewId,'home');
  panel._clearDefaultView();
  assert.equal(panel._defaultViewId,'home');
  panel._applyView('home');
  panel._deleteView();
  assert.equal(panel._defaultViewId,'home');
  assert.equal(panel._activeViewId,'home');
  assert.deepEqual(panel._savedViews,[home,work]);
  assert.equal(storage.getItem(preferenceKey('synthetic-ha','synthetic-user')),stored);
  assert.equal(state.toasts.length,3);
});
