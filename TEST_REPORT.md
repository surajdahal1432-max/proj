# Folio Test Report

Verification for the central server processing migration. Only executed checks are listed; nothing
here is inferred from a rendered UI.

## Summary

| Check | Command | Result |
|---|---|---|
| TypeScript + production build | `npm run build` (`tsc --noEmit && vite build`) | **PASS** |
| Real-file server integration suite | `npm run test:server` | **PASS — 10/10** |
| Health endpoint reports engines | included in suite | PASS |
| Cross-origin request rejected | included in suite | PASS (403) |
| Unknown job not readable | included in suite | PASS (404) |

Build output at the time of writing: 1938 modules transformed, `dist/index.html` + 5 assets
(`pdfcore` 881 kB, `pdf-worker` 1.27 MB, `index` 406 kB). Only Vite chunking warnings were emitted.

## Integration suite (`tests/server.test.mjs`)

The suite spawns `server.mjs` on a free port with a temporary `FOLIO_JOB_DIR`, then drives the same
HTTP contract the browser uses:

```
POST /api/jobs {tool, files:[{name,size}], options} → 201 {jobId, uploads[]}
PUT  /api/jobs/:id/upload/:index                      (raw bytes)
POST /api/jobs/:id/start                              → 202
GET  /api/jobs/:id                                    → status/progress/outputs
GET  /api/jobs/:id/download/:index                    → output bytes
```

| # | Test | Real input | Assertion |
|---|---|---|---|
| 1 | health endpoint | — | `ok: true`, engine map present |
| 2 | merge | two multi-page PDFs | page count = sum, order preserved |
| 3 | extract | 3-page PDF, pages 1 and 3 | output has 2 pages, content matches selection |
| 4 | rotate | real PDF, 90° | page `/Rotate` and box swap asserted |
| 5 | split | real PDF, per-page ranges | every group is a valid PDF |
| 6 | pdf-to-text | real PDF | extracted text non-empty and contains known content |
| 7 | word-to-pdf | real `.docx` | valid PDF **and** re-extracted text contains no `<w:…>` markup |
| 8 | pdf-to-jpg | real PDF at 72 dpi | JPEG magic bytes inside the returned bundle |
| 9 | cross-origin POST | — | 403 |
| 10 | unknown job id | — | 404 |

Test 7 is the regression guard for the original defect where raw OOXML fragments (`<w:t>`,
`<w:tab>`, `<w:pPr>`) appeared as document text: the produced PDF is reopened through the server's
own text extractor, so a parser regression fails the suite.

## Defect found and fixed during verification

`server/app.mjs` exported `safePath` twice, so the process died at startup with
`SyntaxError: Duplicate export of 'safePath'` and **no tool could run server-side**. The export list
was corrected to `export { handleApi, HttpError, sendJson }`. Before the fix the suite failed at the
health check (server never became ready); after the fix 10/10 pass.

## What is not covered

- The other 29 registered tools have handlers and engines but were not exercised with real files in
  this round; see `FUNCTIONALITY_AUDIT.md` for per-tool status.
- Certificate-based digital signatures (pyHanko) and PDF/A validation (veraPDF) are not installed, so
  they are untested and not advertised.
- Password-protected PDF inputs, OCR language packs beyond English, and very large (multi-hundred-page)
  documents were not tested; limits are 40 MB per file and 120 MB per job.
- Browser interaction (drag-and-drop, canvas overlay placement) is covered by the build and manual
  use, not by an automated UI test in this round.
- The suite runs against a locally spawned server; the deployed instance was verified separately via
  `/api/health`.

## Reproducing

```bash
npm install
npm run build
npm run test:server      # real files through the job API
```
