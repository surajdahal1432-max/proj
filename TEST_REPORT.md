# Test Report

Evidence for the current revision. Every number below comes from a command that was actually run in
this repository; nothing here is inferred from a rendered page or a successful build.

## 1. Summary

| Check | Command | Result |
|---|---|---|
| TypeScript (strict) | `npx tsc --noEmit` | **PASS** — 0 errors |
| Production build | `npm run build` | **PASS** — 1936 modules, `dist/pdfjs` assets copied |
| Full test suite | `npm run test:all` | **PASS** — 74 tests, 0 failures |
| Organize/extract suite | `npm run test:organize` | **PASS** — 19/19 |
| Privacy guard suite | `npm run test:privacy` | **PASS** — 11/11 |
| Dependency security | `run_tests(preset: security)` (OSV) | **PASS** — 362 packages, 0 high/critical, 2 moderate |
| Licence audit | `npm run license:audit` | **PASS** — 371 components: 348 A, 23 B, 0 C, 0 D |
| Engine registry | `npm run docs:engines` | **PASS** — 15 engines, 36 tools mapped |

Test totals: `npm run test:all` runs `tests/*.test.mjs` (12 tests) and then
`pipelines.test.ts` + `regression.test.ts` + `organize.test.ts` + `privacy.test.ts` (62 tests).

## 2. What the suites actually assert

### `tests/organize.test.ts` — 19 tests

Real PDFs are generated with an independent generator, then processed and re-opened:

- **Extract:** only selected pages survive, in the selected order; non-consecutive and reversed
  selections keep their order; a single selection yields exactly one page; every page selected
  reproduces the document; out-of-range indices are dropped and an empty selection fails loudly;
  the per-page ZIP bundle contains N separate, individually valid PDFs.
- **Merge:** documents are concatenated in queue order, page count equals the sum of inputs, mixed
  page sizes are preserved in order, an empty selection is rejected.
- **Split:** every page becomes its own valid PDF; custom ranges produce the requested groupings;
  out-of-range groups are dropped rather than corrupting the output.
- **Organize:** reorder supports duplicates and arbitrary order; deleting pages keeps the remaining
  order; deleting every page is refused.
- **Rotate:** rotation is written into the output document; per-page rotation overrides the global
  value.
- **Fixture sanity:** the independent generator itself produces readable text, so the assertions are
  not comparing an engine against itself.

### `tests/regression.test.ts` — 17 tests (within the 62)

- Merge keeps input order and every page; large documents keep page identity.
- Watermark and page numbers are embedded in the **text layer**, not just drawn visually.
- Signature is embedded as an XObject at the placement the user chose; geometry stays on the page and
  keeps aspect ratio; every placement normalises to a valid rect.
- DOCX → PDF never leaks OOXML markup and keeps structure; a document without styles/numbering parts
  still parses; malformed XML raises a conversion error instead of producing a broken PDF.
- XLSX, PPTX, Markdown, HTML and plain text convert to readable PDFs.
- Forms can be inspected, filled and flattened.
- Encryption round-trips and rejects a wrong password.
- Corrupted PDFs either fail loudly or repair into a readable file — never silently succeed.
- Low-level compression preserves content.

### `tests/pipelines.test.ts` — 15 tests (within the 62)

End-to-end paths for merge, split, extract, organize, rotate, images-to-PDF, DOCX, XLSX, PPTX,
Markdown/HTML/text, forms, encryption, repair and compression, each asserting the produced file is
valid and contains what the operation promised.

### `tests/privacy.test.ts` — 11 tests

- Fail-closed: strict mode is ON before the store registers a preference (a throwing provider is
  treated as ON).
- Loopback detection: `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` allowed;
  `localhost.evil.example`, `192.168.1.10` and non-URLs rejected.
- A remote destination throws `LocalModeViolation`, and the refusal is recorded with reason
  `strict-local-blocked`.
- Loopback Ollama is allowed and recorded as `loopback`; with the mode off, remote is recorded as
  `local-mode-off`.
