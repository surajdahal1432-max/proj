/**
 * Central engine registry.
 *
 * Single source of truth for *what actually processes each tool*, where it runs, what it can
 * accept and produce, and how its output is validated. The UI, the documentation generator and
 * the regression tests all read from here so the audit can never drift from the code.
 */

export type ExecutionSide = 'server' | 'browser' | 'document-worker' | 'local-model'

/** A = approved, B = approved with notices, C = needs legal review, D = rejected unless approved. */
export type LicenseClass = 'A' | 'B' | 'C' | 'D'

export type Fidelity = 'exact' | 'high' | 'approximate'

export interface EngineDefinition {
  id: string
  name: string
  purpose: string
  license: string
  licenseClass: LicenseClass
  side: ExecutionSide
  /** Bundled in this deployment (browser bundle) or only described for a future worker. */
  bundled: boolean
}

export interface ToolEngineSpec {
  toolId: string
  primary: string
  fallback?: string
  /** Native engine that performs this tool on Folio's server. */
  preferredWorker?: string
  side: ExecutionSide
  inputs: string[]
  outputs: string[]
  fidelity: Fidelity
  limits: string[]
  validation: string[]
}

export const ENGINES: Record<string, EngineDefinition> = {
  'pdf-lib': {
    id: 'pdf-lib',
    name: 'pdf-lib',
    purpose: 'PDF creation, page copy/reorder, overlays, form filling, standard encryption',
    license: 'MIT',
    licenseClass: 'A',
    side: 'browser',
    bundled: true,
  },
  pdfjs: {
    id: 'pdfjs',
    name: 'PDF.js',
    purpose: 'PDF rendering to canvas, text-layer extraction, page geometry',
    license: 'Apache-2.0',
    licenseClass: 'B',
    side: 'browser',
    bundled: true,
  },
  tesseract: {
    id: 'tesseract',
    name: 'Tesseract.js',
    purpose: 'OCR of scanned pages into a searchable text layer',
    license: 'Apache-2.0',
    licenseClass: 'B',
    side: 'browser',
    bundled: true,
  },
  jszip: {
    id: 'jszip',
    name: 'JSZip',
    purpose: 'ZIP archives for batch downloads and OOXML containers',
    license: 'MIT',
    licenseClass: 'A',
    side: 'browser',
    bundled: true,
  },
  docx: {
    id: 'docx',
    name: 'docx',
    purpose: 'Writing .docx output for PDF to Word',
    license: 'MIT',
    licenseClass: 'A',
    side: 'browser',
    bundled: true,
  },
  pptxgenjs: {
    id: 'pptxgenjs',
    name: 'PptxGenJS',
    purpose: 'Writing .pptx output for PDF to PowerPoint',
    license: 'MIT',
    licenseClass: 'A',
    side: 'browser',
    bundled: true,
  },
  'ooxml-parser': {
    id: 'ooxml-parser',
    name: 'Folio OOXML parser (in-repo)',
    purpose: 'Namespace-aware DOMParser walk of word/document.xml, xl/worksheets, ppt/slides',
    license: 'MIT (first-party)',
    licenseClass: 'A',
    side: 'browser',
    bundled: true,
  },
  'xlsx-writer': {
    id: 'xlsx-writer',
    name: 'Folio XLSX writer (in-repo)',
    purpose: 'Minimal SpreadsheetML writer on top of JSZip',
    license: 'MIT (first-party)',
    licenseClass: 'A',
    side: 'browser',
    bundled: true,
  },
  webcrypto: {
    id: 'webcrypto',
    name: 'Web Crypto API',
    purpose: 'AES-CBC key derivation and encryption for password protection',
    license: 'W3C / browser built-in',
    licenseClass: 'A',
    side: 'browser',
    bundled: true,
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (user-hosted)',
    purpose: 'Offline LLM inference for summary, Q&A, translation',
    license: 'MIT (client); model licences vary by model',
    licenseClass: 'B',
    side: 'local-model',
    bundled: false,
  },
  'libreoffice-worker': {
    id: 'libreoffice-worker',
    name: 'LibreOffice headless (document worker)',
    purpose: 'High-fidelity Office rendering and PDF/A export',
    license: 'MPL-2.0',
    licenseClass: 'C',
    side: 'server',
    bundled: true,
  },
  'chromium-worker': {
    id: 'chromium-worker',
    name: 'Chromium via Playwright (document worker)',
    purpose: 'Real CSS layout for HTML and webpage to PDF',
    license: 'Apache-2.0 (Chromium: BSD-3-Clause and others)',
    licenseClass: 'C',
    side: 'server',
    bundled: true,
  },
  'qpdf-worker': {
    id: 'qpdf-worker',
    name: 'qpdf (document worker)',
    purpose: 'Structural PDF repair, linearization and inspection',
    license: 'Apache-2.0',
    licenseClass: 'B',
    side: 'server',
    bundled: true,
  },
  'pyhanko-worker': {
    id: 'pyhanko-worker',
    name: 'pyHanko (document worker)',
    purpose: 'Certificate-based digital signatures',
    license: 'MIT',
    licenseClass: 'A',
    side: 'document-worker',
    bundled: false,
  },
  'verapdf-worker': {
    id: 'verapdf-worker',
    name: 'veraPDF (document worker)',
    purpose: 'ISO 19005 (PDF/A) conformance validation',
    license: 'AGPL-3.0 / MPL-2.0 mix',
    licenseClass: 'D',
    side: 'document-worker',
    bundled: false,
  },
}

