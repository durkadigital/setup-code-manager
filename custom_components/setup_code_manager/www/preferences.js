/** Saved list views contain choices only; searches and inventory never persist. */
import { SORTS, GROUPS } from './filters.js';

export const MAX_SAVED_VIEWS = 20;
export const VIEW_SETTINGS_DEFAULTS = Object.freeze({
  tab:'all', protocol:'', codeStatus:'all', room:'', floor:'', label:'', sort:'name-asc', group:'none',
});
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const choice = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const selector = (value, prefix, maxLength = 256) => {
  if (value === '' || value === 'unassigned') return value;
  return typeof value === 'string' && value.startsWith(prefix) && value.length <= prefix.length + maxLength
    && value.slice(prefix.length).trim() && !/[\u0000-\u001f\u007f]/u.test(value) ? value : '';
};

export function sanitizeViewSettings(value) {
  const input = object(value);
  return {
    tab:choice(input.tab, ['all','linked','unlinked','archive'], 'all'),
    protocol:choice(input.protocol, ['','matter','homekit','zwave'], ''),
    codeStatus:choice(input.codeStatus, ['all','has','missing'], 'all'),
    room:selector(input.room, 'room:'), floor:selector(input.floor, 'floor:', 1024), label:selector(input.label, 'label:', 1024),
    sort:choice(input.sort, SORTS, 'name-asc'), group:choice(input.group, GROUPS, 'none'),
  };
}

const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(value) ? value : '';
const viewName = value => typeof value === 'string'
  ? [...value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim()].slice(0,80).join('') : '';

export function normalizeViews(value) {
  const result = [], ids = new Set();
  if (!Array.isArray(value)) return result;
  for (const raw of value) {
    const input = object(raw), id = safeId(input.id), name = viewName(input.name);
    if (!id || !name || ids.has(id)) continue;
    result.push({ id, name, settings:sanitizeViewSettings(input.settings) });
    ids.add(id);
    if (result.length === MAX_SAVED_VIEWS) break;
  }
  return result;
}

export function preferenceKey(instanceId, userId) {
  const valid = value => typeof value === 'string' && value.trim() && value.length <= 256
    && !/[\u0000-\u001f\u007f]/u.test(value);
  if (!valid(instanceId) || !valid(userId)) return null;
  try { return `setup_code_manager:views:v1:${encodeURIComponent(instanceId)}:${encodeURIComponent(userId)}`; }
  catch { return null; }
}

export function loadViews(storage, instanceId, userId) {
  const key = preferenceKey(instanceId, userId);
  if (!key) return [];
  try {
    const raw = storage?.getItem(key);
    if (typeof raw !== 'string' || raw.length > 100000) return [];
    const envelope = JSON.parse(raw);
    return envelope?.version === 1 ? normalizeViews(envelope.views) : [];
  } catch { return []; }
}

export function saveViews(storage, instanceId, userId, views) {
  const key = preferenceKey(instanceId, userId);
  if (!key) return false;
  try {
    if (typeof storage?.setItem !== 'function') return false;
    storage.setItem(key, JSON.stringify({ version:1, views:normalizeViews(views) }));
    return true;
  } catch { return false; }
}
