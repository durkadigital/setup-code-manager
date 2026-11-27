/** Portable SCM backup v1. All multi-byte numbers are big endian. */
const MAGIC = [83,67,77,66,1]; // SCMB, version 1
const COST = 600000;
const HEADER_BYTES = 37, TAG_BYTES = 16;
const MAX_CONTENT = 16 * 1024 * 1024;
export const MAX_BACKUP_BYTES = MAX_CONTENT + HEADER_BYTES + TAG_BYTES;
const encoder = new TextEncoder();

async function transform(encrypt, password, header, input, subtle) {
  const salt = header.subarray(9,25), iv = header.subarray(25,37);
  const secret = encoder.encode(password.normalize('NFC'));
  let key;
  try {
    if (subtle) {
      const material = await subtle.importKey('raw',secret,'PBKDF2',false,['deriveKey']);
      const action = encrypt ? 'encrypt' : 'decrypt';
      const nativeKey = await subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:COST},material,{name:'AES-GCM',length:256},false,[action]);
      return new Uint8Array(await subtle[action]({name:'AES-GCM',iv,additionalData:header,tagLength:128},nativeKey,input));
    }
    const [{pbkdf2},{sha256},{gcm}] = await Promise.all([
      import('./vendor/noble-hashes/pbkdf2.js'),import('./vendor/noble-hashes/sha2.js'),import('./vendor/noble-ciphers/aes.js'),
    ]);
    key = pbkdf2(sha256,secret,salt,{c:COST,dkLen:32});
    const cipher = gcm(key,iv,header);
    return encrypt ? cipher.encrypt(input) : cipher.decrypt(input);
  } finally { secret.fill(0); key?.fill(0); }
}

export async function encryptBackup(text, password, subtle = globalThis.crypto.subtle) {
  if (!password || password.length > 1024 || typeof text !== 'string' || text.length > MAX_CONTENT) throw new Error('Invalid backup');
  const input = encoder.encode(text);
  if (!input.length || input.length > MAX_CONTENT) throw new Error('Invalid backup');
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC); new DataView(header.buffer).setUint32(5,COST);
  globalThis.crypto.getRandomValues(header.subarray(9));
  try {
    const encrypted = await transform(true,password,header,input,subtle);
    const file = new Uint8Array(HEADER_BYTES + encrypted.length);
    file.set(header); file.set(encrypted,HEADER_BYTES);
    return file;
  } finally { input.fill(0); }
}

export async function decryptBackup(file, password, subtle = globalThis.crypto.subtle) {
  const bytes = new Uint8Array(file);
  if (!password || password.length > 1024 || bytes.length <= HEADER_BYTES + TAG_BYTES || bytes.length > MAX_BACKUP_BYTES ||
      !MAGIC.every((byte,i) => byte === bytes[i]) || new DataView(bytes.buffer,bytes.byteOffset).getUint32(5) !== COST) throw new Error('Invalid backup');
  const plain = await transform(false,password,bytes.subarray(0,HEADER_BYTES),bytes.subarray(HEADER_BYTES),subtle);
  try { return new TextDecoder('utf-8',{fatal:true}).decode(plain); }
  finally { plain.fill(0); }
}
