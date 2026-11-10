import assert from 'node:assert/strict';
import test from 'node:test';
import { availableRooms, filterRecords, recordRooms, recordFloors, recordLabels, availableFloors, availableLabels, groupRecordsByRoom } from '../custom_components/setup_code_manager/www/filters.js';

// All credentials below are synthetic, with no connection to a real device.
const MATTER = 'MT:Y.K9042C00KA0648G00';
const code = (protocol, value, fields = {}) => ({ protocol, value, ...fields });
const record = (id, fields = {}) => ({
  id, name: `Synthetic ${id}`, location: '', manufacturer: '', model: '', serial_number: '',
  notes: '', codes: [], links: [], archived: false, ...fields,
});
const ids = (records, filters = {}, language = 'en') => filterRecords(records, filters, language).map(item => item.id);

test('search finds each supported text field as a case-insensitive literal substring', () => {
  const records = [
    record('name', { name: 'Synthetic Reading Lamp' }),
    record('location', { location: 'Synthetic Kitchen' }),
    record('manufacturer', { manufacturer: 'Synthetic Vendor' }),
    record('model', { model: 'Synthetic Model X.42' }),
    record('serial', { serial_number: 'SYNTHETIC-ABC-0123' }),
    record('notes', { notes: 'The synthetic sticker is UNDER the base.' }),
    record('label', { codes: [code('homekit', '111-22-333', { label: 'Synthetic cardboard sleeve' })] }),
  ];
  for (const [query, expected] of [
    ['READING LAMP', 'name'], ['kitchen', 'location'], ['vendor', 'manufacturer'],
    ['x.42', 'model'], ['abc-0123', 'serial'], ['under the base', 'notes'], ['cardboard sleeve', 'label'],
  ]) assert.deepEqual(ids(records, { query }), [expected]);
  assert.deepEqual(ids(records, { query: 'x.4[2]' }), []);
});

test('raw Matter payload search preserves Base38 punctuation and searches its manual value', () => {
  const records = [record('matter', { codes: [code('matter', MATTER, { manual_value: '03497011233' })] })];
  for (const query of [MATTER, 'mt:y.k9042', 'C00KA0648', '03497011233', '0349-701-1233', '0349 701 1233', '49-701']) {
    assert.deepEqual(ids(records, { query }), ['matter'], query);
  }
  for (const query of ['MT:YK9042', 'YK9042', '904200064800', 'MT:Y-K9042', '003497011233']) {
    assert.deepEqual(ids(records, { query }), [], query);
  }
});

test('manual numeric code search ignores spaces and hyphens while preserving leading zeros', () => {
  const records = [
    record('homekit', { codes: [code('homekit', '001-23-456')] }),
    record('matter', { codes: [code('matter', '0349 701 1233')] }),
    record('zwave', { codes: [code('zwave', '01234-23456-34567-45678-56789-01234-02345-03456')] }),
  ];
  for (const [query, expected] of [
    ['00123456', 'homekit'], ['001 23 456', 'homekit'], ['1-23-45', 'homekit'],
    ['03497011233', 'matter'], ['0349-701-1233', 'matter'], ['701 12', 'matter'],
    ['0123423456', 'zwave'], ['02345 03456', 'zwave'],
  ]) assert.deepEqual(ids(records, { query }), [expected], query);
  assert.deepEqual(ids(records, { query: '000123456' }), []);
  assert.deepEqual(ids(records, { query: '001.23.456' }), []);
  assert.deepEqual(ids(records, { query: '001/23/456' }), []);
});

test('search never joins separate fields or separate codes into a match', () => {
  const records = [record('separate', {
    name: 'Synthetic alpha', location: 'beta', notes: '0123',
    codes: [code('homekit', '111-22-333', { label: 'gamma' }), code('matter', '444-55-666', { label: 'delta' })],
  })];
  for (const query of ['alpha beta', 'gammadelta', '333444', '333 444', '0123111']) {
    assert.deepEqual(ids(records, { query }), [], query);
  }
});

