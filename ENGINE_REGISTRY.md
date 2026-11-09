# Folio Engine Registry

> **Generated file — do not edit by hand.** Run `npm run docs:engines` to regenerate from
> `src/lib/engines.ts`, which is the single source of truth for engine selection.

Every advertised tool is mapped to a concrete engine, an execution side, its input and output
formats, its fidelity level, and the limitations a user must be told about. No tool may run on an
engine that is not listed here.

## Summary

| Metric | Count |
|---|---|
| Engines registered | 15 |
| Tools mapped | 36 |
| Tools processed on Folio's server | 36 |
| Browser-side tools (PDF.js preview and canvas rendering only) | 0 |
| Tools executed by a native server engine | 6 |
| Engines not bundled in this deployment | 3 |
| Engines with an unapproved licence class | 3 |

Registry counter from code: `ENGINE_REGISTRY_COUNT = {"engines":15,"tools":36}`.

## Engine inventory

| Engine | Name | Purpose | Licence | Class | Side | Shipped |
|---|---|---|---|---|---|---|
| `pdf-lib` | pdf-lib | PDF creation, page copy/reorder, overlays, form filling, standard encryption | MIT | A | browser | bundled |
| `pdfjs` | PDF.js | PDF rendering to canvas, text-layer extraction, page geometry | Apache-2.0 | B | browser | bundled |
| `tesseract` | Tesseract.js | OCR of scanned pages into a searchable text layer | Apache-2.0 | B | browser | bundled |
| `jszip` | JSZip | ZIP archives for batch downloads and OOXML containers | MIT | A | browser | bundled |
| `docx` | docx | Writing .docx output for PDF to Word | MIT | A | browser | bundled |
| `pptxgenjs` | PptxGenJS | Writing .pptx output for PDF to PowerPoint | MIT | A | browser | bundled |
| `ooxml-parser` | Folio OOXML parser (in-repo) | Namespace-aware DOMParser walk of word/document.xml, xl/worksheets, ppt/slides | MIT (first-party) | A | browser | bundled |
| `xlsx-writer` | Folio XLSX writer (in-repo) | Minimal SpreadsheetML writer on top of JSZip | MIT (first-party) | A | browser | bundled |
| `webcrypto` | Web Crypto API | AES-CBC key derivation and encryption for password protection | W3C / browser built-in | A | browser | bundled |
| `ollama` | Ollama (user-hosted) | Offline LLM inference for summary, Q&A, translation | MIT (client); model licences vary by model | B | local-model | not bundled |
| `libreoffice-worker` | LibreOffice headless (document worker) | High-fidelity Office rendering and PDF/A export | MPL-2.0 | C | server | bundled |
| `chromium-worker` | Chromium via Playwright (document worker) | Real CSS layout for HTML and webpage to PDF | Apache-2.0 (Chromium: BSD-3-Clause and others) | C | server | bundled |
| `qpdf-worker` | qpdf (document worker) | Structural PDF repair, linearization and inspection | Apache-2.0 | B | server | bundled |
| `pyhanko-worker` | pyHanko (document worker) | Certificate-based digital signatures | MIT | A | document-worker | not bundled |
| `verapdf-worker` | veraPDF (document worker) | ISO 19005 (PDF/A) conformance validation | AGPL-3.0 / MPL-2.0 mix | D | document-worker | not bundled |

Licence classes follow the policy in `THIRD_PARTY_LICENSES.md`: **A** approved, **B** approved with
notice obligations, **C** requires legal review, **D** rejected. Class C and D engines are listed for
evaluation only and are **not** invoked by any tool; `unapprovedEngines()` returns them so the build
can assert this.

## Tool → engine matrix

