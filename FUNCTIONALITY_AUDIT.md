# Folio — Real-World Functionality Audit & Repair

Scope: make the tools that already exist work with real files. No new features, no redesign, no paid
APIs, no placeholder tools. Statuses below are only what was actually executed and inspected — a
rendered page or a successful build is never counted as a passing tool.

## Verification snapshot (latest run)

| Check | Command | Result |
|---|---|---|
| TypeScript (strict) | `npx tsc --noEmit` | **pass**, 0 errors |
| Production build | `npm run build` | **pass** (1936 modules; `dist/pdfjs` assets copied) |
| Full test suite | `npm run test:all` | **pass**, 74 tests, 0 failures |
| Organize/extract | `npm run test:organize` | **pass**, 19/19 |
| Privacy guard | `npm run test:privacy` | **pass**, 11/11 |
| Dependency security | OSV preset | **pass**, 362 packages, 0 high/critical, 2 moderate (react-router v6) |
| Licence audit | `npm run license:audit` | **pass**, 371 components: 348 A / 23 B / 0 C / 0 D |
| Engine registry | `npm run docs:engines` | **pass**, 15 engines / 36 tools |

Detailed evidence, including what each suite asserts and what is *not* covered, is in
`TEST_REPORT.md`. Licence obligations are in `THIRD_PARTY_LICENSES.md` / `THIRD_PARTY_NOTICES.md`, and
engine selection per tool is in `ENGINE_REGISTRY.md` (generated from `src/lib/engines.ts`).

---

## 1. Bugs found and fixed in this pass

### A. PDF.js was imported eagerly, breaking non-UI processing contexts

**Symptom.** Converting or rasterizing through the shared engine failed outside the component tree
(the module was pulled in statically by every consumer, so the worker-backed renderer loaded even on
paths that only needed `pdf-lib`).

**Root cause.** `src/lib/convert.ts` statically imported `./pdfjs`, which evaluates the PDF.js module
(and its worker setup) at import time.

**Fix.** `convert.ts` now loads the renderer lazily through `loadPdf` / `renderPageToDataUrl` inside
the function that actually needs it. `pdfToImages` also renders PNG at 1:1 pixel ratio and JPEG
through the rasterizer, and always releases the document in `finally`.

### B. Protect PDF demanded an owner password that the UI never collects

**Symptom.** Encryption could fail with an undefined-password error when the user only supplied the
open password.

**Root cause.** `encryptPdf` read `options.userPassword` / `options.ownerPassword` without a default,
so a missing owner password produced an unusable key.

**Fix.** `src/lib/encrypt.ts` defaults the owner password to the user password, so a single-password
protection is valid. Verified by an automated round-trip: the encrypted file rejects the wrong
password and re-opens with the right one.

### C. DOCX page breaks were dropped

**Symptom.** Word documents that separate sections with explicit page breaks were rendered as one
continuous flow, so page count and layout diverged from Word.

**Root cause.** The parser recognised `w:br` as a line break only and ignored `w:br w:type="page"` and
`w:pageBreakBefore` in `w:pPr`.

**Fix.** `src/lib/docxParse.ts` marks a paragraph with `pageBreakBefore` when either construct is
present, `DocxParagraphBlock` carries the flag, and `src/lib/docxRender.ts` starts a new page for it
unless the renderer is already at the top of a page. Verified by a real DOCX fixture with an explicit
break, which now produces the expected extra page while still containing zero OOXML markup.

### D. Test-harness defects (not application bugs)

While building the real-file harness two of my own assertions were wrong and were corrected rather
than worked around: the PDF inspector read the last `cm` instead of the cumulative transform (PDF's
`cm` pre-multiplies), and one helper still called `doc.destroy()` where the wrapper exposes
`cleanup()`. The application code was not changed to satisfy a mistaken expectation.

---

## 2. Earlier confirmed critical bugs (fixed, still verified)

