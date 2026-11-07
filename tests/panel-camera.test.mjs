import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Exercise the production element and scanner with a small DOM surface. These
// tests never access a device, open a real picker, or decode a personal image.
const classes = new Map();
globalThis.customElements = {
  get: name => classes.get(name),
  define: (name, element) => classes.set(name, element),
};
globalThis.window = new EventTarget();
globalThis.window.setTimeout = setTimeout;
globalThis.window.clearTimeout = clearTimeout;
globalThis.HTMLElement = class {
  attachShadow() {
    this.shadowRoot = {
      addEventListener() {},
      appendChild(input) { input.attached = true; },
      getElementById() { return null; },
      querySelector() { return null; },
    };
  }
};
const www = new URL('../custom_components/setup_code_manager/www/', import.meta.url);
globalThis.jsQR = createRequire(import.meta.url)(fileURLToPath(new URL('vendor/jsQR.js', www)));
await import(new URL('panel.js', www));
const Panel = classes.get('setup-code-manager-panel');

function replaceGlobal(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
}

function panelWithModalObserver() {
  const panel = new Panel();
  const modals = [];
  panel._openModal = kind => { modals.push(kind); panel._modal = { kind }; };
  return { panel, modals };
}

for (const [name, secure, hasMedia] of [
  ['HTTP even when a media API is exposed', false, true],
  ['HTTPS without mediaDevices', true, false],
  ['HTTPS without getUserMedia', true, 'empty'],
]) {
  test(`${name} opens native photo capture during the original action`, async t => {
    replaceGlobal(t, 'isSecureContext', secure);
    let mediaRequests = 0;
    const getUserMedia = () => { mediaRequests++; return Promise.reject(new Error('must not run')); };
    replaceGlobal(t, 'navigator', hasMedia === true ? { mediaDevices: { getUserMedia } } : hasMedia === 'empty' ? { mediaDevices: {} } : {});
    const { panel, modals } = panelWithModalObserver();
    const photos = [];
    panel._choosePhoto = (...args) => photos.push(args);
    const pending = panel._startCamera('matter');
    // Deliberately inspect before awaiting: deferring this loses user activation
    // for the native file/camera picker on mobile browsers.
    assert.deepEqual(photos, [['matter', true]]);
    assert.deepEqual(modals, []);
    assert.equal(mediaRequests, 0);
    await pending;
  });
}

test('HTTPS with mediaDevices keeps the real scanner path', async t => {
  replaceGlobal(t, 'isSecureContext', true);
  let mediaRequests = 0;
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia: async () => {
    mediaRequests++;
    throw Object.assign(new Error('synthetic permission refusal'), { name: 'NotAllowedError' });
  } } });
  const document = new EventTarget();
  document.defaultView = globalThis.window;
  replaceGlobal(t, 'document', document);
  const { panel, modals } = panelWithModalObserver();
  const frame = { hidden: false, setAttribute(name) { if (name === 'hidden') this.hidden = true; } };
  const status = { hidden: false, setAttribute(name) { if (name === 'hidden') this.hidden = true; } };
  const error = { innerHTML: '' };
  panel.shadowRoot.querySelector = selector => selector === '.scanner-frame' ? frame : null;
  panel.shadowRoot.getElementById = id => ({ 'scan-video': { ownerDocument: document, isConnected: true }, 'scanner-error': error, 'camera-status': status })[id] || null;
  const photos = [];
  panel._choosePhoto = (...args) => photos.push(args);
  await panel._startCamera('homekit');
  assert.deepEqual(modals, ['scanner']);
  assert.deepEqual(photos, []);
  assert.equal(mediaRequests, 1);
  assert.equal(panel._activeProtocol, 'homekit');
  assert.equal(frame.hidden, true);
  assert.equal(status.hidden, true);
  assert.match(error.innerHTML, /Camera access was denied/);
  panel._stopCamera();
});

function filePickerDOM(t) {
  const inputs = [];
  replaceGlobal(t, 'document', { createElement(tag) {
    assert.equal(tag, 'input');
    const input = new EventTarget();
    input.style = {};
    input.attributes = new Map();
    input.setAttribute = (name, value) => input.attributes.set(name, value);
    input.getAttribute = name => input.attributes.get(name) ?? null;
    input.click = () => { input.clicked = true; };
    input.remove = () => { input.removed = true; };
    inputs.push(input);
    return input;
  } });
  return inputs;
}

