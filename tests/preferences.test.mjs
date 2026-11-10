import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_SAVED_VIEWS, VIEW_SETTINGS_DEFAULTS, loadViewPreferences, loadViews, normalizeViews,
  preferenceKey, sanitizeViewSettings, saveViewPreferences, saveViews,
} from '../custom_components/setup_code_manager/www/preferences.js';

function memoryStorage() {
  const values = new Map();
  return { values, getItem(key) { return this.values.get(key) ?? null; }, setItem(key, value) { this.values.set(key, value); } };
}
const view = (id, fields = {}) => ({ id, name:`View ${id}`, settings:{ room:'room:Office', codeStatus:'missing' }, ...fields });

test('saved view choices include list controls and strictly discard searches, codes and record data', () => {
  const settings = {
    tab:'archive', protocol:'matter', codeStatus:'has', room:'room:Kids / Study',
    floor:'floor:upper', label:'label:work', sort:'updated-desc', group:'room',
  };
  assert.deepEqual(sanitizeViewSettings({ ...settings, query:'SYNTHETIC-CODE-SECRET', notes:'private note', codes:[{ value:'MT:SECRET' }], devices:[{ name:'private inventory' }] }), settings);
  assert.equal(Object.hasOwn(sanitizeViewSettings({ query:'secret' }), 'query'), false);
  assert.deepEqual(sanitizeViewSettings(null), VIEW_SETTINGS_DEFAULTS);
  assert.deepEqual(sanitizeViewSettings([]), VIEW_SETTINGS_DEFAULTS);
});

test('untrusted choice values are bounded and fall back safely without changing exact room names', () => {
  assert.deepEqual(sanitizeViewSettings({ tab:'everything', protocol:'wifi', codeStatus:true, room:'Office', floor:'upper', label:'work', sort:'random', group:true }), VIEW_SETTINGS_DEFAULTS);
  for (const key of ['room','floor','label']) {
    assert.equal(sanitizeViewSettings({ [key]:'unassigned' })[key], 'unassigned');
    assert.equal(sanitizeViewSettings({ [key]:`${key}:` })[key], '');
    assert.equal(sanitizeViewSettings({ [key]:`${key}: ` })[key], '');
    assert.equal(sanitizeViewSettings({ [key]:`${key}:bad\nvalue` })[key], '');
    assert.equal(sanitizeViewSettings({ [key]:`${key}:${'x'.repeat(1100)}` })[key], '');
  }
  assert.equal(sanitizeViewSettings({ room:'room: A room ' }).room, 'room: A room ');
});

test('saved view normalization bounds names and count, rejects odd or duplicate IDs and preserves Unicode', () => {
  const normalized = normalizeViews([
    null, false, {}, view('bad id'), view('bad:scope'), view('../path'), view('valid', { name:' \n  Work\t room \0 ' }),
    view('valid', { name:'Duplicate ID' }), view('blank', { name:' \n ' }), view('emoji', { name:'🌱'.repeat(90) }),
    ...Array.from({ length:30 }, (_, i) => view(`id-${i}`)),
  ]);
  assert.equal(normalized.length, MAX_SAVED_VIEWS);
  assert.equal(normalized[0].name, 'Work room');
  assert.equal(normalized[1].name, '🌱'.repeat(80));
  assert.equal(normalized.filter(item => item.id === 'valid').length, 1);
  assert.deepEqual(normalizeViews({ views:[view('nested')] }), []);
});

test('preference keys isolate HA instances and users without falling back to a shared anonymous key', () => {
  assert.notEqual(preferenceKey('instance-a','user'), preferenceKey('instance-b','user'));
  assert.notEqual(preferenceKey('instance','user-a'), preferenceKey('instance','user-b'));
  assert.notEqual(preferenceKey('instance:a','user'), preferenceKey('instance','a:user'));
  for (const value of [undefined,null,'',' ','a\n',42,'a'.repeat(257),'\ud800']) {
    assert.equal(preferenceKey(value,'user'), null);
    assert.equal(preferenceKey('instance',value), null);
  }
});

test('saving and loading round trip only sanitized choices in the correct instance/user scope', () => {
  const storage = memoryStorage();
  const raw = [view('uuid-safe_1', { query:'SYNTHETIC-SECRET-QUERY', devices:[{ name:'private device' }], settings:{ room:'room:Office', query:'MT:SECRET', codeStatus:'missing', sort:'room' } })];
  assert.equal(saveViews(storage,'instance','user-a',raw), true);
  const stored = storage.getItem(preferenceKey('instance','user-a'));
  assert.doesNotMatch(stored, /SECRET|private device|devices|query/);
  assert.deepEqual(loadViews(storage,'instance','user-a'), normalizeViews(raw));
  assert.deepEqual(loadViews(storage,'instance','user-b'), []);
  assert.deepEqual(loadViews(storage,'other-instance','user-a'), []);
  assert.equal(saveViews(storage,'instance','user-a',[]), true);
  assert.deepEqual(loadViews(storage,'instance','user-a'), []);
});

