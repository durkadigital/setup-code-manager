import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const www = new URL("../custom_components/setup_code_manager/www/", import.meta.url);
const require = createRequire(import.meta.url);
globalThis.jsQR = require(fileURLToPath(new URL("vendor/jsQR.js", www)));
const { decodeImageData, scanImage, startScanner } = await import(new URL("scanner.js", www));
const encoder = { window: {} };
vm.runInNewContext(readFileSync(new URL("qr.js", www), "utf8"), encoder);

// Test-only CHIP onboarding payload: vendor 0xfff1, product 0x8000,
// discriminator 3840, passcode 20202021. No real device credentials.
const MATTER = "MT:Y.K9042C00KA0648G00";

function pixels(payload, { inverted = false, rotated = false } = {}) {
  const { data: modules, size } = encoder.window.SetupCodesQR.encode(payload, { border: 4, ecc: "M" });
  const scale = 6;
  const width = size * scale;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      let column = Math.floor(x / scale);
      let row = Math.floor(y / scale);
      if (rotated) [column, row] = [size - 1 - row, column];
      const dark = Boolean(modules[row][column]) !== inverted;
      const offset = (y * width + x) * 4;
      data[offset] = data[offset + 1] = data[offset + 2] = dark ? 0 : 255;
      data[offset + 3] = 255;
    }
  }
  return { data, width, height: width };
}

function globalValue(t, key, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
}

function browser(t, imageData = pixels(MATTER)) {
  const window = new EventTarget();
  window.setTimeout = setTimeout;
  window.clearTimeout = clearTimeout;
  const document = new EventTarget();
  document.defaultView = window;
  document.hidden = false;
  document.createElement = (tag) => {
    assert.equal(tag, "canvas");
    return { width: 0, height: 0, getContext: () => ({ drawImage() {}, getImageData: () => imageData }) };
  };
  globalValue(t, "document", document);
  globalValue(t, "isSecureContext", true);
  const video = {
    ownerDocument: document,
    isConnected: true,
    srcObject: null,
    readyState: 2,
    videoWidth: imageData.width,
    videoHeight: imageData.height,
    play: async () => {},
    pause() {},
  };
  const track = { stops: 0, stop() { this.stops++; } };
  const stream = { getTracks: () => [track] };
  globalValue(t, "navigator", { mediaDevices: { getUserMedia: async () => stream } });
  return { video, stream, track, document, window };
}

test("bundled decoder bytes match the verified pinned npm artifact", () => {
  const actual = createHash("sha256").update(readFileSync(new URL("vendor/jsQR.js", www))).digest("hex");
  assert.equal(actual, "bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859");
});

test("real local decoder reads Matter RGBA pixels, including rotation and inversion", () => {
  for (const options of [{}, { inverted: true }, { rotated: true }]) {
    assert.equal(decodeImageData(pixels(MATTER, options)), MATTER);
  }
});

test("real local decoder recognizes HomeKit and SmartStart families", () => {
  for (const payload of ["X-HM://0023ISYWY7STT", "900100123456789012345678901234567890123456789012345678901234567890"]) {
    assert.equal(decodeImageData(pixels(payload)), payload);
  }
});

test("a decoded unrelated URL and an empty image return distinct safe errors", () => {
  assert.throws(() => decodeImageData(pixels("https://example.com/unrelated")), { code: "unsupported_code" });
  const white = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) };
  assert.throws(() => decodeImageData(white), { code: "qr_not_found" });
  assert.throws(() => decodeImageData({ ...white, width: 65 }), { code: "image_unreadable" });
});

test("camera success stops every track before delivering the decoded code", { timeout: 2000 }, async (t) => {
  const { video, track } = browser(t);
  let finish;
  const result = new Promise((resolve) => { finish = resolve; });
  const stop = await startScanner(video, (raw) => {
    assert.equal(track.stops, 1);
    assert.equal(video.srcObject, null);
    finish(raw);
  }, assert.fail);
  assert.equal(await result, MATTER);
  stop();
  stop();
  assert.equal(track.stops, 1);
});

