# Deployment

Folio ships as a static Vite build served by a small Node HTTP server (`server.mjs`). There is no
application backend and no database requirement: every tool runs in the browser.

## 1. Build and run locally

```bash
npm install
npm run build      # prebuild copies PDF.js fonts/cmaps/wasm/iccs into public/pdfjs, then tsc + vite build
npm start          # node server.mjs
```

- Default port: **3000** (`PORT` env var overrides).
- The server binds `0.0.0.0` so it is reachable from outside the container.
- `GET /tool/merge` and other SPA routes fall back to `index.html`.
- A missing static asset with a file extension returns **404** (never HTML), and a malformed path
  returns **400** without crashing the process.

## 2. Container

The `Dockerfile` is a two-stage `node:26-alpine` build (Node 26 is the current LTS, supported until
April 2029):

1. **build** — installs dependencies, runs `npm run build`, producing `dist/`.
2. **runtime** — copies `dist/`, `server.mjs` and `package.json`, sets `PORT=3000`, `EXPOSE 3000`,
   `CMD ["node", "server.mjs"]`, and runs as a non-root user after upgrading Alpine packages.

No native engines are installed. The image stays small and cold-starts quickly.

## 3. AppJet hosting

Deployment is automatic on the `appjet` branch. Hosting entitlement for this account: **1 GB RAM,
1 vCPU, unlimited traffic** per app (Free plan).

That is ample for a browser-side application, because processing happens on the user's device. It is
**not** sufficient for LibreOffice/qpdf/Chromium workers: those need their own service with 1–2 GB
RAM per concurrent conversion (see `ENGINE_REGISTRY.md`). Do not add them to this image.

Custom domains and persistent disks are not part of the Free plan; they require Starter ($5/month) or
Pro in Settings → Billing.

For large production traffic, deploy the same branch to https://qoddi.com (select branch `appjet`).

## 4. Environment variables

All are optional. The application is fully functional with none set.

| Variable | Purpose | Default when unset |
|---|---|---|
| `PORT` | Server port | `3000` |
| `VITE_SUPABASE_URL` | Enables optional cloud sync (auth + settings + job metadata) | cloud sync disabled |
| `VITE_SUPABASE_ANON_KEY` | Public anon key for the above | cloud sync disabled |

`VITE_*` values are baked in at build time and are public. Never put a service-role key in a `VITE_*`
variable.

## 5. Optional Supabase schema

Run this in the Supabase SQL editor before enabling cloud sync. It stores **preferences and job
metadata only** — there is no document table and no storage bucket.

```sql
create table if not exists public.folio_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null default 'light' check (theme in ('light','dark')),
  strict_local_mode boolean not null default true,
  ollama_host text not null default 'http://localhost:11434',
  ollama_model text not null default 'llama3',
  updated_at timestamptz not null default now()
);

create table if not exists public.folio_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tool_id text not null,
  status text not null check (status in ('queued','running','done','failed')),
  page_count integer,
  output_count integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_code text
);

alter table public.folio_settings enable row level security;
alter table public.folio_jobs enable row level security;

create policy "own settings" on public.folio_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own jobs" on public.folio_jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists folio_jobs_user_started
  on public.folio_jobs (user_id, started_at desc);
```

Notes:

- RLS is mandatory. Without it the anon key would expose every row.
- `folio_jobs` deliberately has no file-name, page-text or document column.
- Row ownership is `auth.uid() = user_id`, so one user cannot read another's rows.

## 6. Document worker (not deployed)

Tools that need native engines are marked `side: 'document-worker'` in `src/lib/engines.ts` and are
listed in `ENGINE_REGISTRY.md`. Enabling one requires a separate service:

- **Resource profile:** 1 vCPU, 1–2 GB RAM, 30 s per-document timeout, 50 MB upload cap.
- **Isolation:** one temporary directory per request, deleted in `finally`; abandoned directories swept
  after 5 minutes.
- **Auth:** short-lived signed request token; no unauthenticated endpoint.
- **Retention:** zero. Input and output are deleted immediately after the response is streamed.
- **Licensing:** add the engine to `THIRD_PARTY_LICENSES.md` first; class C/D engines need written
  approval (veraPDF is GPL-3.0 + MPL-2.0 and must not be added without it).
- **Strict Local Mode:** the frontend must refuse worker calls while the mode is on, and say so in the
  UI instead of silently switching to remote processing.

Until such a worker exists, those tools state their limitation in the UI and no tool pretends to use
an engine it does not have.

## 7. Health and troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 502 from the platform | server bound to `localhost`, or `PORT` mismatch | bind `0.0.0.0`, keep `EXPOSE`/`PORT` aligned with the configured port |
| Fonts/cmaps 404 during PDF rendering | `public/pdfjs` not generated | run `npm run build` (prebuild copies the assets) |
| OCR never completes | language data blocked by the browser/network | allow `cdn.jsdelivr.net` for `tessdata`, or self-host the trained data |
| Cloud sync returns 404 | schema not applied | run the SQL in section 5 |
| Cloud sync refuses to run | Strict Local Mode is on | that is intended — turn it off in the header |
