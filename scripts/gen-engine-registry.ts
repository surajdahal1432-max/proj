#!/usr/bin/env tsx
/**
 * Generates ENGINE_REGISTRY.md from src/lib/engines.ts.
 *
 * The registry is the single source of truth for which engine performs each tool's work, on which
 * side it executes, and what its limits are. Generating the document from the code guarantees the
 * documentation cannot drift from the shipped behaviour.
 *
 * Usage: npm run docs:engines
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ENGINE_REGISTRY_COUNT,
  ENGINES,
  TOOL_ENGINES,
  toolsForSide,
  toolsWithPreferredWorker,
  unapprovedEngines,
  type ToolEngineSpec,
} from '../src/lib/engines'

const ROOT = process.cwd()
const engines = Object.values(ENGINES)
const tools = Object.values(TOOL_ENGINES)

const bundled = engines.filter((e) => e.bundled)
const described = engines.filter((e) => !e.bundled)

const cell = (value: string | undefined) => (value ? value.replace(/\|/g, '\\|') : '—')
const list = (values: string[]) => values.join('; ')

const fidelityNote: Record<ToolEngineSpec['fidelity'], string> = {
  exact: 'Structural PDF operation — output is the original page content, not a re-render',
  high: 'Layout-preserving conversion with a documented approximation where the browser cannot match a desktop renderer',
  approximate: 'Best-effort reconstruction; the tool states the limitation in its UI before processing',
}

const engineRows = engines
  .map(
    (e) =>
      `| \`${e.id}\` | ${cell(e.name)} | ${cell(e.purpose)} | ${cell(e.license)} | ${e.licenseClass} | ${e.side} | ${e.bundled ? 'bundled' : 'not bundled'} |`,
  )
  .join('\n')

const toolRows = tools
  .map((t) => {
    const fallback = t.fallback ? `\`${t.fallback}\`` : '—'
    const worker = t.preferredWorker ? `\`${t.preferredWorker}\`` : '—'
    return `| \`${t.toolId}\` | \`${t.primary}\` | ${fallback} | ${worker} | ${t.side} | ${cell(list(t.inputs))} | ${cell(list(t.outputs))} | ${t.fidelity} |`
  })
  .join('\n')

const detailSections = tools
  .map((t) => {
    const limits = t.limits.map((l) => `- ${l}`).join('\n')
    const validation = t.validation.map((v) => `- ${v}`).join('\n')
    const workerLine = t.preferredWorker
      ? `\n**Native server engine:** \`${t.preferredWorker}\` — executed by the engine deployed in this image.\n`
      : ''
    return `### \`${t.toolId}\` — ${t.primary}${t.fallback ? ` (fallback: ${t.fallback})` : ''}

*Fidelity:* ${t.fidelity} — ${fidelityNote[t.fidelity]}
${workerLine}
**Known limits**

${limits || '- none recorded'}

**Output validation performed**

${validation || '- none recorded'}
`
  })
  .join('\n')

const localTools = toolsForSide('browser')
const workerTools = tools.filter((t) => t.side !== 'browser')
const preferred = toolsWithPreferredWorker()
const unapproved = unapprovedEngines()

const doc = `# Folio Engine Registry

> **Generated file — do not edit by hand.** Run \`npm run docs:engines\` to regenerate from
> \`src/lib/engines.ts\`, which is the single source of truth for engine selection.

Every advertised tool is mapped to a concrete engine, an execution side, its input and output
formats, its fidelity level, and the limitations a user must be told about. No tool may run on an
engine that is not listed here.

## Summary

| Metric | Count |
|---|---|
| Engines registered | ${engines.length} |
| Tools mapped | ${tools.length} |
| Tools processed on Folio's server | ${workerTools.length} |
| Browser-side tools (PDF.js preview and canvas rendering only) | ${localTools.length} |
| Tools executed by a native server engine | ${preferred.length} |
| Engines not bundled in this deployment | ${described.length} |
| Engines with an unapproved licence class | ${unapproved.length} |

Registry counter from code: \`ENGINE_REGISTRY_COUNT = ${JSON.stringify(ENGINE_REGISTRY_COUNT)}\`.

## Engine inventory

| Engine | Name | Purpose | Licence | Class | Side | Shipped |
|---|---|---|---|---|---|---|
${engineRows}

Licence classes follow the policy in \`THIRD_PARTY_LICENSES.md\`: **A** approved, **B** approved with
notice obligations, **C** requires legal review, **D** rejected. Class C and D engines are listed for
evaluation only and are **not** invoked by any tool; \`unapprovedEngines()\` returns them so the build
can assert this.

## Tool → engine matrix

| Tool | Primary | Fallback | Preferred worker engine | Side | Inputs | Outputs | Fidelity |
|---|---|---|---|---|---|---|---|
${toolRows}

## Per-tool limits and validation

${detailSections}
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
3. When a native engine would materially improve fidelity, declare it as \`preferredWorker\` and tell
   the user which engine produced their file.
4. Never select an engine whose licence class is C or D.
5. Never substitute a lower-fidelity engine without recording a warning on the job.
`

writeFileSync(join(ROOT, 'ENGINE_REGISTRY.md'), doc)
console.log(
  `ENGINE_REGISTRY.md written — ${engines.length} engines, ${tools.length} tools, ${workerTools.length} worker-side, ${unapproved.length} unapproved`,
)
