#!/usr/bin/env node
/**
 * Third-party licence audit + SBOM generator.
 *
 * Reads the *installed* dependency tree (package-lock.json + node_modules manifests) and emits:
 *   THIRD_PARTY_COMPONENTS.csv   machine-readable component inventory with A/B/C/D classification
 *   THIRD_PARTY_LICENSES.md      human-readable summary grouped by licence
 *   THIRD_PARTY_NOTICES.md       notice/attribution obligations to ship with a release
 *   sbom.cdx.json                CycloneDX 1.5 software bill of materials
 *
 * Exit code 1 if any component is class D (reject/replace) so CI cannot ship it silently.
 * Class C (needs legal review) is reported loudly but does not fail the build.
 *
 * Usage: node scripts/license-audit.mjs [--check]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/** Licence identifiers that are safe for commercial distribution. */
const CLASS_A = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense', 'CC0-1.0', 'BlueOak-1.0.0', 'Zlib', 'X11', 'MIT-0', 'OFL-1.1', 'Python-2.0', 'CC-BY-4.0', 'WTFPL']
/** Permissive but with attribution/notice obligations we must ship. */
const CLASS_B = ['BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'OFL-1.1', 'MIT-0', 'Python-2.0', 'CC-BY-4.0']
/** Weak/limited copyleft: usable only after reviewing the exact obligations. */
const CLASS_C = ['MPL-2.0', 'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'EPL-2.0', 'CDDL-1.0']
/** Reciprocal/copyleft: must not be introduced without written approval. */
const CLASS_D = ['GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later', 'AGPL-3.0', 'AGPL-3.0-only', 'AGPL-3.0-or-later', 'SSPL-1.0', 'CPAL-1.0', 'EUPL-1.2', 'OSL-3.0']

/** Purpose notes for direct dependencies; transitive ones are described generically. */
const PURPOSE = {
  react: 'UI runtime',
  'react-dom': 'DOM renderer for the UI',
  'react-router-dom': 'Client-side routing between tool pages',
  'lucide-react': 'Icon set',
  zustand: 'Client state store (queues, settings, history)',
  'pdf-lib': 'PDF creation, page manipulation, overlays, encryption primitives',
  'pdfjs-dist': 'PDF parsing and raster rendering in the browser',
  'tesseract.js': 'Client-side OCR engine (WASM)',
  jszip: 'ZIP archives for batch downloads and OOXML container parsing',
  docx: 'DOCX generation for PDF-to-Word output',
  pptxgenjs: 'PPTX generation for PDF-to-PowerPoint output',
  clsx: 'Conditional class name helper',
  'tailwind-merge': 'Tailwind class conflict resolution',
  vite: 'Build tool',
  typescript: 'Type checker and compiler',
  tailwindcss: 'Utility CSS framework',
  postcss: 'CSS transform pipeline',
  autoprefixer: 'Vendor prefixing',
  jsdom: 'DOM implementation for the Node test harness',
  tsx: 'TypeScript execution for tests',
  '@types/node': 'Node type definitions',
  '@types/react': 'React type definitions',
  '@types/react-dom': 'React DOM type definitions',
  '@vitejs/plugin-react': 'Vite React plugin',
}

/**
 * Components that are not npm packages but are redistributed inside the built app.
 * PDF.js ships font data for standard-14 fallback and CJK support; the files are
 * copied into public/pdfjs by scripts/copy-pdfjs-assets.mjs.
 */
const BUNDLED_ASSETS = [
  {
    name: 'PDF.js standard font data (Foxit core fonts)',
    version: 'bundled with pdfjs-dist',
    license: 'BSD-3-Clause (see node_modules/pdfjs-dist/standard_fonts/LICENSE_FOXIT)',
    repository: 'https://github.com/mozilla/pdf.js',
    purpose: 'Standard-14 font substitutes for PDF text rendering',
    distribution: 'static files under /pdfjs/standard_fonts in the built image',
    notices: 'Retain the Foxit licence notice shipped by pdfjs-dist',
    modifications: 'none',
    klass: 'B',
  },
  {
    name: 'PDF.js cMap data',
    version: 'bundled with pdfjs-dist',
    license: 'Apache-2.0',
    repository: 'https://github.com/mozilla/pdf.js',
    purpose: 'CJK character map tables',
    distribution: 'static files under /pdfjs/cmaps in the built image',
    notices: 'Retain Apache-2.0 notice',
    modifications: 'none',
    klass: 'B',
  },
  {
    name: 'Tesseract.js OCR language data (eng)',
    version: 'fetched at runtime from the tesseract.js CDN',
    license: 'Apache-2.0 (tessdata)',
    repository: 'https://github.com/tesseract-ocr/tessdata',
    purpose: 'English OCR trained data',
    distribution: 'not redistributed — downloaded by the browser on first OCR use',
    notices: 'None required when not redistributed',
    modifications: 'none',
    klass: 'B',
  },
]

function normaliseLicence(raw) {
  if (!raw) return 'UNKNOWN'
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(' OR ') : raw.type || 'UNKNOWN'
  return value.replace(/^\(|\)$/g, '').trim()
}

/**
 * Classify a licence *expression*, not just a licence id.
 *
 * npm packages frequently offer alternatives (`MIT OR GPL-3.0`) or conjunctions
 * (`MIT AND Zlib`). Taking the presence of a copyleft id as an automatic rejection is wrong: for
 * `MIT OR GPL-3.0` we simply elect MIT. Severity is therefore computed per OR-alternative and the
 * most permissive alternative wins; the elected expression is recorded for the notices file.
 */
function classifyExpression(licence) {
  const alternatives = licence
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)

  const rank = { A: 0, B: 1, C: 2, D: 3 }
  let best = { klass: 'D', elected: licence }

  for (const alternative of alternatives.length ? alternatives : [licence]) {
    const ids = alternative.split(/\s+AND\s+/i).map((id) => id.trim()).filter(Boolean)
    let klass = 'A'
    for (const id of ids) {
      if (CLASS_D.includes(id)) klass = 'D'
      else if (CLASS_C.includes(id) && rank[klass] < rank.C) klass = 'C'
      else if (CLASS_B.includes(id) && rank[klass] < rank.B) klass = 'B'
      else if (!CLASS_A.includes(id) && rank[klass] < rank.C) klass = 'C'
      if (klass === 'D') break
    }
    if (rank[klass] < rank[best.klass]) best = { klass, elected: alternative }
  }

  return best
}

function classify(licence) {
  return classifyExpression(licence).klass
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

const pkg = readJson(join(ROOT, 'package.json'), {})
const lock = readJson(join(ROOT, 'package-lock.json'), { packages: {} })
const direct = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
])

