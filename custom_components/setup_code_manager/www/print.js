/** Local, explicit print views. Browser printing also offers Save as PDF. */
import './qr.js';

export const MAX_PRINT_RECORDS = 100;
const text = value => typeof value === 'string' ? value : '';
const esc = value => text(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const messages = {
  title:['Gerätekarten','Device cards'], room:['Raum','Room'], noRoom:['Ohne Raum','No room'],
  device:['Gerät ohne Namen','Unnamed device'], serial:['Seriennummer','Serial number'],
  codes:['Einrichtungscodes','Setup codes'], noCode:['Kein Einrichtungscode hinterlegt.','No setup code saved.'],
  original:['Einrichtungscode','Setup code'], qr:['QR-Inhalt','QR payload'], manual:['Manueller Einrichtungscode','Manual setup code'],
  derived:['Aus dem Matter-QR-Code berechnet','Derived from the Matter QR code'], note:['Notiz','Note'],
  qrFailed:['QR-Code nicht darstellbar. Verwende den gespeicherten Inhalt.','Could not display the QR code. Use the saved payload.'],
  print:['Drucken / als PDF sichern','Print / save as PDF'], close:['Schließen','Close'],
  warning:['Diese Gerätekarten enthalten lesbare Einrichtungscodes.','These device cards contain readable setup codes.'],
};
const protocols = { matter:'Matter', homekit:'HomeKit', zwave:'Z-Wave' };
const labels = language => {
  const index = text(language).toLowerCase().startsWith('de') ? 0 : 1;
  return key => messages[key][index];
};
const isQR = code => /^(MT:|X-HM:\/\/)/.test(text(code.value)) || code.protocol === 'zwave' && /^90\d{30,}$/.test(text(code.value));
const manualValue = code => code.protocol === 'matter' && text(code.value).startsWith('MT:') && /^(?:[0-9]{11}|[0-9]{21})$/.test(text(code.manual_value)) ? code.manual_value : '';
const formatManual = value => value.length === 11
  ? `${value.slice(0,4)}-${value.slice(4,7)}-${value.slice(7)}`
  : `${value.slice(0,4)}-${value.slice(4,7)}-${value.slice(7,10)}-${value.slice(10,15)}-${value.slice(15,20)}-${value.slice(20)}`;

function codeHTML(code, t) {
  const value = text(code.value).trim();
  let qr = '';
  if (isQR(code)) {
    try {
      // Only the bundled encoder builds SVG; arbitrary SVG from records is never accepted.
      qr = `<div class="qr">${window.SetupCodesQR.renderSVG(value, { border:4, ecc:'M', pixelSize:6, whiteColor:'#ffffff', blackColor:'#000000' }).replace('<svg ', `<svg role="img" aria-label="${esc(protocols[code.protocol] || text(code.protocol))} QR" `)}</div>`;
    } catch { qr = `<p class="muted">${esc(t('qrFailed'))}</p>`; }
  }
  const manual = manualValue(code);
  return `<section class="code"><h3>${esc(protocols[code.protocol] || text(code.protocol))}</h3>${text(code.label).trim() ? `<p class="muted source">${esc(code.label)}</p>` : ''}<div class="code-content">${qr}<div class="code-values"><p class="label">${esc(t(isQR(code) ? 'qr' : 'original'))}</p><code>${esc(value)}</code>${manual ? `<p class="label">${esc(t('manual'))}</p><code class="manual">${esc(formatManual(manual))}</code><p class="muted">${esc(t('derived'))}</p>` : ''}</div></div></section>`;
}

/** Build a standalone document without network resources or executable data. */
export function buildPrintDocument(records, { language = 'en', includeNotes = true } = {}) {
  if (!Array.isArray(records) || !records.length || records.length > MAX_PRINT_RECORDS || records.some(record => !record || typeof record !== 'object' || Array.isArray(record))) {
    throw Object.assign(new Error('Invalid print selection.'), { code:'invalid_print_selection' });
  }
  const t = labels(language);
  const cards = records.map(record => {
    const codes = (Array.isArray(record.codes) ? record.codes : []).filter(code => code && typeof code === 'object' && text(code.value).trim());
    const model = [text(record.manufacturer).trim(),text(record.model).trim()].filter(Boolean).join(' · ');
    return `<article class="device-card"><header><h2>${esc(text(record.name).trim() || t('device'))}</h2><p class="room">${esc(t('room'))}: ${esc(text(record.location).trim() || t('noRoom'))}</p>${model ? `<p class="muted">${esc(model)}</p>` : ''}${text(record.serial_number).trim() ? `<p class="muted">${esc(t('serial'))}: ${esc(record.serial_number)}</p>` : ''}</header><h3 class="section-title">${esc(t('codes'))}</h3>${codes.length ? codes.map(code => codeHTML(code,t)).join('') : `<p class="muted">${esc(t('noCode'))}</p>`}${includeNotes === true && text(record.notes).trim() ? `<section class="notes"><h3>${esc(t('note'))}</h3><p>${esc(record.notes)}</p></section>` : ''}</article>`;
  }).join('');
  return `<!doctype html><html lang="${text(language).toLowerCase().startsWith('de') ? 'de' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'"><title>Setup Code Manager · ${esc(t('title'))}</title><style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#f3f4f5;color:#172027;font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.toolbar,.cards{max-width:920px;margin:0 auto}.toolbar{margin-bottom:20px}.toolbar h1{font-size:22px;margin:0 0 8px}.toolbar p{margin:8px 0 16px}.toolbar button{font:inherit;padding:9px 16px;min-height:44px;border:1px solid #687681;border-radius:6px;background:#fff;color:#172027;margin-right:8px;cursor:pointer}.toolbar button:focus-visible{outline:3px solid #007ca7;outline-offset:3px}.cards{display:grid;gap:20px}.device-card{padding:24px;background:#fff;border:1px solid #a7b0b7;border-radius:8px;break-inside:avoid-page;overflow-wrap:anywhere}h2{font-size:23px;line-height:1.25;margin:0 0 9px}h3{font-size:16px;margin:0 0 6px}p{margin:5px 0}.room{font-weight:600}.muted{color:#4e5b65;font-size:12px}.section-title{margin-top:22px;padding-top:15px;border-top:1px solid #c8cdd2}.code{margin-top:16px;break-inside:avoid-page}.source{margin-bottom:8px}.code-content{display:flex;gap:20px;align-items:flex-start}.qr{width:160px;flex-shrink:0;line-height:0}.qr svg{display:block;width:100%;height:auto;shape-rendering:crispEdges}.code-values{min-width:0;flex:1}.label{font-size:12px;color:#4e5b65;margin:0 0 3px}.label:not(:first-child){margin-top:16px}code{display:block;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}.manual{font-size:18px;font-weight:600;letter-spacing:.02em}.notes{margin-top:20px;padding-top:14px;border-top:1px solid #c8cdd2}.notes p{white-space:pre-wrap}@media(max-width:520px){body{padding:16px}.device-card{padding:18px}.code-content{flex-direction:column}.qr{width:150px}}@page{size:auto;margin:12mm}@media print{body{padding:0;background:#fff;font-size:11pt}.toolbar{display:none}.cards{max-width:none;gap:8mm}.device-card{border-radius:0;padding:6mm;box-shadow:none}.qr{width:35mm}.code-content{flex-direction:row;gap:5mm}.muted,.label{color:#333}.device-card,.qr svg{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><div class="toolbar"><h1>Setup Code Manager · ${esc(t('title'))}</h1><p>${esc(t('warning'))}</p><button type="button" id="scm-print">${esc(t('print'))}</button><button type="button" id="scm-close">${esc(t('close'))}</button></div><main class="cards">${cards}</main></body></html>`;
}

function renderReady(popup, host) {
  return new Promise(resolve => {
    const timeout = (host.setTimeout || globalThis.setTimeout).bind(host);
    const cancel = (host.clearTimeout || globalThis.clearTimeout).bind(host);
    let complete = false;
    const finish = () => { if (complete) return; complete = true; cancel(timer); resolve(); };
    const timer = timeout(finish, 200);
    if (typeof popup.requestAnimationFrame === 'function') popup.requestAnimationFrame(() => popup.requestAnimationFrame(finish));
  });
}

/** Call directly from a user action; a blank window opens before any await. */
export function printDeviceCards(records, options = {}, host = globalThis.window) {
  let popup;
  try { popup = host?.open?.('', '_blank', 'popup,width=1000,height=800'); }
  catch { return Promise.resolve({ status:'blocked' }); }
  if (!popup) return Promise.resolve({ status:'blocked' });
  let closed = false;
  let closeButton, printButton;
  const detach = () => {
    try {
      popup.removeEventListener?.('afterprint', cleanup);
      popup.removeEventListener?.('pagehide', pagehide);
      popup.document?.removeEventListener?.('keydown', escape);
      closeButton?.removeEventListener?.('click', cleanup);
      printButton?.removeEventListener?.('click', printClick);
    } catch { /* A user may have navigated or closed the auxiliary window. */ }
  };
  const cleanup = () => {
    if (closed) return;
    closed = true;
    detach();
    // Remove readable codes before closing even when the browser refuses close().
    try { popup.document?.open(); popup.document?.write('<!doctype html><title>Setup Code Manager</title>'); popup.document?.close(); } catch { /* Closing a navigated/closed window may deny DOM access. */ }
    try { popup.close(); } catch { /* Document is already cleared. */ }
  };
  const pagehide = () => { closed = true; detach(); };
  const escape = event => { if (event.key === 'Escape') { event.preventDefault(); cleanup(); } };
  const print = () => { if (!closed && !popup.closed) { popup.focus?.(); popup.print(); } };
  const printClick = () => { try { print(); } catch { cleanup(); } };
  return (async () => {
    try {
      // Generated content has no script and cannot reach its opener.
      popup.opener = null;
      const html = buildPrintDocument(records, options);
      popup.document.open(); popup.document.write(html); popup.document.close();
      closeButton = popup.document.getElementById('scm-close');
      printButton = popup.document.getElementById('scm-print');
      closeButton?.addEventListener('click', cleanup);
      printButton?.addEventListener('click', printClick);
      popup.document.addEventListener?.('keydown', escape);
      popup.addEventListener?.('afterprint', cleanup);
      popup.addEventListener?.('pagehide', pagehide);
      await renderReady(popup, host);
      if (closed || popup.closed) { cleanup(); return { status:'closed' }; }
      print();
      return { status:closed || popup.closed ? 'closed' : 'opened' };
    } catch { cleanup(); return { status:'error' }; }
  })();
}
