/** Read printed Matter pairing numbers entirely in the browser. */
const permutation = ['0123456789','1576283049','5803796142','8916043527','9453126870','4286573901','2793806415','7046913258'];

function validManual(digits) {
  if (!/^(?:[0-3]\d{10}|[4-7]\d{20})$/.test(digits)) return false;
  // Verhoeff multiplication in the dihedral group D5.
  let c = 0;
  for (const [i, digit] of [...digits].reverse().entries()) {
    const x = Number(permutation[i % 8][Number(digit)]);
    const rotation = (c % 5 + (c < 5 ? x % 5 : -(x % 5)) + 5) % 5;
    c = rotation + ((c < 5) !== (x < 5) ? 5 : 0);
  }
  if (c !== 0) return false;
  const low = Number(digits.slice(1,6)), high = Number(digits.slice(6,10));
  if (low > 65535 || high > 8191) return false;
  const pin = high * 16384 + (low & 16383);
  if (!pin || pin > 99999998 || /^(\d)\1{7}$/.test(String(pin)) || [12345678,87654321].includes(pin)) return false;
  if (digits.length === 21) {
    const vendor = Number(digits.slice(10,15)), product = Number(digits.slice(15,20));
    if (vendor > 65524 || product > 65535 || (vendor && !product)) return false;
  }
  return true;
}

export function matterCandidates(text) {
  const found = new Set();
  for (const line of text.split(/\r?\n/)) {
    for (const match of line.matchAll(/(?<![\p{L}\d])[0-9](?:[0-9 .\u00a0–-]*[0-9])?(?![\p{L}\d])/gu)) {
      const digits = match[0].replace(/\D/g,'');
      if (validManual(digits)) found.add(digits);
    }
  }
  return [...found];
}

export function formatManual(digits) {
  const groups = digits.length === 21 ? [4,3,3,5,5,1] : [4,3,4];
  let offset = 0;
  return groups.map(size => { const group = digits.slice(offset,offset+size); offset += size; return group; }).join('-');
}

export async function readPrintedMatter(canvas, signal) {
  if (signal?.aborted) throw new DOMException('Cancelled','AbortError');
  // Use a dedicated, directly owned worker so closing the dialog can stop
  // language/core initialization as well as an active recognition job.
  const base = new URL('./vendor/ocr/',import.meta.url);
  const worker = new Worker(new URL('worker.min.js',base));
  let pending, cancelled = false;
  const stopped = () => pending?.reject(new Error('OCR stopped'));
  const cancel = () => { cancelled = true; worker.terminate(); stopped(); };
  worker.onerror = stopped;
  worker.onmessage = ({data}) => {
    if (data.status === 'resolve') pending?.resolve(data.data);
    if (data.status === 'reject') stopped();
  };
  let job = 0;
  function request(action,payload) {
    if (cancelled || signal?.aborted) throw new DOMException('Cancelled','AbortError');
    return new Promise((resolve,reject) => {
      pending = {resolve,reject};
      worker.postMessage({workerId:'photo',jobId:String(++job),action,payload});
    });
  }
  const timer = setTimeout(cancel,60000);
  signal?.addEventListener('abort',cancel,{once:true});
  try {
    const png = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
    if (!png) throw new Error('Cannot read image');
    const image = new Uint8Array(await png.arrayBuffer());
    await request('load',{options:{lstmOnly:true,corePath:new URL('tesseract-core-lstm.wasm.js',base).href}});
    await request('loadLanguage',{langs:'eng',options:{langPath:base.href,cacheMethod:'none',gzip:true,lstmOnly:true}});
    await request('initialize',{langs:'eng',oem:1,config:{}});
    await request('setParameters',{params:{tessedit_pageseg_mode:'11'}});
    const result = await request('recognize',{image,options:{},output:{text:true}});
    return matterCandidates(result.text);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort',cancel);
    worker.terminate();
  }
}
