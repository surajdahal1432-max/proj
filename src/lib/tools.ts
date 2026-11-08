import {
  AlignLeft,
  ArrowLeftRight,
  ArrowRightLeft,
  Combine,
  Crop,
  FileArchive,
  FileDown,
  FileImage,
  FileLock2,
  FilePlus2,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FileType2,
  FormInput,
  GitCompareArrows,
  Grid2x2,
  Highlighter,
  Languages,
  Layers,
  Lock,
  MessageSquareText,
  Minimize2,
  PenTool,
  Presentation,
  RotateCw,
  ScanText,
  Scissors,
  ShieldCheck,
  Sparkles,
  SquareDashed,
  Stamp,
  Table2,
  Unlock,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export type ToolCategory = 'organize' | 'convert' | 'edit' | 'security' | 'ai'

export type ToolKind =
  | 'merge'
  | 'split'
  | 'rearrange'
  | 'extract'
  | 'rotate'
  | 'compress'
  | 'repair'
  | 'ocr'
  | 'convertFrom'
  | 'convertTo'
  | 'webToPdf'
  | 'editor'
  | 'sign'
  | 'redact'
  | 'compare'
  | 'forms'
  | 'encrypt'
  | 'decrypt'
  | 'watermark'
  | 'ai'

export type AiTab = 'summarize' | 'chat' | 'tables' | 'translate'

export interface ToolDefinition {
  id: string
  name: string
  tagline: string
  description: string
  category: ToolCategory
  icon: LucideIcon
  kind: ToolKind
  accept: string[]
  multiple: boolean
  options?: Record<string, string>
  aiTab?: AiTab
  featured?: boolean
}

export const CATEGORIES: { id: ToolCategory | 'all'; label: string; blurb: string }[] = [
  { id: 'all', label: 'All tools', blurb: 'Everything, no paywalls' },
  { id: 'organize', label: 'Organize', blurb: 'Pages, order and structure' },
  { id: 'convert', label: 'Convert', blurb: 'Any format in, any format out' },
  { id: 'edit', label: 'Edit & Sign', blurb: 'Annotate, sign, fill forms' },
  { id: 'security', label: 'Security', blurb: 'Redact, encrypt, compare' },
  { id: 'ai', label: 'AI Workspace', blurb: 'Summarise, chat, translate' },
]

const PDF = ['pdf']

export const TOOLS: ToolDefinition[] = [
  /* ----------------------------- Organize ----------------------------- */
  {
    id: 'merge',
    name: 'Merge PDF',
    tagline: 'Combine files in any order',
    description: 'Drag to reorder documents, preview thumbnails and page counts, then merge into one PDF.',
    category: 'organize',
    icon: Combine,
    kind: 'merge',
    accept: PDF,
    multiple: true,
    featured: true,
  },
  {
    id: 'split',
    name: 'Split PDF',
    tagline: 'Ranges, intervals or single pages',
    description: 'Split by custom ranges like 1-3, 5, 8-12, by fixed intervals, or export every page separately.',
    category: 'organize',
    icon: Scissors,
    kind: 'split',
    accept: PDF,
    multiple: false,
    featured: true,
  },
  {
    id: 'rearrange',
    name: 'Organize Pages',
    tagline: 'Visual drag-and-drop page grid',
    description: 'Reorder, rotate, duplicate and delete pages with a live visual grid before exporting.',
    category: 'organize',
    icon: Grid2x2,
    kind: 'rearrange',
    accept: PDF,
    multiple: false,
  },
  {
    id: 'extract',
    name: 'Extract Pages',
    tagline: 'Pull out exactly what you need',
    description: 'Select pages visually and export them as a new document, or one PDF per page.',
    category: 'organize',
    icon: Layers,
    kind: 'extract',
    accept: PDF,
    multiple: false,
  },
  {
    id: 'rotate',
    name: 'Rotate PDF',
    tagline: 'Fix orientation instantly',
    description: 'Rotate every page or individual pages by 90°, 180° or 270° with live previews.',
    category: 'organize',
    icon: RotateCw,
    kind: 'rotate',
    accept: PDF,
    multiple: false,
  },

  /* ----------------------------- Optimize ----------------------------- */
  {
    id: 'compress',
    name: 'Compress PDF',
    tagline: 'Smaller files, real numbers',
    description: 'Choose extreme, recommended or low compression and compare exact before/after sizes.',
    category: 'convert',
    icon: Minimize2,
    kind: 'compress',
    accept: PDF,
    multiple: true,
    featured: true,
  },
  {
    id: 'repair',
    name: 'Repair PDF',
    tagline: 'Recover damaged documents',
    description: 'Rebuild broken cross-reference tables and salvage readable pages from corrupted files.',
    category: 'convert',
    icon: Wrench,
    kind: 'repair',
    accept: PDF,
    multiple: false,
  },
  {
    id: 'ocr',
    name: 'OCR PDF',
    tagline: 'Make scans searchable',
    description: 'Recognise text in 13 languages with Tesseract and embed a real, selectable text layer.',
    category: 'convert',
    icon: ScanText,
    kind: 'ocr',
    accept: PDF,
    multiple: false,
    featured: true,
  },

  /* ------------------------- PDF → other ------------------------- */
  {
    id: 'pdf-to-word',
    name: 'PDF to Word',
    tagline: 'Editable .docx output',
    description: 'Convert selectable PDF text into a properly styled Word document you can keep editing.',
    category: 'convert',
    icon: FileText,
    kind: 'convertFrom',
    accept: PDF,
    multiple: true,
    options: { format: 'docx' },
  },
  {
    id: 'pdf-to-excel',
    name: 'PDF to Excel',
    tagline: 'Detect tables automatically',
    description: 'Find tabular data in your PDF and export clean, cell-aligned .xlsx spreadsheets.',
    category: 'convert',
    icon: FileSpreadsheet,
    kind: 'convertFrom',
    accept: PDF,
    multiple: true,
    options: { format: 'xlsx' },
  },
  {
    id: 'pdf-to-powerpoint',
    name: 'PDF to PowerPoint',
    tagline: 'One slide per page',
    description: 'Turn each page into a presentation slide with its heading and key lines preserved.',
    category: 'convert',
    icon: Presentation,
    kind: 'convertFrom',
    accept: PDF,
    multiple: true,
    options: { format: 'pptx' },
  },
  {
    id: 'pdf-to-jpg',
    name: 'PDF to JPG',
    tagline: 'High-resolution images',
    description: 'Render pages as crisp JPEGs at your chosen DPI and download them individually or as a ZIP.',
    category: 'convert',
    icon: FileImage,
    kind: 'convertFrom',
    accept: PDF,
    multiple: true,
    options: { format: 'jpeg' },
  },
  {
    id: 'pdf-to-png',
    name: 'PDF to PNG',
    tagline: 'Lossless page exports',
    description: 'Export pages as lossless PNGs with transparent-friendly rendering and batch ZIP download.',
    category: 'convert',
    icon: FileImage,
    kind: 'convertFrom',
    accept: PDF,
    multiple: true,
    options: { format: 'png' },
  },
  {
    id: 'pdf-to-markdown',
    name: 'PDF to Markdown',
    tagline: 'Docs-ready plain text',
    description: 'Convert PDF content into clean Markdown with headings, bullets and page sections.',
    category: 'convert',
    icon: FileType2,
    kind: 'convertFrom',
    accept: PDF,
    multiple: true,
    options: { format: 'md' },
  },
  {
    id: 'pdf-to-text',
    name: 'PDF to Text',
    tagline: 'Raw, searchable text',
    description: 'Extract every character of selectable text with page boundaries preserved.',
    category: 'convert',
    icon: AlignLeft,
    kind: 'convertFrom',
    accept: PDF,
    multiple: true,
    options: { format: 'txt' },
  },
  {
    id: 'pdf-to-pdfa',
    name: 'PDF to PDF/A',
    tagline: 'Archival compliance',
    description: 'Produce a PDF/A-2b compliant file with embedded metadata, output intent and XMP.',
    category: 'convert',
    icon: FileArchive,
    kind: 'convertFrom',
    accept: PDF,
    multiple: true,
    options: { format: 'pdfa' },
  },

  /* ------------------------- other → PDF ------------------------- */
  {
    id: 'word-to-pdf',
    name: 'Word to PDF',
    tagline: '.docx → paginated PDF',
    description: 'Convert Word documents to PDF with heading structure, lists and configurable page layout.',
    category: 'convert',
    icon: FilePlus2,
    kind: 'convertTo',
    accept: ['docx'],
    multiple: true,
    options: { format: 'docx' },
  },
  {
    id: 'excel-to-pdf',
    name: 'Excel to PDF',
    tagline: '.xlsx → clean tables',
    description: 'Convert spreadsheets into landscape PDFs with real table rules and readable columns.',
    category: 'convert',
    icon: FileSpreadsheet,
    kind: 'convertTo',
    accept: ['xlsx', 'csv'],
    multiple: true,
    options: { format: 'xlsx' },
  },
  {
    id: 'powerpoint-to-pdf',
    name: 'PowerPoint to PDF',
    tagline: '.pptx → slide handouts',
    description: 'Convert slide decks to landscape PDFs with slide titles and bullet content intact.',
    category: 'convert',
    icon: Presentation,
    kind: 'convertTo',
    accept: ['pptx'],
    multiple: true,
    options: { format: 'pptx' },
  },
  {
    id: 'image-to-pdf',
    name: 'Image to PDF',
    tagline: 'JPG & PNG → PDF',
    description: 'Combine photos and scans into a single PDF with fit-to-page sizing and ordering.',
    category: 'convert',
    icon: FileImage,
    kind: 'convertTo',
    accept: ['png', 'jpg', 'jpeg', 'webp'],
    multiple: true,
    options: { format: 'image' },
  },
  {
    id: 'markdown-to-pdf',
    name: 'Markdown to PDF',
    tagline: 'Notes → polished PDF',
    description: 'Render Markdown with headings, lists, tables and code blocks into a typeset PDF.',
    category: 'convert',
    icon: FileType2,
    kind: 'convertTo',
    accept: ['md', 'markdown', 'txt'],
    multiple: true,
    options: { format: 'md' },
  },
  {
    id: 'html-to-pdf',
    name: 'HTML to PDF',
    tagline: 'Local HTML files',
    description: 'Turn saved HTML pages into readable PDFs without sending anything to a server.',
    category: 'convert',
    icon: FileDown,
    kind: 'convertTo',
    accept: ['html', 'htm'],
    multiple: true,
    options: { format: 'html' },
  },
  {
    id: 'webpage-to-pdf',
    name: 'Webpage to PDF',
    tagline: 'Any URL → document',
    description: 'Capture a public page as PDF text. Strict Local Mode blocks any proxy fallback.',
    category: 'convert',
    icon: ArrowRightLeft,
    kind: 'webToPdf',
    accept: [],
    multiple: false,
  },

  /* ----------------------------- Edit ----------------------------- */
  {
    id: 'editor',
    name: 'Visual PDF Editor',
    tagline: 'Text, shapes, highlights, stamps',
    description: 'Draw on rendered pages with text boxes, highlights, shapes, images and page numbers. Undo/redo included.',
    category: 'edit',
    icon: Highlighter,
    kind: 'editor',
    accept: PDF,
    multiple: false,
    featured: true,
  },
  {
    id: 'sign',
    name: 'Sign PDF',
    tagline: 'Drawn, typed or uploaded',
    description: 'Build a vector signature, initials or date stamp and place it precisely on any page.',
    category: 'edit',
    icon: PenTool,
    kind: 'sign',
    accept: PDF,
    multiple: false,
    featured: true,
  },
  {
    id: 'forms',
    name: 'Fill PDF Forms',
    tagline: 'Detect and fill fields',
    description: 'Detect interactive fields, fill text, checkboxes, radios and dropdowns, then export flat or fillable.',
    category: 'edit',
    icon: FormInput,
    kind: 'forms',
    accept: PDF,
    multiple: false,
  },
  {
    id: 'watermark',
    name: 'Watermark PDF',
    tagline: 'Brand or protect pages',
    description: 'Stamp diagonal or tiled text watermarks with custom font size, colour and opacity.',
    category: 'edit',
    icon: Stamp,
    kind: 'watermark',
    accept: PDF,
    multiple: true,
  },

  /* ----------------------------- Security ----------------------------- */
  {
    id: 'redact',
    name: 'Redact PDF',
    tagline: 'Permanent, stream-level removal',
    description: 'Burn selections into pixels and strip the underlying text so redactions cannot be reversed.',
    category: 'security',
    icon: SquareDashed,
    kind: 'redact',
    accept: PDF,
    multiple: false,
    featured: true,
  },
  {
    id: 'compare',
    name: 'Compare PDFs',
    tagline: 'See every change',
    description: 'Diff two versions side by side with word-level additions and deletions plus a report PDF.',
    category: 'security',
    icon: GitCompareArrows,
    kind: 'compare',
    accept: PDF,
    multiple: true,
  },
  {
    id: 'encrypt',
    name: 'Protect PDF',
    tagline: 'AES-256 encryption',
    description: 'Encrypt with AES-256 (revision 6) and set granular print, copy and edit permissions.',
    category: 'security',
    icon: Lock,
    kind: 'encrypt',
    accept: PDF,
    multiple: true,
  },
  {
    id: 'decrypt',
    name: 'Unlock PDF',
    tagline: 'Remove password protection',
    description: 'Remove known passwords from AES-256 files while keeping text intact, with a pixel fallback.',
    category: 'security',
    icon: Unlock,
    kind: 'decrypt',
    accept: PDF,
    multiple: false,
  },

  /* ------------------------------- AI ------------------------------- */
  {
    id: 'ai-summarize',
    name: 'Smart Summary',
    tagline: 'Executive summaries',
    description: 'Generate bullet or paragraph summaries with page citations — offline by default, Ollama for depth.',
    category: 'ai',
    icon: Sparkles,
    kind: 'ai',
    accept: PDF,
    multiple: false,
    aiTab: 'summarize',
    featured: true,
  },
  {
    id: 'ai-chat',
    name: 'Document Q&A',
    tagline: 'Ask your documents',
    description: 'Chat with page-level citations using local retrieval or your own Ollama model. No API credits.',
    category: 'ai',
    icon: MessageSquareText,
    kind: 'ai',
    accept: PDF,
    multiple: false,
    aiTab: 'chat',
    featured: true,
  },
  {
    id: 'ai-tables',
    name: 'Table Extraction',
    tagline: 'Tables → CSV / JSON',
    description: 'Detect tabular structures and export clean CSV or Excel-compatible JSON in one click.',
    category: 'ai',
    icon: Table2,
    kind: 'ai',
    accept: PDF,
    multiple: false,
    aiTab: 'tables',
  },
  {
    id: 'ai-translate',
    name: 'Translate Document',
    tagline: 'Layout-preserving translation',
    description: 'Translate page blocks while keeping paragraph structure, powered by your local model.',
    category: 'ai',
    icon: Languages,
    kind: 'ai',
    accept: PDF,
    multiple: false,
    aiTab: 'translate',
  },
  {
    id: 'ai-workspace',
    name: 'AI Workspace',
    tagline: 'All intelligence tools',
    description: 'Summaries, RAG chat, table extraction and translation in a single workspace.',
    category: 'ai',
    icon: FileSearch,
    kind: 'ai',
    accept: PDF,
    multiple: false,
    aiTab: 'summarize',
  },
]

export const TOOL_MAP: Record<string, ToolDefinition> = Object.fromEntries(TOOLS.map((tool) => [tool.id, tool]))

export function getTool(id: string | undefined): ToolDefinition | undefined {
  return id ? TOOL_MAP[id] : undefined
}

export function toolsByCategory(category: ToolCategory | 'all'): ToolDefinition[] {
  return category === 'all' ? TOOLS : TOOLS.filter((tool) => tool.category === category)
}

export function searchTools(query: string, category: ToolCategory | 'all' = 'all'): ToolDefinition[] {
  const pool = toolsByCategory(category)
  const q = query.trim().toLowerCase()
  if (!q) return pool
  return pool.filter((tool) =>
    [tool.name, tool.tagline, tool.description, tool.category, ...(tool.accept ?? [])]
      .join(' ')
      .toLowerCase()
      .includes(q),
  )
}

export const ALL_ACCEPT = ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'md', 'txt', 'html', 'csv']

