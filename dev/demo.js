/** Explicitly synthetic, memory-only API for exercising the production panel. */
import '../custom_components/setup_code_manager/www/panel.js';
const copy = value => JSON.parse(JSON.stringify(value));
const now = () => new Date().toISOString();
const MATTER = 'MT:Y.K9042C00KA0648G00';
const HOMEKIT = '111-22-333';
const DSK = '12345-23456-34567-45678-56789-01234-02345-03456';
const INSTANCE = 'synthetic-local-preview';
// HA organization is derived for responses and never written into inventory.
const syntheticAreas = {
  Wohnzimmer:{id:'demo-living',floor_id:'demo-ground',floor_name:'Erdgeschoss'},
  Flur:{id:'demo-hall',floor_id:'demo-ground',floor_name:'Erdgeschoss'},
  Küche:{id:'demo-kitchen',floor_id:'demo-ground',floor_name:'Erdgeschoss'},
  Arbeitszimmer:{id:'demo-office',floor_id:'demo-upper',floor_name:'Obergeschoss'},
  Büro:{id:'demo-study',floor_id:'demo-upper',floor_name:'Obergeschoss'},
  Schlafzimmer:{id:'demo-bedroom',floor_id:'demo-upper',floor_name:'Obergeschoss'},
};
const syntheticLabels = {
  'ha-1':[{id:'demo-energy',name:'Energie'}],
  'ha-2':[{id:'demo-lighting',name:'Beleuchtung'}],
  'ha-3':[{id:'demo-security',name:'Sicherheit'}],
  'ha-4':[{id:'demo-climate',name:'Raumklima'}],
  'ha-5':[{id:'demo-energy',name:'Energie'}],
  'ha-6':[{id:'demo-lighting',name:'Beleuchtung'}],
  'ha-9':[{id:'demo-lighting',name:'Beleuchtung'}],
};
const organizationFromHA = device => ({
  areas:device.location ? [{name:device.location,...(syntheticAreas[device.location] || {
    id:`demo-area-${device.location.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/[^a-z0-9]+/g,'_') || 'other'}`,
    floor_id:'',floor_name:'',
  })}] : [],
  labels:copy(syntheticLabels[device.id] || []),
});
const fields = ['id','name','manufacturer','model','serial_number','location','notes','archived','created_at','updated_at','links','source_refs'];
const csvFields = ['format','schema_version','instance_id','revision','row_type',...fields,'code_id','protocol','value','label'];
const code = (id,protocol,value) => ({id,protocol,value,label:'Originalcode'});
const storedCode = ({id,protocol,value,label}) => ({id,protocol,value,label});
const record = (id,name,location,manufacturer,model,codes,links=[],archived=false) => ({id,name,location,manufacturer,model,serial_number:'',notes:id === 'demo-1' ? 'Aufkleber auf der Unterseite.' : '',codes,links:links.map(ha_device_id => ({ha_device_id})),archived,created_at:'2026-11-07T10:00:00+00:00',updated_at:'2026-11-07T10:00:00+00:00',source_refs:[]});
const initial = [
  record('demo-1','Steckdose Sofa','Wohnzimmer','Eve','Energy',[code('c-1','matter',MATTER),code('c-2','homekit',HOMEKIT)],['ha-1']),
  record('demo-2','Schreibtischlampe','Arbeitszimmer','IKEA','KAJPLATS',[]),
  record('demo-3','Türsensor','Flur','Aeotec','Door / Window Sensor',[code('c-3','zwave',DSK)],['ha-3']),
  record('demo-4','Heizkörper Büro','Büro','Eve','Thermo',[code('c-4','matter','3497-011-2332')],['ha-4']),
  record('demo-5','Zwischenstecker Küche','Küche','Shelly','Wave Plug',[code('c-5','zwave',DSK)],['ha-5']),
  record('demo-6','Stehleuchte','Wohnzimmer','Nanoleaf','Essentials',[]),
  record('demo-7','Steckdose Gästezimmer','Gästezimmer','Eve','Energy',[code('c-7','homekit','234-56-789')],[],true),
  record('demo-8','Sensor Abstellraum','Abstellraum','Aeotec','Sensor',[],[],true),
];
const haInitial = [
  {id:'ha-1',name:'Steckdose Sofa',location:'Wohnzimmer',manufacturer:'Eve',model:'Energy',serial_number:'SYNTHETIC-001',protocols:['matter','homekit'],integration_names:['Matter','HomeKit Device'],available:true},
  {id:'ha-2',name:'Schreibtischlampe',location:'Arbeitszimmer',manufacturer:'IKEA',model:'KAJPLATS',serial_number:'',protocols:['matter'],integration_names:['Matter'],available:true},
  {id:'ha-3',name:'Türsensor',location:'Flur',manufacturer:'Aeotec',model:'Door / Window Sensor',serial_number:'',protocols:['zwave'],integration_names:['Z-Wave JS'],available:true},
  {id:'ha-4',name:'Heizkörper Büro',location:'Büro',manufacturer:'Eve',model:'Thermo',serial_number:'',protocols:['matter'],integration_names:['Matter'],available:false},
  {id:'ha-5',name:'Zwischenstecker Küche',location:'Küche',manufacturer:'Shelly',model:'Wave Plug',serial_number:'',protocols:['zwave'],integration_names:['Z-Wave JS'],available:true},
  {id:'ha-6',name:'Stehleuchte',location:'Wohnzimmer',manufacturer:'Nanoleaf',model:'Essentials',serial_number:'',protocols:['homekit'],integration_names:['HomeKit Device'],available:true},
  {id:'ha-9',name:'Leselampe',location:'Schlafzimmer',manufacturer:'Philips',model:'Hue White',serial_number:'',protocols:[],integration_names:['Hue'],via_device_id:'ha-bridge',available:true},
  {id:'ha-bridge',name:'Hue Bridge',location:'Flur',manufacturer:'Philips',model:'Bridge',serial_number:'',protocols:['matter'],integration_names:['Hue','Matter'],available:true},
];
// Maximum-length identity fields and long notes exercise the bounded detail pane.
if (new URLSearchParams(location.search).get('layout-test') === 'long') {
  initial[0].name = 'Steckdose mit sehr langem Gerätenamen '.repeat(8).slice(0, 256);
  initial[0].location = 'Beispielraum '.repeat(24).slice(0, 256);
  initial[0].model = 'Beispielmodell '.repeat(24).slice(0, 256);
  initial[0].notes = 'Lange synthetische Notiz für den Scrolltest.\n'.repeat(30);
  initial[0].codes.push(code('c-long', 'zwave', DSK));
  haInitial[0].name = initial[0].name;
  haInitial[0].location = initial[0].location;
}
let devices = copy(initial), haDevices = copy(haInitial), revision = 1;
const subscribers = new Set(), previews = new Map();
const failure = code => { throw {code,message:code}; };
const emit = () => subscribers.forEach(fn => fn({event_type:'setup_code_manager_updated'}));
const ensureRevision = expected => { if (expected !== revision) failure('conflict'); };
const identityFromHA = item => {
  const active = (item.links || []).map(link => haDevices.find(device => device.id === link.ha_device_id)).filter(Boolean);
  if (!active.length) return {};
  const combined = key => [...new Set(active.map(device => device[key]).filter(Boolean))].sort((a,b) => a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0).join(' / ').slice(0,256);
  return {name:combined('name'),location:combined('location')};
};
const syncIdentities = () => { for (const item of devices) Object.assign(item,identityFromHA(item)); };
const updateHADevice = (id,changes) => {
  const device = haDevices.find(item => item.id === id);
  if (!device) return false;
  Object.assign(device,changes);syncIdentities();revision++;emit();return true;
};
const decorated = data => data.map(item => {
  const links = item.links.map(link => {const ha = haDevices.find(d => d.id === link.ha_device_id);return {...link,active:!!ha,name:ha?.name || '',location:ha?.location || '',available:!!ha && ha.available,...(ha ? organizationFromHA(ha) : {areas:[],labels:[]})};});
  // Only this known synthetic payload has a precomputed manual equivalent.
  const codes = item.codes.map(c => ({...storedCode(c),...(c.protocol === 'matter' && c.value === MATTER ? {manual_value:'34970112332'} : {})}));
  return {...copy(item),...identityFromHA(item),codes,links,linked:links.some(link => link.active),available:links.some(link => link.active && link.available),protocols:[...new Set([...item.codes.map(c => c.protocol),...links.flatMap(link => haDevices.find(d => d.id === link.ha_device_id)?.protocols || [])])]};
});
const csvCell = value => `"${String(value ?? '').replaceAll('"','""')}"`;
const exportCSV = (records = devices) => {
  const base = {format:'setup-code-manager',schema_version:'1',instance_id:INSTANCE,revision:String(revision)};
  const rows = [{...base,row_type:'metadata'}];
  for (const item of records) {
    const common = {...base,...item,archived:String(item.archived),links:JSON.stringify(item.links),source_refs:JSON.stringify(item.source_refs)};
    if (!item.codes.length) rows.push({...common,row_type:'record'});
    for (const c of item.codes) rows.push({...common,row_type:'code',code_id:c.id,protocol:c.protocol,value:c.value,label:c.label});
  }
  return [csvFields.map(csvCell).join(','),...rows.map(row => csvFields.map(field => csvCell("'" + (row[field] ?? ''))).join(','))].join('\r\n')+'\r\n';
};
const parseCSV = content => {
  const rows = []; let row=[], value='', quoted=false;
  for (let i=0;i<content.length;i++) {
    const ch = content[i];
    if (ch === '"') { if (quoted && content[i+1] === '"') {value+='"';i++;} else quoted=!quoted; }
    else if (ch === ',' && !quoted) {row.push(value);value='';}
    else if ((ch === '\n' || ch === '\r') && !quoted) { if(ch === '\r' && content[i+1] === '\n') i++;row.push(value);if(row.some(Boolean)) rows.push(row);row=[];value='';}
    else value+=ch;
  }
  if (value || row.length) {row.push(value);rows.push(row);}
  if (quoted || JSON.stringify(rows.shift()) !== JSON.stringify(csvFields)) failure('validation_error');
  const objects=rows.map(cells=>Object.fromEntries(csvFields.map((key,i)=>[key,String(cells[i] || '').replace(/^'/,'')])));
  if (objects[0]?.row_type !== 'metadata' || objects[0]?.schema_version !== '1') failure('validation_error');
  const result = new Map();
  for(const row of objects.slice(1)) {
    if(!result.has(row.id)) result.set(row.id,{...Object.fromEntries(fields.map(key=>[key,row[key]])),archived:row.archived === 'true',links:row.instance_id === INSTANCE ? JSON.parse(row.links || '[]') : [],source_refs:JSON.parse(row.source_refs || '[]'),codes:[]});
    if(row.row_type === 'code') result.get(row.id).codes.push({id:row.code_id,protocol:row.protocol,value:row.value,label:row.label});
  }
  return [...result.values()];
};
const canonical = data => JSON.stringify(Object.fromEntries([...fields,'codes'].filter(key => !['created_at','updated_at'].includes(key)).map(key => [key,data[key]])));
const legacy = () => [copy(initial[0]),copy(initial[2]),{...copy(initial[4]),codes:[code('c-5','zwave','23456-23456-34567-45678-56789-01234-02345-03456')]},record('legacy-1','Leselampe Bett','Schlafzimmer','IKEA','KAJPLATS',[code('lc-1','matter',MATTER)]),record('legacy-2','Türsensor Keller','Keller','Aeotec','Sensor',[code('lc-2','zwave',DSK)]),record('legacy-3','Tischleuchte','Büro','Nanoleaf','Essentials',[code('lc-3','homekit',HOMEKIT)])];
async function callWS(message) {
  // Inventory examples remain in memory; the panel may remember view settings separately.
  await new Promise(resolve => setTimeout(resolve,120));
  const command = message.type.replace('setup_code_manager/','');
  if(command === 'list') return {devices:decorated(devices),revision,instance_id:INSTANCE,legacy_available:true};
  if(command === 'ha_devices') return {devices:haDevices.map(device=>({...copy(device),...organizationFromHA(device),record_ids:devices.filter(record=>record.links.some(link=>link.ha_device_id === device.id)).map(record=>record.id)}))};
  if(command === 'save') {
    ensureRevision(message.expected_revision);
    const draft=copy(message.record);const old=devices.find(item=>item.id === draft.id);
    Object.assign(draft,identityFromHA(draft));
    if(!draft.name?.trim() || draft.codes.length > 3 || new Set(draft.codes.map(c=>c.protocol)).size !== draft.codes.length) failure('validation_error');
    for(const c of draft.codes) if(!['matter','homekit','zwave'].includes(c.protocol) || !c.value?.trim()) failure('invalid_code');
    for(const link of draft.links || []) {
      if(!haDevices.some(device=>device.id === link.ha_device_id) && (link.active === true || !old?.links.some(item=>item.ha_device_id === link.ha_device_id))) failure('device_removed');
      if(devices.some(record=>record.id !== draft.id && record.links.some(item=>item.ha_device_id === link.ha_device_id))) failure('duplicate_link');
    }
    draft.id ||= crypto.randomUUID();draft.created_at=old?.created_at || now();draft.updated_at=now();draft.source_refs=copy(old?.source_refs || []);draft.archived=old?.archived || false;
    draft.links=(draft.links || []).map(({ha_device_id})=>({ha_device_id}));
    draft.codes=draft.codes.map(storedCode);
    const index=devices.findIndex(item=>item.id === draft.id);if(index<0) devices.push(draft);else devices[index]=draft;
    revision++;emit();return copy(draft);
  }
  if(command === 'archive' || command === 'delete') {
    ensureRevision(message.expected_revision);const found=devices.find(item=>item.id === message.record_id);if(!found) failure('validation_error');
    if(command === 'delete') devices=devices.filter(item=>item !== found);else {found.archived=message.archived;found.updated_at=now();}
    revision++;emit();return {};
  }
  if(command === 'export') {
    if(!['json','csv'].includes(message.format)) failure('validation_error');
    const selected=message.record_ids !== undefined;
    let records=devices;
    if(selected) {
      const ids=message.record_ids;
      if(!Array.isArray(ids) || !ids.length || ids.length>10000 || ids.some(id=>typeof id !== 'string' || id.trim() !== id || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) || new Set(ids).size !== ids.length) failure('validation_error');
      const requested=new Set(ids);
      if(ids.some(id=>!devices.some(item=>item.id === id))) failure('not_found');
      records=devices.filter(item=>requested.has(item.id));
    }
    return {filename:`setup-code-manager-${selected ? 'selected-' : ''}DEMO.${message.format}`,mime:message.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json',count:records.length,scope:selected ? 'selected' : 'all',content:message.format === 'csv' ? exportCSV(records) : JSON.stringify({format:'setup-code-manager',schema_version:1,instance_id:INSTANCE,revision,devices:records},null,2)};
  }
  if(command === 'preview_import') {
    let incoming;
    if(message.format === 'legacy') incoming=legacy();
    else if(message.format === 'csv') incoming=parseCSV(message.content);
    else {let envelope;try{envelope=JSON.parse(message.content);}catch{failure('validation_error');}if(envelope.format !== 'setup-code-manager' || envelope.schema_version !== 1 || !Array.isArray(envelope.devices)) failure('validation_error');incoming=envelope.devices.map(item=>({...item,links:envelope.instance_id === INSTANCE ? item.links : []}));}
    const token=crypto.randomUUID();
    const rows=incoming.map((item,index)=>{const existing=devices.find(record=>record.id === item.id);const valid=!!item.id && !!item.name && Array.isArray(item.codes);return {key:String(index),id:item.id,name:item.name,status:!valid ? 'invalid' : !existing ? 'new' : canonical(item) === canonical(existing) ? 'unchanged' : 'conflict',existing:existing ? copy(existing) : undefined,incoming:copy(item)};});
    const preview={token,revision,rows,counts:{}};previews.set(token,preview);return copy(preview);
  }
  if(command === 'import') {
    ensureRevision(message.expected_revision);const preview=previews.get(message.token);if(!preview || preview.revision !== revision) failure('conflict');
    const next=copy(devices);let imported=0,skipped=0;
    for(const row of preview.rows) {const decision=message.decisions[row.key];if(decision === 'add' && row.status === 'new') {next.push(copy(row.incoming));imported++;}else if(decision === 'replace' && row.status === 'conflict') {next[next.findIndex(item=>item.id === row.id)]=copy(row.incoming);imported++;}else skipped++;}
    devices=next;revision++;previews.delete(message.token);emit();return {imported,skipped};
  }
  failure('not_loaded');
}
const panel=document.querySelector('setup-code-manager-panel');
const hass={language:'de',user:{id:'synthetic-admin',is_admin:true},callWS,connection:{subscribeEvents:async fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);}}};
panel.hass=hass;panel.narrow=innerWidth<800;
window.addEventListener('resize',()=>{panel.narrow=innerWidth<800;});
document.getElementById('language').addEventListener('change',event=>{panel.hass={...hass,language:event.target.value};});
document.getElementById('theme').addEventListener('click',()=>{const dark=!document.documentElement.classList.contains('dark');document.documentElement.classList.toggle('dark',dark);document.documentElement.classList.toggle('light',!dark);});
document.getElementById('reset').addEventListener('click',()=>{location.reload();});
document.getElementById('concurrent').addEventListener('click',()=>{devices[0].notes='Beispiel einer parallelen Änderung.';devices[0].updated_at=now();revision++;emit();});
// Readable, explicitly demo-only controls for repeatable browser acceptance checks.
window.setupCodeManagerDemo={callWS,snapshot:()=>({devices:copy(devices),revision}),removeHADevice:id=>{syncIdentities();haDevices=haDevices.filter(item=>item.id !== id);syncIdentities();revision++;emit();},renameHADevice:(id,name)=>updateHADevice(id,{name}),setHAArea:(id,location)=>updateHADevice(id,{location}),concurrentChange:()=>{devices[0].notes='Parallel bearbeitet';revision++;emit();}};
