import assert from 'node:assert/strict';
import test from 'node:test';
import {downloadPDF, MAX_PDF_BYTES, PDF_URL_LIFETIME_MS} from '../custom_components/setup_code_manager/www/pdf.js';
const bytes = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n';
const result = (patch={}) => ({mime:'application/pdf',encoding:'base64',filename:'setup-code-manager-cards-synthetic.pdf',byte_length:bytes.length,content:btoa(bytes),count:2,...patch});
function fixture({failure}={}) {
  const state={created:[],revoked:[],timers:[],cleared:[],links:[],appended:0,clicked:0,removed:0};
  const host={Blob,atob,btoa,URL:{createObjectURL(blob){state.created.push(blob);return 'blob:synthetic-pdf';},revokeObjectURL(url){state.revoked.push(url);}},setTimeout(fn,delay){state.timers.push({fn,delay});return state.timers.length;},clearTimeout(id){state.cleared.push(id);},open(){assert.fail('PDF download must not open a popup.');},print(){assert.fail('PDF download must not invoke printing.');},document:{body:{appendChild(){state.appended++;}},createElement(tag){assert.equal(tag,'a');const link={click(){state.clicked++;if(failure)throw new Error('Synthetic private setup code diagnostic');},remove(){state.removed++;}};state.links.push(link);return link;}}};
  return {host,state};
}

test('PDF bytes are downloaded as an attachment with the exact MIME and filename without a new window', async()=>{
  const {host,state}=fixture();
  assert.equal(downloadPDF(result(),{host,expectedCount:2}),undefined);
  assert.equal(state.created.length,1);assert.equal(state.created[0].type,'application/pdf');
  assert.equal(await state.created[0].text(),bytes);
  assert.equal(state.appended,1);assert.equal(state.clicked,1);assert.equal(state.removed,1);
  assert.equal(state.links[0].href,'blob:synthetic-pdf');
  assert.equal(state.links[0].download,'setup-code-manager-cards-synthetic.pdf');
  assert.equal(state.links[0].target,undefined);
  assert.deepEqual(state.revoked,[]);
  assert.equal(state.timers[0].delay,PDF_URL_LIFETIME_MS);assert.ok(PDF_URL_LIFETIME_MS>=10000);
  state.timers[0].fn();assert.deepEqual(state.revoked,['blob:synthetic-pdf']);
});

for(const [name,patch] of [
  ['wrong MIME',{mime:'text/html'}],['wrong encoding',{encoding:'utf8'}],
  ['selection mismatch',{count:1}],['oversized',{byte_length:MAX_PDF_BYTES+1}],
  ['missing byte length',{byte_length:undefined}],['boolean byte length',{byte_length:true}],
  ['length mismatch',{byte_length:bytes.length+1}],['empty bytes',{content:'',byte_length:0}],
  ['invalid base64',{content:'%%%='}],['base64 padding in middle',{content:'AAAA=AAA'}],
  ['noncanonical base64',{content:'Zh==',byte_length:1}],
  ['wrong file header',{content:btoa('<html>Not a PDF</html>%%EOF'),byte_length:25}],
  ['missing EOF',{content:btoa('%PDF-1.4\nmissing'),byte_length:16}],
  ['unsafe name',{filename:'../../private.pdf'}],['wrong extension',{filename:'codes.html'}],
  ['control character in name',{filename:'codes\n.pdf'}],
])test(`${name} cannot create or download a file`,()=>{
  const {host,state}=fixture();
  assert.throws(()=>downloadPDF(result(patch),{host,expectedCount:2}),error=>error.code==='invalid_pdf'&&!error.message.includes('private'));
  assert.equal(state.created.length,0);assert.equal(state.clicked,0);assert.equal(state.timers.length,0);
});

test('a failed native download cleans up both anchor and URL and reports no private diagnostic',()=>{
  const {host,state}=fixture({failure:true});
  assert.throws(()=>downloadPDF(result(),{host,expectedCount:2}),error=>error.code==='pdf_download_failed'&&!error.message.includes('Synthetic private'));
  assert.equal(state.removed,1);assert.deepEqual(state.revoked,['blob:synthetic-pdf']);assert.deepEqual(state.cleared,[1]);
});

test('a large valid PDF response is validated without a recursive base64 expression',()=>{
  const content='%PDF-1.4\n'+ 'a'.repeat(1024*1024)+'\n%%EOF\n';
  const {host,state}=fixture();
  downloadPDF(result({content:btoa(content),byte_length:content.length}),{host,expectedCount:2});
  assert.equal(state.created[0].size,content.length);assert.equal(state.clicked,1);
});
