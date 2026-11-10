import assert from 'node:assert/strict';
import test from 'node:test';
import { translator } from '../custom_components/setup_code_manager/www/i18n.js';

// Small DOM adapter: innerHTML replaces nodes, and removing an open popover
// closes it. This models the two browser lifecycle boundaries, not panel logic.
const definitions = new Map();
let currentState;
const decode = value => value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const encode = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const voidTags = new Set(['input','link','meta','img','br','hr','col','source']);
class Node {
  constructor(tag, state) { this.tagName = tag.toUpperCase(); this.localName = tag; this.state = state; this.attributes = new Map(); this.childNodes = []; this.parentNode = null; this.style = {}; this.listeners = new Map(); this.scrollTop = 0; }
  get children() { return this.childNodes.filter(node => node instanceof Node); }
  get parentElement() { return this.parentNode; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get id() { return this.getAttribute('id') || ''; }
  get dataset() { return Object.fromEntries([...this.attributes].filter(([key]) => key.startsWith('data-')).map(([key,value]) => [key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value])); }
  get hidden() { return this.attributes.has('hidden'); }
  set hidden(value) { value ? this.setAttribute('hidden','') : this.removeAttribute('hidden'); }
  get classList() { const self=this; return {contains:name=>(self.getAttribute('class')||'').split(/\s+/).includes(name),toggle(name,force){const classes=new Set((self.getAttribute('class')||'').split(/\s+/).filter(Boolean));const add=force===undefined?!classes.has(name):force;add?classes.add(name):classes.delete(name);self.setAttribute('class',[...classes].join(' '));return add;},add(...names){for(const name of names)this.toggle(name,true);},remove(...names){for(const name of names)this.toggle(name,false);}}; }
  get disabled() { return this.attributes.has('disabled'); }
  get isConnected() { return this === this.state.root || !!this.parentNode?.isConnected; }
  get value() { if (this.localName === 'select') return (this.options.find(option => option.selected) || (!this._noSelection && this.options[0]))?.value || ''; return this._value ?? this.getAttribute('value') ?? ''; }
  set value(value) { this._value = String(value); if (this.localName === 'select') { for (const option of this.options) option.selected = option.value === this._value; this._noSelection = !this.options.some(option => option.selected); } }
  get options() { return this.querySelectorAll('option'); }
  get label() { return this.getAttribute('label') ?? this.textContent; }
  get selected() { return this.attributes.has('selected'); }
  set selected(value) { value ? this.setAttribute('selected','') : this.removeAttribute('selected'); }
  get open() { return this.attributes.has('open'); }
  set open(value) { value ? this.setAttribute('open','') : this.removeAttribute('open'); }
  get textContent() { return this.childNodes.map(node => node instanceof Node ? node.textContent : node).join(''); }
  set textContent(value) { this.replaceChildren(String(value)); }
  setAttribute(name,value) { this.attributes.set(name,String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type,listener) { if (!this.listeners.has(type)) this.listeners.set(type,new Set()); this.listeners.get(type).add(listener); }
  removeEventListener(type,listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) { event.target ??= this; for (const listener of this.listeners.get(event.type) || []) listener(event); if (event.bubbles) this.parentNode?.dispatchEvent(event); return true; }
  disconnect() { if (this.popoverOpen) { this.popoverOpen = false; this.state.popoverCloses++; } for (const child of this.children) child.disconnect(); if (this.state.activeElement === this) this.state.activeElement = null; }
  remove() { if (!this.parentNode) return; this.disconnect(); this.parentNode.childNodes = this.parentNode.childNodes.filter(node => node !== this); this.parentNode = null; }
  appendChild(node) { if (node instanceof Node) { node.remove(); node.parentNode = this; } this.childNodes.push(node); return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  replaceChildren(...nodes) { for (const child of this.children) { child.disconnect(); child.parentNode = null; } this.childNodes = []; this.append(...nodes); }
  replaceWith(node) { const parent = this.parentNode; if (!parent) return; const index = parent.childNodes.indexOf(this); this.disconnect(); this.parentNode = null; if (node instanceof Node) { node.remove(); node.parentNode = parent; } parent.childNodes.splice(index,1,node); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector) {
    if (selector === ':popover-open') return !!this.popoverOpen;
    if (selector === ':focus') return this.state.activeElement === this;
    if (selector.endsWith(':last-child')) { if (this.parentElement?.children.at(-1) !== this) return false; selector = selector.slice(0,-11); }
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']*)["']?)?\]/g)];
    let rest = selector.replace(/\[[^\]]*\]/g,'');
    for (const [,name,value] of attrs) if (!this.attributes.has(name) || value !== undefined && this.getAttribute(name) !== value) return false;
    const id = rest.match(/#([\w-]+)/)?.[1]; if (id && this.id !== id) return false;
    for (const name of [...rest.matchAll(/\.([\w-]+)/g)].map(match => match[1])) if (!(this.getAttribute('class') || '').split(/\s+/).includes(name)) return false;
    rest = rest.replace(/[#.][\w-]+/g,'');
    return !rest || rest === '*' || this.localName === rest;
  }
  querySelectorAll(selector) { const alternatives = selector.split(',').map(item => item.trim()); const all = []; const visit = root => { for (const child of root.children) { all.push(child); visit(child); } }; visit(this); return all.filter(node => alternatives.some(item => { const parts = item.replace(/>/g,' > ').split(/\s+/); if (!node.matches(parts.pop())) return false; let parent = node.parentNode; while (parts.length) { const direct = parts.at(-1) === '>'; if (direct) parts.pop(); const part = parts.pop(); if (direct) { if (!parent?.matches(part)) return false; } else { while (parent && !parent.matches(part)) parent = parent.parentNode; if (!parent) return false; } parent = parent.parentNode; } return true; })); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  getElementById(id) { return this.querySelectorAll('[id]').find(node => node.id === id) || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  getBoundingClientRect() { return {left:20,right:490,top:200,bottom:244,width:470,height:this.id === 'filter-panel' ? 380 : 44}; }
  focus() { this.state.activeElement = this; this.state.focusCalls.push(this); if (this.localName === 'select') this.state.selectFocuses++; }
  showPopover() { if (!this.popoverOpen) { this.popoverOpen = true; this.state.popoverOpens++; } }
  hidePopover() { if (this.popoverOpen) { this.popoverOpen = false; this.state.popoverCloses++; } }
  get outerHTML() { const attrs = [...this.attributes].map(([name,value]) => ` ${name}="${encode(value)}"`).join(''); return `<${this.localName}${attrs}>${voidTags.has(this.localName) ? '' : `${this.innerHTML}</${this.localName}>`}`; }
  get innerHTML() { return this.childNodes.map(node => node instanceof Node ? node.outerHTML : encode(node)).join(''); }
  set innerHTML(html) {
    html = html === null ? '' : String(html);
    if (this.localName === 'select') this._noSelection = false;
    if (this.id === 'app') this.state.appReplacements++;
    this.replaceChildren(); const stack = [this];
    for (const token of html.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g) || []) {
      if (token.startsWith('<!--')) continue;
      if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
      if (!token.startsWith('<')) { stack.at(-1).appendChild(decode(token)); continue; }
      const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
      const element = new Node(tag,this.state);
      for (const match of token.slice(tag.length+1,-1).matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) element.setAttribute(match[1],decode(match[2] ?? match[3] ?? match[4] ?? ''));
      stack.at(-1).appendChild(element);
      if (!voidTags.has(tag) && !token.endsWith('/>')) stack.push(element);
    }
  }
}
globalThis.customElements = {get:name => definitions.get(name),define:(name,Panel)=>definitions.set(name,Panel)};
globalThis.window = {};
globalThis.HTMLElement = class {
  attachShadow() { const state = currentState; const root = new Node('shadow-root',state); state.root = root; Object.defineProperty(root,'activeElement',{get:()=>state.activeElement}); this.shadowRoot = root; }
  getBoundingClientRect() { return {width:window.innerWidth}; }
};
await import('../custom_components/setup_code_manager/www/panel.js');
const Panel = definitions.get('setup-code-manager-panel');
function fixture({desktop=false}={}) {
  const state = currentState = {root:null,activeElement:null,focusCalls:[],selectFocuses:0,popoverOpens:0,popoverCloses:0,appReplacements:0};
  globalThis.window = {innerWidth:desktop?1280:390,innerHeight:844};
  globalThis.document = {createElement:tag => new Node(tag,state)};
  const panel = new Panel(); panel._loading = false; panel._hass = {language:'en'};
  panel._devices = [
    {id:'a',name:'Alpha',location:'Office',archived:false,notes:'',codes:[],links:[{active:true,location:'Office',areas:[{id:'office',name:'Office',floor_id:'upper',floor_name:'Upstairs'}],labels:[]}]},
    {id:'b',name:'Beta',location:'Kitchen',archived:false,notes:'',codes:[],links:[]},
  ];
  panel._renderMain();
  return {panel,state};
}
const control = (panel,field) => panel.shadowRoot.querySelector(`[data-field="${field}"]`);
const renderedRecords = panel => panel.shadowRoot.querySelectorAll('.row-open').map(row => row.dataset.id);
async function openFilters(panel) {
  const trigger = panel.shadowRoot.querySelector('[data-action="toggle-filters"]');
  trigger.focus();
  await panel._onClick({target:trigger});
}
async function refreshDevices(panel,devices) {
  panel._connected = true;
  panel._hass.callWS = async request => {
    assert.equal(request.type,'setup_code_manager/list');
    return {devices,revision:1,instance_id:'test-instance'};
  };
  await panel._refresh(false);
}

test('opening mobile filters keeps native pickers closed until a select is chosen', async () => {
  const {panel,state} = fixture();
  await openFilters(panel);
  assert.equal(panel._filtersOpen,true);
  assert.equal(state.selectFocuses,0,'Opening Filter must not focus a native select and launch its iOS picker.');
  assert.notEqual(panel.shadowRoot.activeElement?.localName,'select');
  assert.equal(panel.shadowRoot.activeElement?.isConnected,true,'Opening filters must retain a connected keyboard-focus target.');
  assert.ok(control(panel,'room-filter'));
});

for (const [field,value] of [['room-filter','room:Office'],['floor-filter','floor:upper']]) {
  test(`${field} selection keeps the same open filter controls without re-opening a native picker`, async () => {
    const {panel,state} = fixture();
    panel._filtersOpen = true; panel._advancedFiltersOpen = true; panel._renderMain();
    const section = panel.shadowRoot.getElementById('filter-panel'), select = control(panel,field);
    // Native interaction already focuses the original select; selecting an item
    // must not subsequently focus a replacement select from a rebuilt form.
    state.activeElement = select; select.value = value;
    panel._onChange({target:select});
    assert.deepEqual(panel._visibleDevices().map(record => record.id),['a']);
    assert.deepEqual(renderedRecords(panel),['a'],'The displayed results must update while preserving the controls.');
    assert.equal(panel.shadowRoot.getElementById('filter-panel') === section,true,'Choosing a filter must preserve the live filter panel.');
    assert.equal(control(panel,field) === select,true,'Choosing a filter must preserve its native select node.');
    assert.equal(state.selectFocuses,0,'A completed selection must not launch the native picker again.');
    assert.equal(panel.shadowRoot.activeElement === select,true,'Keyboard focus stays on the original select without another focus call.');
    assert.equal(select.isConnected,true);
  });
}

test('desktop filter changes leave the existing top-layer popover open without hide/show', async () => {
  const {panel,state} = fixture({desktop:true});
  panel._filtersOpen = true; panel._renderMain();
  assert.equal(state.popoverOpens,1);
  const section = panel.shadowRoot.getElementById('filter-panel'), select = control(panel,'room-filter');
  state.activeElement = select; select.value = 'room:Office';
  panel._onChange({target:select});
  assert.deepEqual(panel._visibleDevices().map(record => record.id),['a']);
  assert.deepEqual(renderedRecords(panel),['a']);
  assert.equal(panel.shadowRoot.getElementById('filter-panel') === section,true,'The same desktop popover must stay connected.');
  assert.equal(section.popoverOpen,true);
  assert.equal(state.popoverCloses,0,'Filtering must not remove or hide the open popover.');
  assert.equal(state.popoverOpens,1,'Filtering must not create and show another popover.');
});

test('background HA refresh updates records without replacing an active picker or its unchanged options', async () => {
  const {panel,state} = fixture({desktop:true});
  await openFilters(panel);
  const section = panel.shadowRoot.getElementById('filter-panel');
  const select = control(panel,'room-filter');
  const options = [...select.options];
  state.activeElement = select;
  const devices = panel._devices.map(record => record.id === 'a' ? {...record,name:'Alpha updated'} : record);
  await refreshDevices(panel,devices);
  assert.equal(panel.shadowRoot.querySelector('.row-open').textContent,'Alpha updated');
  assert.equal(panel.shadowRoot.getElementById('filter-panel') === section,true);
  assert.equal(control(panel,'room-filter') === select,true);
  assert.equal(select.options.every((option,index) => option === options[index]),true,'Unchanged options must remain connected during a native selection.');
  assert.equal(panel.shadowRoot.activeElement === select,true);
  assert.equal(state.selectFocuses,0);
  assert.equal(state.popoverCloses,0);
  assert.equal(state.popoverOpens,1);
});

for (const desktop of [false,true]) {
  test(`${desktop ? 'desktop' : 'mobile'} viewport-height changes preserve live controls and picker focus`, async () => {
    const {panel,state} = fixture({desktop});
    await openFilters(panel);
    const section = panel.shadowRoot.getElementById('filter-panel');
    const select = control(panel,'room-filter');
    const appReplacements = state.appReplacements;
    state.activeElement = select;
    window.innerHeight = 500;
    panel._resizeFilters();
    assert.equal(panel.shadowRoot.getElementById('filter-panel') === section,true);
    assert.equal(control(panel,'room-filter') === select,true);
    assert.equal(panel.shadowRoot.activeElement === select,true);
    assert.equal(state.appReplacements,appReplacements);
    assert.equal(state.selectFocuses,0);
    assert.equal(state.popoverCloses,0);
    assert.equal(state.popoverOpens,desktop ? 1 : 0);
    if (desktop) assert.equal(section.style.maxHeight,'236px');
  });
}

test('crossing the inline filter breakpoint preserves form nodes and performs one necessary top-layer transition', async () => {
  const {panel,state} = fixture({desktop:true});
  await openFilters(panel);
  const section = panel.shadowRoot.getElementById('filter-panel');
  const select = control(panel,'room-filter');
  state.activeElement = select;
  window.innerWidth = 390;
  panel._resizeFilters();
  assert.equal(panel.shadowRoot.getElementById('filter-panel') === section,true);
  assert.equal(control(panel,'room-filter') === select,true);
  assert.equal(section.classList.contains('inline'),true);
  assert.equal(section.getAttribute('popover'),null);
  assert.equal(section.hidden,false);
  assert.equal(panel._filtersOpen,true);
  assert.equal(state.popoverCloses,1);
  assert.equal(state.popoverOpens,1);
  // Native toggle events from changing presentation must not close the inline form.
  section.dispatchEvent({type:'toggle',newState:'closed'});
  assert.equal(panel._filtersOpen,true);
  window.innerWidth = 1280;
  panel._resizeFilters();
  assert.equal(panel.shadowRoot.getElementById('filter-panel') === section,true);
  assert.equal(control(panel,'room-filter') === select,true);
  assert.equal(section.classList.contains('floating'),true);
  assert.equal(section.popoverOpen,true);
  assert.equal(section.hidden,false);
  assert.equal(state.popoverCloses,1);
  assert.equal(state.popoverOpens,2);
  assert.equal(state.selectFocuses,0,'A responsive presentation change must not explicitly launch a select picker.');
});

test('metadata options defer changes until the active native select loses focus', async () => {
  const {panel,state} = fixture({desktop:true});
  await openFilters(panel);
  const section = panel.shadowRoot.getElementById('filter-panel');
  const select = control(panel,'room-filter');
  const options = [...select.options];
  state.activeElement = select;
  await refreshDevices(panel,[...panel._devices,{id:'c',name:'Gamma',location:'Garage',archived:false,codes:[],links:[]}]);
  assert.deepEqual(renderedRecords(panel),['a','b','c'],'Records should update while the picker options remain stable.');
  assert.equal(control(panel,'room-filter') === select,true);
  assert.equal(select.options.length,options.length);
  assert.equal(select.options.every((option,index) => option === options[index]),true);
  assert.equal(select.options.some(option => option.value === 'room:Garage'),false);
  const trigger = panel.shadowRoot.querySelector('[data-action="toggle-filters"]');
  state.activeElement = trigger;
  select.dispatchEvent({type:'focusout',bubbles:true});
  await Promise.resolve();
  assert.equal(control(panel,'room-filter') === select,true);
  assert.equal(select.options.some(option => option.value === 'room:Garage'),true,'New metadata must become available after the native picker is left.');
  assert.equal(panel.shadowRoot.activeElement === trigger,true);
  assert.equal(select.isConnected,true);
  assert.equal(panel.shadowRoot.getElementById('filter-panel') === section,true);
  assert.equal(state.selectFocuses,0);
  assert.equal(state.popoverCloses,0);
  assert.equal(state.popoverOpens,1);
});

test('HA language changes translate retained filter and tab labels without reopening the active native picker', async () => {
  const {panel,state} = fixture({desktop:true});
  await openFilters(panel);
  const section = panel.shadowRoot.getElementById('filter-panel');
  const tabs = panel.shadowRoot.getElementById('inventory-tabs');
  const select = control(panel,'room-filter');
  const de = translator('de');
  assert.notEqual(section.getAttribute('aria-label'),de('filters'));
  assert.notEqual(tabs.getAttribute('aria-label'),de('device'));
  state.activeElement = select;
  panel._started = true;
  panel.hass = {language:'de'};
  assert.equal(panel.shadowRoot.getElementById('filter-panel') === section,true);
  assert.equal(panel.shadowRoot.getElementById('inventory-tabs') === tabs,true);
  assert.equal(control(panel,'room-filter') === select,true);
  assert.equal(section.getAttribute('aria-label'),de('filters'));
  assert.equal(tabs.getAttribute('aria-label'),de('device'));
  assert.equal(panel.shadowRoot.activeElement === select,true);
  assert.equal(state.selectFocuses,0);
  assert.equal(state.popoverCloses,0);
  assert.equal(state.popoverOpens,1);
});
