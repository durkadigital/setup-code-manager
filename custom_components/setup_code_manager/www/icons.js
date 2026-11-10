/** Small inline icon set; no icon font or network request is required. */
const paths = {
  plus:'M12 5v14M5 12h14', close:'m6 6 12 12M6 18 18 6', back:'m12 5-7 7 7 7M5 12h14', menu:'M4 6h16M4 12h16M4 18h16', more:'M12 5h.01M12 12h.01M12 19h.01',
  pdf:'M14 2H4v20h16V8zM14 2v6h6M7 13h2v4M9 13a2 2 0 0 1 0 4M13 13v4h2M17 13v4M17 13h2M17 15h2',
  search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', filter:'M4 6h16M7 12h10M10 18h4',
  link:'m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  unlink:'m3 3 18 18M8 16l-1 1a4 4 0 0 1-6-6l2-2M16 8l1-1a4 4 0 0 1 6 6l-2 2',
  archive:'M3 4h18v4H3zM5 8v13h14V8M10 12h4', restore:'M3 4h18v4H3zM5 8v13h14V8m-10 7 3-3 3 3M12 12v6',
  trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
  eye:'M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  copy:'M9 8h12v13H9zM5 16H3V3h12v2', external:'M14 3h7v7M21 3l-9 9M10 3H3v18h18v-7',
  qr:'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM12 3v3M12 9v3H3M12 15v6M21 12h-6',
  camera:'M8 5l2-2h4l2 2h5v16H3V5zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  image:'M3 3h18v18H3zM3 17l6-6 5 5 3-3 4 4M17 7h.01', keyboard:'M2 5h20v14H2zM6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 12h.01M10 12h.01M14 12h.01M18 12h.01M7 16h10',
  download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5', upload:'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
  check:'m4 12 5 5L20 6', warning:'m12 3 10 18H2zM12 9v4M12 17h.01', info:'M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  key:'M14 8a6 6 0 1 1-12 0 6 6 0 0 1 12 0M13 8h9v4h-4v3h-4V9',
  plug:'M8 2v5M16 2v5M6 7h12v6l-4 4v5h-4v-5l-4-4z', bulb:'M9 18h6M9 22h6M8 15a7 7 0 1 1 8 0l-1 3H9z', sensor:'M5 2h10v20H5zM19 5v7M11 6h.01', heater:'M3 5h4v15H3zM10 3h4v17h-4zM17 5h4v15h-4z',
  chevron:'m9 5 7 7-7 7', refresh:'M20 7V2l-4 4a8 8 0 1 0 3 13M20 7h-5', edit:'m3 16 12-12 5 5L8 21H3zM13 6l5 5',
};
export function icon(name, extra = '') {
  return `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.key}"/></svg>`;
}
export function deviceIcon(record) {
  const name = `${record.name || ''} ${record.model || ''}`.toLowerCase();
  return /lampe|leuchte|light|lamp|bulb/.test(name) ? 'bulb' : /heiz|radiat|thermostat/.test(name) ? 'heater' : /sensor|tür|door/.test(name) ? 'sensor' : 'plug';
}