test("closing while a camera permission prompt is pending releases a late stream", async (t) => {
  const { video, stream, track } = browser(t);
  let grantPermission;
  navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => { grantPermission = resolve; });
  const controller = new AbortController();
  const starting = startScanner(video, assert.fail, assert.fail, { signal: controller.signal });
  controller.abort();
  await assert.rejects(starting, { code: "cancelled" });
  grantPermission(stream);
  await new Promise(setImmediate);
  assert.equal(track.stops, 1);
  assert.equal(video.srcObject, null);
});

test("a detached dialog cannot attach a late camera stream", async (t) => {
  const { video, stream, track } = browser(t);
  let grantPermission;
  navigator.mediaDevices.getUserMedia = () => new Promise((resolve) => { grantPermission = resolve; });
  const starting = startScanner(video, assert.fail, assert.fail);
  video.isConnected = false;
  grantPermission(stream);
  await assert.rejects(starting, { code: "cancelled" });
  assert.equal(track.stops, 1);
  assert.equal(video.srcObject, null);
});

test("leaving the page stops the camera and stop remains idempotent", async (t) => {
  const { video, track, window } = browser(t);
  video.readyState = 0;
  const stop = await startScanner(video, assert.fail, assert.fail);
  window.dispatchEvent(new Event("pagehide"));
  stop();
  assert.equal(track.stops, 1);
  assert.equal(video.srcObject, null);
});

test("camera denial and insecure context are actionable errors", async (t) => {
  const { video } = browser(t);
  navigator.mediaDevices.getUserMedia = async () => { throw { name: "NotAllowedError" }; };
  await assert.rejects(startScanner(video, assert.fail, assert.fail), { code: "camera_denied" });
  globalThis.isSecureContext = false;
  await assert.rejects(startScanner(video, assert.fail, assert.fail), { code: "insecure_context" });
});

test("photo bitmap path decodes pixels and closes the bitmap", async (t) => {
  const data = pixels(MATTER);
  browser(t, data);
  let closed = 0;
  globalValue(t, "createImageBitmap", async () => ({ width: data.width, height: data.height, close: () => closed++ }));
  assert.equal(await scanImage({ size: 1000, type: "image/png" }), MATTER);
  assert.equal(closed, 1);
});

test("Safari image-element fallback releases its blob URL after decoding", async (t) => {
  const data = pixels(MATTER);
  browser(t, data);
  globalValue(t, "createImageBitmap", async () => { throw new Error("unsupported"); });
  let removed = 0;
  let revoked = 0;
  globalValue(t, "Image", class {
    naturalWidth = data.width;
    naturalHeight = data.height;
    set src(value) { assert.equal(value, "blob:scanner-test"); queueMicrotask(() => this.onload?.()); }
    removeAttribute(name) { assert.equal(name, "src"); removed++; }
  });
  t.mock.method(URL, "createObjectURL", () => "blob:scanner-test");
  t.mock.method(URL, "revokeObjectURL", (url) => { assert.equal(url, "blob:scanner-test"); revoked++; });
  assert.equal(await scanImage({ size: 1000, type: "image/png" }), MATTER);
  assert.equal(removed, 1);
  assert.equal(revoked, 1);
});

test("oversized photos and SVGs are rejected, and decoded oversized bitmaps close", async (t) => {
  browser(t);
  await assert.rejects(scanImage({ size: 21 * 1024 * 1024, type: "image/jpeg" }), { code: "image_too_large" });
  await assert.rejects(scanImage({ size: 100, type: "image/svg+xml" }), { code: "unsupported_image" });
  let closed = 0;
  globalValue(t, "createImageBitmap", async () => ({ width: 10000, height: 10000, close: () => closed++ }));
  await assert.rejects(scanImage({ size: 1000, type: "image/png" }), { code: "image_too_large" });
  assert.equal(closed, 1);
});