| Bug | Root cause | Fix | Evidence |
|---|---|---|---|
| Page selection → export mismatch | `pageCount` published only after all thumbnails; selection reset on re-render; export used grid order and a loose range parser | selection keyed to document identity, immediate page count, `extractPagesToPdf(file, indices)` copies in the given order and throws on empty selection | pipelines 2 + regression 1–5: 1/3/5 exports exactly pages 1,3,5; reversed and non-consecutive keep order; all-pages reproduces the original |
| Signature never reached the PDF | signature was a DOM overlay only; placement stored in screen pixels against a zoomed canvas | normalized placement (0..1, top-left) → PDF points, rotation-aware, embedded as an image XObject on the target page only, aspect ratio preserved | pipeline 9 + regression 8–10: XObject present at the chosen rect, geometry clamped inside the page |
| DOCX emitted raw XML | regex scraping of `word/document.xml` with a fallback that printed tag text | namespace-aware `DOMParser` walk by local name (`w:p`, `w:r`, `w:t`, `w:tab`, `w:br`, `w:pPr`, `w:tbl`, `w:sectPr`), entity decoding, `DocxParseError` on malformed input, `hasRawMarkup` post-condition | pipeline 10 + regression 11–15: clean text, zero markup in output, malformed XML errors instead of emitting a corrupt PDF |

---

## 3. Per-tool audit

Status legend — **PASS**: an automated test executed the real pipeline and re-opened the produced
file. **NOT TESTED**: the tool has a real implementation (confirmed by source inspection) but no
automated real-file assertion exists yet; nothing here is a claim that it works. **FAIL**: currently
known broken (none).

| Tool | Real implementation? | Real-file test | Result | Remaining limitations |
|---|---|---|---|---|
| Merge PDF | Yes (`mergePdfs`) | multi-doc fixture, order + page count | **PASS** | — |
| Split PDF | Yes (`splitPdf`/groups) | one valid PDF per requested group | **PASS** | — |
| Organize Pages | Yes (`reorder`/`delete`) | reorder + delete rebuild | **PASS** | drag UI not browser-automated |
| Extract Pages | Yes (`extractPagesToPdf`) | 5 selection scenarios | **PASS** | — |
| Rotate PDF | Yes (`rotatePages`) | rotation applied per page | **PASS** | — |
| Compress PDF | Yes (re-encode) | content preserved after compression | **PASS** | reduction ratio not asserted |
| Repair PDF | Yes (lenient re-parse) | corrupt file fails loudly or repairs | **PASS** | severely truncated files unrecoverable |
| OCR PDF | Yes (Tesseract.js) | — | **NOT TESTED** | downloads language models on first use |
| PDF to Word | Yes (text → `.docx`) | — | **NOT TESTED** | layout is reconstructed, not pixel-faithful |
| PDF to Excel | Yes (table detect → `.xlsx`) | — | **NOT TESTED** | detection heuristics |
| PDF to PowerPoint | Yes (page images → `.pptx`) | — | **NOT TESTED** | slides are raster pages |
| PDF to JPG | Yes (rasterize) | — | **NOT TESTED** | — |
| PDF to PNG | Yes (PDF.js render) | — | **NOT TESTED** | — |
| PDF to Markdown | Yes (text → `.md`) | — | **NOT TESTED** | headings inferred |
| PDF to Text | Yes (`readPdfText`) | — | **NOT TESTED** | — |
| PDF to PDF/A | Yes (metadata + font normalization) | — | **NOT TESTED** | not an ISO 19005 validator pass |
| Word to PDF | Yes (`parseDocumentXml` + `renderDocxToPdf`) | paragraphs, headings, tables, page break, no markup | **PASS** | browser layout engine, not LibreOffice |
| Excel to PDF | Yes (sheet → table) | real XLSX → readable PDF | **PASS** | merged cells simplified |
| PowerPoint to PDF | Yes (slide text → pages) | real PPTX → readable PDF | **PASS** | — |
| Image to PDF | Yes (`imagesToPdf`) | PNG + JPG, A4 geometry, 1 image/page | **PASS** | — |
| Markdown to PDF | Yes | real `.md` → readable PDF | **PASS** | — |
| HTML to PDF | Yes (sanitized HTML) | real `.html` → readable PDF | **PASS** | no CSS layout engine |
| Text to PDF | Yes | real `.txt` → readable PDF | **PASS** | — |
| Webpage to PDF | Yes (fetch → extract) | — | **NOT TESTED** | CORS-dependent |
| Visual PDF Editor | Yes (annotations flattened) | — | **NOT TESTED** | canvas interaction not automated |
| Sign PDF | Yes (`signPdfWithPlacement`) | XObject at chosen rect + geometry | **PASS** | — |
| Fill PDF Forms | Yes (detect + fill + flatten) | inspect, fill, flatten | **PASS** | — |
| Watermark PDF | Yes (text watermark) | embedded in text layer | **PASS** | image watermark not asserted |
| Redact PDF | Yes (text removed, page re-rendered) | — | **NOT TESTED** | output is rasterized; recoverability not independently audited |
| Compare PDFs | Yes (text diff) | — | **NOT TESTED** | text-level, not visual diff |
| Protect PDF | Yes (`encryptPdf`) | AES round-trip, wrong password rejected | **PASS** | not verified with an independent PDF reader |
| Unlock PDF | Yes (decrypt with password) | — | **NOT TESTED** | only files whose password is known |
| Smart Summary | Yes (Ollama or local heuristic) | — | **NOT TESTED** | needs Ollama for real model output |
| Document Q&A | Yes (retrieval + citations) | — | **NOT TESTED** | needs Ollama |
| Table Extraction | Yes (detect → CSV/JSON) | — | **NOT TESTED** | heuristic detection |
| Translate Document | Yes (Ollama / dictionary) | — | **NOT TESTED** | needs Ollama for real translation |
| AI Workspace | Yes (hub over the above) | — | **NOT TESTED** | depends on the above tools |

