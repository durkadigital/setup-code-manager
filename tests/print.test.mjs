import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

globalThis.window = {};
const { buildPrintDocument, printDeviceCards, MAX_PRINT_RECORDS } = await import('../custom_components/setup_code_manager/www/print.js');
const require = createRequire(import.meta.url);
const jsQR = require(fileURLToPath(new URL('../custom_components/setup_code_manager/www/vendor/jsQR.js',import.meta.url)));
// Synthetic CHIP reference payload, never a real credential.
const MATTER = 'MT:Y.K9042C00KA0648G00';
const MANUAL = '34970112332';
const device = (overrides = {}) => ({
  id:'synthetic-device',name:'Synthetic socket',location:'Test room',manufacturer:'Example',model:'Demo',
  serial_number:'SYNTHETIC-001',notes:'Synthetic note',codes:[{protocol:'matter',value:MATTER,label:'Original label',manual_value:MANUAL}],
  ...overrides,
});

function decodeSVG(html) {
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0];
  assert.ok(svg);
  const [,width,height] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
  const data = new Uint8ClampedArray(width*height*4).fill(255);
  for (const match of svg.matchAll(/M(\d+),(\d+)h6v6h-6z/g)) {
    const x = Number(match[1]),y = Number(match[2]);
    for (let row=y;row<y+6;row++) for (let column=x;column<x+6;column++) {
      const offset=(row*width+column)*4;
      data[offset]=data[offset+1]=data[offset+2]=0;
    }
  }
  return jsQR(data,width,height)?.data;
}

for (const language of ['de','en']) {
  test(`print cards retain original QR and display its derived manual code separately (${language})`, () => {
    const record=device();
    const before=structuredClone(record);
    const html=buildPrintDocument([record],{language});
    assert.equal(decodeSVG(html),MATTER);
    assert.match(html,/3497-011-2332/);
    assert.match(html,language==='de' ? /Aus dem Matter-QR-Code berechnet/ : /Derived from the Matter QR code/);
    assert.match(html,language==='de' ? /Manueller Einrichtungscode/ : /Manual setup code/);
    assert.match(html,/Synthetic socket/);
    assert.match(html,/Test room/);
    assert.deepEqual(record,before);
  });
}

test('21-digit Matter metadata prints fully, including its leading zero', () => {
  const digits='012345678901234567890';
  const html=buildPrintDocument([device({codes:[{protocol:'matter',value:MATTER,manual_value:digits}]})]);
  assert.match(html,/0123-456-789-01234-56789-0/);
  assert.equal(decodeSVG(html),MATTER);
});

test('manual values are never invented or duplicated for manual codes and other protocols', () => {
  const html=buildPrintDocument([device({codes:[
    {protocol:'matter',value:'03497011233',manual_value:'03497011233'},
    {protocol:'homekit',value:'031-45-154',manual_value:'34970112332'},
    {protocol:'matter',value:MATTER,manual_value:'not valid'},
  ]})]);
  assert.doesNotMatch(html,/class="manual"/);
  assert.match(html,/03497011233/);
  assert.match(html,/031-45-154/);
  assert.doesNotMatch(html,/not valid/);
  assert.equal((html.match(/<svg /g)||[]).length,1);
});

for (const [protocol,value] of [['homekit','X-HM://0023ISYWY7STT'],['zwave','900100123456789012345678901234567890123456789012345678901234567890']]) {
  test(`${protocol} QR uses the original stored payload`, () => {
    const html=buildPrintDocument([device({codes:[{protocol,value}]})]);
    assert.equal(decodeSVG(html),value);
  });
}