test('empty and whitespace-only queries return every record in the current tab', () => {
  const records = [record('active'), record('archived', { archived: true })];
  assert.deepEqual(ids(records, { query: '' }), ['active']);
  assert.deepEqual(ids(records, { query: ' \t\n ' }), ['active']);
  assert.deepEqual(ids(records, { tab: 'archive', query: '   ' }), ['archived']);
});

test('room names are exact and keep slash-containing user names intact', () => {
  const records = [
    record('kitchen', { location: 'Kitchen' }),
    record('kitchenette', { location: 'Kitchenette' }),
    record('slash', { location: 'Office / Workshop' }),
    record('prefix', { location: 'unassigned' }),
  ];
  assert.deepEqual(ids(records, { room: 'room:Kitchen' }), ['kitchen']);
  assert.deepEqual(ids(records, { room: 'room:kitchen' }), []);
  assert.deepEqual(ids(records, { room: 'room:Office / Workshop' }), ['slash']);
  assert.deepEqual(ids(records, { room: 'room:Office' }), []);
  assert.deepEqual(ids(records, { room: 'room:unassigned' }), ['prefix']);
  assert.deepEqual(recordRooms(records[2]), ['Office / Workshop']);
});

test('multi-link records use separate active rooms without splitting the aggregate location', () => {
  const multi = record('multi', {
    location: 'Kitchen / Office / Workshop',
    links: [{ location: 'Kitchen' }, { active: true, location: 'Office / Workshop' }, { location: 'Kitchen' }],
  });
  assert.deepEqual(recordRooms(multi), ['Kitchen', 'Office / Workshop']);
  assert.deepEqual(ids([multi], { room: 'room:Kitchen' }), ['multi']);
  assert.deepEqual(ids([multi], { room: 'room:Office / Workshop' }), ['multi']);
  assert.deepEqual(ids([multi], { room: 'room:Office' }), []);
  assert.deepEqual(ids([multi], { room: 'room:Kitchen / Office / Workshop' }), []);
  assert.deepEqual(ids([multi], { query: 'Office / Workshop' }), ['multi']);
});

test('explicitly empty active-link areas override the stale record location', () => {
  const noRoom = record('no-room', { location: 'Old room', links: [{ active: true, location: '' }, { location: '   ' }] });
  const someRoom = record('some-room', { location: 'Old room', links: [{ location: '' }, { location: 'New room' }] });
  assert.deepEqual(recordRooms(noRoom), []);
  assert.deepEqual(recordRooms(someRoom), ['New room']);
  assert.deepEqual(ids([noRoom, someRoom], { room: 'unassigned' }), ['no-room']);
  assert.deepEqual(ids([noRoom, someRoom], { room: 'room:Old room' }), []);
});

test('removed links are ignored and entirely removed records retain their last known room', () => {
  const partlyRemoved = record('partial', {
    location: 'Aggregate', links: [{ active: false, location: 'Removed room' }, { active: true, location: 'Current room' }],
  });
  const removed = record('removed', { location: 'Last known room', links: [{ active: false, location: 'Ignored link room' }] });
  assert.deepEqual(recordRooms(partlyRemoved), ['Current room']);
  assert.deepEqual(recordRooms(removed), ['Last known room']);
  assert.deepEqual(ids([partlyRemoved, removed], { room: 'room:Removed room' }), []);
  assert.deepEqual(ids([partlyRemoved, removed], { room: 'room:Last known room' }), ['removed']);
});

test('older link data without location metadata falls back to record location', () => {
  assert.deepEqual(recordRooms(record('old', { location: 'Known room', links: [{ ha_device_id: 'synthetic-ha' }] })), ['Known room']);
  assert.deepEqual(recordRooms(record('standalone', { location: 'Standalone room' })), ['Standalone room']);
  assert.deepEqual(recordRooms(record('blank', { location: '  ' })), []);
});

