# Security and Privacy

Folio processes documents. This document states exactly what happens to a file, what is enforced in
code, and what the limits of those guarantees are. Claims here are backed by the tests named in
`TEST_REPORT.md`.

## 1. Where documents go

| Situation | What happens to the file |
|---|---|
| Default (every tool in this build) | The file is read in the browser with `File`/`ArrayBuffer` APIs and processed by `pdf-lib` / `pdf.js` / `jszip` / `tesseract.js`. It is never uploaded. |
| Strict Local Mode **on** | Identical, and every outbound request is *refused in code* before any bytes are written to a socket. |
| Strict Local Mode **off** + local Ollama | The extracted **text** (not the file) is sent to the user's own loopback Ollama instance at `http://localhost:11434` for summarisation / Q&A / translation. |
| Strict Local Mode **off** + optional Supabase | Only preferences and job *metadata* (tool id, status, counts, timestamps) are synced. Documents are never sent. |

There is no document-upload endpoint in this application. `server.mjs` is a static file server: it
serves the built assets and nothing else. There is no route that accepts a file.

## 2. Strict Local Mode is enforced, not advertised

Implemented in `src/lib/privacy.ts`:

- **Fail-closed default.** Before the store registers the user's preference, the guard reports
  "strict local mode ON". A code path that transmits before the preference is known is refused.
- **Single choke point.** `guardedFetch(url, init)` calls `assertTransmissionAllowed` first. If the
  mode is on and the destination is not loopback, it throws `LocalModeViolation` *before* calling
  `fetch`. The Ollama calls in `src/lib/ai.ts` go through this wrapper, so the AI workspace cannot
  bypass it.
- **Loopback is allowed.** `localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]` and `*.localhost` are treated as
  the user's own machine. A remote Ollama host is blocked exactly like any other server. Host matching
  is on the parsed hostname, so `https://localhost.evil.example` is correctly rejected.
- **Auditable.** Every permitted or refused transmission is appended to a bounded (100-entry) log with
  URL, decision and reason, readable via `getTransmissionLog()`. "Nothing left your device" is
  therefore verifiable rather than asserted.

Verified by `tests/privacy.test.ts` (11 tests): remote block, loopback allow, mode-off allow,
`fetch` never invoked when blocked, bounded log, log returned as a copy.

## 3. Cloud (Supabase) is optional and metadata-only

`src/lib/supabase.ts` is inert unless `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set at
build time. When unset, every function throws `SupabaseError('not-configured')` and the app remains
fully functional offline.

- **No storage bucket, no document columns.** `assertNoDocumentPayload` recursively rejects payloads
  containing `file`, `files`, `blob`, `bytes`, `buffer`, `content`, `text`, `pages`, `document`, `pdf`,
  `base64` or any string longer than 4 KB. Settings and job rows pass through it before every write.
- **Requests go through the privacy guard**, so Strict Local Mode blocks cloud sync with a clear
  message instead of silently uploading.
- **The anon key is the only credential in the client.** It is a public key by design. Row Level
  Security policies (below) restrict every row to `auth.uid() = user_id`. A service-role key must
  never be placed in frontend env vars.
- Only email/password authentication is used; no third-party identity provider is configured.

## 4. Redaction

The Redact tool rasterises the affected pages and rebuilds them as image content, so the original text
and vector operators for those pages are not present in the output. It does not draw a rectangle over
live text.

**Limitation to state honestly:** redaction is page-level. A redacted page becomes an image; the text
of that page is gone, but *unredacted* pages of the same document keep their text layer. Users who
need to redact a small phrase on one page while keeping text elsewhere should split the document,
redact the page, and merge. This is documented in the tool's UI.

## 5. Encryption (Protect / Unlock)

`src/lib/encrypt.ts` applies the PDF standard security handler through `pdf-lib`. The password and
permissions are set by the user; the file never leaves the browser. Because there is no server, a
forgotten password cannot be recovered — this is stated in the UI.

**Limitation:** `pdf-lib` supports the standard security handler (RC4 and AES-128/256 depending on the
version's implementation). It is not a certified AES-256 implementation under ISO 32000-2, and it does
not produce PAdES digital signatures. Verified behaviour is recorded in `TEST_REPORT.md`; a
certification-grade implementation would require the pyHanko/qpdf worker described in
`ENGINE_REGISTRY.md`, which is not bundled.

Unlock removes protection from a file the user can already open or has the password for. It is a
legitimate recovery feature, not a cracking tool; there is no brute-force path.

## 6. Input validation and resource limits

- File type is checked by extension **and** content signature before parsing; a renamed file that is
  not the format it claims is rejected with an actionable message rather than a corrupt output.
- Encrypted inputs raise `PasswordError` with "unlock it first" guidance instead of an opaque failure.
- Corrupt archives/streams produce a conversion error; the app never emits a partially parsed PDF
  containing raw XML or binary fragments (the DOCX path uses `DOMParser` on the OOXML parts, not regex
  tag stripping).
- Every page-rendering loop calls `page.cleanup()` and closes the document with `doc.destroy()` in a
  `finally` block, so cancelling or failing does not leak workers (see `usePageThumbnails`, `pdfjs.ts`).
- Very large documents are processed page by page rather than all at once; batch queues report
  per-file progress and per-file errors so one bad file does not abort the queue.

## 7. Temporary files and retention

In this build there are no server-side temporary files, because there is no server-side processing.
Nothing is retained: outputs exist as in-memory `Blob`s and are released when the page is closed.

If a document worker is added later (LibreOffice, qpdf, PDFBox), it must: accept one file per
authenticated request, process it in a per-request isolated directory, stream the result back, delete
input and output in a `finally` block, sweep abandoned directories after a short expiry, and never
write document bytes to logs. That contract is a precondition for enabling any worker-side engine.

## 8. Secrets

No secret is present in the repository or the client bundle. `VITE_*` variables are build-time public
values; the Supabase anon key is intentionally public and constrained by RLS. If cloud sync is
enabled, the service-role key stays server-side and is never referenced by frontend code.

## 9. Reporting

Security issues should be reported privately to the maintainer rather than in a public issue. Include
the tool, the file type and the observed behaviour; do not attach a sensitive document — a minimal
synthetic reproduction is enough.