test('device metadata, note, labels and code strings cannot inject HTML', () => {
  const injection='</title><img src="https://example.invalid/private" onerror="alert(1)"><script>alert(1)</script>';
  const html=buildPrintDocument([device({name:injection,location:injection,manufacturer:injection,model:injection,serial_number:injection,notes:injection,codes:[{protocol:injection,value:injection,label:injection}]})]);
  assert.ok(html.includes('&lt;/title&gt;&lt;img'));
  assert.doesNotMatch(html,/<script\b|<img\b|onerror="alert|<link\b/i);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('notes are optional and missing-code records remain printable without bogus QRs', () => {
  const record=device({location:'',codes:[null,{}, {value:'  '}]});
  const html=buildPrintDocument([record],{language:'de',includeNotes:false});
  assert.match(html,/Ohne Raum/);
  assert.match(html,/Kein Einrichtungscode hinterlegt/);
  assert.doesNotMatch(html,/Synthetic note|<svg /);
  assert.match(buildPrintDocument([record],{includeNotes:true}),/Synthetic note/);
  assert.doesNotMatch(buildPrintDocument([record],{includeNotes:'false'}),/Synthetic note/);
});

test('the document has no external resources or executable script and hides controls for printing', () => {
  const html=buildPrintDocument([device()]);
  assert.match(html,/default-src 'none'/);
  assert.doesNotMatch(html,/<script\b|<link\b|<img\b|<iframe\b|\bsrc=|@import|url\(/i);
  assert.match(html,/@media print/);
  assert.match(html,/\.toolbar\{display:none\}/);
});

test('QR generation has a quiet zone and safe fallback without leaking an exception', () => {
  const original=window.SetupCodesQR.renderSVG;
  let options;
  window.SetupCodesQR.renderSVG=(value,settings)=>{options=settings;return original(value,settings);};
  try {
    buildPrintDocument([device()]);
    assert.equal(options.border,4);
    assert.equal(options.ecc,'M');
    window.SetupCodesQR.renderSVG=()=>{throw new Error('private diagnostic');};
    const html=buildPrintDocument([device()]);
    assert.match(html,/Could not display the QR code/);
    assert.match(html,/MT:Y\.K9042C00KA0648G00/);
    assert.doesNotMatch(html,/private diagnostic/);
  } finally { window.SetupCodesQR.renderSVG=original; }
});

test('empty, malformed or excessive selections fail with a constant safe message', () => {
  for (const records of [[],null,[null],[[]],Array.from({length:MAX_PRINT_RECORDS+1},()=>device())]) {
    assert.throws(()=>buildPrintDocument(records),error=>error.code==='invalid_print_selection' && error.message==='Invalid print selection.');
  }
});

class Events {
  listeners=new Map();
  addEventListener(type,listener) { if (!this.listeners.has(type)) this.listeners.set(type,new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type,listener) { this.listeners.get(type)?.delete(listener); }
  emit(type,event={}) { for (const listener of [...(this.listeners.get(type)||[])]) listener(event); }
}
function browser({ blocked=false,printThrows=false,writeThrows=false,autoAfterPrint=false }={}) {
  const calls=[];
  const frames=[];
  const buttons={'scm-print':new Events(),'scm-close':new Events()};
  const document=new Events();
  document.html='';
  document.open=()=>{calls.push('document-open');document.html='';};
  document.write=html=>{calls.push('document-write');if (writeThrows && html.includes('device-card')) throw new Error('sensitive write diagnostic');document.html+=html;};
  document.close=()=>calls.push('document-close');
  document.getElementById=id=>buttons[id];
  const popup=new Events();
  Object.assign(popup,{document,closed:false,opener:{},requestAnimationFrame:callback=>frames.push(callback),focus:()=>calls.push('focus'),close:()=>{calls.push('close');popup.closed=true;},print:()=>{calls.push('print');if (printThrows) throw new Error(`sensitive print diagnostic ${MATTER}`);if (autoAfterPrint) popup.emit('afterprint');}});
  const host={setTimeout,clearTimeout,open:(...args)=>{calls.push(['open',...args]);return blocked ? null : popup;}};
  return {host,popup,document,buttons,calls,flushFrames(){while(frames.length) frames.shift()();}};
}

test('popup denial returns blocked without creating a document', async () => {
  const b=browser({blocked:true});
  assert.deepEqual(await printDeviceCards([device()],{},b.host),{status:'blocked'});
  assert.equal(b.calls.length,1);
});

test('the blank popup opens synchronously and printing waits for rendered frames', async () => {
  const b=browser();
  const pending=printDeviceCards([device()],{includeNotes:false},b.host);
  assert.deepEqual(b.calls[0],['open','','_blank','popup,width=1000,height=800']);
  assert.ok(!b.calls.includes('print'));
  assert.equal(b.popup.opener,null);
  assert.ok(b.document.html.includes(MATTER));
  b.flushFrames();
  assert.deepEqual(await pending,{status:'opened'});
  assert.ok(b.calls.indexOf('print')>b.calls.indexOf('document-close'));
  b.popup.emit('afterprint');
  assert.ok(b.popup.closed);
  assert.ok(!b.document.html.includes(MATTER));
});

test('print-dialog completion and cancellation both clear codes, close and detach listeners', async () => {
  const b=browser({autoAfterPrint:true});
  const pending=printDeviceCards([device()],{},b.host);
  b.flushFrames();
  assert.deepEqual(await pending,{status:'closed'});
  assert.ok(b.popup.closed);
  assert.ok(!b.document.html.includes(MATTER));
  assert.equal(b.buttons['scm-print'].listeners.get('click').size,0);
  assert.equal(b.buttons['scm-close'].listeners.get('click').size,0);
  assert.equal(b.popup.listeners.get('afterprint').size,0);
  assert.equal(b.document.listeners.get('keydown').size,0);
  b.popup.emit('afterprint');
  assert.equal(b.calls.filter(value=>value==='close').length,1);
});

for (const source of ['button','Escape']) {
  test(`closing via ${source} during rendering prevents a late print request`, async () => {
    const b=browser();
    const pending=printDeviceCards([device()],{},b.host);
    if (source==='button') b.buttons['scm-close'].emit('click');
    else b.document.emit('keydown',{key:'Escape',preventDefault(){}});
    b.flushFrames();
    assert.deepEqual(await pending,{status:'closed'});
    assert.ok(!b.calls.includes('print'));
    assert.ok(!b.document.html.includes(MATTER));
  });
}

for (const failure of ['printThrows','writeThrows']) {
  test(`${failure} clears the auxiliary document and returns a safe error`, async () => {
    const b=browser({[failure]:true});
    const pending=printDeviceCards([device()],{},b.host);
    b.flushFrames();
    assert.deepEqual(await pending,{status:'error'});
    assert.ok(b.popup.closed);
    assert.ok(!b.document.html.includes(MATTER));
  });
}

test('manual print control remains available when a browser does not open the dialog automatically', async () => {
  const b=browser();
  const pending=printDeviceCards([device()],{},b.host);
  b.flushFrames();
  await pending;
  b.buttons['scm-print'].emit('click');
  assert.equal(b.calls.filter(value=>value==='print').length,2);
  b.buttons['scm-close'].emit('click');
  assert.ok(b.popup.closed);
  assert.ok(!b.document.html.includes(MATTER));
});


for (const source of ['native-window-close','pagehide']) {
  test(`${source} during rendering prevents a late print request`, async () => {
    const b=browser();
    const pending=printDeviceCards([device()],{},b.host);
    if (source==='native-window-close') b.popup.closed=true;
    else b.popup.emit('pagehide');
    b.flushFrames();
    assert.deepEqual(await pending,{status:'closed'});
    assert.ok(!b.calls.includes('print'));
  });
}

test('a navigated window denying DOM access still closes and returns only a safe status', async () => {
  const b=browser();
  Object.defineProperty(b.popup,'document',{get(){throw new Error(`sensitive navigation diagnostic ${MATTER}`);}});
  assert.deepEqual(await printDeviceCards([device()],{},b.host),{status:'error'});
  assert.ok(b.popup.closed);
});