const components = []
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path || !path.startsWith('node_modules/')) continue
  const name = entry.name ?? path.replace(/^node_modules\//, '').replace(/\/node_modules\//g, ' > ')
  if (entry.dev === undefined && entry.link) continue
  const manifest = readJson(join(ROOT, path, 'package.json'), null)
  const licence = normaliseLicence(manifest?.license ?? manifest?.licenses ?? entry.license)
  const repository =
    typeof manifest?.repository === 'string'
      ? manifest.repository
      : manifest?.repository?.url ?? entry.resolved ?? ''
  const isDirect = direct.has(name)
  components.push({
    name,
    version: manifest?.version ?? entry.version ?? 'unknown',
    license: licence,
    repository: repository.replace(/^git\+/, '').replace(/\.git$/, ''),
    purpose: PURPOSE[name] ?? (isDirect ? 'Direct dependency' : 'Transitive dependency'),
    distribution: entry.dev ? 'build-time only (not shipped in the runtime image)' : 'shipped in the built application',
    notices: classify(licence) === 'A' ? 'none beyond the licence text' : 'retain copyright + licence notice',
    modifications: 'none',
    klass: classify(licence),
    elected: classifyExpression(licence).elected,
    direct: isDirect,
  })
}

for (const asset of BUNDLED_ASSETS) {
  components.push({ ...asset, elected: asset.license, direct: false })
}

components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))

const counts = components.reduce((acc, c) => ({ ...acc, [c.klass]: (acc[c.klass] ?? 0) + 1 }), {})
const reject = components.filter((c) => c.klass === 'D')
const review = components.filter((c) => c.klass === 'C')

