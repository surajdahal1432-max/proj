# Folio Deployment

Folio has **one** processing architecture. There is no local/cloud mode switch: the browser is a
client, and every document operation runs on Folio's own server.

```
User → Folio frontend (React/Vite SPA) → authenticated job API → native engine → validated output → download
```

## Runtime image

`Dockerfile` builds the SPA, then ships a single runtime stage (`node:26-alpine`) containing the
engines that actually process documents:

| Engine | Package | Used by |
|---|---|---|
| qpdf | `qpdf` | compress, repair, encrypt, decrypt, structural page work |
| poppler-utils | `poppler-utils` (`pdftoppm`, `pdftotext`, `pdfinfo`) | pdf-to-jpg/png, redact rasterisation, text extraction, page counts |
| Tesseract | `tesseract-ocr`, `tesseract-ocr-data-eng` | ocr |
| LibreOffice | `libreoffice-writer`, `-calc`, `-impress` | Office/HTML/Markdown/webpage → PDF, PDF → Office |
| ImageMagick | `imagemagick` | image normalisation for image-to-pdf |
| pdf-lib + first-party writers | npm | merge, extract, rearrange, rotate, watermark, forms, sign, overlays |

`USER node` drops privileges; LibreOffice and Tesseract need a writable `HOME`, set to `/home/node`.

### Base image decision (image security scan)

The runtime stage deliberately stays on Alpine. Two Debian-based variants were built and scanned:

| Runtime base | Blocking image findings | Examples |
|---|---|---|
| `node:26-alpine` (current) | 4 | glib 2.88.1-r1, imagemagick 7.1.2.35-r0 |
| `node:26-bookworm-slim` | 135 | curl, glibc, ImageMagick — several with no fix published |
| `node:26-trixie-slim` | 135 | curl 8.14.1-2+deb13u7, glibc 2.41 — no fix published |

All four Alpine findings report a "fixed version" that is **older** than the version
installed (glib: fixed `2.66.6-r0`, installed `2.88.1-r1`; ImageMagick: fixed
`7.0.10.31-r0`, installed `7.1.2.35-r0`). Both installed builds already contain those
upstream fixes, and Alpine v3.24 carries no newer build of either package, so no
`apk upgrade` can change the outcome. Clearing the findings by removing
LibreOffice/poppler/ImageMagick would only delete the engines that perform Office
conversion, OCR rasterisation and image normalisation, so the engines are kept and the
scan result is reported rather than suppressed. Publishing this image needs the advisory
data corrected on the scanner side; the previously deployed build stays live until then.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port (the deployment port is 3000) |
| `FOLIO_ROOT` | `/app/dist` | Static SPA directory |
| `FOLIO_JOB_DIR` | `/tmp/folio-jobs` | Isolated per-job temporary directories |
| `FOLIO_HEAVY_CONCURRENCY` | `1` | Simultaneous LibreOffice/Tesseract/poppler jobs |
| `FOLIO_LIGHT_CONCURRENCY` | `2` | Simultaneous pdf-lib/qpdf jobs |
| `FOLIO_JOB_TIMEOUT_MS` | `180000` | Whole-job deadline |
| `FOLIO_ENGINE_TIMEOUT_MS` | `120000` | Single engine invocation deadline |
| `FOLIO_SESSION_SECRET` | random per boot | Optional; pins the session signing key |

Limits enforced by the API: **40 MB per file**, **120 MB per job**, abandoned jobs expire after
**15 minutes**. Set these through the platform environment, never in source.

## Resource requirements

The verified entitlement is **1 GB RAM / 1 vCPU** per app. Native engines are therefore serialised:
one heavy engine at a time, two light jobs in parallel. A LibreOffice conversion of a normal Word
document takes roughly 1–2 s of engine time in this image; large presentations and OCR are the
slowest paths and are bounded by the 120 s engine deadline.

If you need concurrent heavy processing, run a separate worker service on
[qoddi.com](https://qoddi.com) from branch `appjet` with 2 vCPU / 2–4 GB and point the frontend's
`/api` calls at it. Hosting cost there is the provider's plan price; nothing in Folio requires a paid
document API.

## Health and verification

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | `{ ok, ...stats, engines }` — process and engine availability |
| `GET /api/engines` | `{ ready, unavailable, engines }` — per-tool readiness |

After deploying, verify:

```bash
curl -s https://<app>/api/health | jq '.ok, .engines'
curl -s https://<app>/api/engines | jq '.ready | length, .unavailable'
npm run test:server        # real files through the live job API, locally
```

`npm run test:server` boots the server on a free port and drives create → upload → start → poll →
download for merge, extract, rotate, split, pdf-to-text, word-to-pdf and pdf-to-jpg, reopening every
output with `pdf-lib`.

## Operational notes

- Temporary files live only under `FOLIO_JOB_DIR` and are deleted after download, on cancel, and by
  the expiry sweep. No document is written to the SPA directory or to any database.
- The server serves the SPA for unknown extension-less routes and returns 404 for missing files with
  an extension; malformed paths return 400 instead of crashing the process.
- Rolling out a new build replaces the container, so in-flight jobs are lost; the client reports the
  failed status instead of hanging.
