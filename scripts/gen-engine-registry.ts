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
      ? `\n**Higher-fidelity option:** \`${t.preferredWorker}\` — requires the document worker described below; unavailable in Strict Local Mode.\n`
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
| Tools running fully in the browser | ${localTools.length} |
| Tools needing a document worker (unavailable in Strict Local Mode) | ${workerTools.length} |
| Tools with a higher-fidelity worker engine available | ${preferred.length} |
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
## Engines that are *not* bundled

These are documented candidates. They are **not installed in this image** and no tool invokes them.
Enabling one requires: a licence entry in \`THIRD_PARTY_LICENSES.md\`, a worker service with resource
limits, and real-file regression tests.

| Engine | Why it is not bundled | Resource requirement if added | Licence |
|---|---|---|---|
| LibreOffice (headless) | ~500 MB–1 GB image weight, needs a native process per conversion | 1 vCPU, 1–2 GB RAM, 30 s timeout per document | MPL-2.0 (class C — review obligations before shipping) |
| qpdf | Native binary; \`pdf-lib\` covers the structural operations Folio advertises | 128 MB RAM, sub-second per file | Apache-2.0 (class A) |
| Apache PDFBox | JVM runtime | 512 MB heap | Apache-2.0 (class A) |
| pyHanko | Python runtime; digital signatures need a certificate authority the user supplies | 256 MB RAM | MIT (class A) |
| veraPDF | JVM runtime, large validation corpus | 1 GB heap | GPL-3.0 + MPL-2.0 (class D — **must not** be added without written approval) |
| Sharp | Native \`libvips\` build; \`canvas\` covers the raster work Folio does | 256 MB RAM | Apache-2.0 (class A) |
| Playwright + Chromium | ~400 MB image weight for HTML/URL rendering | 1 vCPU, 1 GB RAM | Apache-2.0 (class A) |

### Deployment note

The current deployment is a static build served by \`server.mjs\` on a single 1 vCPU / 1 GB instance.
Native engines do not fit in that process and must not be added to it. A document worker is a
separate service: it accepts a single file over an authenticated endpoint, processes it in an
isolated temporary directory, returns the result, and deletes both input and output immediately
(see \`DEPLOYMENT.md\` and \`SECURITY_AND_PRIVACY.md\`). Until such a worker exists, every tool listed
above runs entirely in the browser and Strict Local Mode is a complete guarantee for them.

## Strict Local Mode

Strict Local Mode is enforced in \`src/lib/privacy.ts\`, not merely advertised:

- Every outbound request must pass \`guardedFetch\`, which throws \`LocalModeViolation\` when the mode is
  on and the destination is not loopback.
- Loopback destinations (the user's own Ollama at \`127.0.0.1:11434\`) are permitted, so local AI keeps
  working without any document leaving the machine.
- The store registers its current mode with the guard, so the switch in the header takes effect for
  every subsequent request in the same tab.
- Every permitted transmission is recorded with its destination and purpose, and the log is
  inspectable, so "nothing left your device" is verifiable rather than claimed.

**Tools available in Strict Local Mode:** ${localTools.length} of ${tools.length}.
${workerTools.length ? `\n**Unavailable in Strict Local Mode:** ${workerTools.map((t) => `\`${t.toolId}\``).join(', ')} — these require the document worker.` : '\nNo tool requires a remote worker, so Strict Local Mode disables nothing.'}

## Selection policy

1. Use the engine that performs the operation structurally; never re-render a document to simulate a
   structural edit.
2. Prefer a browser engine when it reaches the required fidelity, so the document never leaves the
   device.
3. When a native engine would materially improve fidelity, declare it as \`preferredWorker\` and tell
   the user which engine produced their file.
4. Never select an engine whose licence class is C or D.
5. Never silently fall back from local to remote processing.
`

writeFileSync(join(ROOT, 'ENGINE_REGISTRY.md'), doc)
console.log(
  `ENGINE_REGISTRY.md written — ${engines.length} engines, ${tools.length} tools, ${workerTools.length} worker-side, ${unapproved.length} unapproved`,
)
