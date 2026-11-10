import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_SAVED_VIEWS, VIEW_SETTINGS_DEFAULTS, loadViews, normalizeViews,
  preferenceKey, sanitizeViewSettings, saveViews,
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
