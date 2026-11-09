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
| Tools running fully in the browser | 32 |
| Tools needing a document worker (unavailable in Strict Local Mode) | 4 |
| Tools with a higher-fidelity worker engine available | 6 |
| Engines not bundled in this deployment | 6 |
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
| `libreoffice-worker` | LibreOffice headless (document worker) | High-fidelity Office rendering and PDF/A export | MPL-2.0 | C | document-worker | not bundled |
| `chromium-worker` | Chromium via Playwright (document worker) | Real CSS layout for HTML and webpage to PDF | Apache-2.0 (Chromium: BSD-3-Clause and others) | C | document-worker | not bundled |
| `qpdf-worker` | qpdf (document worker) | Structural PDF repair, linearization and inspection | Apache-2.0 | B | document-worker | not bundled |
| `pyhanko-worker` | pyHanko (document worker) | Certificate-based digital signatures | MIT | A | document-worker | not bundled |
| `verapdf-worker` | veraPDF (document worker) | ISO 19005 (PDF/A) conformance validation | AGPL-3.0 / MPL-2.0 mix | D | document-worker | not bundled |

Licence classes follow the policy in `THIRD_PARTY_LICENSES.md`: **A** approved, **B** approved with
notice obligations, **C** requires legal review, **D** rejected. Class C and D engines are listed for
evaluation only and are **not** invoked by any tool; `unapprovedEngines()` returns them so the build
can assert this.

## Tool → engine matrix

| Tool | Primary | Fallback | Preferred worker engine | Side | Inputs | Outputs | Fidelity |
|---|---|---|---|---|---|---|---|
| `merge` | `pdf-lib` | — | — | browser | pdf | pdf | exact |
| `split` | `pdf-lib` | — | — | browser | pdf | pdf | exact |
| `rearrange` | `pdf-lib` | — | — | browser | pdf | pdf | exact |
| `extract` | `pdf-lib` | — | — | browser | pdf | pdf; zip | exact |
| `rotate` | `pdf-lib` | — | — | browser | pdf | pdf | exact |
| `compress` | `pdfjs` | `pdf-lib` | — | browser | pdf | pdf | approximate |
| `repair` | `pdfjs` | `pdf-lib` | — | browser | pdf | pdf | approximate |
| `ocr` | `tesseract` | `pdfjs` | — | browser | pdf | pdf; txt | approximate |
| `pdf-to-word` | `docx` | `pdfjs` | — | browser | pdf | docx | approximate |
| `pdf-to-excel` | `xlsx-writer` | `pdfjs` | — | browser | pdf | xlsx; csv | approximate |
| `pdf-to-powerpoint` | `pptxgenjs` | `pdfjs` | — | browser | pdf | pptx | approximate |
| `pdf-to-jpg` | `pdfjs` | — | — | browser | pdf | jpg; zip | high |
| `pdf-to-png` | `pdfjs` | — | — | browser | pdf | png; zip | high |
| `pdf-to-markdown` | `pdfjs` | — | — | browser | pdf | md | approximate |
| `pdf-to-text` | `pdfjs` | — | — | browser | pdf | txt | exact |
| `pdf-to-pdfa` | `pdf-lib` | — | `verapdf-worker` | browser | pdf | pdf | approximate |
| `word-to-pdf` | `ooxml-parser` | `pdf-lib` | `libreoffice-worker` | browser | docx | pdf | high |
| `excel-to-pdf` | `ooxml-parser` | `pdf-lib` | `libreoffice-worker` | browser | xlsx; csv | pdf | high |
| `powerpoint-to-pdf` | `ooxml-parser` | `pdf-lib` | `libreoffice-worker` | browser | pptx | pdf | high |
| `image-to-pdf` | `pdf-lib` | — | — | browser | png; jpg; jpeg; webp | pdf | exact |
| `markdown-to-pdf` | `ooxml-parser` | `pdf-lib` | — | browser | md; markdown | pdf | high |
| `html-to-pdf` | `ooxml-parser` | `pdf-lib` | `chromium-worker` | browser | html; htm | pdf | approximate |
| `webpage-to-pdf` | `ooxml-parser` | `pdf-lib` | `chromium-worker` | browser | url | pdf | approximate |
| `editor` | `pdfjs` | `pdf-lib` | — | browser | pdf | pdf | high |
| `sign` | `pdf-lib` | — | — | browser | pdf | pdf | exact |
| `forms` | `pdf-lib` | — | — | browser | pdf | pdf | exact |
| `watermark` | `pdf-lib` | — | — | browser | pdf | pdf | exact |
| `redact` | `pdfjs` | `pdf-lib` | — | browser | pdf | pdf | high |
| `compare` | `pdfjs` | — | — | browser | pdf | txt; html | approximate |
| `encrypt` | `pdf-lib` | `webcrypto` | — | browser | pdf | pdf | exact |
| `decrypt` | `pdf-lib` | — | — | browser | pdf | pdf | exact |
| `ai-summarize` | `ollama` | `pdfjs` | — | local-model | pdf | txt; md | approximate |
| `ai-chat` | `ollama` | `pdfjs` | — | local-model | pdf | txt | approximate |
| `ai-tables` | `pdfjs` | `xlsx-writer` | — | browser | pdf | csv; json; xlsx | approximate |
| `ai-translate` | `ollama` | `pdfjs` | — | local-model | pdf | txt; pdf | approximate |
| `ai-workspace` | `ollama` | `pdfjs` | — | local-model | pdf | txt; md; csv | approximate |

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

**Higher-fidelity option:** `verapdf-worker` — requires the document worker described below; unavailable in Strict Local Mode.

**Known limits**