test('available rooms are distinct, locale-sorted and derived from current or last-known areas', () => {
  const records = [
    record('a', { location: 'Kitchen', links: [{ location: 'Zebra' }, { location: 'Ärea' }, { location: 'Zebra' }] }),
    record('b', { location: 'Bedroom' }),
    record('c', { location: 'Ignored', links: [{ location: '' }, { active: false, location: 'Removed' }] }),
    record('d', { location: 'Bedroom', archived: true }),
    record('e', { location: 'Office / Workshop' }),
  ];
  assert.deepEqual(availableRooms(records, 'de'), ['Ärea', 'Bedroom', 'Office / Workshop', 'Zebra']);
  assert.deepEqual(availableRooms([]), []);
});

test('archived records use a changed active HA room and expose archive-only room options', () => {
  const records = [
    record('active', { location: 'Active room', links: [{ active: true, location: 'Active room' }] }),
    record('archived', {
      archived: true, location: 'Previous archived room',
      links: [{ active: true, location: 'Archive-only current room' }, { active: false, location: 'Removed archived room' }],
    }),
  ];
  assert.deepEqual(recordRooms(records[1]), ['Archive-only current room']);
  assert.deepEqual(availableRooms(records), ['Active room', 'Archive-only current room']);
  assert.deepEqual(availableRooms(filterRecords(records, { tab: 'archive' })), ['Archive-only current room']);
  assert.deepEqual(ids(records, { tab: 'archive', room: 'room:Archive-only current room' }), ['archived']);
  assert.deepEqual(ids(records, { room: 'room:Archive-only current room' }), []);
  assert.deepEqual(ids(records, { tab: 'archive', room: 'room:Previous archived room' }), []);
  assert.deepEqual(ids(records, { tab: 'archive', room: 'room:Removed archived room' }), []);
});

test('linked, unlinked and archive tabs use active links and preserve explicit linked metadata', () => {
  const records = [
    record('active', { links: [{ active: true }] }),
    record('legacy-active', { links: [{}] }),
    record('removed', { links: [{ active: false }] }),
    record('standalone'),
    record('reported-linked', { linked: true }),
    record('reported-unlinked', { linked: false, links: [{ active: true }] }),
    record('archived-linked', { archived: true, links: [{}] }),
    record('archived-unlinked', { archived: true }),
  ];
  assert.deepEqual(ids(records, { tab: 'linked' }), ['active', 'legacy-active', 'reported-linked']);
  assert.deepEqual(ids(records, { tab: 'unlinked' }), ['removed', 'reported-unlinked', 'standalone']);
  assert.deepEqual(ids(records, { tab: 'archive' }), ['archived-linked', 'archived-unlinked']);
  assert.equal(ids(records).length, 6);
});

test('protocol all-status uses known protocol metadata or a nonblank stored code', () => {
  const records = [
    record('metadata', { protocols: ['matter'] }),
    record('stored', { codes: [code('matter', MATTER)] }),
    record('blank', { codes: [code('matter', ' \n ')] }),
    record('other', { protocols: ['homekit'], codes: [code('homekit', '11122333')] }),
    record('neither'),
  ];
  assert.deepEqual(ids(records, { protocol: 'matter' }), ['metadata', 'stored']);
  assert.deepEqual(ids(records, { protocol: 'homekit' }), ['other']);
});

test('missing-code status is relative to protocol and includes records with only other code types', () => {
  const records = [
    record('empty'),
    record('matter', { codes: [code('matter', MATTER)] }),
    record('homekit', { codes: [code('homekit', '11122333')] }),
    record('metadata', { protocols: ['matter'] }),
    record('blank', { codes: [code('matter', ' \t ')] }),
  ];
  assert.deepEqual(ids(records, { protocol: 'matter', codeStatus: 'missing' }), ['blank', 'empty', 'homekit', 'metadata']);
  assert.deepEqual(ids(records, { protocol: 'homekit', codeStatus: 'missing' }), ['blank', 'empty', 'matter', 'metadata']);
  assert.deepEqual(ids(records, { codeStatus: 'missing' }), ['blank', 'empty', 'metadata']);
});