| Tool | Primary | Fallback | Preferred worker engine | Side | Inputs | Outputs | Fidelity |
|---|---|---|---|---|---|---|---|
| `merge` | `pdf-lib` | — | — | server | pdf | pdf | exact |
| `split` | `pdf-lib` | — | — | server | pdf | pdf | exact |
| `rearrange` | `pdf-lib` | — | — | server | pdf | pdf | exact |
| `extract` | `pdf-lib` | — | — | server | pdf | pdf; zip | exact |
| `rotate` | `pdf-lib` | — | — | server | pdf | pdf | exact |
| `compress` | `pdfjs` | `pdf-lib` | — | server | pdf | pdf | approximate |
| `repair` | `pdfjs` | `pdf-lib` | — | server | pdf | pdf | approximate |
| `ocr` | `tesseract` | `pdfjs` | — | server | pdf | pdf; txt | approximate |
| `pdf-to-word` | `docx` | `pdfjs` | — | server | pdf | docx | approximate |
| `pdf-to-excel` | `xlsx-writer` | `pdfjs` | — | server | pdf | xlsx; csv | approximate |
| `pdf-to-powerpoint` | `pptxgenjs` | `pdfjs` | — | server | pdf | pptx | approximate |
| `pdf-to-jpg` | `pdfjs` | — | — | server | pdf | jpg; zip | high |
| `pdf-to-png` | `pdfjs` | — | — | server | pdf | png; zip | high |
| `pdf-to-markdown` | `pdfjs` | — | — | server | pdf | md | approximate |
| `pdf-to-text` | `pdfjs` | — | — | server | pdf | txt | exact |
| `pdf-to-pdfa` | `pdf-lib` | — | `verapdf-worker` | server | pdf | pdf | approximate |
| `word-to-pdf` | `ooxml-parser` | `pdf-lib` | `libreoffice-worker` | server | docx | pdf | high |
| `excel-to-pdf` | `ooxml-parser` | `pdf-lib` | `libreoffice-worker` | server | xlsx; csv | pdf | high |
| `powerpoint-to-pdf` | `ooxml-parser` | `pdf-lib` | `libreoffice-worker` | server | pptx | pdf | high |
| `image-to-pdf` | `pdf-lib` | — | — | server | png; jpg; jpeg; webp | pdf | exact |
| `markdown-to-pdf` | `ooxml-parser` | `pdf-lib` | — | server | md; markdown | pdf | high |
| `html-to-pdf` | `ooxml-parser` | `pdf-lib` | `chromium-worker` | server | html; htm | pdf | approximate |
| `webpage-to-pdf` | `ooxml-parser` | `pdf-lib` | `chromium-worker` | server | url | pdf | approximate |
| `editor` | `pdfjs` | `pdf-lib` | — | server | pdf | pdf | high |
| `sign` | `pdf-lib` | — | — | server | pdf | pdf | exact |
| `forms` | `pdf-lib` | — | — | server | pdf | pdf | exact |
| `watermark` | `pdf-lib` | — | — | server | pdf | pdf | exact |
| `redact` | `pdfjs` | `pdf-lib` | — | server | pdf | pdf | high |
| `compare` | `pdfjs` | — | — | server | pdf | txt; html | approximate |
| `encrypt` | `pdf-lib` | `webcrypto` | — | server | pdf | pdf | exact |
| `decrypt` | `pdf-lib` | — | — | server | pdf | pdf | exact |
| `ai-summarize` | `ollama` | `pdfjs` | — | server | pdf | txt; md | approximate |
| `ai-chat` | `ollama` | `pdfjs` | — | server | pdf | txt | approximate |
| `ai-tables` | `pdfjs` | `xlsx-writer` | — | server | pdf | csv; json; xlsx | approximate |
| `ai-translate` | `ollama` | `pdfjs` | — | server | pdf | txt; pdf | approximate |
| `ai-workspace` | `ollama` | `pdfjs` | — | server | pdf | txt; md; csv | approximate |

## Per-tool limits and validation

### `merge` — pdf-lib

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- Encrypted inputs must be unlocked first

**Output validation performed**

- Re-open output; page count equals the sum of inputs
- Page text follows the chosen file order

### `split` — pdf-lib

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- One source document per run

**Output validation performed**

- Every part re-opens as a valid PDF with the expected page count

### `rearrange` — pdf-lib

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- Rotation is stored per page, not baked into content streams

**Output validation performed**

- Output order and page count match the grid

### `extract` — pdf-lib

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- Selection is bounded by the real page count

**Output validation performed**

- Combined PDF contains exactly the selected pages in display order
- Per-page and ZIP outputs are individually valid

### `rotate` — pdf-lib

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- Rotation is a multiple of 90 degrees

**Output validation performed**

- Per-page rotation angle is read back from the output

### `compress` — pdfjs (fallback: pdf-lib)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Pages are re-encoded as images, so the text layer is lost
- Reduction ratio depends on the source content

**Output validation performed**

- Page count is preserved and output size is reported honestly

### `repair` — pdfjs (fallback: pdf-lib)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Severely truncated files cannot be recovered
- Recovered pages are re-encoded

**Output validation performed**

- Unrecoverable input raises an actionable error instead of emitting an empty PDF

### `ocr` — tesseract (fallback: pdfjs)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Language data downloads on first use
- Accuracy depends on scan quality and language pack