test('corrupt, unsupported and oversized stored envelopes yield no views and never delete storage', () => {
  const storage = memoryStorage(), key = preferenceKey('instance','user');
  for (const raw of ['{broken','null','[]','{"version":2,"views":[]}','{"version":"1","views":[]}','{"version":1,"views":{}}','x'.repeat(100001)]) {
    storage.setItem(key,raw);
    assert.deepEqual(loadViews(storage,'instance','user'), []);
    assert.equal(storage.getItem(key),raw);
  }
  storage.setItem(key,JSON.stringify({ version:1, views:[view('valid'), view('bad id'), { id:'bad', name:'', settings:{} }] }));
  assert.deepEqual(loadViews(storage,'instance','user').map(item => item.id), ['valid']);
});

test('unavailable storage and read/write failures are recoverable and do not prevent list usage', () => {
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.deepEqual(loadViews(denied,'instance','user'), []);
  assert.equal(saveViews(denied,'instance','user',[view('valid')]), false);
  assert.deepEqual(loadViews(undefined,'instance','user'), []);
  assert.equal(saveViews(undefined,'instance','user',[view('valid')]), false);
  const getterDenied = { get setItem() { throw new Error('denied getter'); } };
  assert.equal(saveViews(getterDenied,'instance','user',[view('valid')]), false);
  const untouched = { getItem() { throw new Error('should not read'); }, setItem() { throw new Error('should not write'); } };
  assert.deepEqual(loadViews(untouched,'','user'), []);
  assert.equal(saveViews(untouched,'instance','',[view('valid')]), false);
});


test('long HA floor and label IDs survive saved view round trips while room names stay bounded', () => {
  const storage = memoryStorage(), floorId = 'f'.repeat(300), labelId = 'l'.repeat(500);
  const choices = { floor:`floor:${floorId}`, label:`label:${labelId}`, room:`room:${'r'.repeat(300)}` };
  assert.equal(saveViews(storage,'instance','user',[view('long-ids',{ settings:choices })]), true);
  const saved = loadViews(storage,'instance','user')[0].settings;
  assert.equal(saved.floor, choices.floor);
  assert.equal(saved.label, choices.label);
  assert.equal(saved.room, '');
});

test('legacy version 1 saved views remain readable and can acquire a default without migration', () => {
  const storage = memoryStorage(), key = preferenceKey('instance','user');
  const views = [view('home', { name:'Home' }), view('work', { name:'Work' })];
  const legacy = JSON.stringify({ version:1, views });
  storage.setItem(key,legacy);
  assert.deepEqual(loadViewPreferences(storage,'instance','user'), { views:normalizeViews(views), defaultViewId:'' });
  assert.equal(storage.getItem(key),legacy);
  assert.equal(saveViewPreferences(storage,'instance','user',{ views, defaultViewId:'home' }), true);
  assert.deepEqual(JSON.parse(storage.getItem(key)), { version:1, views:normalizeViews(views), defaultViewId:'home' });
  assert.deepEqual(loadViews(storage,'instance','user'), normalizeViews(views));
});

test('default view selection is scoped to its HA instance and user and can be explicitly cleared', () => {
  const storage = memoryStorage(), views = [view('home'), view('work')];
  assert.equal(saveViewPreferences(storage,'instance-a','user-a',{ views, defaultViewId:'home' }), true);
  assert.equal(saveViewPreferences(storage,'instance-a','user-b',{ views, defaultViewId:'work' }), true);
  assert.equal(saveViewPreferences(storage,'instance-b','user-a',{ views, defaultViewId:'work' }), true);
  assert.equal(loadViewPreferences(storage,'instance-a','user-a').defaultViewId, 'home');
  assert.equal(loadViewPreferences(storage,'instance-a','user-b').defaultViewId, 'work');
  assert.equal(loadViewPreferences(storage,'instance-b','user-a').defaultViewId, 'work');
  assert.deepEqual(loadViewPreferences(storage,'instance-b','user-b'), { views:[], defaultViewId:'' });
  assert.equal(saveViewPreferences(storage,'instance-a','user-a',{ views, defaultViewId:'' }), true);
  assert.deepEqual(loadViewPreferences(storage,'instance-a','user-a'), { views:normalizeViews(views), defaultViewId:'' });
  assert.equal(loadViewPreferences(storage,'instance-a','user-b').defaultViewId, 'work');
  assert.equal(Object.hasOwn(JSON.parse(storage.getItem(preferenceKey('instance-a','user-a'))),'defaultViewId'), false);
});