test('has-code status requires a stored code of the selected protocol, never only protocol metadata', () => {
  const records = [
    record('metadata', { protocols: ['matter'] }),
    record('matter', { codes: [code('matter', MATTER)] }),
    record('homekit', { codes: [code('homekit', '11122333')] }),
    record('both', { codes: [code('matter', MATTER), code('homekit', '11122333')] }),
    record('blank', { codes: [code('matter', '')] }),
  ];
  assert.deepEqual(ids(records, { protocol: 'matter', codeStatus: 'has' }), ['both', 'matter']);
  assert.deepEqual(ids(records, { protocol: 'homekit', codeStatus: 'has' }), ['both', 'homekit']);
  assert.deepEqual(ids(records, { codeStatus: 'has' }), ['both', 'homekit', 'matter']);
});

test('all filters combine, and clearing them restores the tab results without changing records', () => {
  const records = [
    record('target', { name: 'A synthetic lamp', notes: 'Sticker under base', codes: [code('homekit', '00123456')], links: [{ location: 'Office' }] }),
    record('wrong-code', { notes: 'Sticker under base', codes: [code('matter', MATTER)], links: [{ location: 'Office' }] }),
    record('wrong-room', { notes: 'Sticker under base', codes: [code('homekit', '00123456')], links: [{ location: 'Hall' }] }),
    record('unlinked', { notes: 'Sticker under base', codes: [code('homekit', '00123456')], location: 'Office' }),
    record('archive', { archived: true, notes: 'Sticker under base', codes: [code('homekit', '00123456')], links: [{ location: 'Office' }] }),
  ];
  const before = structuredClone(records);
  assert.deepEqual(ids(records, { tab: 'linked', query: 'under BASE', protocol: 'matter', codeStatus: 'missing', room: 'room:Office' }), ['target']);
  assert.deepEqual(ids(records, { tab: 'linked', query: '', protocol: '', codeStatus: 'all', room: '' }), ['target', 'wrong-code', 'wrong-room']);
  assert.deepEqual(ids(records, { tab: 'archive', query: '00 123', protocol: 'homekit', codeStatus: 'has', room: 'room:Office' }), ['archive']);
  assert.deepEqual(records, before);
  assert.strictEqual(filterRecords(records, { query: 'A synthetic lamp' })[0], records[0]);
});

test('malformed optional metadata is ignored without inventing searchable string values', () => {
  const records = [record('malformed', {
    name: 42, notes: { secret: 'not a note' }, model: ['not a model'], manufacturer: null,
    serial_number: false, protocols: 'matter', codes: [null, false, { protocol: 'matter', value: 1234 }, { label: { text: 'not a label' } }],
    location: 'Fallback room', links: [null, false, { location: 123 }],
  })];
  for (const query of ['42', 'not a note', '[object Object]', 'not a model', 'false', '1234']) {
    assert.deepEqual(ids(records, { query }), [], query);
  }
  assert.deepEqual(recordRooms(records[0]), ['Fallback room']);
  assert.deepEqual(ids(records, { protocol: 'matter' }), []);
  assert.deepEqual(ids(records, { codeStatus: 'missing' }), ['malformed']);
  assert.deepEqual(ids(records, { query: 'fallback' }), ['malformed']);
  assert.deepEqual(ids([record('bad-collections', { codes: {}, links: 'invalid' })]), ['bad-collections']);
  assert.deepEqual(filterRecords([null, false]), []);
});


test('floor and label metadata comes only from active HA links and uses exact IDs', () => {
  const linked = record('linked', { links:[
    { active:true, location:'Office', areas:[{ id:'office', name:'Office', floor_id:'upper', floor_name:'Upper floor' }], labels:[{ id:'work', name:'Work' }] },
    { active:false, location:'Old room', areas:[{ floor_id:'old-floor', floor_name:'Old floor' }], labels:[{ id:'old-label', name:'Old label' }] },
    { active:true, areas:[{ floor_id:'upper', floor_name:'Upper floor' }], labels:[{ id:'work', name:'Work' }, { id:'lights', name:'Lights' }] },
  ] });
  assert.deepEqual(recordFloors(linked), [{ id:'upper', name:'Upper floor' }]);
  assert.deepEqual(recordLabels(linked), [{ id:'work', name:'Work' }, { id:'lights', name:'Lights' }]);
  assert.deepEqual(ids([linked], { floor:'floor:upper', label:'label:work' }), ['linked']);
  for (const selection of ['floor:Upper floor','floor:up','floor:old-floor']) assert.deepEqual(ids([linked], { floor:selection }), []);
  for (const selection of ['label:Work','label:wor','label:old-label']) assert.deepEqual(ids([linked], { label:selection }), []);
});

