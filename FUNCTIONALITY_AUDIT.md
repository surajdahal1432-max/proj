# Folio — Functionality Audit, Bug Fix & Repair

Scope: fix the three confirmed broken pipelines first, then audit every tool that actually exists in
this repository, fix shared root causes, and add a regression suite. No redesign, no new paid APIs,
no placeholder tools.

**Verification snapshot**

| Check | Command | Result |
|---|---|---|
| TypeScript (strict) | `tsc --noEmit` (inside `npm run build`) | pass, 0 errors |
| Production build | `npm run build` | pass (1934 modules, 11.1 s) |
| Regression suite | `npm test` (`tsx --test tests/*.test.ts`) | **17/17 pass** |
| Route smoke (desktop 1280 + mobile 390) | web preset, `/`, `/tools`, `/tool/extract`, `/tool/word-to-pdf`, `/tool/sign`, `/settings` | 12/12 pass, no page errors |
| Dependency advisories | OSV scan, 334 packages | 0 high/critical, 2 moderate (`react-router`, see limitations) |

---

## 1. Priority 1 — confirmed bugs

### A. PDF page selection → extraction → download

**Symptom.** Selecting pages did nothing useful; the downloaded PDF did not match the selection.

**Root cause (three separate defects, all in the selection-to-export chain):**

1. `usePageThumbnails` reported `pageCount` only after every thumbnail finished rendering, so the
   selection grid rendered with an empty page list for large PDFs — clicks had nothing to bind to.
2. Selection state was stored per-render instead of per document, so it was reset when the thumbnail
   effect re-ran (zoom, resize, re-upload), silently discarding the user's choices.
3. The export call received the *rendered grid order* rather than the selected 0-based page indices,
   and the "range" input was parsed loosely, so `1-3, 5, 8-12` produced duplicated/out-of-order pages.

**Fix.**

- `src/hooks/usePageThumbnails.ts` — publish `pageCount` immediately from the loaded document, then
  stream thumbnails in; state is keyed to the document identity.
- `src/components/tools/OrganizeTools.tsx` — `ExtractTool` rewritten: explicit selection set, range
  input, select-all/clear, dedupe + ascending sort, ZIP bundle when splitting per page.
- `src/lib/pdf.ts` — `extractPagesToPdf(file, indices)` copies the requested pages **in the given
  order**, drops out-of-range indices, and throws when the selection is empty instead of writing a
  zero-page PDF.

**Verified.** Selecting `1, 3, 5` produces a 3-page PDF containing exactly pages 1, 3, 5 in that
order; reversed and non-consecutive selections keep their order; "all pages" reproduces the original
page count; out-of-range indices are dropped and an empty selection raises an error. Covered by five
automated tests that re-open the exported bytes and compare page count and per-page text.

### B. E-signature

**Symptom.** The signature appeared in the editor but never in the downloaded file (or landed in the
wrong place).

**Root cause.**

- The signature existed only as a DOM overlay; nothing was written into the PDF document object.
- Placement was stored in screen pixels measured against a zoomed, scrolled canvas, so the PDF
  coordinates were wrong whenever zoom ≠ 100% or the window was resized.
- Page rotation was ignored, so signatures on rotated pages were mirrored/offset.

**Fix.**

- `src/lib/signature.ts` — placement is normalized (`x`, `y`, `width` in 0..1, top-left origin) and
  converted to PDF points with rotation-aware math inside `signPdfWithPlacement`; the drawn/typed/
  uploaded signature is embedded as a real image XObject via `pdf-lib` on the target page only.
- Aspect ratio is preserved: the width is clamped **before** the height is derived, so an
  out-of-range width can no longer stretch the stamp (this was the remaining geometry defect).
- `src/components/tools/EditorTools.tsx` — drag/resize/rotate operate on normalized coordinates, so
  zoom, scroll and window resize no longer shift the stamp.

**Verified.** The exported PDF is re-parsed: the signature image XObject is present on the placed page
and absent from the others; geometry stays inside the page box for degenerate inputs (negative,
overflowing, zero-width placements) and aspect ratio is retained. Three automated tests.

### C. DOCX → PDF raw XML leakage

**Symptom.** The generated PDF contained visible `<w:t>`, `<w:tab>`, `<w:pPr>` fragments, and the
corrupted input produced ~89 "paragraphs" instead of ~33.

**Root cause.** The pipeline scraped `word/document.xml` with regular expressions and, on input it did
not recognise, fell back to treating tag text as literal document text — so markup was emitted as
body copy. Namespace prefixes were hardcoded, and entity/tab/break handling was missing.

**Fix.**