**Output validation performed**

- Recognised text is embedded as a selectable layer on each page

### `pdf-to-word` — docx (fallback: pdfjs)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Paragraphs are rebuilt from positioned text lines, not Word layout

**Output validation performed**

- Output opens as a valid OOXML package containing the source text

### `pdf-to-excel` — xlsx-writer (fallback: pdfjs)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Table detection is heuristic and column-alignment based

**Output validation performed**

- Workbook opens with one sheet per detected table

### `pdf-to-powerpoint` — pptxgenjs (fallback: pdfjs)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Each slide is a raster of the source page

**Output validation performed**

- Slide count equals page count

### `pdf-to-jpg` — pdfjs

*Fidelity:* high — Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer

**Known limits**

- JPEG is lossy

**Output validation performed**

- Image count equals page count and dimensions follow page geometry

### `pdf-to-png` — pdfjs

*Fidelity:* high — Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer

**Known limits**

- Very high DPI on large pages needs memory

**Output validation performed**

- Image count equals page count at 1:1 pixel ratio

### `pdf-to-markdown` — pdfjs

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Headings and lists are inferred from font size and indentation

**Output validation performed**

- Every source page contributes its text

### `pdf-to-text` — pdfjs

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- Text only: images and layout are dropped by definition

**Output validation performed**

- Extracted text contains the known fixture strings

### `pdf-to-pdfa` — pdf-lib

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Native server engine:** `verapdf-worker` — executed by the engine deployed in this image.

**Known limits**

- Adds archival metadata and normalises fonts; this is not an ISO 19005 validator pass
- veraPDF is AGPL-licensed and therefore not bundled without explicit approval

**Output validation performed**

- Output re-opens and preserves page count

### `word-to-pdf` — ooxml-parser (fallback: pdf-lib)

*Fidelity:* high — Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer

**Native server engine:** `libreoffice-worker` — executed by the engine deployed in this image.

**Known limits**

- Browser layout engine: paragraphs, runs, tables, margins and page breaks are preserved
- Floating shapes, text boxes and exact Word font metrics are approximations

**Output validation performed**

- No OOXML markup reaches the page
- Malformed XML raises DocxParseError

### `excel-to-pdf` — ooxml-parser (fallback: pdf-lib)

*Fidelity:* high — Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer

**Native server engine:** `libreoffice-worker` — executed by the engine deployed in this image.

**Known limits**

- Merged cells are simplified
- Very wide sheets are scaled to fit

**Output validation performed**

- Sheet names and cell text appear in the output

### `powerpoint-to-pdf` — ooxml-parser (fallback: pdf-lib)

*Fidelity:* high — Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer

**Native server engine:** `libreoffice-worker` — executed by the engine deployed in this image.

**Known limits**

- Slide text is laid out one page per slide; themes and animations are dropped

**Output validation performed**

- Slide count equals page count

### `image-to-pdf` — pdf-lib

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- One image per page, fitted to the page box

**Output validation performed**

- Page count equals image count and dimensions match the chosen size

### `markdown-to-pdf` — ooxml-parser (fallback: pdf-lib)

*Fidelity:* high — Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer

**Known limits**

- Inline HTML is flattened to text

**Output validation performed**

- Headings and list items appear as text

### `html-to-pdf` — ooxml-parser (fallback: pdf-lib)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Native server engine:** `chromium-worker` — executed by the engine deployed in this image.

**Known limits**

- Sanitised text layout only: CSS is not applied
- A Chromium worker would give true layout

**Output validation performed**

- Scripts and styles never reach the output

### `webpage-to-pdf` — ooxml-parser (fallback: pdf-lib)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Native server engine:** `chromium-worker` — executed by the engine deployed in this image.

**Known limits**

- Subject to the target site CORS policy
- Not available in Strict Local Mode

**Output validation performed**

- Non-fetchable URLs raise an actionable error

### `editor` — pdfjs (fallback: pdf-lib)

*Fidelity:* high — Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer

**Known limits**

- Annotations are flattened into the page on export

**Output validation performed**

- Exported PDF re-opens with the added objects

### `sign` — pdf-lib

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- Visual signature, not a certificate-based digital signature

**Output validation performed**

- Signature XObject exists at the chosen rectangle on the target page

### `forms` — pdf-lib

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- Only existing AcroForm fields can be filled

**Output validation performed**

- Field values persist after flattening

### `watermark` — pdf-lib

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- Text watermarks are drawn into the page content