test('available floor and label options are locale sorted, ID distinct and include archived active links', () => {
  const records = [
    record('a', { links:[{ areas:[{ floor_id:'z', floor_name:'Zebra' }, { floor_id:'a', floor_name:'Ärea' }], labels:[{ id:'l2', name:'Same name' }, { id:'l1', name:'Same name' }] }] }),
    record('b', { archived:true, links:[{ areas:[{ floor_id:'b', floor_name:'Basement' }], labels:[{ id:'archive', name:'Archive label' }, { id:'l1', name:'Same name' }] }] }),
    record('removed', { links:[{ active:false, areas:[{ floor_id:'old', floor_name:'Removed' }], labels:[{ id:'old', name:'Removed' }] }] }),
  ];
  assert.deepEqual(availableFloors(records, 'de').map(item => item.id), ['a','b','z']);
  assert.deepEqual(availableLabels(records).map(item => item.id), ['archive','l1','l2']);
});

test('unassigned floor and label match records with no current HA metadata, without stale fallbacks', () => {
  const records = [
    record('standalone', { floors:[{ id:'stale', name:'Stale' }], labels:[{ id:'stale', name:'Stale' }] }),
    record('removed', { links:[{ active:false, areas:[{ floor_id:'old', floor_name:'Old' }], labels:[{ id:'old', name:'Old' }] }] }),
    record('empty', { links:[{ areas:[], labels:[] }] }),
    record('assigned', { links:[{ areas:[{ floor_id:'floor-id', floor_name:'Floor' }], labels:[{ id:'label-id', name:'Label' }] }] }),
  ];
  assert.deepEqual(ids(records, { floor:'unassigned', label:'unassigned' }), ['empty','removed','standalone']);
  assert.deepEqual(ids(records, { floor:'floor:floor-id', label:'label:label-id' }), ['assigned']);
  assert.deepEqual(recordFloors(record('malformed', { links:[{ areas:[null, false, {}, { floor_id:12, floor_name:'Not an ID' }, { floor_id:'deleted', floor_name:'' }], labels:[null, false, { id:'deleted', name:'' }] }] })), []);
});

test('all structured filters compose with floor and direct device label, including the archive', () => {
  const area = { id:'office', name:'Office', floor_id:'upstairs', floor_name:'Upstairs' };
  const match = record('target', { archived:true, notes:'Under base', codes:[code('homekit','11122333')], links:[{ location:'Office', areas:[area], labels:[{ id:'work', name:'Work' }] }] });
  const other = record('other', { ...match, id:'other', links:[{ location:'Office', areas:[area], labels:[{ id:'different', name:'Different' }] }] });
  assert.deepEqual(ids([match, other], { tab:'archive', query:'under', room:'room:Office', protocol:'matter', codeStatus:'missing', floor:'floor:upstairs', label:'label:work' }), ['target']);
  assert.deepEqual(ids([match], { tab:'archive', room:'room:Office', floor:'unassigned' }), []);
});

test('name sorting has deterministic ID ties and never reorders or alters the source array', () => {
  const records = [record('z', { name:'Same' }), record('b', { name:'Alpha' }), record('a', { name:'Same' }), record('c', { name:'Zebra' })];
  const before = structuredClone(records);
  assert.deepEqual(ids(records), ['b','a','z','c']);
  assert.deepEqual(ids(records, { sort:'name-desc' }), ['c','a','z','b']);
  assert.deepEqual(ids(records, { sort:'unknown' }), ['b','a','z','c']);
  assert.deepEqual(records, before);
});