test('capture picker requests rear camera and still delivers the selected file', t => {
  const inputs = filePickerDOM(t);
  const panel = new Panel();
  const received = [];
  panel._chooseFile('image/*', file => received.push(file), { capture: true });
  const [input] = inputs;
  assert.equal(input.type, 'file');
  assert.equal(input.accept, 'image/*');
  assert.equal(input.capture ?? input.getAttribute('capture'), 'environment');
  assert.equal(input.attached, true);
  assert.equal(input.clicked, true);
  const synthetic = { name: 'synthetic.png', size: 1, type: 'image/png' };
  input.files = [synthetic];
  input.dispatchEvent(new Event('change'));
  input.dispatchEvent(new Event('change'));
  assert.equal(input.removed, true);
  assert.deepEqual(received, [synthetic]);
});

test('ordinary photo and import pickers have no capture hint and cancel cleanly', t => {
  const inputs = filePickerDOM(t);
  const panel = new Panel();
  for (const accept of ['image/*', '.json,.csv,application/json,text/csv']) {
    let callbacks = 0;
    panel._chooseFile(accept, () => callbacks++);
    const input = inputs.at(-1);
    assert.ok(!input.capture && !input.getAttribute('capture'));
    input.dispatchEvent(new Event('cancel'));
    assert.equal(input.removed, true);
    assert.equal(callbacks, 0);
  }
});

test('photo capture flag is forwarded while the regular photo action stays a library picker', () => {
  const panel = new Panel();
  const choices = [];
  panel._chooseFile = (...args) => choices.push(args);
  panel._choosePhoto('zwave', true);
  panel._choosePhoto('matter');
  assert.equal(panel._activeProtocol, 'matter');
  assert.equal(choices[0][0], 'image/*');
  assert.equal(typeof choices[0][1], 'function');
  assert.equal(choices[0][2]?.capture, true);
  assert.equal(choices[1][0], 'image/*');
  assert.equal(choices[1][2]?.capture ?? false, false);
});


test('disconnect cancels a pending photo and its late decode cannot modify a new draft', async t => {
  let finishImage;
  let bitmapClosed = false;
  replaceGlobal(t, 'createImageBitmap', () => new Promise(resolve => { finishImage = resolve; }));
  const panel = new Panel();
  panel._draft = { name: 'Original synthetic draft', codes: [], links: [] };
  let renderCount = 0;
  panel._renderModal = () => renderCount++;
  const received = [];
  panel._receiveScan = value => received.push(value);
  let onFile;
  panel._chooseFile = (_accept, callback) => { onFile = callback; };
  panel._choosePhoto('matter', true);
  const pending = onFile({ name: 'synthetic.png', type: 'image/png', size: 1 });
  assert.equal(typeof finishImage, 'function');
  assert.equal(panel._busy, true);
  assert.equal(panel._readingPhoto, true);
  const controller = panel._photoController;
  panel.disconnectedCallback();
  assert.equal(controller.signal.aborted, true);
  const newDraft = { name: 'New synthetic draft', codes: [], links: [] };
  panel._draft = newDraft;
  panel._modal = { kind: 'editor' };
  finishImage({ width: 1, height: 1, close() { bitmapClosed = true; } });
  await pending;
  assert.strictEqual(panel._draft, newDraft);
  assert.equal(panel._modal.kind, 'editor');
  assert.deepEqual(received, []);
  assert.equal(panel._draftError, '');
  assert.equal(panel._busy, false);
  assert.equal(panel._readingPhoto, false);
  assert.equal(panel._photoController, null);
  assert.equal(renderCount, 1);
  assert.equal(bitmapClosed, true);
});

