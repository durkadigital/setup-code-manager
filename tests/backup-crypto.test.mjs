import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptBackup, decryptBackup } from '../custom_components/setup_code_manager/www/backup-crypto.js';

const json = JSON.stringify({name:'Mustergerät', notes:'Größe', devices:[]});
const phrase = 'Nur ein Schlüsselsatz für Tests';

test('secure and local HTTP crypto can restore one another’s files', async () => {
  const native = await encryptBackup(json,phrase);
  const local = await encryptBackup(json,phrase.normalize('NFD'),null);
  assert.notDeepEqual(native,local);
  assert(!new TextDecoder().decode(native).includes('Mustergerät'));
  assert.equal(await decryptBackup(native,phrase,null),json);
  assert.equal(await decryptBackup(local,phrase),json);
});

test('wrong passwords, tampering, unsupported versions and malformed lengths fail', async () => {
  const file = await encryptBackup(json,phrase);
  await assert.rejects(decryptBackup(file,'different passphrase'));
  for (const offset of [0,4,5,9,25,37,file.length-1]) {
    const changed=file.slice(); changed[offset]^=1;
    await assert.rejects(decryptBackup(changed,phrase));
  }
  await assert.rejects(decryptBackup(file.slice(0,32),phrase));
  await assert.rejects(decryptBackup(new Uint8Array(16*1024*1024+54),phrase));
});

test('separate backups have independent salts and nonces', async () => {
  const [a,b] = await Promise.all([encryptBackup(json,phrase),encryptBackup(json,phrase)]);
  assert.notDeepEqual(a.slice(9,25),b.slice(9,25));
  assert.notDeepEqual(a.slice(25,37),b.slice(25,37));
});
