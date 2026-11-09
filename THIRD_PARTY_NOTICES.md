# Third-Party Notices

Folio includes the following third-party components. If you distribute Folio or a derivative work,
ship this file together with the full licence texts referenced below.

## Attribution obligations

| Component | Licence | Source |
|---|---|---|
| `@csstools/color-helpers` 6.1.2 | MIT-0 | https://github.com/csstools/postcss-plugins |
| `@csstools/css-syntax-patches-for-csstree` 1.1.16 | MIT-0 | https://github.com/csstools/postcss-plugins |
| `baseline-browser-mapping` 2.11.35 | Apache-2.0 | https://github.com/web-platform-dx/baseline-browser-mapping |
| `caniuse-lite` 1.0.30001823 | CC-BY-4.0 | browserslist/caniuse-lite |
| `class-variance-authority` 0.7.1 | Apache-2.0 | https://github.com/joe-bell/cva |
| `data-urls > webidl-conversions` 8.0.1 | BSD-2-Clause | https://github.com/jsdom/webidl-conversions |
| `didyoumean` 1.2.2 | Apache-2.0 | https://github.com/dcporter/didyoumean.js |
| `entities` 9.0.0 | BSD-2-Clause | https://github.com/fb55/entities |
| `idb-keyval` 6.3.0 | Apache-2.0 | https://github.com/jakearchibald/idb-keyval |
| `jsdom > webidl-conversions` 8.0.1 | BSD-2-Clause | https://github.com/jsdom/webidl-conversions |
| `jszip` 3.10.2 | MIT OR GPL-3.0-or-later | https://github.com/Stuk/jszip |
| `pako` 1.0.11 | MIT AND Zlib | nodeca/pako |
| `PDF.js cMap data` bundled with pdfjs-dist | Apache-2.0 | https://github.com/mozilla/pdf.js |
| `PDF.js standard font data (Foxit core fonts)` bundled with pdfjs-dist | BSD-3-Clause (see node_modules/pdfjs-dist/standard_fonts/LICENSE_FOXIT) | https://github.com/mozilla/pdf.js |
| `pdfjs-dist` 6.5.438 | Apache-2.0 | https://github.com/mozilla/pdf.js |
| `source-map-js` 1.2.2 | BSD-3-Clause | 7rulnik/source-map-js |
| `tesseract.js` 6.0.1 | Apache-2.0 | https://github.com/naptha/tesseract.js |
| `Tesseract.js OCR language data (eng)` fetched at runtime from the tesseract.js CDN | Apache-2.0 (tessdata) | https://github.com/tesseract-ocr/tessdata |
| `tesseract.js-core` 6.1.2 | Apache-2.0 | https://github.com/naptha/tesseract.js-core |
| `tough-cookie` 6.1.0 | BSD-3-Clause | git://github.com/salesforce/tough-cookie |
| `ts-interface-checker` 0.1.13 | Apache-2.0 | https://github.com/gristlabs/ts-interface-checker |
| `typescript` 5.9.3 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| `wasm-feature-detect` 1.9.0 | Apache-2.0 | GoogleChromeLabs/wasm-feature-detect |
| `webidl-conversions` 3.0.1 | BSD-2-Clause | jsdom/webidl-conversions |
| `xml-name-validator` 5.0.0 | Apache-2.0 | jsdom/xml-name-validator |

## Full licence texts

Full texts are available in each package's directory under `node_modules/<package>/LICENSE`, and in
`node_modules/pdfjs-dist/standard_fonts/LICENSE_FOXIT` for the bundled standard font data. The
build copies no licence text into the application bundle, so a distributable release must include
this file and those licence texts alongside the artefact.

## Apache-2.0 components

`pdfjs-dist` and `tesseract.js` are licensed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0). No modifications have been made to their source.
Apache-2.0 requires that recipients receive a copy of the licence and any NOTICE file content.

## MIT / ISC / BSD components

These require retaining the copyright notice and permission notice. They are listed in
`THIRD_PARTY_COMPONENTS.csv` with their source repositories.

## Generated

`node scripts/license-audit.mjs` regenerates this file. Do not edit by hand.