- `src/lib/docxParse.ts` — namespace-aware `DOMParser` walk of the OOXML tree resolving elements by
  local name (`w:p`, `w:r`, `w:t`, `w:tab`, `w:br`, `w:cr`, `w:pPr`, `w:rPr`, `w:hyperlink`,
  `w:tbl`, `w:sectPr`), so any prefix binding works. Entities are decoded, whitespace preservation
  (`xml:space="preserve"`) and tabs/line breaks are honoured, and text is never derived from markup.
- Malformed input raises `DocxParseError` with a user-actionable message instead of emitting a broken
  PDF; `hasRawMarkup`/`blocksContainMarkup` act as a post-condition guard so markup can never reach
  the renderer.
- `src/lib/docxRender.ts` — `renderDocxToPdf` lays out headings, runs (bold/italic/underline/colour/
  size), alignment, lists, tables, page size/orientation/margins and page breaks.
- Formatting preserved: page size, orientation, margins, alignment, font family/size, bold/italic/
  underline, lists, tables, hyperlinks, page breaks.

**Verified.** A real DOCX fixture parses to clean text (33 paragraphs, zero markup); a document
without `styles.xml`/`numbering.xml` still parses; the rendered PDF re-opens and contains no XML
markup; malformed XML raises a conversion error rather than producing a corrupt file. Five tests.

---

## 2. Priority 3 — shared engine fixes

| Root cause | Where | Fix |
|---|---|---|
| Worker-backed PDF renderer imported statically by every consumer, so any non-browser import of the engine failed | `src/lib/pdf.ts` | `pdfjs` is now loaded lazily (`loadPdfjs`/`requirePdfjs`); the pure `pdf-lib` paths work headless, the browser still runs the password probe and renderer |
| Encrypted PDFs surfaced as raw library exceptions | `src/lib/pdf.ts` | Normalised to `PdfPasswordError` with actionable copy ("Unlock it first with the Unlock PDF tool") |
| Zero-based vs one-based page indexing mixed between UI and engine | `pdf.ts`, `OrganizeTools.tsx` | UI is 1-based, engine is 0-based; conversion happens once at the call site |
| Blob/URL download leaks and inconsistent filenames | `src/lib/utils.ts` | Single `downloadBlob` helper, sanitised filenames, `URL.revokeObjectURL` after 30 s |
| Unencodable characters silently corrupted standard-font text | `src/lib/pdf.ts` | `sanitizeWinAnsi` normalises text before it reaches WinAnsi fonts |

---

## 3. Priority 2 — tool audit (every tool in the repository)

36 tool entries, 17 distinct engine kinds, all 17 kinds handled by `renderTool` — no dead cards and
no orphaned registry entries. There are no `TODO`/`coming soon`/`alert()` stubs anywhere in `src/`.

Status legend — **Verified**: automated test re-opens the output. **Wiring OK**: page renders, handler
calls the real engine and produces a real Blob download, but the output was not asserted automatically
(see limitations).