const pdfIn = ['pdf']
const pdfOut = ['pdf']

export const TOOL_ENGINES: Record<string, ToolEngineSpec> = {
  merge: {
    toolId: 'merge',
    primary: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'exact',
    limits: ['Encrypted inputs must be unlocked first'],
    validation: ['Re-open output; page count equals the sum of inputs', 'Page text follows the chosen file order'],
  },
  split: {
    toolId: 'split',
    primary: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'exact',
    limits: ['One source document per run'],
    validation: ['Every part re-opens as a valid PDF with the expected page count'],
  },
  rearrange: {
    toolId: 'rearrange',
    primary: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'exact',
    limits: ['Rotation is stored per page, not baked into content streams'],
    validation: ['Output order and page count match the grid'],
  },
  extract: {
    toolId: 'extract',
    primary: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: ['pdf', 'zip'],
    fidelity: 'exact',
    limits: ['Selection is bounded by the real page count'],
    validation: ['Combined PDF contains exactly the selected pages in display order', 'Per-page and ZIP outputs are individually valid'],
  },
  rotate: {
    toolId: 'rotate',
    primary: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'exact',
    limits: ['Rotation is a multiple of 90 degrees'],
    validation: ['Per-page rotation angle is read back from the output'],
  },
  compress: {
    toolId: 'compress',
    primary: 'pdfjs',
    fallback: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'approximate',
    limits: ['Pages are re-encoded as images, so the text layer is lost', 'Reduction ratio depends on the source content'],
    validation: ['Page count is preserved and output size is reported honestly'],
  },
  repair: {
    toolId: 'repair',
    primary: 'pdfjs',
    fallback: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'approximate',
    limits: ['Severely truncated files cannot be recovered', 'Recovered pages are re-encoded'],
    validation: ['Unrecoverable input raises an actionable error instead of emitting an empty PDF'],
  },
  ocr: {
    toolId: 'ocr',
    primary: 'tesseract',
    fallback: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['pdf', 'txt'],
    fidelity: 'approximate',
    limits: ['Language data downloads on first use', 'Accuracy depends on scan quality and language pack'],
    validation: ['Recognised text is embedded as a selectable layer on each page'],
  },
  'pdf-to-word': {
    toolId: 'pdf-to-word',
    primary: 'docx',
    fallback: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['docx'],
    fidelity: 'approximate',
    limits: ['Paragraphs are rebuilt from positioned text lines, not Word layout'],
    validation: ['Output opens as a valid OOXML package containing the source text'],
  },
  'pdf-to-excel': {
    toolId: 'pdf-to-excel',
    primary: 'xlsx-writer',
    fallback: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['xlsx', 'csv'],
    fidelity: 'approximate',
    limits: ['Table detection is heuristic and column-alignment based'],
    validation: ['Workbook opens with one sheet per detected table'],
  },
  'pdf-to-powerpoint': {
    toolId: 'pdf-to-powerpoint',
    primary: 'pptxgenjs',
    fallback: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['pptx'],
    fidelity: 'approximate',
    limits: ['Each slide is a raster of the source page'],
    validation: ['Slide count equals page count'],
  },
  'pdf-to-jpg': {
    toolId: 'pdf-to-jpg',
    primary: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['jpg', 'zip'],
    fidelity: 'high',
    limits: ['JPEG is lossy'],
    validation: ['Image count equals page count and dimensions follow page geometry'],
  },
  'pdf-to-png': {
    toolId: 'pdf-to-png',
    primary: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['png', 'zip'],
    fidelity: 'high',
    limits: ['Very high DPI on large pages needs memory'],
    validation: ['Image count equals page count at 1:1 pixel ratio'],
  },
  'pdf-to-markdown': {
    toolId: 'pdf-to-markdown',
    primary: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['md'],
    fidelity: 'approximate',
    limits: ['Headings and lists are inferred from font size and indentation'],
    validation: ['Every source page contributes its text'],
  },
  'pdf-to-text': {
    toolId: 'pdf-to-text',
    primary: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['txt'],
    fidelity: 'exact',
    limits: ['Text only: images and layout are dropped by definition'],
    validation: ['Extracted text contains the known fixture strings'],
  },
  'pdf-to-pdfa': {
    toolId: 'pdf-to-pdfa',
    primary: 'pdf-lib',
    preferredWorker: 'verapdf-worker',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'approximate',
    limits: [
      'Adds archival metadata and normalises fonts; this is not an ISO 19005 validator pass',
      'veraPDF is AGPL-licensed and therefore not bundled without explicit approval',
    ],
    validation: ['Output re-opens and preserves page count'],
  },
  'word-to-pdf': {
    toolId: 'word-to-pdf',
    primary: 'ooxml-parser',
    fallback: 'pdf-lib',
    preferredWorker: 'libreoffice-worker',
    side: 'server',
    inputs: ['docx'],
    outputs: pdfOut,
    fidelity: 'high',
    limits: [
      'Browser layout engine: paragraphs, runs, tables, margins and page breaks are preserved',
      'Floating shapes, text boxes and exact Word font metrics are approximations',
    ],
    validation: ['No OOXML markup reaches the page', 'Malformed XML raises DocxParseError'],
  },
  'excel-to-pdf': {
    toolId: 'excel-to-pdf',
    primary: 'ooxml-parser',
    fallback: 'pdf-lib',
    preferredWorker: 'libreoffice-worker',
    side: 'server',
    inputs: ['xlsx', 'csv'],
    outputs: pdfOut,
    fidelity: 'high',
    limits: ['Merged cells are simplified', 'Very wide sheets are scaled to fit'],
    validation: ['Sheet names and cell text appear in the output'],
  },
  'powerpoint-to-pdf': {
    toolId: 'powerpoint-to-pdf',
    primary: 'ooxml-parser',
    fallback: 'pdf-lib',
    preferredWorker: 'libreoffice-worker',
    side: 'server',
    inputs: ['pptx'],
    outputs: pdfOut,
    fidelity: 'high',
    limits: ['Slide text is laid out one page per slide; themes and animations are dropped'],
    validation: ['Slide count equals page count'],
  },
  'image-to-pdf': {
    toolId: 'image-to-pdf',
    primary: 'pdf-lib',
    side: 'server',
    inputs: ['png', 'jpg', 'jpeg', 'webp'],
    outputs: pdfOut,
    fidelity: 'exact',
    limits: ['One image per page, fitted to the page box'],
    validation: ['Page count equals image count and dimensions match the chosen size'],
  },
  'markdown-to-pdf': {
    toolId: 'markdown-to-pdf',
    primary: 'ooxml-parser',
    fallback: 'pdf-lib',
    side: 'server',
    inputs: ['md', 'markdown'],
    outputs: pdfOut,
    fidelity: 'high',
    limits: ['Inline HTML is flattened to text'],
    validation: ['Headings and list items appear as text'],
  },
  'html-to-pdf': {
    toolId: 'html-to-pdf',
    primary: 'ooxml-parser',
    fallback: 'pdf-lib',
    preferredWorker: 'chromium-worker',
    side: 'server',
    inputs: ['html', 'htm'],
    outputs: pdfOut,
    fidelity: 'approximate',
    limits: ['Sanitised text layout only: CSS is not applied', 'A Chromium worker would give true layout'],
    validation: ['Scripts and styles never reach the output'],
  },
  'webpage-to-pdf': {
    toolId: 'webpage-to-pdf',
    primary: 'ooxml-parser',
    fallback: 'pdf-lib',
    preferredWorker: 'chromium-worker',
    side: 'server',
    inputs: ['url'],
    outputs: pdfOut,
    fidelity: 'approximate',
    limits: ['Subject to the target site CORS policy', 'Not available in Strict Local Mode'],
    validation: ['Non-fetchable URLs raise an actionable error'],
  },
  editor: {
    toolId: 'editor',
    primary: 'pdfjs',
    fallback: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'high',
    limits: ['Annotations are flattened into the page on export'],
    validation: ['Exported PDF re-opens with the added objects'],
  },
  sign: {
    toolId: 'sign',
    primary: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'exact',
    limits: ['Visual signature, not a certificate-based digital signature'],
    validation: ['Signature XObject exists at the chosen rectangle on the target page'],
  },
  forms: {
    toolId: 'forms',
    primary: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'exact',
    limits: ['Only existing AcroForm fields can be filled'],
    validation: ['Field values persist after flattening'],
  },
  watermark: {
    toolId: 'watermark',
    primary: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'exact',
    limits: ['Text watermarks are drawn into the page content'],
    validation: ['Watermark text is present in the output text layer'],
  },
  redact: {
    toolId: 'redact',
    primary: 'pdfjs',
    fallback: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'high',
    limits: [
      'Redacted pages are re-rendered as images so the original text objects are not carried over',
      'Residual object data has not been audited with an independent extraction tool',
    ],
    validation: ['Redacted text is absent from the re-extracted text layer'],
  },
  compare: {
    toolId: 'compare',
    primary: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['txt', 'html'],
    fidelity: 'approximate',
    limits: ['Text-level diff, not a visual diff'],
    validation: ['Added and removed lines are both reported'],
  },
  encrypt: {
    toolId: 'encrypt',
    primary: 'pdf-lib',
    fallback: 'webcrypto',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'exact',
    limits: ['Permissions were not verified with a third-party PDF reader'],
    validation: ['Wrong password is rejected and the correct password re-opens the file'],
  },
  decrypt: {
    toolId: 'decrypt',
    primary: 'pdf-lib',
    side: 'server',
    inputs: pdfIn,
    outputs: pdfOut,
    fidelity: 'exact',
    limits: ['Requires the correct password; nothing is brute-forced'],
    validation: ['Unlocked output opens without a password'],
  },
  'ai-summarize': {
    toolId: 'ai-summarize',
    primary: 'ollama',
    fallback: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['txt', 'md'],
    fidelity: 'approximate',
    limits: ['Runs on Folio\'s server with a deterministic extractive summariser', 'No external AI provider, API key or paid credit is involved'],
    validation: ['Summary is derived from the document text, never invented'],
  },
  'ai-chat': {
    toolId: 'ai-chat',
    primary: 'ollama',
    fallback: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['txt'],
    fidelity: 'approximate',
    limits: ['Answers are extractive: ranked passages are quoted with page citations', 'No external AI provider is contacted'],
    validation: ['Every citation maps to a real page'],
  },
  'ai-tables': {
    toolId: 'ai-tables',
    primary: 'pdfjs',
    fallback: 'xlsx-writer',
    side: 'server',
    inputs: pdfIn,
    outputs: ['csv', 'json', 'xlsx'],
    fidelity: 'approximate',
    limits: ['Column detection is positional and can merge wrapped cells'],
    validation: ['Exported rows match the detected grid'],
  },
  'ai-translate': {
    toolId: 'ai-translate',
    primary: 'ollama',
    fallback: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['txt', 'pdf'],
    fidelity: 'approximate',
    limits: ['Layout is not re-flowed per language', 'Translation quality is limited to the extracted text'],
    validation: ['Output keeps page structure and never drops source paragraphs silently'],
  },
  'ai-workspace': {
    toolId: 'ai-workspace',
    primary: 'ollama',
    fallback: 'pdfjs',
    side: 'server',
    inputs: pdfIn,
    outputs: ['txt', 'md', 'csv'],
    fidelity: 'approximate',
    limits: ['Hub over the other AI tools; inherits their limits'],
    validation: ['Delegates to the individual tools rather than duplicating logic'],
  },
}

export function engineForTool(toolId: string): ToolEngineSpec | undefined {
  return TOOL_ENGINES[toolId]
}

export function engineDefinition(engineId: string): EngineDefinition | undefined {
  return ENGINES[engineId]
}

export function toolsForSide(side: ExecutionSide): ToolEngineSpec[] {
  return Object.values(TOOL_ENGINES).filter((spec) => spec.side === side)
}

/** Tools whose best available fidelity needs a native document worker that is not bundled. */
export function toolsWithPreferredWorker(): ToolEngineSpec[] {
  return Object.values(TOOL_ENGINES).filter((spec) => Boolean(spec.preferredWorker))
}

export function unapprovedEngines(): EngineDefinition[] {
  return Object.values(ENGINES).filter((engine) => engine.licenseClass === 'C' || engine.licenseClass === 'D')
}

export const ENGINE_REGISTRY_COUNT = {
  engines: Object.keys(ENGINES).length,
  tools: Object.keys(TOOL_ENGINES).length,
}