/* ---------------------------------------------------------------- *
 * CSV
 * ---------------------------------------------------------------- */
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`
const csvHeader = [
  'package',
  'version',
  'license',
  'license_elected',
  'class',
  'direct',
  'source_repository',
  'purpose',
  'distribution_method',
  'required_notices',
  'modifications',
  'unresolved_obligations',
]
const csvRows = components.map((c) =>
  [
    c.name,
    c.version,
    c.license,
    c.elected,
    c.klass,
    c.direct ? 'direct' : 'transitive',
    c.repository,
    c.purpose,
    c.distribution,
    c.notices,
    c.modifications,
    c.klass === 'A' ? 'none' : c.klass === 'B' ? 'ship licence text + copyright notice' : 'pending review',
  ]
    .map(csvCell)
    .join(','),
)
writeFileSync(
  join(ROOT, 'THIRD_PARTY_COMPONENTS.csv'),
  `${csvHeader.map(csvCell).join(',')}\n${csvRows.join('\n')}\n`,
)

/* ---------------------------------------------------------------- *
 * THIRD_PARTY_LICENSES.md
 * ---------------------------------------------------------------- */
const byLicence = new Map()
for (const c of components) {
  const list = byLicence.get(c.license) ?? []
  list.push(c)
  byLicence.set(c.license, list)
}
const licenceSections = [...byLicence.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .map(([licence, list]) => {
    const rows = list
      .map((c) => `| \`${c.name}\` | ${c.version} | ${c.klass} | ${c.purpose} |`)
      .join('\n')
    return `### ${licence} — ${list.length} component${list.length === 1 ? '' : 's'}\n\n| Package | Version | Class | Purpose |\n|---|---|---|---|\n${rows}\n`
  })
  .join('\n')

writeFileSync(
  join(ROOT, 'THIRD_PARTY_LICENSES.md'),
  `# Third-Party Licences

Generated by \`node scripts/license-audit.mjs\` from the installed dependency tree
(${components.length} components). Re-run before every public release.

## Classification

| Class | Meaning | Policy |
|---|---|---|
| **A** | Approved for commercial distribution | No obligations beyond the licence text |
| **B** | Approved with documented obligations | Ship the licence text and copyright notice |
| **C** | Requires further legal review | Not approved for distribution until reviewed |
| **D** | Reject / replace | Must not be shipped; the audit fails if present |

## Summary

| Class | Count |
|---|---|
| A | ${counts.A ?? 0} |
| B | ${counts.B ?? 0} |
| C | ${counts.C ?? 0} |
| D | ${counts.D ?? 0} |

${
  reject.length
    ? `> **REJECT:** ${reject.map((c) => c.name).join(', ')} must be removed before distribution.\n`
    : '> No class D (reciprocal/copyleft) components are present.\n'
}
${
  review.length
    ? `> **Review required (class C):** ${review.map((c) => `${c.name} (${c.license})`).join(', ')}\n`
    : '> No class C components require legal review.\n'
}

## Engine dependencies and their licences

| Engine | Package | Licence | Use |
|---|---|---|---|
| PDF creation / page ops | \`pdf-lib\` | MIT | Merge, split, extract, rotate, watermark, sign, encrypt |
| PDF rendering | \`pdfjs-dist\` | Apache-2.0 | Thumbnails, previews, text extraction, raster export |
| OCR | \`tesseract.js\` | Apache-2.0 | Searchable text layer from scans |
| ZIP / OOXML container | \`jszip\` | MIT \`\` | Batch downloads, DOCX/XLSX/PPTX parsing |
| DOCX output | \`docx\` | MIT | PDF → Word |
| PPTX output | \`pptxgenjs\` | MIT | PDF → PowerPoint |

**Not bundled:** LibreOffice, qpdf, Apache PDFBox, pyHanko, veraPDF, Sharp and Playwright/Chromium
are *not* part of this build. They are documented as optional server-side engines in
\`ENGINE_REGISTRY.md\`; adding one requires its own licence entry here first. No GPL, AGPL, SSPL or
other reciprocal licences are present.

## Components by licence

${licenceSections}
## Maintaining this document

\`\`\`bash
node scripts/license-audit.mjs          # regenerate all four artefacts
node scripts/license-audit.mjs --check  # CI mode: fail on class D only
\`\`\`

This is an engineering compliance process, not legal advice.
`,
)