- `guardedFetch` never invokes `fetch` when blocked (asserted with a spy that would set a flag).
- The log is bounded at 100 entries, clearable, and returned as a copy so callers cannot mutate
  guard state.

### `tests/utils.test.mjs` — 12 tests

Page-range parsing: spaced and half-spaced ranges, out-of-document ranges, clamping past the end,
open-ended `8-`, negative `-1` (last page), mixed lists with duplicates, reversed ranges, en/em dash
separators, semicolons, junk and zero, plus `formatPageRanges` round-tripping.

## 3. Dependency security

`run_tests(preset: security)` — OSV-Scanner, 362 packages checked, 0 high/critical findings.

Two **moderate** advisories remain, both in `react-router@6.30.6`:

| Advisory | Severity | Fixed in |
|---|---|---|
| GHSA-337j-9hxr-rhxg — constructor injection via `deserializeErrors()` in SSR hydration | moderate | 7.18.0 |
| GHSA-wrjc-x8rr-h8h6 — open redirect via backslash in `<Link>`/`useNavigate` | moderate | 7.18.0 |

Both fixes require a **major** upgrade to React Router 7, which is a breaking change to routing and
out of scope for this pass. Both advisories concern SSR hydration and navigation to attacker-supplied
URLs; Folio is a client-only SPA that does not use `deserializeErrors()` or hydrate server data, and
it does not navigate to user-supplied URLs. Recorded as a known limitation rather than silently
suppressed.

## 4. Licence audit

`npm run license:audit` inspects the installed tree and classifies each component:

| Class | Count | Meaning |
|---|---|---|
| A | 348 | approved for commercial distribution |
| B | 23 | approved, ship licence text + notice |
| C | 0 | requires legal review |
| D | 0 | reject / replace |

No GPL, AGPL, SSPL or other reciprocal licence is present. The classifier evaluates licence
*expressions*: `jszip` (`MIT OR GPL-3.0`) elects MIT and `pako` (`MIT AND Zlib`) is permissive, so
neither is falsely flagged. Artefacts: `THIRD_PARTY_COMPONENTS.csv`, `THIRD_PARTY_LICENSES.md`,
`THIRD_PARTY_NOTICES.md`, `sbom.cdx.json` (CycloneDX 1.5).

## 5. Engine registry

`npm run docs:engines` regenerates `ENGINE_REGISTRY.md` from `src/lib/engines.ts`: 15 engines,
36 tools, 32 browser-side, 4 requiring a document worker, 6 with a higher-fidelity worker engine
available, 3 engines with an unapproved licence class that no tool invokes.

## 6. Not covered by automated tests

Stated plainly rather than marked as passing:

- **Interactive canvas editing** (Visual Editor drag/resize, signature drawing with mouse and touch,
  page-thumbnail drag-and-drop) is not automated. The underlying placement maths and the PDF
  embedding are covered by `regression.test.ts`; the pointer interaction itself is not.
- **OCR** downloads language data on first use; no OCR run is asserted here.
- **AI tools** require a local Ollama instance; the local heuristic fallback is exercised by unit
  logic, but real model output is not.
- **Cloud sync** requires Supabase credentials and the schema in `DEPLOYMENT.md`; unconfigured
  behaviour (graceful `not-configured`) is the default path and no live Supabase project was used.
- **Independent PDF-reader verification** of encryption and redaction (e.g. Adobe Reader, qpdf) was
  not performed; encryption is verified by round-trip through the same engine.
- **Real Word/Excel/PowerPoint rendering fidelity** is browser-side layout, not LibreOffice. Fidelity
  is documented per tool in `ENGINE_REGISTRY.md`.
- **Browser-driven end-to-end checks** of the deployed app are reported separately in
  `FUNCTIONALITY_AUDIT.md`.

## 7. Reproducing

```bash
npm install
npm run build        # typecheck + production build (+ PDF.js asset copy)
npm run test:all     # 74 tests
npm run license:audit
npm run docs:engines
```

The `.ts` suites run under `node@22.23.4` with `tsx` (see `package.json`), because the sandbox's
default Node cannot import TypeScript directly.
