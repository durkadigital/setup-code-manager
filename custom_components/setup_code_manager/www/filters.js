/** Pure inventory search and filters; no record or credential is changed. */
import { protocolNames } from './i18n.js';

const text = value => typeof value === 'string' ? value : '';
const list = value => Array.isArray(value) ? value : [];
const links = record => list(record?.links).filter(link => link && typeof link === 'object');
const codes = record => list(record?.codes).filter(code => code && typeof code === 'object');
const storedCodes = record => codes(record).filter(code => text(code.value).trim());
const isLinked = record => typeof record?.linked === 'boolean' ? record.linked : links(record).some(link => link.active !== false);
const hasCode = (record, protocol) => storedCodes(record).some(code => !protocol || code.protocol === protocol);
const displayProtocols = record => [...new Set([
  ...list(record?.protocols), ...storedCodes(record).map(code => code.protocol),
])].filter(protocol => Object.hasOwn(protocolNames, protocol));

/** Active HA areas are authoritative, including an explicitly empty area. */
export function recordRooms(record) {
  const activeLocations = links(record)
    .filter(link => link.active !== false && typeof link.location === 'string')
    .map(link => link.location);
  const locations = activeLocations.length ? activeLocations : [text(record?.location)];
  return [...new Set(locations.filter(location => location.trim()))];
}

export function availableRooms(records, language = 'en') {
  return [...new Set(list(records).flatMap(recordRooms))].sort((a, b) => a.localeCompare(b, language));
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

export function filterRecords(records, { tab = 'all', query = '', protocol = '', codeStatus = 'all', room = '' } = {}, language = 'en') {
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
    return !normalizedQuery || matchesQuery(record, normalizedQuery, numericQuery);
  }).sort((a, b) => text(a.name).localeCompare(text(b.name), language));
}
