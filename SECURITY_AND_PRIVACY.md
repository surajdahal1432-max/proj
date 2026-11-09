# Folio Security and Privacy

Folio processes documents on its own server. This document states exactly what leaves the device,
what is stored, and how jobs are isolated.

## What the user is told

- Files are uploaded only when the user starts a tool; nothing is uploaded while browsing or
  previewing.
- The processing page states that the file is sent to Folio's server for the requested operation.
- There is no local/cloud mode selector, because there is only one processing path.

## Request authentication

- Every API call carries a session cookie issued by `ensureSession()`: an HMAC-signed, `HttpOnly`,
  `SameSite=Lax` identifier.
- State-changing requests (POST/PUT/DELETE) must pass `sameOrigin()`: a cross-origin `Origin`/
  `Referer` is rejected with **403**. This blocks CSRF against the job API.
- A job is readable, startable, downloadable and cancellable only by the session that created it;
  any other session receives **404**, not 403, so job existence is not disclosed.

## Upload validation

- Declared sizes are checked against the per-file (40 MB) and per-job (120 MB) limits before any
  byte is written.
- Streamed bodies are counted while writing, so a lying `Content-Length` cannot exceed the limit.
- File signatures are verified for PDF, OOXML (ZIP) and image inputs; a mismatched or unreadable file
  is rejected with a clear message rather than being passed to an engine.
- Names are sanitised; nothing user-supplied is used as a filesystem path.

## Isolation and cleanup

- Each job gets its own directory under `FOLIO_JOB_DIR`, created with a random identifier.
- Engines run as child processes with `HOME` pointed at the job directory, bounded stdout/stderr
  capture, a hard engine deadline and SIGKILL on cancellation.
- Heavy engines are serialised (`FOLIO_HEAVY_CONCURRENCY=1`), which also bounds memory pressure.
- Temporary inputs and outputs are deleted after download, on cancel, and when a job expires
  (15 minutes). No document content is written to the database, to logs or to the SPA directory.
- Error messages are sanitised before reaching the client; engine stderr is retained only in bounded
  server-side diagnostics.

## Output validation

Before a download link exists, the server checks that each output file exists, is non-empty and has
a plausible type. A job whose engine produced nothing fails with an explicit error instead of
offering an empty download.

## Security-sensitive tools

- **Redaction** rebuilds pages as images so the underlying text and vector objects are not present in
  the output stream; the removed text cannot be selected, searched or copied afterwards.
- **Protection** applies qpdf encryption with the chosen algorithm and permissions; the downloaded
  file must be opened with the password to confirm. **Unlock** requires the correct password and does
  not attempt to brute-force anything.
- **Signatures** are embedded as PDF page overlays through the server engine, so they exist in the
  file rather than only in the UI.

## What is *not* stored

No accounts, no document history, no extracted text, no previews, no permanent file storage. Only
short-lived job metadata (id, tool, status, sizes) is held in memory for the life of the job.

## Reporting a problem

If a job exposes another session's file, retains a document after expiry, or produces an output that
still contains redacted text, treat it as a security defect: reproduce with `npm run test:server`,
record the job id, and fix the root cause before release.