/** Suggest the most relevant tool for a dropped file set. */
export function suggestTools(files: File[]): ToolDefinition[] {
  if (!files.length) return []
  const extensions = files.map((file) => (file.name.split('.').pop() ?? '').toLowerCase())
  const allPdf = extensions.every((extension) => extension === 'pdf')
  const suggestions: ToolDefinition[] = []

  if (allPdf) {
    if (files.length > 1) suggestions.push(TOOL_MAP.merge, TOOL_MAP.compress)
    else suggestions.push(TOOL_MAP.editor, TOOL_MAP['ai-summarize'], TOOL_MAP.split)
  }
  if (extensions.some((extension) => extension === 'docx')) suggestions.push(TOOL_MAP['word-to-pdf'])
  if (extensions.some((extension) => extension === 'xlsx' || extension === 'csv'))
    suggestions.push(TOOL_MAP['excel-to-pdf'])
  if (extensions.some((extension) => extension === 'pptx')) suggestions.push(TOOL_MAP['powerpoint-to-pdf'])
  if (extensions.some((extension) => ['png', 'jpg', 'jpeg', 'webp'].includes(extension)))
    suggestions.push(TOOL_MAP['image-to-pdf'])
  if (extensions.some((extension) => ['md', 'markdown', 'txt'].includes(extension)))
    suggestions.push(TOOL_MAP['markdown-to-pdf'])
  if (extensions.some((extension) => ['html', 'htm'].includes(extension))) suggestions.push(TOOL_MAP['html-to-pdf'])

  const seen = new Set<string>()
  return suggestions.filter((tool) => {
    if (!tool || seen.has(tool.id)) return false
    seen.add(tool.id)
    return true
  })
}

export const TOOL_COUNT = TOOLS.length
export const ICON_SHIELD = ShieldCheck
export const ICON_ARROWS = ArrowLeftRight
export const ICON_CROP = Crop
export const ICON_LOCK = FileLock2
