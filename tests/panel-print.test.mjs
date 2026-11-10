import assert from 'node:assert/strict';
import test from 'node:test';

class Events {
  listeners=new Map();
  addEventListener(type,listener) { if (!this.listeners.has(type)) this.listeners.set(type,new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type,listener) { this.listeners.get(type)?.delete(listener); }
  emit(type,event={}) { for (const listener of [...(this.listeners.get(type)||[])]) listener(event); }
}
const elements=new Map();
globalThis.customElements={get:name=>elements.get(name),define:(name,element)=>elements.set(name,element)};
globalThis.window=new Events();
window.setTimeout=setTimeout;
window.clearTimeout=clearTimeout;
globalThis.HTMLElement=class {
  attachShadow() {
    this.shadowRoot={listeners:new Map(),addEventListener(type,listener){this.listeners.set(type,listener);}};
  }
};
await import('../custom_components/setup_code_manager/www/panel.js');
const Panel=elements.get('setup-code-manager-panel');
const MATTER='MT:Y.K9042C00KA0648G00';
const device=(overrides={})=>({id:'synthetic-a',name:'Synthetic device',location:'Synthetic room',notes:'Synthetic private note',archived:false,links:[],codes:[{id:'synthetic-code',protocol:'matter',value:MATTER,manual_value:'34970112332'}],...overrides});
const click=(panel,action)=>panel._onClick({target:{closest:()=>({disabled:false,dataset:{action}})}});

function fixture(t,{result='opened'}={}) {
  const panel=new Panel();
  const state={renders:0,dialogCloses:0,toasts:[],opened:0,printed:0,frames:[],popups:[]};
  panel._connected=true;
  panel._hass={language:'en'};
  panel._loading=false;
  panel._devices=[device()];
  panel._renderModal=()=>{state.renders++;};
  panel._toast=value=>state.toasts.push(value);
  const modalRoot={innerHTML:''};
  panel.shadowRoot.getElementById=id=>id==='modal-root'?modalRoot:null;
  panel.shadowRoot.querySelector=selector=>selector==='dialog'?{close(){state.dialogCloses++;}}:null;
  const original=window.open;
  window.open=(...args)=>{
    state.opened++;
    state.openArgs=args;
    if (result==='blocked') return null;
    const document=new Events();
    document.html='';
    document.open=()=>{document.html='';};
    document.write=html=>{if(result==='error' && html.includes('device-card')) throw new Error(`Synthetic private diagnostic ${MATTER}`);document.html+=html;};
    document.close=()=>{};
    document.getElementById=()=>new Events();
    const popup=new Events();
    Object.assign(popup,{document,closed:false,opener:{},requestAnimationFrame:callback=>state.frames.push(callback),focus(){},close(){popup.closed=true;},print(){state.printed++;if(result==='closed') popup.emit('afterprint');}});
    state.popups.push(popup);
    return popup;
  };
  state.flushFrames=()=>{while(state.frames.length) state.frames.shift()();};
  t.after(()=>{
    state.flushFrames();
    state.popups.forEach(popup=>popup.emit('afterprint'));
    if (original===undefined) delete window.open; else window.open=original;
  });
  return {panel,state};
}

test('print confirmation snapshots exactly the chosen records and defaults notes off', t=>{
  const {panel}=fixture(t);
  const source=[device()];
  panel._openPrint(source);
  assert.equal(panel._modal.kind,'print');
  assert.equal(panel._printNotes,false);
  assert.notStrictEqual(panel._printRecords,source);
  assert.notStrictEqual(panel._printRecords[0],source[0]);
  source[0].name='Changed outside confirmation';
  source[0].codes[0].value='Changed code';
  source.push(device({id:'synthetic-b'}));
  assert.equal(panel._printRecords.length,1);
  assert.equal(panel._printRecords[0].name,'Synthetic device');
  assert.equal(panel._printRecords[0].codes[0].value,MATTER);
  const html=panel._renderPrint();
  assert.match(html,/Selected records: 1<\/p>/);
  assert.match(html,/Synthetic device/);
  assert.doesNotMatch(html,/Changed outside confirmation|Synthetic private note|MT:Y\.K9042/);
  assert.doesNotMatch(html,/data-field="print-notes" checked/);
});

test('confirmation click opens the popup synchronously and omits notes unless opted in', async t=>{
  const {panel,state}=fixture(t);
  panel._openPrint([device()]);
  const pending=click(panel,'print-confirm');
  assert.equal(state.opened,1);
  assert.deepEqual(state.openArgs,['','_blank','popup,width=1000,height=800']);
  assert.equal(state.printed,0);
  assert.ok(!state.popups[0].document.html.includes('Synthetic private note'));
  const second=click(panel,'print-confirm');
  assert.equal(state.opened,1);
  state.flushFrames();
  await Promise.all([pending,second]);
  assert.equal(state.printed,1);
  assert.equal(panel._modal,null);
  assert.equal(panel._printRecords,null);
  assert.deepEqual(state.toasts,[]); // No claim that a print/PDF was actually saved.
});

test('explicit notes opt-in reaches the print view', async t=>{
  const {panel,state}=fixture(t);
  panel._openPrint([device()]);
  panel._onChange({target:{dataset:{field:'print-notes'},checked:true}});
  const pending=click(panel,'print-confirm');
  assert.ok(state.popups[0].document.html.includes('Synthetic private note'));
  state.flushFrames();
  await pending;
});

for (const result of ['blocked','error']) {
  test(`current ${result} result keeps the confirmation open with a safe error`, async t=>{
    const {panel,state}=fixture(t,{result});
    panel._openPrint([device()]);
    await click(panel,'print-confirm');
    assert.equal(panel._modal.kind,'print');
    assert.equal(panel._busy,false);
    assert.ok(panel._modalError);
    assert.ok(!panel._modalError.includes(MATTER));
    assert.ok(!panel._modalError.includes('diagnostic'));
    assert.equal(state.dialogCloses,0);
  });
}

for (const result of ['blocked','error','opened','closed']) {
  test(`late ${result} print result cannot alter a new editor after disconnect`, async t=>{
    const {panel,state}=fixture(t,{result});
    panel._openPrint([device()]);
    const pending=click(panel,'print-confirm');
    panel.disconnectedCallback();
    assert.equal(panel._printRecords,null);
    assert.equal(panel._printNotes,false);
    panel._connected=true;
    panel._newDraft(device({notes:'New unsaved note'}));
    panel._dirty=true;
    panel._openModal('editor');
    panel._modalError='New editor warning';
    // Simulate a new in-flight save; a stale print result must not clear it.
    panel._busy=true;
    const currentModal=panel._modal;
    const currentDraft=panel._draft;
    const renders=state.renders;
    const closes=state.dialogCloses;
    state.flushFrames();
    await pending;
    assert.strictEqual(panel._modal,currentModal);
    assert.strictEqual(panel._draft,currentDraft);
    assert.equal(panel._draft.notes,'New unsaved note');
    assert.equal(panel._dirty,true);
    assert.equal(panel._modalError,'New editor warning');
    assert.equal(panel._busy,true);
    assert.equal(state.renders,renders);
    assert.equal(state.dialogCloses,closes);
  });
}

test('closing print confirmation removes the cloned records', async t=>{
  const {panel,state}=fixture(t);
  panel._openPrint([device()]);
  await click(panel,'close-modal');
  assert.equal(panel._modal,null);
  assert.equal(panel._printRecords,null);
  assert.equal(state.opened,0);
});

test('empty and more-than-100-card selections never open a print dialog', t=>{
  const {panel,state}=fixture(t);
  panel._openPrint([]);
  panel._openPrint(Array.from({length:101},(_,index)=>device({id:`synthetic-${index}`})));
  assert.equal(panel._modal,undefined);
  assert.equal(state.opened,0);
  assert.equal(state.toasts.length,2);
});