function pendingPhotoSession(t, { dirty = false, confirm = true } = {}) {
  const imageResolvers = [];
  replaceGlobal(t, 'createImageBitmap', () => new Promise(resolve => imageResolvers.push(resolve)));
  let confirmations = 0;
  replaceGlobal(t, 'window', { confirm() { confirmations++; return confirm; } });
  const panel = new Panel();
  const draft = { name: 'Synthetic draft', codes: [], links: [] };
  panel._draft = draft;
  panel._dirty = dirty;
  panel._modal = { kind: 'start' };
  const modalRoot = { innerHTML: 'initial modal' };
  panel.shadowRoot.getElementById = id => id === 'modal-root' ? modalRoot : null;
  const rendered = [];
  panel._renderModal = () => rendered.push({ kind: panel._modal?.kind, html: panel._modal?.kind === 'editor' ? panel._renderEditor() : '' });
  const scans = [];
  panel._receiveScan = value => scans.push(value);
  let onFile;
  panel._chooseFile = (_accept, callback) => { onFile = callback; };
  const start = () => {
    panel._choosePhoto('matter', true);
    return onFile({ name: 'synthetic.png', type: 'image/png', size: 1 });
  };
  const finish = index => imageResolvers[index]({ width: 1, height: 1, close() {} });
  return { panel, draft, modalRoot, rendered, scans, start, finish, confirmations: () => confirmations };
}

function clickAction(panel, action) {
  return panel._onClick({ target: { closest: () => ({ dataset: { action }, disabled: false }) } });
}

test('photo selected from start opens the editor with reading progress and can be closed', async t => {
  const session = pendingPhotoSession(t, { dirty: true });
  const { panel } = session;
  const pending = session.start();
  assert.equal(panel._modal.kind, 'editor');
  assert.match(session.rendered.at(-1).html, /Looking for a QR code in the photo/);
  assert.doesNotMatch(session.rendered.at(-1).html, /Saving/);
  const controller = panel._photoController;
  await clickAction(panel, 'close-modal');
  assert.equal(session.confirmations(), 1);
  assert.equal(controller.signal.aborted, true);
  assert.equal(panel._busy, false);
  assert.equal(panel._readingPhoto, false);
  assert.equal(panel._modal, null);
  assert.equal(panel._draft, null);
  assert.equal(session.modalRoot.innerHTML, '');
  session.finish(0);
  await pending;
  assert.deepEqual(session.scans, []);
  assert.equal(panel._modal, null);
  assert.equal(panel._photoController, null);
});

test('declining draft discard stops photo processing and restores the editable draft', async t => {
  const session = pendingPhotoSession(t, { dirty: true, confirm: false });
  const { panel, draft } = session;
  const pending = session.start();
  const controller = panel._photoController;
  await clickAction(panel, 'close-modal');
  assert.equal(session.confirmations(), 1);
  assert.equal(controller.signal.aborted, true);
  assert.strictEqual(panel._draft, draft);
  assert.equal(panel._dirty, true);
  assert.equal(panel._modal.kind, 'editor');
  assert.equal(panel._busy, false);
  assert.equal(panel._readingPhoto, false);
  assert.doesNotMatch(session.rendered.at(-1).html, /Looking for a QR code in the photo/);
  session.finish(0);
  await pending;
  assert.strictEqual(panel._draft, draft);
  assert.equal(panel._draftError, '');
  assert.deepEqual(session.scans, []);
});

test('a cancelled photo finishing late cannot clear the controller of a retry', async t => {
  const session = pendingPhotoSession(t, { dirty: true, confirm: false });
  const { panel } = session;
  const first = session.start();
  const firstController = panel._photoController;
  await clickAction(panel, 'close-modal');
  const second = session.start();
  const secondController = panel._photoController;
  assert.notStrictEqual(firstController, secondController);
  session.finish(0);
  await first;
  assert.strictEqual(panel._photoController, secondController);
  assert.equal(secondController.signal.aborted, false);
  assert.equal(panel._busy, true);
  assert.equal(panel._readingPhoto, true);
  panel._closeModal(true);
  session.finish(1);
  await second;
  assert.equal(panel._photoController, null);
  assert.deepEqual(session.scans, []);
});

for (const kind of ['editor', 'preview']) {
  test(`${kind} mutation remains protected against close while saving or importing`, async () => {
    const panel = new Panel();
    const draft = { name: 'Synthetic unchanged draft', codes: [], links: [] };
    const modal = { kind };
    panel._draft = draft;
    panel._modal = modal;
    panel._busy = true;
    panel._readingPhoto = false;
    const generation = panel._dialogGeneration;
    await clickAction(panel, 'close-modal');
    // Escape reaches _closeModal directly, so verify both entry points.
    panel._closeModal();
    assert.strictEqual(panel._draft, draft);
    assert.strictEqual(panel._modal, modal);
    assert.equal(panel._dialogGeneration, generation);
    assert.equal(panel._busy, true);
  });
}
