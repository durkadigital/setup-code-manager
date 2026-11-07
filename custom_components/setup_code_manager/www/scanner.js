// All decoding stays in this browser. The pinned decoder is served by HA.
import "./vendor/jsQR.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_SIDE = 16_000;
const PHOTO_SCAN_SIDE = 2400;
const PHOTO_SCAN_SCALES = [1, 0.5, 0.25];
const CAMERA_SCAN_SIDE = 1280;
const FRAME_INTERVAL_MS = 180;

const messages = {
  insecure_context: "Camera access requires HTTPS or localhost. You can select a photo instead.",
  camera_unavailable: "This browser cannot access a camera. Select a photo instead.",
  camera_denied: "Camera access was denied. Allow camera access or select a photo.",
  camera_busy: "The camera is unavailable or in use by another application.",
  camera_failed: "The camera could not be started. Select a photo instead.",
  cancelled: "Scanning was cancelled.",
  image_too_large: "Select an image smaller than 20 MB and 40 megapixels.",
  unsupported_image: "Select a photo in JPEG, PNG, WebP, GIF, AVIF, or HEIF format.",
  image_unreadable: "This photo could not be opened. Try a JPEG or PNG image.",
  qr_not_found: "No QR code was found. Try a clear close-up of the whole code.",
  unsupported_code: "This QR code is not a Matter, HomeKit, or Z-Wave setup code.",
  decoder_unavailable: "The local QR decoder could not be loaded. Reload this panel.",
};

export class ScannerError extends Error {
  constructor(code) {
    super(messages[code] || messages.camera_failed);
    this.name = "ScannerError";
    this.code = code;
  }
}

function supportedPayload(value) {
  // This identifies the code family only. The backend validates the payload.
  const raw = typeof value === "string" ? value.trim() : "";
  return /^(?:MT:|X-HM:\/\/)/.test(raw) || /^90\d+$/.test(raw) ? raw : null;
}

function decodePixels(imageData) {
  if (typeof globalThis.jsQR !== "function") {
    throw new ScannerError("decoder_unavailable");
  }
  const { data, width, height } = imageData;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > MAX_IMAGE_PIXELS || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE ||
      !(data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
    throw new ScannerError("image_unreadable");
  }
  return globalThis.jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
}

/** Decode RGBA pixels; also used by the real-decoder regression tests. */
export function decodeImageData(imageData) {
  const result = decodePixels(imageData);
  if (!result) throw new ScannerError("qr_not_found");
  const raw = supportedPayload(result.data);
  if (!raw) throw new ScannerError("unsupported_code");
  return raw;
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() || []) track.stop();
}

function cameraError(error) {
  if (error instanceof ScannerError) return error;
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(error?.name)) {
    return new ScannerError("camera_denied");
  }
  if (["NotReadableError", "TrackStartError"].includes(error?.name)) {
    return new ScannerError("camera_busy");
  }
  if (["NotFoundError", "DevicesNotFoundError", "OverconstrainedError"].includes(error?.name)) {
    return new ScannerError("camera_unavailable");
  }
  return new ScannerError("camera_failed");
}