test('room sort uses exact current rooms and puts unassigned records last', () => {
  const records = [
    record('no-room', { name:'A no room' }),
    record('z-room', { name:'B', location:'Zebra' }),
    record('b-room', { name:'Z', location:'Bedroom' }),
    record('a-room', { name:'Q', location:'Stale', links:[{ location:'Ärea' }] }),
    record('a-room-tie', { name:'A', location:'Ärea' }),
  ];
  assert.deepEqual(ids(records, { sort:'room' }, 'de'), ['a-room-tie','a-room','b-room','z-room','no-room']);
});

test('last-changed sorting orders valid timestamps newest first and invalid dates last by name', () => {
  const records = [
    record('invalid-z', { name:'Z invalid', updated_at:'not-a-date' }),
    record('old', { name:'Old', updated_at:'2026-11-01T10:00:00+00:00' }),
    record('new-b', { name:'Latest', updated_at:'2026-11-10T11:00:00+01:00' }),
    record('new-a', { name:'Latest', updated_at:'2026-11-10T10:00:00Z' }),
    record('invalid-a', { name:'A invalid', updated_at:123456789 }),
    record('blank', { name:'B blank' }),
  ];
  assert.deepEqual(ids(records, { sort:'updated-desc' }), ['new-a','new-b','old','invalid-a','blank','invalid-z']);
});

test('missing-first sort is protocol-relative rather than treating another stored family as complete', () => {
  const records = [
    record('matter', { name:'A matter', codes:[code('matter', MATTER)] }),
    record('empty', { name:'Z empty' }),
    record('homekit', { name:'B homekit', codes:[code('homekit','11122333')] }),
  ];
  assert.deepEqual(ids(records, { sort:'missing-first' }), ['empty','matter','homekit']);
  assert.deepEqual(ids(records, { protocol:'matter', codeStatus:'missing', sort:'missing-first' }), ['homekit','empty']);
  records[1].protocols = ['matter'];
  records[2].protocols = ['matter','homekit'];
  assert.deepEqual(ids(records, { protocol:'matter', sort:'missing-first' }), ['homekit','empty','matter']);
});

test('room grouping keeps a multi-room entry once and distinguishes a literal slash name', () => {
  const records = [
    record('second', { name:'B', location:'Office' }),
    record('first', { name:'A', location:'Office' }),
    record('combined', { location:'Office / Workshop', links:[{ location:'Workshop' }, { location:'Office' }, { location:'Office' }] }),
    record('slash', { location:'Office / Workshop' }),
    record('unassigned', { location:'' }),
  ];
  const before = structuredClone(records);
  const groups = groupRecordsByRoom(records);
  assert.deepEqual(groups.map(group => group.roomNames), [['Office'],['Office','Workshop'],['Office / Workshop'],[]]);
  assert.deepEqual(groups[0].records.map(item => item.id), ['second','first']);
  assert.notEqual(groups[1].key, groups[2].key);
  assert.equal(groups.at(-1).key, '');
  assert.deepEqual(groups.flatMap(group => group.records).map(item => item.id).sort(), records.map(item => item.id).sort());
  assert.strictEqual(groups[1].records[0], records[2]);
  assert.deepEqual(records, before);
  assert.deepEqual(groupRecordsByRoom([null, false]), []);
});


test('floor and label registry IDs are preserved exactly, including long IDs', () => {
  const floorId = 'f'.repeat(300), labelId = 'l'.repeat(500);
  const linked = record('long-ids', { links:[{ areas:[{ floor_id:floorId, floor_name:'Floor' }], labels:[{ id:labelId, name:'Label' }] }] });
  assert.equal(availableFloors([linked])[0].id, floorId);
  assert.equal(availableLabels([linked])[0].id, labelId);
  assert.deepEqual(ids([linked],{ floor:`floor:${floorId}`, label:`label:${labelId}` }), ['long-ids']);
});
