import assert from 'node:assert/strict';
import test from 'node:test';

class Events {
  listeners = new Map();
  addEventListener(type,listener) { if (!this.listeners.has(type)) this.listeners.set(type,new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type,listener) { this.listeners.get(type)?.delete(listener); }
}
const elements = new Map();
globalThis.customElements = { get:name => elements.get(name),define:(name,element) => elements.set(name,element) };
globalThis.window = new Events();
globalThis.HTMLElement = class {
  attachShadow() { this.shadowRoot = { listeners:new Map(),addEventListener(type,listener) { this.listeners.set(type,listener); } }; }
};
await import('../custom_components/setup_code_manager/www/panel.js');
const Panel = elements.get('setup-code-manager-panel');
const MATTER = 'MT:Y.K9042C00KA0648G00', PDF = '%PDF-1.4\n% synthetic fixture\n%%EOF\n';
const device = (overrides = {}) => ({ id:'synthetic-a',name:'Synthetic device',location:'Synthetic room',notes:'Synthetic private note',archived:false,links:[],codes:[{ id:'synthetic-code',protocol:'matter',value:MATTER,manual_value:'34970112332' }],...overrides });
const result = (count = 1,overrides = {}) => ({ filename:'setup-code-manager-synthetic.pdf',mime:'application/pdf',encoding:'base64',content:btoa(PDF),byte_length:PDF.length,count,...overrides });
const deferred = () => { let resolve,reject; const promise = new Promise((yes,no) => { resolve = yes; reject = no; }); return { promise,resolve,reject }; };
const click = (panel,action,fields = {}) => panel._onClick({ target:{ closest:() => ({ disabled:false,dataset:{ action,...fields } }) } });

function fixture(t,{ response,error,pending } = {}) {
  const panel = new Panel(), state = { renders:0,mainRenders:0,dialogCloses:0,toasts:[],calls:[],downloads:[],blobs:[],revoked:[],timers:[],opened:0,printed:0 };
  panel._connected = true; panel._hass = { language:'en',user:{ id:'synthetic-user' } }; panel._loading = false; panel._devices = [device()];
  panel._renderModal = () => { state.renders++; }; panel._renderMain = () => { state.mainRenders++; }; panel._toast = value => state.toasts.push(value);
  const modalRoot = { innerHTML:'' };
  panel.shadowRoot.getElementById = id => id === 'modal-root' ? modalRoot : null;
  panel.shadowRoot.querySelector = selector => selector === 'dialog' ? { close() { state.dialogCloses++; } } : null;
  panel.shadowRoot.querySelectorAll = () => [];
  const host = new Events(), document = new Events();
  document.body = { appendChild() {} };
  document.createElement = tag => {
    assert.equal(tag,'a');
    return { click() { state.downloads.push({ href:this.href,filename:this.download }); },remove() {} };
  };
  Object.assign(host,{
    document,Blob,atob,
    URL:{ createObjectURL(blob) { state.blobs.push(blob); return `blob:synthetic-${state.blobs.length}`; },revokeObjectURL(url) { state.revoked.push(url); } },
    setTimeout(callback,delay) { state.timers.push({ callback,delay }); return state.timers.length; },clearTimeout() {},
    open() { state.opened++; assert.fail('PDF downloads must not open a popup.'); },
    print() { state.printed++; assert.fail('PDF downloads must not invoke browser printing.'); },
    confirm:() => true,
  });
  globalThis.window = host; globalThis.document = document;
  panel._api = async (command,data) => {
    state.calls.push({ command,data:structuredClone(data) }); assert.equal(command,'pdf');
    if (pending) return pending.promise;
    if (error) throw error;
    return response || result(data.record_ids.length);
  };
  t.after(() => { for (const timer of state.timers) timer.callback(); });
  return { panel,state,host };
}

test('PDF confirmation freezes only IDs and names, never copies setup codes or notes, and defaults notes off', t => {
  const { panel } = fixture(t), source = [device()]; panel._openPDF(source);
  assert.equal(panel._modal.kind,'pdf'); assert.equal(panel._pdfNotes,false);
  assert.notStrictEqual(panel._pdfRecords,source); assert.notStrictEqual(panel._pdfRecords[0],source[0]);
  assert.deepEqual(panel._pdfRecords,[{ id:'synthetic-a',name:'Synthetic device' }]);
  source[0].name = 'Changed outside confirmation'; source[0].codes[0].value = 'Changed code'; source.push(device({ id:'synthetic-b' }));
  assert.deepEqual(panel._pdfRecords,[{ id:'synthetic-a',name:'Synthetic device' }]);
  const html = panel._renderPDF();
  assert.match(html,/Synthetic device/); assert.match(html,/data-field="pdf-notes"/);
  assert.doesNotMatch(html,/data-field="pdf-notes"[^>]*checked|Changed outside confirmation|Synthetic private note|MT:Y\.K9042|34970112332/);
});

for (const [language,expected] of [['en','en'],['de','de'],['de-DE','de'],['fr','en']]) {
  test(`PDF confirmation sends exact frozen IDs, notes off and ${expected} for ${language}`, async t => {
    const { panel,state } = fixture(t); panel._hass.language = language;
    panel._openPDF([device()]); panel._devices = [device({ id:'new-result',name:'Changed filter result' })];
    await click(panel,'pdf-confirm');
    assert.deepEqual(state.calls,[{ command:'pdf',data:{ record_ids:['synthetic-a'],include_notes:false,language:expected } }]);
    assert.equal(state.downloads.length,1); assert.equal(state.downloads[0].filename,'setup-code-manager-synthetic.pdf');
    assert.equal(state.blobs[0].type,'application/pdf'); assert.equal(await state.blobs[0].text(),PDF);
    assert.equal(panel._modal,null); assert.equal(panel._pdfRecords,null); assert.equal(state.opened,0); assert.equal(state.printed,0);
    assert.doesNotMatch(state.toasts.join(' '),/\b(saved|stored|gespeichert)\b/iu,'Starting a download must not claim that a PDF was saved.');
  });
}

test('notes reach the PDF request only after an explicit opt-in', async t => {
  const { panel,state } = fixture(t); panel._openPDF([device()]);
  panel._onChange({ target:{ dataset:{ field:'pdf-notes' },checked:true } }); await click(panel,'pdf-confirm');
  assert.equal(state.calls[0].data.include_notes,true); assert.doesNotMatch(JSON.stringify(state.calls[0]),/Synthetic private note|MT:Y\.K9042|"codes"/);
});

test('a single pending PDF request ignores repeated confirmation clicks and downloads only once', async t => {
  const pending = deferred(), { panel,state } = fixture(t,{ pending }); panel._openPDF([device()]);
  const first = click(panel,'pdf-confirm'); assert.equal(panel._pdfPending,true); assert.equal(panel._busy,true);
  await click(panel,'pdf-confirm'); assert.equal(state.calls.length,1); assert.equal(state.downloads.length,0);
  pending.resolve(result()); await first;
  assert.equal(state.downloads.length,1); assert.equal(panel._busy,false); assert.equal(panel._pdfPending,false);
});

for (const error of [{ code:'not_found',message:`Private ${MATTER}` },{ code:'pdf_too_large',message:`Private ${MATTER}` },{ code:'pdf_failed',message:`Private ${MATTER}` },new Error(`Synthetic diagnostic ${MATTER}`)]) {
  test(`current ${error.code || 'unexpected'} failure keeps the confirmation open with a safe error`, async t => {
    const { panel,state } = fixture(t,{ error }); panel._openPDF([device()]); await click(panel,'pdf-confirm');
    assert.equal(panel._modal.kind,'pdf'); assert.equal(panel._busy,false); assert.equal(panel._pdfPending,false);
    assert.ok(panel._modalError); assert.doesNotMatch(panel._modalError,/MT:Y\.K9042|Private|diagnostic/);
    assert.equal(state.downloads.length,0); assert.equal(state.dialogCloses,0); assert.equal(state.calls.length,1);
    assert.deepEqual(state.calls[0].data.record_ids,['synthetic-a'],'An expired selection must never retry the whole inventory.');
  });
}

test('an inconsistent PDF response never downloads and leaves a safe retryable confirmation', async t => {
  const { panel,state } = fixture(t,{ response:result(2) }); panel._openPDF([device()]); await click(panel,'pdf-confirm');
  assert.equal(state.downloads.length,0); assert.equal(panel._modal.kind,'pdf'); assert.ok(panel._modalError); assert.equal(panel._busy,false);
});

for (const outcome of ['success','failure']) {
  test(`closing a pending PDF permits a new editor and rejects the late ${outcome}`, async t => {
    const pending = deferred(), { panel,state } = fixture(t,{ pending }); panel._openPDF([device()]); const creating = click(panel,'pdf-confirm');
    assert.equal(panel._pdfPending,true); await click(panel,'close-modal');
    assert.equal(panel._modal,null); assert.equal(panel._pdfRecords,null); assert.equal(panel._pdfPending,false); assert.equal(panel._busy,false);
    panel._newDraft(device({ notes:'New unsaved note' })); panel._dirty = true; panel._openModal('editor'); panel._modalError = 'New editor warning'; panel._busy = true;
    const modal = panel._modal, draft = panel._draft, renders = state.renders, closes = state.dialogCloses;
    if (outcome === 'success') pending.resolve(result()); else pending.reject({ code:'pdf_failed' }); await creating;
    assert.strictEqual(panel._modal,modal); assert.strictEqual(panel._draft,draft); assert.equal(panel._draft.notes,'New unsaved note');
    assert.equal(panel._dirty,true); assert.equal(panel._modalError,'New editor warning'); assert.equal(panel._busy,true);
    assert.equal(state.renders,renders); assert.equal(state.dialogCloses,closes); assert.equal(state.downloads.length,0);
  });
}

for (const outcome of ['success','failure']) {
  test(`disconnect clears PDF state and a late ${outcome} cannot alter a later editor`, async t => {
    const pending = deferred(), { panel,state } = fixture(t,{ pending }); panel._openPDF([device()]); const creating = click(panel,'pdf-confirm'); panel.disconnectedCallback();
    assert.equal(panel._pdfRecords,null); assert.equal(panel._pdfNotes,false); assert.equal(panel._pdfPending,false);
    panel._connected = true; panel._newDraft(device({ notes:'Reconnected draft' })); panel._openModal('editor'); panel._dirty = true; panel._busy = true; panel._modalError = 'Current warning';
    const modal = panel._modal, draft = panel._draft, renders = state.renders;
    if (outcome === 'success') pending.resolve(result()); else pending.reject({ code:'pdf_failed' }); await creating;
    assert.strictEqual(panel._modal,modal); assert.strictEqual(panel._draft,draft); assert.equal(panel._modalError,'Current warning'); assert.equal(panel._busy,true); assert.equal(panel._dirty,true);
    assert.equal(state.renders,renders); assert.equal(state.downloads.length,0);
  });
}

test('a PDF response created for another HA account cannot start a download', async t => {
  const pending = deferred(), { panel,state } = fixture(t,{ pending }); panel._openPDF([device()]); const creating = click(panel,'pdf-confirm');
  panel.hass = { language:'en',user:{ id:'other-user' } }; pending.resolve(result()); await creating;
  assert.equal(state.downloads.length,0); assert.deepEqual(state.toasts,[]);
});

test('an active account switch immediately closes a pending PDF and leaves the new account usable', async t => {
  const pending = deferred(), { panel,state } = fixture(t,{ pending }); panel._started = true; panel._refresh = async () => {};
  panel._openPDF([device()]); const creating = click(panel,'pdf-confirm'); panel.hass = { language:'en',user:{ id:'other-user' } };
  assert.equal(panel._modal,null); assert.equal(panel._pdfRecords,null); assert.equal(panel._pdfPending,false); assert.equal(panel._busy,false);
  pending.resolve(result()); await creating; assert.equal(state.downloads.length,0); assert.deepEqual(state.toasts,[]);
});

test('closing an idle PDF confirmation clears lightweight records without requesting a PDF', async t => {
  const { panel,state } = fixture(t); panel._openPDF([device()]); await click(panel,'close-modal');
  assert.equal(panel._modal,null); assert.equal(panel._pdfRecords,null); assert.equal(state.calls.length,0); assert.equal(state.downloads.length,0);
});

test('empty and more-than-100-card scopes never open a PDF confirmation', t => {
  const { panel,state } = fixture(t); panel._openPDF([]); panel._openPDF(Array.from({ length:101 },(_,index) => device({ id:`synthetic-${index}` })));
  assert.equal(panel._modal,undefined); assert.equal(state.calls.length,0); assert.equal(state.downloads.length,0); assert.equal(state.toasts.length,2);
});

test('duplicate or malformed record scopes are rejected locally instead of broadening the PDF request', t => {
  const { panel,state } = fixture(t);
  for (const records of [null,{},[device(),device()],[device({ id:'' })],[device({ id:42 })],[null]]) panel._openPDF(records);
  assert.equal(panel._modal,undefined); assert.equal(state.calls.length,0); assert.equal(state.downloads.length,0); assert.equal(state.toasts.length,6);
});

test('PDF actions use the visible selected scope, filtered scope or single requested record', async t => {
  const { panel } = fixture(t);
  panel._devices = [device({ id:'a',name:'Office device',location:'Office' }),device({ id:'b',name:'Kitchen device',location:'Kitchen' }),device({ id:'archived',location:'Office',archived:true })];
  panel._room = 'room:Office'; panel._selection = new Set(['a','b','archived','missing']);
  await click(panel,'pdf-selected'); assert.deepEqual(panel._pdfRecords,[{ id:'a',name:'Office device' }]);
  await click(panel,'close-modal'); await click(panel,'pdf-filtered'); assert.deepEqual(panel._pdfRecords,[{ id:'a',name:'Office device' }]);
  await click(panel,'close-modal'); await click(panel,'pdf-record',{ id:'b' }); assert.deepEqual(panel._pdfRecords,[{ id:'b',name:'Kitchen device' }]);
});