function drawingSurface(canvas, source, width, height, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new ScannerError("image_unreadable");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

/**
 * Call only after a user's scan action. Abort the optional signal when closing
 * the dialog: even a permission prompt that resolves later cannot retain tracks.
 * Resolves to an idempotent stop function. Successful detection stops first.
 */
export async function startScanner(video, onResult, onError, { signal } = {}) {
  if (signal?.aborted || video?.isConnected === false) throw new ScannerError("cancelled");
  if (globalThis.isSecureContext === false) throw new ScannerError("insecure_context");
  if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw new ScannerError("camera_unavailable");
  if (typeof globalThis.jsQR !== "function") throw new ScannerError("decoder_unavailable");

  const document = video.ownerDocument || globalThis.document;
  const window = document.defaultView || globalThis;
  let stream;
  let timer;
  let observer;
  let stopped = false;
  let rejectCancellation;
  let canvas;
  const cancelled = new Promise((_, reject) => { rejectCancellation = reject; });
  // Register a handler immediately, including for cancellation before a race.
  cancelled.catch(() => {});

  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    observer?.disconnect();
    signal?.removeEventListener("abort", stop);
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("pagehide", stop);
    stopTracks(stream);
    if (stream && video.srcObject === stream) {
      video.pause();
      video.srcObject = null;
    }
    if (canvas) canvas.width = canvas.height = 0;
    rejectCancellation(new ScannerError("cancelled"));
  };
  const visibilityChanged = () => {
    if (document.hidden) stop();
  };
  signal?.addEventListener("abort", stop, { once: true });
  document.addEventListener("visibilitychange", visibilityChanged);
  window.addEventListener("pagehide", stop, { once: true });
  if (window.MutationObserver && document.documentElement) {
    observer = new window.MutationObserver(() => {
      if (video.isConnected === false) stop();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  try {
    const request = globalThis.navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }).then((received) => {
      if (stopped || signal?.aborted || video.isConnected === false) {
        stopTracks(received);
        throw new ScannerError("cancelled");
      }
      stream = received;
      return received;
    });
    await Promise.race([request, cancelled]);
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await Promise.race([Promise.resolve(video.play()), cancelled]);
    if (stopped || video.isConnected === false || document.hidden) {
      stop();
      throw new ScannerError("cancelled");
    }

    canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new ScannerError("camera_failed");
    const scanFrame = () => {
      if (stopped) return;
      if (video.isConnected === false || document.hidden) return stop();
      let raw;
      try {
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          const scale = Math.min(1, CAMERA_SCAN_SIDE / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const result = decodePixels(context.getImageData(0, 0, canvas.width, canvas.height));
          raw = result && supportedPayload(result.data);
        }
      } catch (error) {
        stop();
        onError?.(cameraError(error));
        return;
      }
      if (raw) {
        stop();
        onResult(raw);
      } else {
        timer = window.setTimeout(scanFrame, FRAME_INTERVAL_MS);
      }
    };
    timer = window.setTimeout(scanFrame, 0);
    return stop;
  } catch (error) {
    stop();
    throw cameraError(error);
  }
}

async function openImage(file) {
  // Safari can render a photo differently through ImageBitmap, making an
  // otherwise readable QR fail. Prefer the image element and retain a bitmap
  // fallback for formats the image element cannot open.
  if (typeof globalThis.Image === "function") {
    try {
      return await openImageElement(file);
    } catch {
      // The image element has already released its URL before fallback.
    }
  }
  if (typeof globalThis.createImageBitmap === "function") {
    try {
      const bitmap = await globalThis.createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Format support varies between browser decoding paths.
    }
  }
  throw new ScannerError("image_unreadable");
}

async function openImageElement(file) {
  const url = URL.createObjectURL(file);
  let img;
  let timer;
  const close = () => {
    clearTimeout(timer);
    if (img) {
      img.onload = img.onerror = null;
      img.removeAttribute("src");
    }
    URL.revokeObjectURL(url);
  };
  try {
    img = new Image();
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new ScannerError("image_unreadable")), 15_000);
      img.onload = () => { clearTimeout(timer); resolve(); };
      img.onerror = () => { clearTimeout(timer); reject(new ScannerError("image_unreadable")); };
      img.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}

/** Decode a user-selected photo locally without uploading or keeping the image. */
export async function scanImage(file, { signal } = {}) {
  const checkCancelled = () => {
    if (signal?.aborted) throw new ScannerError("cancelled");
  };
  checkCancelled();
  if (!file || !Number.isFinite(file.size) || file.size <= 0) throw new ScannerError("image_unreadable");
  if (file.size > MAX_FILE_BYTES) throw new ScannerError("image_too_large");
  const imageType = /^(image\/(jpeg|png|webp|gif|avif|heic|heif|heic-sequence|heif-sequence))$/i;
  const imageExtension = /\.(jpe?g|png|webp|gif|avif|hei[cf])$/i;
  if (!(imageType.test(file.type) || (!file.type && imageExtension.test(file.name || "")))) {
    throw new ScannerError("unsupported_image");
  }
  let image;
  let canvas;
  try {
    image = await openImage(file);
    checkCancelled();
    const { width, height } = image;
    if (!width || !height) throw new ScannerError("image_unreadable");
    if (width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
      throw new ScannerError("image_too_large");
    }
    canvas = document.createElement("canvas");
    const maxSide = Math.min(PHOTO_SCAN_SIDE, Math.max(width, height));
    let unsupported = false;
    // Printed texture can confuse the decoder at a single resolution. Try three
    // bounded scales from the original image, reusing one canvas. Yield between
    // passes so a busy indicator can paint and closing the dialog can cancel.
    for (const scale of PHOTO_SCAN_SCALES) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      checkCancelled();
      const surface = drawingSurface(canvas, image.source, width, height, maxSide * scale);
      try {
        return decodeImageData(surface.context.getImageData(0, 0, canvas.width, canvas.height));
      } catch (error) {
        if (error.code !== "qr_not_found" && error.code !== "unsupported_code") throw error;
        unsupported ||= error.code === "unsupported_code";
      }
    }
    checkCancelled();
    throw new ScannerError(unsupported ? "unsupported_code" : "qr_not_found");
  } catch (error) {
    throw error instanceof ScannerError ? error : new ScannerError("image_unreadable");
  } finally {
    image?.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