**Output validation performed**

- Watermark text is present in the output text layer

### `redact` — pdfjs (fallback: pdf-lib)

*Fidelity:* high — Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer

**Known limits**

- Redacted pages are re-rendered as images so the original text objects are not carried over
- Residual object data has not been audited with an independent extraction tool

**Output validation performed**

- Redacted text is absent from the re-extracted text layer

### `compare` — pdfjs

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Text-level diff, not a visual diff

**Output validation performed**

- Added and removed lines are both reported

### `encrypt` — pdf-lib (fallback: webcrypto)

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- Permissions were not verified with a third-party PDF reader

**Output validation performed**

- Wrong password is rejected and the correct password re-opens the file

### `decrypt` — pdf-lib

*Fidelity:* exact — Structural PDF operation — output is the original page content, not a re-render

**Known limits**

- Requires the correct password; nothing is brute-forced

**Output validation performed**

- Unlocked output opens without a password

### `ai-summarize` — ollama (fallback: pdfjs)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Runs on Folio's server with a deterministic extractive summariser
- No external AI provider, API key or paid credit is involved

**Output validation performed**

- Summary is derived from the document text, never invented

### `ai-chat` — ollama (fallback: pdfjs)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Answers are extractive: ranked passages are quoted with page citations
- No external AI provider is contacted

**Output validation performed**

- Every citation maps to a real page

### `ai-tables` — pdfjs (fallback: xlsx-writer)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Column detection is positional and can merge wrapped cells

**Output validation performed**

- Exported rows match the detected grid

### `ai-translate` — ollama (fallback: pdfjs)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Layout is not re-flowed per language
- Translation quality is limited to the extracted text

**Output validation performed**

- Output keeps page structure and never drops source paragraphs silently

### `ai-workspace` — ollama (fallback: pdfjs)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Hub over the other AI tools; inherits their limits

**Output validation performed**

- Delegates to the individual tools rather than duplicating logic

## Engines deployed in this image

Folio runs one processing architecture: the browser is a client and every document operation runs on
Folio's own server.

| Engine | Deployed as | Used by | Licence |
|---|---|---|---|
| qpdf | `qpdf` binary | compress, repair, encrypt, decrypt, structural page work | Apache-2.0 (class B) |
| poppler-utils | `pdftoppm`, `pdftotext`, `pdfinfo` | pdf-to-jpg, pdf-to-png, redact rasterisation, text extraction, page counts | GPL-2.0 programs invoked as separate processes (class B, documented) |
| Tesseract | `tesseract-ocr` + English data | ocr | Apache-2.0 (class B) |
| LibreOffice | `soffice --headless` | Office/HTML/Markdown/webpage → PDF and PDF → Office | MPL-2.0 (class C, obligations documented) |
| pdf-lib | Node library | merge, extract, rearrange, rotate, watermark, forms, sign, editor overlays | MIT (class A) |
| ImageMagick | `convert` | image normalisation for image-to-pdf | ImageMagick licence (class B) |

Evaluation-only engines (`pyhanko-worker`, `verapdf-worker`) are not installed and no tool invokes
them.

### Resource plan

The runtime image has 1 vCPU / 1 GB. Native engines are serialised:
`FOLIO_HEAVY_CONCURRENCY=1` for LibreOffice, Tesseract and poppler batches,
`FOLIO_LIGHT_CONCURRENCY=2` for pdf-lib and qpdf work, with `FOLIO_JOB_TIMEOUT_MS=180000` and
`FOLIO_ENGINE_TIMEOUT_MS=120000`. More concurrency needs a separate worker service — see
`DEPLOYMENT.md`.

## Processing architecture

Every tool follows one path:

`User → Folio frontend → authenticated job API → engine → validated output → download`

- A job is created with declared files, uploaded into an isolated temporary directory, then started.
- The status endpoint exposes progress, stage text and cancellation.
- Outputs are validated (present, non-empty, correct type) before a download link exists.
- Temporary files are deleted after delivery; abandoned jobs expire automatically.
- There is no local/cloud mode switch — users never choose where a document is processed.

## Selection policy

1. Use the engine that performs the operation structurally; never re-render a document to simulate a
   structural edit.
2. Keep the browser to previews: PDF.js renders pages, but processing happens on Folio's server.
3. When a native engine would materially improve fidelity, declare it as `preferredWorker` and tell
   the user which engine produced their file.
4. Never select an engine whose licence class is C or D.
5. Never substitute a lower-fidelity engine without recording a warning on the job.