- Adds archival metadata and normalises fonts; this is not an ISO 19005 validator pass
- veraPDF is AGPL-licensed and therefore not bundled without explicit approval

**Output validation performed**

- Output re-opens and preserves page count

### `word-to-pdf` — ooxml-parser (fallback: pdf-lib)

*Fidelity:* high — Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer

**Higher-fidelity option:** `libreoffice-worker` — requires the document worker described below; unavailable in Strict Local Mode.

**Known limits**

- Browser layout engine: paragraphs, runs, tables, margins and page breaks are preserved
- Floating shapes, text boxes and exact Word font metrics are approximations

**Output validation performed**

- No OOXML markup reaches the page
- Malformed XML raises DocxParseError

### `excel-to-pdf` — ooxml-parser (fallback: pdf-lib)

*Fidelity:* high — Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer

**Higher-fidelity option:** `libreoffice-worker` — requires the document worker described below; unavailable in Strict Local Mode.

**Known limits**

- Merged cells are simplified
- Very wide sheets are scaled to fit

**Output validation performed**

- Sheet names and cell text appear in the output

### `powerpoint-to-pdf` — ooxml-parser (fallback: pdf-lib)

*Fidelity:* high — Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer

**Higher-fidelity option:** `libreoffice-worker` — requires the document worker described below; unavailable in Strict Local Mode.

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

**Higher-fidelity option:** `chromium-worker` — requires the document worker described below; unavailable in Strict Local Mode.

**Known limits**

- Sanitised text layout only: CSS is not applied
- A Chromium worker would give true layout

**Output validation performed**

- Scripts and styles never reach the output

### `webpage-to-pdf` — ooxml-parser (fallback: pdf-lib)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Higher-fidelity option:** `chromium-worker` — requires the document worker described below; unavailable in Strict Local Mode.

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

- Needs a local Ollama endpoint; otherwise a deterministic extractive summary is used
- Blocked in Strict Local Mode when the endpoint is remote

**Output validation performed**

- Summary is derived from the document text, never invented

### `ai-chat` — ollama (fallback: pdfjs)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Answers are grounded in retrieved passages with page citations
- Needs Ollama for generative answers

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
- Needs Ollama for real translation

**Output validation performed**

- Output keeps page structure and never drops source paragraphs silently

### `ai-workspace` — ollama (fallback: pdfjs)

*Fidelity:* approximate — Best-effort reconstruction; the tool states the limitation in its UI before processing

**Known limits**

- Hub over the other AI tools; inherits their limits

**Output validation performed**

- Delegates to the individual tools rather than duplicating logic

## Engines that are *not* bundled

These are documented candidates. They are **not installed in this image** and no tool invokes them.
Enabling one requires: a licence entry in `THIRD_PARTY_LICENSES.md`, a worker service with resource
limits, and real-file regression tests.

| Engine | Why it is not bundled | Resource requirement if added | Licence |
|---|---|---|---|
| LibreOffice (headless) | ~500 MB–1 GB image weight, needs a native process per conversion | 1 vCPU, 1–2 GB RAM, 30 s timeout per document | MPL-2.0 (class C — review obligations before shipping) |
| qpdf | Native binary; `pdf-lib` covers the structural operations Folio advertises | 128 MB RAM, sub-second per file | Apache-2.0 (class A) |
| Apache PDFBox | JVM runtime | 512 MB heap | Apache-2.0 (class A) |
| pyHanko | Python runtime; digital signatures need a certificate authority the user supplies | 256 MB RAM | MIT (class A) |
| veraPDF | JVM runtime, large validation corpus | 1 GB heap | GPL-3.0 + MPL-2.0 (class D — **must not** be added without written approval) |
| Sharp | Native `libvips` build; `canvas` covers the raster work Folio does | 256 MB RAM | Apache-2.0 (class A) |
| Playwright + Chromium | ~400 MB image weight for HTML/URL rendering | 1 vCPU, 1 GB RAM | Apache-2.0 (class A) |

### Deployment note

The current deployment is a static build served by `server.mjs` on a single 1 vCPU / 1 GB instance.
Native engines do not fit in that process and must not be added to it. A document worker is a
separate service: it accepts a single file over an authenticated endpoint, processes it in an
isolated temporary directory, returns the result, and deletes both input and output immediately
(see `DEPLOYMENT.md` and `SECURITY_AND_PRIVACY.md`). Until such a worker exists, every tool listed
above runs entirely in the browser and Strict Local Mode is a complete guarantee for them.

## Strict Local Mode

Strict Local Mode is enforced in `src/lib/privacy.ts`, not merely advertised:

- Every outbound request must pass `guardedFetch`, which throws `LocalModeViolation` when the mode is
  on and the destination is not loopback.
- Loopback destinations (the user's own Ollama at `127.0.0.1:11434`) are permitted, so local AI keeps
  working without any document leaving the machine.
- The store registers its current mode with the guard, so the switch in the header takes effect for
  every subsequent request in the same tab.
- Every permitted transmission is recorded with its destination and purpose, and the log is
  inspectable, so "nothing left your device" is verifiable rather than claimed.

**Tools available in Strict Local Mode:** 32 of 36.

**Unavailable in Strict Local Mode:** `ai-summarize`, `ai-chat`, `ai-translate`, `ai-workspace` — these require the document worker.

## Selection policy

1. Use the engine that performs the operation structurally; never re-render a document to simulate a
   structural edit.
2. Prefer a browser engine when it reaches the required fidelity, so the document never leaves the
   device.
3. When a native engine would materially improve fidelity, declare it as `preferredWorker` and tell
   the user which engine produced their file.
4. Never select an engine whose licence class is C or D.
5. Never silently fall back from local to remote processing.
