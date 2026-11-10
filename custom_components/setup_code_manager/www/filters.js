/** Pure inventory search and filters; no record or credential is changed. */
import { protocolNames } from './i18n.js';

export const SORTS = Object.freeze(['name-asc', 'name-desc', 'room', 'updated-desc', 'missing-first']);
export const GROUPS = Object.freeze(['none', 'room']);
const text = value => typeof value === 'string' ? value : '';
const list = value => Array.isArray(value) ? value : [];
const links = record => list(record?.links).filter(link => link && typeof link === 'object');
const activeLinks = record => links(record).filter(link => link.active !== false);
const codes = record => list(record?.codes).filter(code => code && typeof code === 'object');
const storedCodes = record => codes(record).filter(code => text(code.value).trim());
const isLinked = record => typeof record?.linked === 'boolean' ? record.linked : links(record).some(link => link.active !== false);
const hasCode = (record, protocol) => storedCodes(record).some(code => !protocol || code.protocol === protocol);
const displayProtocols = record => [...new Set([
  ...list(record?.protocols), ...storedCodes(record).map(code => code.protocol),
])].filter(protocol => Object.hasOwn(protocolNames, protocol));
const byName = (a, b, language) => text(a.name).localeCompare(text(b.name), language) || text(a.id).localeCompare(text(b.id), language);

/** Active HA areas are authoritative, including an explicitly empty area. */
export function recordRooms(record) {
  const activeLocations = activeLinks(record)
    .filter(link => typeof link.location === 'string')
    .map(link => link.location);
  const locations = activeLocations.length ? activeLocations : [text(record?.location)];
  return [...new Set(locations.filter(location => location.trim()))];
}

export function availableRooms(records, language = 'en') {
  return [...new Set(list(records).flatMap(recordRooms))].sort((a, b) => a.localeCompare(b, language));
}

function distinctMetadata(items) {
  const found = new Map();
  for (const item of items) {
    const id = text(item?.id);
    const name = text(item?.name);
    if (id.trim() && name.trim() && !found.has(id)) found.set(id, { id, name });
  }
  return [...found.values()];
}

/** Floors and labels describe only currently linked HA devices, never old links. */
export function recordFloors(record) {
  return distinctMetadata(activeLinks(record).flatMap(link => list(link.areas))
    .map(area => ({ id:area?.floor_id, name:area?.floor_name })));
}

export function recordLabels(record) {
  return distinctMetadata(activeLinks(record).flatMap(link => list(link.labels)));
}

export function availableFloors(records, language = 'en') {
  return distinctMetadata(list(records).flatMap(recordFloors)).sort((a, b) => byName(a, b, language));
}

export function availableLabels(records, language = 'en') {
  return distinctMetadata(list(records).flatMap(recordLabels)).sort((a, b) => byName(a, b, language));
}

const sortedRooms = (record, language) => recordRooms(record).sort((a, b) => a.localeCompare(b, language));
function compareRooms(a, b, language) {
  const left = sortedRooms(a, language);
  const right = sortedRooms(b, language);
  if (!left.length || !right.length) return Number(!left.length) - Number(!right.length);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].localeCompare(right[i], language);
    if (difference) return difference;
  }
  return left.length - right.length;
}

/** Each record appears once; a multi-room record has its own combined group. */
export function groupRecordsByRoom(records, language = 'en') {
  const groups = new Map();
  for (const record of list(records)) {
    if (!record || typeof record !== 'object') continue;
    const roomNames = sortedRooms(record, language);
    const key = roomNames.length ? JSON.stringify(roomNames) : '';
    if (!groups.has(key)) groups.set(key, { key, roomNames, records:[] });
    groups.get(key).records.push(record);
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.roomNames.length || !b.roomNames.length) return Number(!a.roomNames.length) - Number(!b.roomNames.length);
    for (let i = 0; i < Math.min(a.roomNames.length, b.roomNames.length); i++) {
      const difference = a.roomNames[i].localeCompare(b.roomNames[i], language);
      if (difference) return difference;
    }
    return a.roomNames.length - b.roomNames.length;
  });
}

// Only manual numeric values can ignore formatting. Removing characters from a
// Matter Base38 payload would invent matches and lose meaningful punctuation.
const numericCode = value => /^[0-9\s-]+$/.test(text(value)) ? value.replace(/[\s-]/g, '') : '';

function matchesQuery(record, query, numericQuery) {
  const recordCodes = codes(record);
  const fields = [
    record.name, record.location, ...recordRooms(record), record.manufacturer,
    record.model, record.serial_number, record.notes,
    ...recordCodes.flatMap(code => [code.label, code.value, code.manual_value]),
  ];
  if (fields.some(value => text(value).toLocaleLowerCase().includes(query))) return true;
  return !!numericQuery && recordCodes.some(code => [code.value, code.manual_value]
    .some(value => numericCode(value).includes(numericQuery)));
}

function matchesMetadata(items, selection, prefix) {
  if (selection === 'unassigned') return !items.length;
  if (selection.startsWith(prefix)) return items.some(item => item.id === selection.slice(prefix.length));
  return true;
}

const updatedTime = record => {
  const time = Date.parse(text(record.updated_at));
  return Number.isFinite(time) ? time : -Infinity;
};
function compareRecords(a, b, sort, protocol, language) {
  let primary = 0;
  if (sort === 'name-desc') primary = text(b.name).localeCompare(text(a.name), language);
  else if (sort === 'room') primary = compareRooms(a, b, language);
  else if (sort === 'missing-first') primary = Number(hasCode(a, protocol)) - Number(hasCode(b, protocol));
  else if (sort === 'updated-desc') {
    const left = updatedTime(a), right = updatedTime(b);
    primary = left === right ? 0 : left < right ? 1 : -1;
  }
  return primary || byName(a, b, language);
}

export function filterRecords(records, { tab = 'all', query = '', protocol = '', codeStatus = 'all', room = '', floor = '', label = '', sort = 'name-asc' } = {}, language = 'en') {
  const normalizedQuery = text(query).trim().toLocaleLowerCase();
  const numericQuery = numericCode(normalizedQuery);
  return list(records).filter(record => {
    if (!record || typeof record !== 'object') return false;
    if (tab === 'archive' ? !record.archived : record.archived) return false;
    if (tab === 'linked' && !isLinked(record)) return false;
    if (tab === 'unlinked' && isLinked(record)) return false;
    if (codeStatus === 'missing') {
      if (hasCode(record, protocol)) return false;
    } else if (codeStatus === 'has') {
      if (!hasCode(record, protocol)) return false;
    } else if (protocol && !displayProtocols(record).includes(protocol)) return false;
    const rooms = recordRooms(record);
    if (room === 'unassigned' && rooms.length) return false;
    if (room.startsWith('room:') && !rooms.includes(room.slice(5))) return false;
    if (!matchesMetadata(recordFloors(record), text(floor), 'floor:')) return false;
    if (!matchesMetadata(recordLabels(record), text(label), 'label:')) return false;
    return !normalizedQuery || matchesQuery(record, normalizedQuery, numericQuery);
  }).sort((a, b) => compareRecords(a, b, sort, protocol, language));
}