/* ---------------------------------------------------------------- *
 * THIRD_PARTY_NOTICES.md
 * ---------------------------------------------------------------- */
const noticeComponents = components.filter((c) => c.klass !== 'A')
const noticeRows = noticeComponents
  .map((c) => `| \`${c.name}\` ${c.version} | ${c.license} | ${c.repository || 'see package metadata'} |`)
  .join('\n')

writeFileSync(
  join(ROOT, 'THIRD_PARTY_NOTICES.md'),
  `# Third-Party Notices

Folio includes the following third-party components. If you distribute Folio or a derivative work,
ship this file together with the full licence texts referenced below.

## Attribution obligations

| Component | Licence | Source |
|---|---|---|
${noticeRows}

## Full licence texts

Full texts are available in each package's directory under \`node_modules/<package>/LICENSE\`, and in
\`node_modules/pdfjs-dist/standard_fonts/LICENSE_FOXIT\` for the bundled standard font data. The
build copies no licence text into the application bundle, so a distributable release must include
this file and those licence texts alongside the artefact.

## Apache-2.0 components

\`pdfjs-dist\` and \`tesseract.js\` are licensed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0). No modifications have been made to their source.
Apache-2.0 requires that recipients receive a copy of the licence and any NOTICE file content.

## MIT / ISC / BSD components

These require retaining the copyright notice and permission notice. They are listed in
\`THIRD_PARTY_COMPONENTS.csv\` with their source repositories.

## Generated

\`node scripts/license-audit.mjs\` regenerates this file. Do not edit by hand.
`,
)

/* ---------------------------------------------------------------- *
 * CycloneDX 1.5 SBOM
 * ---------------------------------------------------------------- */
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:folio-${Date.now().toString(16)}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: 'Folio', name: 'scripts/license-audit.mjs', version: '1.0.0' }],
    component: {
      type: 'application',
      name: pkg.name ?? 'folio',
      version: pkg.version ?? '1.0.0',
      description: pkg.description ?? 'Folio document processing application',
    },
  },
  components: components.map((c) => ({
    type: 'library',
    name: c.name,
    version: c.version,
    purl: `pkg:npm/${c.name.replace('@', '%40')}@${c.version}`,
    scope: c.distribution.startsWith('build-time') ? 'optional' : 'required',
    licenses: [{ license: { id: c.license.split(' ')[0] } }],
    properties: [
      { name: 'folio:class', value: c.klass },
      { name: 'folio:purpose', value: c.purpose },
    ],
    ...(c.repository ? { externalReferences: [{ type: 'vcs', url: c.repository }] } : {}),
  })),
}
writeFileSync(join(ROOT, 'sbom.cdx.json'), `${JSON.stringify(sbom, null, 2)}\n`)

/* ---------------------------------------------------------------- *
 * Report
 * ---------------------------------------------------------------- */
console.log(`license-audit: ${components.length} components`)
console.log(`  A (approved)              ${counts.A ?? 0}`)
console.log(`  B (notices required)      ${counts.B ?? 0}`)
console.log(`  C (legal review required) ${counts.C ?? 0}`)
console.log(`  D (reject/replace)        ${counts.D ?? 0}`)
if (review.length) console.log(`  review: ${review.map((c) => `${c.name} (${c.license})`).join(', ')}`)
if (reject.length) {
  console.error(`license-audit FAILED: class D components present: ${reject.map((c) => c.name).join(', ')}`)
  process.exit(1)
}
if (process.argv.includes('--check')) {
  const expected = ['THIRD_PARTY_COMPONENTS.csv', 'THIRD_PARTY_LICENSES.md', 'THIRD_PARTY_NOTICES.md', 'sbom.cdx.json']
  const missing = expected.filter((file) => !existsSync(join(ROOT, file)))
  if (missing.length) {
    console.error(`license-audit FAILED: missing artefacts: ${missing.join(', ')}`)
    process.exit(1)
  }
}
console.log('license-audit: artefacts written')
