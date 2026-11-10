/** Download an already generated PDF without opening a popup or print dialog. */
export const MAX_PDF_RECORDS = 100;
export const MAX_PDF_BYTES = 8 * 1024 * 1024;
export const PDF_URL_LIFETIME_MS = 60000;
const invalid = () => Object.assign(new Error('Invalid PDF response.'), {code:'invalid_pdf'});

export function downloadPDF(result, {expectedCount, host = globalThis.window} = {}) {
  if (!result || result.mime !== 'application/pdf' || result.encoding !== 'base64'
    || !Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > MAX_PDF_RECORDS || result.count !== expectedCount
    || typeof result.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}\.pdf$/.test(result.filename)
    || !Number.isSafeInteger(result.byte_length) || result.byte_length < 1 || result.byte_length > MAX_PDF_BYTES
    || typeof result.content !== 'string' || !result.content.length || result.content.length > Math.ceil(MAX_PDF_BYTES / 3) * 4
    || result.content.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(result.content)) throw invalid();
  let binary;
  try { binary = (host?.atob || globalThis.atob)(result.content); }
  catch { throw invalid(); }
  if (binary.length !== result.byte_length || (host?.btoa || globalThis.btoa)(binary) !== result.content
    || !/^%PDF-(?:1\.[0-7]|2\.0)/.test(binary.slice(0,8)) || !/%%EOF[\t \r\n]*$/.test(binary.slice(-64))) throw invalid();
  const bytes = Uint8Array.from(binary,char => char.charCodeAt(0));
  const blob = new (host?.Blob || globalThis.Blob)([bytes],{type:'application/pdf'});
  let url, link, timer;
  try {
    url = host.URL.createObjectURL(blob);
    // Companion apps read blob URLs asynchronously. Keep the object available
    // beyond the click, including navigation into the native download manager.
    timer = host.setTimeout(() => { try { host.URL.revokeObjectURL(url); } catch { /* The browsing context may have ended. */ } },PDF_URL_LIFETIME_MS);
    link = host.document.createElement('a'); link.href = url; link.download = result.filename;
    host.document.body.appendChild(link); link.click();
  } catch {
    try { if (timer !== undefined) host?.clearTimeout?.(timer); if (url) host?.URL?.revokeObjectURL?.(url); } catch { /* Best-effort cleanup after a failed download. */ }
    throw Object.assign(new Error('PDF download could not be started.'),{code:'pdf_download_failed'});
  } finally { try { link?.remove(); } catch { /* Native navigation may already have detached the anchor. */ } }
}
