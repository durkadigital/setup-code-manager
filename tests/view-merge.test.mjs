import assert from 'node:assert/strict';
import test from 'node:test';
import * as preferences from '../custom_components/setup_code_manager/www/preferences.js';

const {MAX_SAVED_VIEWS,normalizeViews,VIEW_SETTINGS_DEFAULTS} = preferences;
const view = (id,name,settings={}) => ({id,name,settings});
const merge = (server,local) => preferences.mergeLocalViews(server,local);
const deepFreeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

test('the public preference normalizer retains only valid views and an existing default', () => {
  const raw = {
    views:[{...view('home','Home',{room:'room:Office',query:'SYNTHETIC-PRIVATE',codes:['MT:PRIVATE']}),notes:'PRIVATE'}],
    defaultViewId:'home',query:'PRIVATE',codes:['PRIVATE'],
  };
  assert.deepEqual(preferences.normalizeViewPreferences(raw),{
    views:[view('home','Home',{...VIEW_SETTINGS_DEFAULTS,room:'room:Office'})],defaultViewId:'home',
  });
  assert.deepEqual(preferences.normalizeViewPreferences({views:raw.views,defaultViewId:'unknown'}),{
    views:normalizeViews(raw.views),defaultViewId:'',
  });
  assert.deepEqual(preferences.normalizeViewPreferences(null),{views:[],defaultViewId:''});
});

test('merging preserves central entries and order, appends local IDs and never mutates either input', () => {
  const server = deepFreeze([view('server-b','Office',{room:'room:Office'}),view('server-a','Kitchen')]);
  const local = deepFreeze([view('local-b','Children',{room:'room:Children'}),view('local-a','Garden')]);
  const result = merge(server,local);
  assert.deepEqual(result,{views:normalizeViews([...server,...local]),added:2,remaining:0});
  assert.notEqual(result.views[0],server[0]);
  assert.notEqual(result.views[0].settings,server[0].settings);
  assert.notEqual(result.views[2],local[0]);
  assert.deepEqual(merge(server,local),result,'The merge must be deterministic without generating IDs.');
});

test('a stale local copy with a central ID can never rename or overwrite the central view', () => {
  const server = [view('shared','Current server choice',{room:'room:Office'})];
  const local = [view('shared','Older local choice',{room:'room:Kitchen'}),view('fresh','A separate view')];
  assert.deepEqual(merge(server,local),{views:normalizeViews([server[0],local[1]]),added:1,remaining:0});
});

test('case-insensitive names with the same normalized choices are duplicates, including repeated local copies', () => {
  const server = [view('central','Office',{room:'room:Office'})];
  const local = [
    view('duplicate','oFFICE',{room:'room:Office',query:'SYNTHETIC-PRIVATE'}),
    view('local-one','Home',{group:'room'}),view('local-two','HOME',{group:'room'}),
    view('other-name','Distinct name',{room:'room:Office'}),
  ];
  assert.deepEqual(merge(server,local),{
    views:normalizeViews([server[0],local[1],local[3]]),added:2,remaining:0,
  });
});

test('different choices with colliding names use a deterministic available local suffix', () => {
  const server = [view('a','Office'),view('b','OFFICE (LOKAL)'),view('c','Office (lokal 2)')];
  const local = [view('local','Office',{room:'room:Office'}),view('duplicate','OFFICE',{room:'room:Office'})];
  assert.deepEqual(merge(server,local),{
    views:normalizeViews([...server,view('local','Office (lokal 3)',{room:'room:Office'})]),added:1,remaining:0,
  });
});

test('local collision suffixes fit within 80 Unicode code points and keep complete astral characters', () => {
  const long = '🌱'.repeat(80);
  const server = [view('central',long),view('suffix',`${'🌱'.repeat(72)} (lokal)`)];
  const local = [view('local',long,{group:'room'})];
  const result = merge(server,local);
  assert.equal(result.views[2].name,`${'🌱'.repeat(70)} (lokal 2)`);
  assert.equal([...result.views[2].name].length,80);
  assert.equal(result.views[2].id,'local');
  assert.equal(result.added,1);
});

test('capacity counts only distinct unrepresented local choices as remaining', () => {
  const server = Array.from({length:MAX_SAVED_VIEWS-1},(_,index) => view(`central-${index}`,`Central ${index}`));
  const local = [
    view('central-0','Stale local name',{group:'room'}),view('duplicate-central','CENTRAL 1'),
    view('added','Local first'),view('overflow','Local overflow',{group:'room'}),
    view('same-overflow','LOCAL OVERFLOW',{group:'room'}),view('overflow','Same ID, stale update'),
    view('other-overflow','Another overflow'),
  ];
  assert.deepEqual(merge(server,local),{
    views:normalizeViews([...server,local[2]]),added:1,remaining:2,
  });
});

test('more than 20 valid local entries are reported as remaining without exceeding the central limit', () => {
  const local = Array.from({length:MAX_SAVED_VIEWS+3},(_,index) => view(`local-${index}`,`Local ${index}`));
  assert.deepEqual(merge([],local),{views:normalizeViews(local),added:MAX_SAVED_VIEWS,remaining:3});
});

test('untrusted inputs are normalized through the privacy whitelist and invalid entries do not consume capacity', () => {
  const local = [null,{},view('bad id','Invalid'),view('empty',' '),{
    ...view('safe',' \n Local\t view ',{room:'room:Office',query:'SYNTHETIC-PRIVATE',codes:['MT:PRIVATE']}),
    notes:'PRIVATE',query:'PRIVATE',codes:['PRIVATE'],
  }];
  const result = merge(null,local);
  assert.deepEqual(result,{views:normalizeViews(local),added:1,remaining:0});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|query|codes|notes/);
  assert.deepEqual(merge({},{}),{views:[],added:0,remaining:0});
});
