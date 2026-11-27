# Bundled QR decoder

`jsQR.js` is the unmodified browser bundle from **jsqr 1.4.0** by the
[jsQR contributors](https://github.com/cozmo/jsQR). Its full Apache License 2.0
is preserved in `jsQR.LICENSE`. The npm package contains no separate NOTICE file.
This license differs from the MIT license of this project and of its QR encoder.

Source: https://github.com/cozmo/jsQR

Pinned artifact: https://registry.npmjs.org/jsqr/-/jsqr-1.4.0.tgz

Retrieved on 2026-11-07. npm's package SHA-512 integrity was verified before
extracting only `package/dist/jsQR.js` and `package/LICENSE`:

```text
sha512-dxLob7q65Xg2DvstYkRpkYtmKm2sPJ9oFhrhmudT1dZvNFFTlroai3AWSpLey/w5vMcLBXRgOJsbXpdN9HzU/A==
```

SHA-256 checksums:

```text
b5299b37917a1fe7a8cab9dd5cc6b8accf82663add80abe5bf7761a921cc6602  jsqr-1.4.0.tgz
bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859  jsQR.js
c6596eb7be8581c18be736c846fb9173b69eccf6ef94c5135893ec56bd92ba08  jsQR.LICENSE
```

The scanner imports this bundle from Home Assistant's local static route. Its
UMD wrapper exposes `self.jsQR` in the browser. There is no CDN fallback,
telemetry, image upload, or runtime dependency fetch. Both the camera and photo
path use this decoder, including Safari browsers without `BarcodeDetector`.

When updating, verify the npm integrity and upstream license again, replace the
bundle and license together, update these hashes, and run `node --test
tests/scanner.test.mjs` from the repository root. The tests rasterize QR symbols
using the separately bundled encoder and decode their actual RGBA pixels.

## Offline text recognition

The bundled Tesseract.js 6.0.1 browser worker and tesseract.js-core 6.0.0
LSTM-only, non-SIMD WebAssembly core use Apache-2.0. Their licenses and
the worker's dependency notices are in `ocr/`. The quantized English
trained model comes from `@tesseract.js-data/eng@1.0.0`
(`4.0.0_best_int/eng.traineddata.gz`). The Tesseract trained models are
released under Apache-2.0. The npm package archives were verified against
their SHA-512 registry integrity before extracting these files. The panel
starts one local worker only if photo QR detection fails for Matter.

## Portable backup on local HTTP

Web Crypto handles key derivation and authenticated encryption in secure
contexts. For local HTTP, the backup worker can import the original ESM code
and MIT licenses from `@noble/hashes@2.0.1` (PBKDF2-HMAC-SHA256) and
`@noble/ciphers@2.1.1` (AES-GCM). Only the dependency trees of
`pbkdf2.js`, `sha2.js` and `aes.js` are bundled. The npm package integrity
was checked before extraction. The same binary backup is readable by either
implementation.

Upstream source and licensing information is available from
[Tesseract.js](https://github.com/naptha/tesseract.js),
[the Tesseract language data](https://github.com/tesseract-ocr/tessdata_best/blob/main/LICENSE),
[noble-hashes](https://github.com/paulmillr/noble-hashes) and
[noble-ciphers](https://github.com/paulmillr/noble-ciphers).

| npm archive | SHA-512 integrity (Base64) |
| --- | --- |
| tesseract.js 6.0.1 | /sPvMvrCtgxnNRCjbTYbr7BRu0yfWDsMZQ2a/T5aN/L1t8wUQN6tTWv6p6FwzpoEBA0jrN2UD2SX4QQFRdoDbA== |
| tesseract.js-core 6.0.0 | 1Qncm/9oKM7xgrQXZXNB+NRh19qiXGhxlrR8EwFbK5SaUbPZnS5OMtP/ghtqfd23hsr1ZvZbZjeuAGcMxd/ooA== |
| @tesseract.js-data/eng 1.0.0 | mbTumm6KQPUHyzTPQaF3ObXYnx0SqqfV2nabqFVQBwD6Kl7PhGSLSzOlfFTWy0P3BjghaSKA2W9GB19Jk+ZcTg== |
| @noble/ciphers 2.1.1 | bysYuiVfhxNJuldNXlFEitTVdNnYUc+XNJZd7Qm2a5j1vZHgY+fazadNFWFaMK/2vye0JVlxV3gHmC0WDfAOQw== |
| @noble/hashes 2.0.1 | XlOlEbQcE9fmuXxrVTXCTlG2nlRXa9Rj3rr5Ue/+tX+nmkgbX720YHh0VR3hBF9xDvwnb8D2shVGOwNx+ulArw== |
