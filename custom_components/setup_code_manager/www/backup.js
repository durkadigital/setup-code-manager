/** The worker owns each passphrase for exactly one operation. */
export function runBackup(action,input,password,signal) {
  return new Promise((resolve,reject) => {
    const worker = new Worker(new URL('./backup-worker.js',import.meta.url),{type:'module'});
    const finish = (callback,value) => {
      clearTimeout(timer);
      signal.removeEventListener('abort',cancel);
      worker.terminate();
      callback(value);
    };
    const cancel = () => finish(reject,new DOMException('Cancelled','AbortError'));
    const fail = () => finish(reject,new Error('Backup could not be processed'));
    const timer = setTimeout(fail,120000);
    worker.onerror = fail;
    worker.onmessageerror = fail;
    worker.onmessage = ({data}) => data.failed ? fail() : finish(resolve,data.result);
    signal.addEventListener('abort',cancel,{once:true});
    if (signal.aborted) cancel();
    else worker.postMessage({action,input,password},input instanceof ArrayBuffer ? [input] : []);
  });
}
