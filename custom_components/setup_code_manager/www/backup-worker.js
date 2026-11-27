import { encryptBackup, decryptBackup } from './backup-crypto.js';

self.onmessage = async ({data}) => {
  try {
    if (data.action === 'encrypt') {
      const file = await encryptBackup(data.input,data.password);
      self.postMessage({result:file.buffer},[file.buffer]);
    } else if (data.action === 'decrypt') {
      self.postMessage({result:await decryptBackup(data.input,data.password)});
    } else throw new Error('Unknown operation');
  } catch { self.postMessage({failed:true}); }
};