test('the compatibility save function preserves the default when its view is added, renamed or updated', () => {
  const storage = memoryStorage(), views = [view('home'), view('work')];
  assert.equal(saveViewPreferences(storage,'instance','user',{ views, defaultViewId:'home' }), true);
  const changed = [view('extra'), view('home', { name:'My renamed home', settings:{ group:'room', sort:'updated-desc' } }), view('work')];
  assert.equal(saveViews(storage,'instance','user',changed), true);
  assert.deepEqual(loadViewPreferences(storage,'instance','user'), { views:normalizeViews(changed), defaultViewId:'home' });
  assert.equal(saveViews(storage,'instance','user',changed.filter(item => item.id !== 'work')), true);
  assert.equal(loadViewPreferences(storage,'instance','user').defaultViewId, 'home');
  assert.equal(saveViews(storage,'instance','user',changed.filter(item => item.id !== 'home')), true);
  assert.deepEqual(loadViewPreferences(storage,'instance','user'), { views:normalizeViews(changed.filter(item => item.id !== 'home')), defaultViewId:'' });
});

test('default IDs must refer to a retained valid view on both read and write', () => {
  const storage = memoryStorage(), key = preferenceKey('instance','user');
  const views = [view('home'), view('bad id'), view('blank',{ name:'' })];
  for (const defaultViewId of [undefined,null,true,42,'','Home','home ','bad id','blank','missing','x'.repeat(81),{ id:'home' }]) {
    assert.equal(saveViewPreferences(storage,'instance','user',{ views, defaultViewId }), true);
    assert.deepEqual(loadViewPreferences(storage,'instance','user'), { views:normalizeViews(views), defaultViewId:'' });
    storage.setItem(key,JSON.stringify({ version:1, views, defaultViewId }));
    assert.deepEqual(loadViewPreferences(storage,'instance','user'), { views:normalizeViews(views), defaultViewId:'' });
  }
  const overLimit = Array.from({ length:MAX_SAVED_VIEWS + 1 }, (_, i) => view(`id-${i}`));
  assert.equal(saveViewPreferences(storage,'instance','user',{ views:overLimit, defaultViewId:`id-${MAX_SAVED_VIEWS}` }), true);
  assert.equal(loadViewPreferences(storage,'instance','user').defaultViewId, '');
  assert.equal(saveViewPreferences(storage,'instance','user',{ views, defaultViewId:'home' }), true);
  assert.equal(saveViews(storage,'instance','user',[view('home',{ name:'' })]), true);
  assert.deepEqual(loadViewPreferences(storage,'instance','user'), { views:[], defaultViewId:'' });
});

test('default view persistence keeps the existing privacy whitelist', () => {
  const storage = memoryStorage(), views = [view('home', { query:'SYNTHETIC-SECRET-QUERY', codes:['MT:SECRET'], settings:{ query:'MT:SECRET', notes:'private note', group:'room' } })];
  assert.equal(saveViewPreferences(storage,'instance','user',{ views, defaultViewId:'home', query:'SECRET', codes:['SECRET'], notes:'private note', defaultView:view('private') }), true);
  const stored = storage.getItem(preferenceKey('instance','user'));
  assert.doesNotMatch(stored, /SECRET|private|codes|query|notes/);
  assert.deepEqual(JSON.parse(stored), { version:1, views:normalizeViews(views), defaultViewId:'home' });
});

test('default preferences recover safely from corrupt or unavailable storage and invalid scopes', () => {
  const empty = { views:[], defaultViewId:'' }, storage = memoryStorage(), key = preferenceKey('instance','user');
  for (const raw of [null,'{broken','null','[]','{"version":2,"views":[],"defaultViewId":"home"}','{"version":1,"views":{},"defaultViewId":"home"}','x'.repeat(100001)]) {
    storage.setItem(key,raw);
    assert.deepEqual(loadViewPreferences(storage,'instance','user'), empty);
    assert.equal(storage.getItem(key),raw);
  }
  for (const broken of [undefined,{}, { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } }, { get getItem() { throw new Error('denied getter'); }, get setItem() { throw new Error('denied getter'); } }]) {
    assert.deepEqual(loadViewPreferences(broken,'instance','user'), empty);
    assert.equal(saveViewPreferences(broken,'instance','user',{ views:[view('home')], defaultViewId:'home' }), false);
  }
  const untouched = { getItem() { assert.fail('invalid scope must not read'); }, setItem() { assert.fail('invalid scope must not write'); } };
  assert.deepEqual(loadViewPreferences(untouched,'','user'), empty);
  assert.equal(saveViewPreferences(untouched,'instance','',{ views:[view('home')], defaultViewId:'home' }), false);
  assert.equal(saveViews(untouched,'','user',[view('home')]), false);
  assert.equal(saveViewPreferences(storage,'instance','user',null), true);
  assert.deepEqual(loadViewPreferences(storage,'instance','user'), empty);
});
