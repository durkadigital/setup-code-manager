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
