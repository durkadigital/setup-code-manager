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

function pixels(payload, { inverted = false, rotated = false, scale = 6, noise = 0, foreground = 0, background = 255 } = {}) {
  const { data: modules, size } = encoder.window.SetupCodesQR.encode(payload, { border: 4, ecc: "M" });
  const width = size * scale;
  const data = new Uint8ClampedArray(width * width * 4);
  let seed = 0x12345678;
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      let column = Math.floor(x / scale);
      let row = Math.floor(y / scale);
      if (rotated) [column, row] = [size - 1 - row, column];
      const dark = Boolean(modules[row][column]) !== inverted;
      const offset = (y * width + x) * 4;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const shade = (dark ? foreground : background) + ((seed >>> 24) / 255 - 0.5) * noise;
      data[offset] = data[offset + 1] = data[offset + 2] = shade;
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

// Small software canvas for photo-path tests. Bilinear sampling mirrors browser
// drawImage resizing; the real bundled decoder receives the resulting pixels.
function photoBrowser(t, imageData, { onDraw = () => {} } = {}) {
  const state = browser(t, imageData);
  const draws = [];
  const canvases = [];
  state.document.createElement = () => {
    let rendered;
    const canvas = { width: 0, height: 0, getContext: () => ({
      drawImage(source, _x, _y, width, height) {
        draws.push([width, height]);
        onDraw(draws.length);
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
          const sy = Math.max(0, (y + 0.5) * source.height / height - 0.5);
          const y0 = Math.floor(sy), y1 = Math.min(source.height - 1, y0 + 1), fy = sy - y0;
          for (let x = 0; x < width; x++) {
            const sx = Math.max(0, (x + 0.5) * source.width / width - 0.5);
            const x0 = Math.floor(sx), x1 = Math.min(source.width - 1, x0 + 1), fx = sx - x0;
            for (let c = 0; c < 4; c++) {
              const top = source.data[(y0 * source.width + x0) * 4 + c] * (1 - fx) + source.data[(y0 * source.width + x1) * 4 + c] * fx;
              const bottom = source.data[(y1 * source.width + x0) * 4 + c] * (1 - fx) + source.data[(y1 * source.width + x1) * 4 + c] * fx;
              data[(y * width + x) * 4 + c] = top * (1 - fy) + bottom * fy;
            }
          }
        }
        rendered = { width, height, data };
      },
      getImageData: () => rendered,
    }) };
    canvases.push(canvas);
    return canvas;
  };
  let closed = 0;
  globalValue(t, "createImageBitmap", async () => ({ ...imageData, close() { closed++; } }));
  return { ...state, draws, canvases, closed: () => closed };
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

test("photo scanning retries a noisy printed QR at a smaller scale with the real decoder", async (t) => {
  const data = pixels(MATTER, { scale: 12, foreground: 90, background: 190, noise: 25 });
  // The previous single-scale path fails this deterministic synthetic photo.
  assert.throws(() => decodeImageData(data), { code: "qr_not_found" });
  const state = photoBrowser(t, data);
  assert.equal(await scanImage({ size: 1000, type: "image/jpeg" }), MATTER);
  assert.equal(state.draws.length, 2);
  assert.equal(state.closed(), 1);
  assert.ok(state.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test("photo cancellation before opening never requests a bitmap", async (t) => {
  globalValue(t, "createImageBitmap", assert.fail);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(scanImage({ size: 1000, type: "image/jpeg" }, { signal: controller.signal }), { code: "cancelled" });
});

test("photo cancellation while opening closes a late bitmap without drawing it", async (t) => {
  const state = photoBrowser(t, pixels(MATTER));
  let finishOpening;
  let closed = 0;
  globalThis.createImageBitmap = () => new Promise((resolve) => { finishOpening = resolve; });
  const controller = new AbortController();
  const scanning = scanImage({ size: 1000, type: "image/jpeg" }, { signal: controller.signal });
  controller.abort();
  finishOpening({ width: 200, height: 200, close() { closed++; } });
  await assert.rejects(scanning, { code: "cancelled" });
  assert.equal(closed, 1);
  assert.equal(state.draws.length, 0);
});

test("photo retries yield to cancellation before another decode and release resources", async (t) => {
  const controller = new AbortController();
  const data = pixels(MATTER, { scale: 12, foreground: 90, background: 190, noise: 25 });
  const state = photoBrowser(t, data, { onDraw: () => setTimeout(() => controller.abort(), 0) });
  await assert.rejects(scanImage({ size: 1000, type: "image/jpeg" }, { signal: controller.signal }), { code: "cancelled" });
  assert.equal(state.draws.length, 1);
  assert.equal(state.closed(), 1);
  assert.ok(state.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test("photo failure has a bounded number of attempts and releases its bitmap and canvas", async (t) => {
  const state = photoBrowser(t, { width: 128, height: 128, data: new Uint8ClampedArray(128 * 128 * 4).fill(255) });
  await assert.rejects(scanImage({ size: 1000, type: "image/jpeg" }), { code: "qr_not_found" });
  assert.equal(state.draws.length, 3);
  assert.equal(state.canvases.length, 1);
  assert.equal(state.closed(), 1);
  assert.ok(state.canvases.every((canvas) => canvas.width === 0 && canvas.height === 0));
});

test("photo retries retain the unsupported-code error without exposing its contents", async (t) => {
  const payload = "https://example.com/unrelated";
  const state = photoBrowser(t, pixels(payload));
  await assert.rejects(scanImage({ size: 1000, type: "image/jpeg" }), (error) => {
    assert.equal(error.code, "unsupported_code");
    assert.ok(!error.message.includes(payload));
    return true;
  });
  assert.equal(state.draws.length, 3);
  assert.equal(state.closed(), 1);
});

test("photo opening prefers the image-element path and releases its blob URL after decoding", async (t) => {
  const data = pixels(MATTER);
  browser(t, data);
  let bitmapRequests = 0;
  globalValue(t, "createImageBitmap", async () => { bitmapRequests++; throw new Error("unsupported"); });
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
  assert.equal(bitmapRequests, 0);
});

test("an image-element opening failure releases its URL before the bitmap fallback", async (t) => {
  const data = pixels(MATTER);
  browser(t, data);
  let removed = 0;
  let revoked = 0;
  let closed = 0;
  globalValue(t, "Image", class {
    set src(value) { assert.equal(value, "blob:scanner-open-failure"); queueMicrotask(() => this.onerror?.()); }
    removeAttribute(name) { assert.equal(name, "src"); removed++; }
  });
  t.mock.method(URL, "createObjectURL", () => "blob:scanner-open-failure");
  t.mock.method(URL, "revokeObjectURL", (url) => { assert.equal(url, "blob:scanner-open-failure"); revoked++; });
  globalValue(t, "createImageBitmap", async () => {
    assert.equal(removed, 1);
    assert.equal(revoked, 1);
    return { width: data.width, height: data.height, close() { closed++; } };
  });
  assert.equal(await scanImage({ size: 1000, type: "image/png" }), MATTER);
  assert.equal(closed, 1);
});

test("Safari image-element fallback also releases its blob URL after all attempts fail", async (t) => {
  const data = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) };
  browser(t, data);
  globalValue(t, "createImageBitmap", undefined);
  let removed = 0;
  let revoked = 0;
  globalValue(t, "Image", class {
    naturalWidth = data.width;
    naturalHeight = data.height;
    set src(value) { assert.equal(value, "blob:scanner-failure-test"); queueMicrotask(() => this.onload?.()); }
    removeAttribute(name) { assert.equal(name, "src"); removed++; }
  });
  t.mock.method(URL, "createObjectURL", () => "blob:scanner-failure-test");
  t.mock.method(URL, "revokeObjectURL", (url) => { assert.equal(url, "blob:scanner-failure-test"); revoked++; });
  await assert.rejects(scanImage({ size: 1000, type: "image/png" }), { code: "qr_not_found" });
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