| # | Tool | Upload | Processing | Preview | Download | Status |
|---|---|---|---|---|---|---|
| 1 | Merge PDF | ✅ | ✅ `mergePdfs` | thumbnails | ✅ | **Verified** |
| 2 | Split PDF | ✅ | ✅ `splitPdf` | page ranges | ✅ ZIP | **Verified** (range parsing) |
| 3 | Organize Pages | ✅ | ✅ `reorderPages`/`deletePages` | grid | ✅ | **Verified** |
| 4 | Extract Pages | ✅ | ✅ `extractPagesToPdf` | thumbnails | ✅ | **Verified** |
| 5 | Rotate PDF | ✅ | ✅ `rotatePages` | thumbnails | ✅ | Wiring OK |
| 6 | Compress PDF | ✅ | ✅ `compressPdf` | size compare | ✅ | Wiring OK |
| 7 | Repair PDF | ✅ | ✅ lenient re-parse + rebuild | stats | ✅ | Wiring OK (best-effort recovery) |
| 8 | OCR PDF | ✅ | ✅ Tesseract.js, language select | text layer | ✅ | Wiring OK (needs model download) |
| 9 | PDF to Word | ✅ | ✅ text/layout → `.docx` | text | ✅ | Wiring OK |
| 10 | PDF to Excel | ✅ | ✅ tables → `.xlsx` | table grid | ✅ | Wiring OK |
| 11 | PDF to PowerPoint | ✅ | ✅ page images → `.pptx` | slides | ✅ | Wiring OK |
| 12 | PDF to JPG | ✅ | ✅ rasterize | image grid | ✅ ZIP | Wiring OK |
| 13 | PDF to PNG | ✅ | ✅ rasterize | image grid | ✅ ZIP | Wiring OK |
| 14 | PDF to Markdown | ✅ | ✅ text → `.md` | text | ✅ | Wiring OK |
| 15 | PDF to Text | ✅ | ✅ `readPdfText` | text | ✅ | Wiring OK |
| 16 | PDF to PDF/A | ✅ | ✅ metadata + font normalisation | stats | ✅ | Wiring OK (client-side approximation) |
| 17 | Word to PDF | ✅ | ✅ `parseDocumentXml` + `renderDocxToPdf` | stats | ✅ | **Verified** |
| 18 | Excel to PDF | ✅ | ✅ sheet → table layout | preview | ✅ | Wiring OK |
| 19 | PowerPoint to PDF | ✅ | ✅ slide text → pages | preview | ✅ | Wiring OK |
| 20 | Image to PDF | ✅ | ✅ `imagesToPdf` | thumbnails | ✅ | Wiring OK |
| 21 | Markdown to PDF | ✅ | ✅ parse → laid-out PDF | preview | ✅ | Wiring OK |
| 22 | HTML to PDF | ✅ | ✅ sanitised HTML → text/layout | preview | ✅ | Wiring OK |
| 23 | Webpage to PDF | ✅ | ✅ fetch → extract → PDF | preview | ✅ | Wiring OK (CORS-dependent) |
| 24 | Visual PDF Editor | ✅ | ✅ annotations burned into PDF | canvas | ✅ | Wiring OK |
| 25 | Sign PDF | ✅ | ✅ `signPdfWithPlacement` | canvas | ✅ | **Verified** |
| 26 | Fill PDF Forms | ✅ | ✅ field detect + fill | form list | ✅ | Wiring OK |
| 27 | Watermark PDF | ✅ | ✅ text/image watermark | preview | ✅ | Wiring OK |
| 28 | Redact PDF | ✅ | ✅ text removed + page re-rendered | canvas | ✅ | Wiring OK |
| 29 | Compare PDFs | ✅ | ✅ side-by-side text diff | diff view | ✅ | Wiring OK |
| 30 | Protect PDF | ✅ | ✅ `pdf-lib` encryption | stats | ✅ | Wiring OK |
| 31 | Unlock PDF | ✅ | ✅ decrypt with password | stats | ✅ | Wiring OK |
| 32 | Smart Summary | ✅ | ✅ Ollama / local heuristic | text | ✅ | Wiring OK (Ollama optional) |
| 33 | Document Q&A | ✅ | ✅ retrieval + citations | chat | ✅ | Wiring OK (Ollama optional) |
| 34 | Table Extraction | ✅ | ✅ table detect → CSV/JSON | table grid | ✅ | Wiring OK |
| 35 | Translate Document | ✅ | ✅ Ollama / dictionary fallback | text | ✅ | Wiring OK (Ollama optional) |
| 36 | AI Workspace | ✅ | ✅ combined hub | panel | ✅ | Wiring OK |

All tools share the same queue (`useFileQueue`), validation, progress, error toast and download path,
so a fix in the shared engine applies to every tool rather than being patched per screen.

---

## 4. Priority 5 — regression system

`tests/regression.test.ts` runs with `npm test` and builds **real** fixtures at runtime (no committed
binaries, no hardcoded document content): multi-page PDFs with distinct per-page text, a genuine DOCX
ZIP built with JSZip including `word/document.xml`, `styles.xml` and `numbering.xml`.

Assertions re-open the exported bytes with `pdf-lib` and check page count, page order, page dimensions
and per-page text, plus XObject presence for signatures. The suite fails correctly: it caught two real
defects while being written (the signature aspect-ratio distortion and a wrong export assertion).

---

## 5. Remaining bugs / known limitations

1. **File-picker interaction is not browser-automatable** in this environment, so end-to-end upload →
   click → download is not asserted in a real browser. Processing correctness is instead asserted
   headlessly by re-opening the produced bytes (17 tests). Route rendering is asserted in Chromium at
   1280 px and 390 px with no page errors.
2. **PDF/A (tool 16)** is a client-side approximation (metadata + font normalisation), not a certified
   ISO 19005 validator pass. **Repair PDF (tool 7)** performs best-effort object recovery; severely
   truncated files can still be unrecoverable, in which case the tool reports an error instead of
   emitting a broken PDF.
3. **OCR** downloads Tesseract language models on first use, and **AI tools** call a local Ollama
   endpoint (`http://localhost:11434`) when configured. Without either, OCR is unavailable and the AI
   tools fall back to the local heuristic extractor — no paid API is used anywhere.
4. **Webpage to PDF (tool 23)** depends on the target site's CORS policy; cross-origin pages may be
   refused by the browser, which the tool reports as an error.
5. **Dependency advisories:** `react-router@6.30.6` carries two *moderate* advisories fixed only in
   `7.18.0`, a major migration (v6 → v7 API changes). Deliberately not upgraded in a bug-fix pass —
   both affect SSR hydration and `<Link>` redirect handling, which this client-only SPA does not use.
   Left visible rather than suppressed.

## 6. Reproducing

```bash
npm install
npm test          # 17 regression tests
npm run build     # tsc --noEmit && vite build
npm run dev       # http://localhost:5173
```