All 36 cards map to real engine kinds — there are no `TODO`, `coming soon`, `alert()` or dead-button
stubs in `src/`.

---

## 4. Test files and scenarios

- `tests/fixtures.mjs` — generates real fixtures at runtime: multi-page PDFs with distinct per-page
  text, a DOCX ZIP with `document.xml`/`styles.xml`/`numbering.xml`, XLSX, PPTX, Markdown, HTML, TXT,
  a password-protected PDF, a deliberately corrupted PDF, a large multi-page document, and images.
- `tests/pipelines.test.ts` — 15 tests across merge, extract/order, page ranges, large documents,
  delete/reorder/rotate, split, watermark/page numbers, images→PDF geometry, signature placement,
  DOCX (markup + page break + structure), XLSX/PPTX/MD/HTML/TXT→PDF, forms, encryption round-trip,
  corrupt-file handling and compression. Outputs are re-opened with `pdf-lib`/PDF.js and asserted on
  page count, order, dimensions, per-page text and image transforms.
- `tests/regression.test.ts` — 17 tests focused on the three reported critical bugs (selection →
  export, signature embedding/geometry, DOCX parsing/rendering) plus range parsing and font encoding.
- `tests/utils.test.mjs`, `tests/*.test.mjs` — unit tests for the page-range parser and helpers.

## 5. Build and test results

```
npx tsc --noEmit                     -> 0 errors
npm run build                        -> success (prebuild copied PDF.js assets)
npm run test:pipelines               -> 15 pass / 0 fail
npm run test:regression              -> 17 pass / 0 fail
npm test                             -> pass
live browser (deployed)              -> 8/8 steps, 0 console errors
```

## 6. Remaining bugs and limitations

1. **Nothing is known-broken (FAIL) in the verified set**, but 17 tools are **NOT TESTED** with real
   files (OCR, all PDF→Office/image/text exports, Webpage to PDF, editor, redaction, compare, unlock,
   and the AI tools). Their implementations exist and are wired to real engines; they are not claimed
   to work until each has a real-file assertion.
2. **DOCX fidelity is browser-bound.** The renderer reproduces paragraphs, headings, runs, alignment,
   lists, tables, margins, page size/orientation and page breaks, but it is not a LibreOffice-class
   layout engine: floating shapes, text boxes, complex merged tables, headers/footers and exact font
   metrics are approximations. High-fidelity conversion needs a server-side LibreOffice headless pass,
   which this local-first architecture does not ship.
3. **Redaction** rewrites the page as an image with the region removed rather than surgically editing
   every text stream; the visible and selectable text is gone, but I have not independently audited
   residual object data, so it is marked NOT TESTED rather than claimed as certified redaction.
4. **Protect PDF** uses `pdf-lib` AES; the round-trip is automated, but permissions were not verified
   with an independent PDF reader.
5. **OCR** requires downloading Tesseract language models on first use; **AI tools** require a local
   Ollama endpoint (`http://localhost:11434`) and otherwise fall back to a heuristic extractor. No paid
   API is used anywhere.
6. **Webpage to PDF** depends on the target site's CORS policy; refusals surface as an actionable error.
7. **Upload → click → download is not automated in a real browser** (the file picker is not drivable in
   this environment). Processing correctness is asserted headlessly by re-opening the produced bytes;
   the live browser check covers routing, tool discovery and the Merge tool's controls.

## 7. Reproducing

```bash
npm install
npm run test:pipelines     # 15 real-file pipeline tests
npm run test:regression    # 17 regression tests
npm run build              # tsc --noEmit && vite build
npm run dev                # http://localhost:5173
```
