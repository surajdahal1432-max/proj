import * as React from 'react'
import {
  ArrowRight,
  FileDown,
  FileUp,
  Gauge,
  Globe,
  Languages,
  ScanText,
  Sparkles,
  Wrench,
} from 'lucide-react'
import type { ToolDefinition } from '@/lib/tools'
import { useFileQueue } from '@/hooks/useFileQueue'
import { useRecordHistory } from '@/hooks/useRecordHistory'
import { UploadDropzone } from '@/components/UploadDropzone'
import { ResultPanel, type ResultFile } from '@/components/ResultPanel'
import { ToolShell, ToolPanel, ProcessBar, EmptyQueueHint } from '@/components/ToolShell'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Label, Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from '@/components/ui/controls'
import { Alert, Badge, Spinner } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/overlays'
import { baseName, downloadBlob, formatBytes } from '@/lib/utils'
import { compressPdf, imagesToPdf, repairPdf, toPdfA } from '@/lib/pdf'
import {
  docxToPdf,
  htmlToPdf,
  markdownToPdf,
  pdfToCsv,
  pdfToDocx,
  pdfToImages,
  pdfToMarkdown,
  pdfToPptx,
  pdfToTextFile,
  pdfToXlsx,
  pptxToPdf,
  textToPdfFile,
  urlToPdf,
  xlsxToPdf,
} from '@/lib/convert'
import type { TextPdfOptions } from '@/lib/textPdf'
import { OCR_LANGUAGES, ocrPdf } from '@/lib/ocr'
import { zipBlobs } from '@/lib/zip'
import { useAppStore } from '@/store/useAppStore'
import { readAsArrayBuffer } from '@/lib/utils'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Processing failed. The file may be damaged or unsupported.'
}

/* ------------------------------------------------------------------ *
 * Compress
 * ------------------------------------------------------------------ */

export function CompressTool({ tool }: { tool: ToolDefinition }) {
  const queue = useFileQueue({ accept: ['pdf'], multiple: true })
  const { toast } = useToast()
  const record = useRecordHistory()
  const [level, setLevel] = React.useState<'extreme' | 'recommended' | 'low'>('recommended')
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [results, setResults] = React.useState<ResultFile[]>([])
  const [savings, setSavings] = React.useState<{ original: number; compressed: number; mode: string } | null>(null)

  const run = async () => {
    if (!queue.files.length) return
    setBusy(true)
    setProgress(0)
    setResults([])
    setSavings(null)
    try {
      const output: ResultFile[] = []
      let original = 0
      let compressed = 0
      let mode = 'structural'
      for (let index = 0; index < queue.files.length; index += 1) {
        const entry = queue.files[index]
        const outcome = await compressPdf(entry.file, {
          level,
          onProgress: (done, total) => {
            const within = total ? done / total : 1
            setProgress(Math.round(((index + within) / queue.files.length) * 100))
          },
        })
        original += outcome.originalSize
        compressed += outcome.compressedSize
        mode = outcome.mode
        output.push({ name: `${baseName(entry.name)}-compressed.pdf`, blob: outcome.blob, size: outcome.blob.size })
      }
      setResults(output)
      setSavings({ original, compressed, mode })
      record(tool, queue.files.map((entry) => entry.name).join(', ').slice(0, 160), {
        name: output[0]?.name ?? 'compressed.pdf',
        size: compressed,
      })
      const saved = original > 0 ? Math.max(0, Math.round((1 - compressed / original) * 100)) : 0
      toast({
        title: `Compressed — ${saved}% smaller`,
        description: `${formatBytes(original)} → ${formatBytes(compressed)}`,
        variant: 'success',
      })
    } catch (error) {
      toast({ title: 'Compression failed', description: errorMessage(error), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell
      tool={tool}
      aside={
        <ToolPanel title="Compression level" description="Higher compression rasterizes pages and drops the text layer.">
          <div className="space-y-1.5">
            <Label>Level</Label>
            <Select value={level} onValueChange={(value) => setLevel(value as typeof level)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low — lossless cleanup</SelectItem>
                <SelectItem value="recommended">Recommended — balanced</SelectItem>
                <SelectItem value="extreme">Extreme — smallest file</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {level === 'low'
                ? 'Rebuilds object streams without touching page content. Text stays selectable.'
                : 'Pages are re-encoded as optimised JPEG images. Great for scans, smaller for text documents.'}
            </p>
          </div>
          <ProcessBar onRun={run} disabled={!queue.files.length} busy={busy} label="Compress PDFs" />
          {busy ? <Progress value={progress} /> : null}
          {savings ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Before</span>
                <span className="font-medium">{formatBytes(savings.original)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">After</span>
                <span className="font-medium">{formatBytes(savings.compressed)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-emerald-500/20 pt-1">
                <span className="text-muted-foreground">Saved</span>
                <span className="font-semibold text-emerald-500">
                  {Math.max(0, Math.round((1 - savings.compressed / Math.max(1, savings.original)) * 100))}%
                </span>
              </div>
            </div>
          ) : null}
        </ToolPanel>
      }
    >
      <UploadDropzone
        accept={['pdf']}
        multiple
        onFiles={queue.add}
        title="Drop PDFs to compress"
        subtitle="Batch as many files as you want — each one is processed in parallel workers."
      />
      {queue.files.length ? (
        <div className="flex flex-wrap gap-2">
          {queue.files.map((entry) => (
            <Badge key={entry.id} variant="secondary">
              {entry.name} · {formatBytes(entry.size)}
            </Badge>
          ))}
        </div>
      ) : (
        <EmptyQueueHint>Add one or more PDFs to see how much space you can save.</EmptyQueueHint>
      )}
      {results.length ? (
        <ResultPanel
          results={results}
          title="Compressed files ready"
          originalSize={savings?.original}
          zipName="folio-compressed.zip"
          note={
            savings ? (
              <span>
                Mode: <strong className="text-foreground">{savings.mode}</strong> ·{' '}
                {formatBytes(savings.original)} → {formatBytes(savings.compressed)}
              </span>
            ) : undefined
          }
          onReset={() => {
            setResults([])
            setSavings(null)
            queue.clear()
          }}
        />
      ) : null}
    </ToolShell>
  )
}

/* ------------------------------------------------------------------ *
 * Repair
 * ------------------------------------------------------------------ */

export function RepairTool({ tool }: { tool: ToolDefinition }) {
  const queue = useFileQueue({ accept: ['pdf'], multiple: false, detectPages: false })
  const { toast } = useToast()
  const record = useRecordHistory()
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [results, setResults] = React.useState<ResultFile[]>([])
  const [report, setReport] = React.useState<{ strategy: string; pages: number; warnings: string[] } | null>(null)

  const run = async () => {
    const file = queue.single?.file
    if (!file) return
    setBusy(true)
    setProgress(0)
    setResults([])
    setReport(null)
    try {
      const outcome = await repairPdf(file, (done, total) =>
        setProgress(total ? Math.round((done / total) * 100) : 0),
      )
      const name = `${baseName(file.name)}-repaired.pdf`
      setResults([{ name, blob: outcome.blob, size: outcome.blob.size }])
      setReport({ strategy: outcome.strategy, pages: outcome.pagesRecovered, warnings: outcome.warnings })
      record(tool, file.name, { name, size: outcome.blob.size })
      toast({
        title: `Recovered ${outcome.pagesRecovered} page${outcome.pagesRecovered === 1 ? '' : 's'}`,
        description: outcome.strategy === 'object-rebuild' ? 'Rebuilt the object graph losslessly.' : 'Rebuilt pages from rendered content.',
        variant: 'success',
      })
    } catch (error) {
      toast({ title: 'Repair failed', description: errorMessage(error), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell
      tool={tool}
      aside={
        <ToolPanel title="Recovery" description="Folio first attempts a lossless object rebuild, then falls back to rendering.">
          <ProcessBar onRun={run} disabled={!queue.single} busy={busy} label="Repair PDF" />
          {busy ? <Progress value={progress} /> : null}
          {report ? (
            <div className="space-y-1.5 rounded-lg bg-muted/50 p-2.5 text-[11px]">
              <p>
                Strategy: <strong className="text-foreground">{report.strategy}</strong>
              </p>
              <p>
                Pages recovered: <strong className="text-foreground">{report.pages}</strong>
              </p>
              {report.warnings.length ? (
                <ul className="list-disc space-y-1 pl-4 text-amber-500">
                  {report.warnings.slice(0, 4).map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </ToolPanel>
      }
    >
      <UploadDropzone
        accept={['pdf']}
        onFiles={queue.add}
        title="Drop a damaged PDF"
        subtitle="Truncated, mis-structured or partially corrupted files can often still be recovered."
        compact={Boolean(queue.single)}
      />
      {queue.single?.error ? (
        <Alert variant="warning" title="This file could not be read" description={`${queue.single.error} — repair will still try.`} />
      ) : null}
      {!queue.single ? <EmptyQueueHint>Add the file you want to rescue.</EmptyQueueHint> : null}
      {results.length ? (
        <ResultPanel
          results={results}
          title="Repaired document ready"
          originalSize={queue.single?.size}
          onReset={() => {
            setResults([])
            setReport(null)
            queue.clear()
          }}
        />
      ) : null}
    </ToolShell>
  )
}

/* ------------------------------------------------------------------ *
 * OCR
 * ------------------------------------------------------------------ */

export function OcrTool({ tool }: { tool: ToolDefinition }) {
  const queue = useFileQueue({ accept: ['pdf'], multiple: false })
  const { toast } = useToast()
  const record = useRecordHistory()
  const [languages, setLanguages] = React.useState<string[]>(['eng'])
  const [dpi, setDpi] = React.useState(200)
  const [busy, setBusy] = React.useState(false)
  const [status, setStatus] = React.useState('')
  const [progress, setProgress] = React.useState(0)
  const [results, setResults] = React.useState<ResultFile[]>([])
  const [text, setText] = React.useState('')
  const [confidence, setConfidence] = React.useState<number | null>(null)

  const toggleLanguage = (code: string) => {
    setLanguages((current) =>
      current.includes(code) ? current.filter((entry) => entry !== code) : [...current, code],
    )
  }

  const run = async () => {
    const file = queue.single?.file
    if (!file) return
    if (!languages.length) {
      toast({ title: 'Pick at least one language', variant: 'warning' })
      return
    }
    setBusy(true)
    setProgress(0)
    setStatus('Preparing')
    setResults([])
    setText('')
    setConfidence(null)
    try {
      const outcome = await ocrPdf(file, {
        languages,
        dpi,
        onProgress: (report) => {
          setProgress(report.percent)
          setStatus(report.status)
        },
      })
      const name = `${baseName(file.name)}-searchable.pdf`
      const textBlob = new Blob([outcome.text], { type: 'text/plain;charset=utf-8' })
      setResults([
        { name, blob: outcome.blob, size: outcome.blob.size },
        { name: `${baseName(file.name)}-ocr.txt`, blob: textBlob, size: textBlob.size },
      ])
      setText(outcome.text)
      setConfidence(outcome.confidence)
      record(tool, file.name, { name, size: outcome.blob.size })
      toast({
        title: 'OCR complete',
        description: `${Math.round(outcome.confidence)}% average confidence across ${outcome.pages.length} page${outcome.pages.length === 1 ? '' : 's'}.`,
        variant: 'success',
      })
    } catch (error) {
      toast({ title: 'OCR failed', description: errorMessage(error), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell
      tool={tool}
      aside={
        <ToolPanel title="Recognition" description="Tesseract runs entirely in your browser — nothing is uploaded.">
          <div className="space-y-1.5">
            <Label>Languages</Label>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {OCR_LANGUAGES.map((language) => (
                <label
                  key={language.code}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent/60"
                >
                  <Checkbox
                    checked={languages.includes(language.code)}
                    onChange={() => toggleLanguage(language.code)}
                  />
                  <span>{language.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ocr-dpi">Render DPI</Label>
            <Input
              id="ocr-dpi"
              type="number"
              min={100}
              max={400}
              step={50}
              value={dpi}
              onChange={(event) => setDpi(Math.min(400, Math.max(100, Number(event.target.value) || 200)))}
            />
            <p className="text-[11px] text-muted-foreground">Higher DPI improves accuracy on small print but is slower.</p>
          </div>
          <ProcessBar onRun={run} disabled={!queue.single} busy={busy} label="Run OCR" />
          {busy ? (
            <div className="space-y-1.5">
              <Progress value={progress} />
              <p className="text-[11px] text-muted-foreground">{status}</p>
            </div>
          ) : null}
        </ToolPanel>
      }
    >
      <UploadDropzone
        accept={['pdf', 'png', 'jpg', 'jpeg']}
        onFiles={queue.add}
        title="Drop a scanned PDF or image"
        subtitle="Folio builds a real, selectable text layer you can search and copy."
        compact={Boolean(queue.single)}
      />
      {!queue.single ? <EmptyQueueHint>Add a scanned document to recognise its text.</EmptyQueueHint> : null}
      {confidence !== null ? (
        <div className="flex items-center gap-2 text-xs">
          <Badge variant={confidence > 80 ? 'success' : confidence > 60 ? 'warning' : 'destructive'}>
            {Math.round(confidence)}% confidence
          </Badge>
          <span className="text-muted-foreground">Extracted text preview below.</span>
        </div>
      ) : null}
      {text ? (
        <ToolPanel title="Recognised text" description="Copy or download the plain-text transcript.">
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-[11px] leading-relaxed">
            {text.slice(0, 20000)}
          </pre>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadBlob(new Blob([text], { type: 'text/plain' }), 'folio-ocr.txt')}
          >
            <FileDown className="h-3.5 w-3.5" /> Download transcript
          </Button>
        </ToolPanel>
      ) : null}
      {results.length ? (
        <ResultPanel
          results={results}
          title="Searchable PDF ready"
          originalSize={queue.single?.size}
          onReset={() => {
            setResults([])
            setText('')
            setConfidence(null)
            queue.clear()
          }}
        />
      ) : null}
    </ToolShell>
  )
}

/* ------------------------------------------------------------------ *
 * PDF → other formats
 * ------------------------------------------------------------------ */

type ConvertTarget = 'docx' | 'xlsx' | 'pptx' | 'jpeg' | 'png' | 'md' | 'txt' | 'pdfa' | 'csv'

function targetFor(toolId: string): ConvertTarget {
  if (toolId.endsWith('word')) return 'docx'
  if (toolId.endsWith('excel')) return 'xlsx'
  if (toolId.endsWith('powerpoint')) return 'pptx'
  if (toolId.endsWith('jpg')) return 'jpeg'
  if (toolId.endsWith('png')) return 'png'
  if (toolId.endsWith('markdown')) return 'md'
  if (toolId.endsWith('text')) return 'txt'
  if (toolId.endsWith('csv')) return 'csv'
  if (toolId.endsWith('pdfa')) return 'pdfa'
  return 'docx'
}

export function ConvertFromTool({ tool }: { tool: ToolDefinition }) {
  const queue = useFileQueue({ accept: ['pdf'], multiple: true })
  const { toast } = useToast()
  const record = useRecordHistory()
  const target = targetFor(tool.id)
  const [dpi, setDpi] = React.useState(150)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [results, setResults] = React.useState<ResultFile[]>([])

  const run = async () => {
    if (!queue.files.length) return
    setBusy(true)
    setProgress(0)
    setResults([])
    try {
      const output: ResultFile[] = []
      for (let index = 0; index < queue.files.length; index += 1) {
        const file = queue.files[index].file
        const base = baseName(file.name)
        const step = (done: number, total: number) =>
          setProgress(Math.round(((index + (total ? done / total : 1)) / queue.files.length) * 100))

        if (target === 'jpeg' || target === 'png') {
          const images = await pdfToImages(file, { format: target, dpi, onProgress: step })
          images.forEach((image) => output.push({ name: image.name, blob: image.blob, size: image.blob.size }))
        } else if (target === 'pdfa') {
          const blob = await toPdfA(file, step)
          output.push({ name: `${base}-pdfa.pdf`, blob, size: blob.size })
        } else {
          const named =
            target === 'docx'
              ? await pdfToDocx(file)
              : target === 'xlsx'
                ? await pdfToXlsx(file)
                : target === 'pptx'
                  ? await pdfToPptx(file)
                  : target === 'md'
                    ? await pdfToMarkdown(file)
                    : target === 'csv'
                      ? await pdfToCsv(file)
                      : await pdfToTextFile(file)
          output.push({ name: named.name, blob: named.blob, size: named.blob.size })
        }
      }
      setResults(output)
      record(tool, queue.files.map((entry) => entry.name).join(', ').slice(0, 160), {
        name: output[0]?.name ?? 'converted',
        size: output.reduce((sum, item) => sum + item.size, 0),
      })
      toast({
        title: `Converted to ${target.toUpperCase()}`,
        description: `${output.length} file${output.length === 1 ? '' : 's'} ready to download.`,
        variant: 'success',
      })
    } catch (error) {
      toast({ title: 'Conversion failed', description: errorMessage(error), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell
      tool={tool}
      aside={
        <ToolPanel title="Output settings" description="Conversion reads the real text layer of your PDF.">
          {target === 'jpeg' || target === 'png' ? (
            <div className="space-y-1.5">
              <Label htmlFor="dpi">Image resolution (DPI)</Label>
              <Input
                id="dpi"
                type="number"
                min={72}
                max={400}
                step={24}
                value={dpi}
                onChange={(event) => setDpi(Math.min(400, Math.max(72, Number(event.target.value) || 150)))}
              />
            </div>
          ) : (
            <p className="rounded-lg bg-muted/50 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              {target === 'docx'
                ? 'Paragraph structure, headings and page breaks are reconstructed as editable Word content.'
                : target === 'xlsx' || target === 'csv'
                  ? 'Tables are detected from text positions and exported as real rows and columns.'
                  : target === 'pptx'
                    ? 'Each page becomes a slide with the document text placed as a text frame.'
                    : target === 'pdfa'
                      ? 'Pages are rendered at 200 DPI and tagged as PDF/A-2b for archival storage.'
                      : 'Text is exported verbatim with page separators preserved.'}
            </p>
          )}
          <ProcessBar onRun={run} disabled={!queue.files.length} busy={busy} label={`Convert to ${target.toUpperCase()}`} />
          {busy ? <Progress value={progress} /> : null}
        </ToolPanel>
      }
    >
      <UploadDropzone
        accept={['pdf']}
        multiple
        onFiles={queue.add}
        title={`Drop PDFs to convert to ${target.toUpperCase()}`}
        subtitle="Batch conversion is supported — every file is processed locally."
      />
      {queue.files.length ? (
        <div className="flex flex-wrap gap-2">
          {queue.files.map((entry) => (
            <Badge key={entry.id} variant="secondary">
              {entry.name}
              {entry.pageCount ? ` · ${entry.pageCount}p` : ''}
            </Badge>
          ))}
        </div>
      ) : (
        <EmptyQueueHint>Add PDFs to convert. Scanned files should be run through OCR first.</EmptyQueueHint>
      )}
      {results.length ? (
        <ResultPanel
          results={results}
          title={`${target.toUpperCase()} output ready`}
          zipName={`folio-${target}.zip`}
          onReset={() => {
            setResults([])
            queue.clear()
          }}
        />
      ) : null}
    </ToolShell>
  )
}

/* ------------------------------------------------------------------ *
 * Other formats → PDF
 * ------------------------------------------------------------------ */

type SourceKind = 'docx' | 'xlsx' | 'pptx' | 'md' | 'html' | 'txt' | 'image'

function sourceFor(toolId: string): SourceKind {
  if (toolId.startsWith('word')) return 'docx'
  if (toolId.startsWith('excel')) return 'xlsx'
  if (toolId.startsWith('powerpoint')) return 'pptx'
  if (toolId.startsWith('markdown')) return 'md'
  if (toolId.startsWith('html')) return 'html'
  if (toolId.startsWith('text')) return 'txt'
  return 'image'
}

const SOURCE_ACCEPT: Record<SourceKind, string[]> = {
  docx: ['docx'],
  xlsx: ['xlsx', 'csv'],
  pptx: ['pptx'],
  md: ['md', 'markdown'],
  html: ['html', 'htm'],
  txt: ['txt'],
  image: ['png', 'jpg', 'jpeg', 'webp'],
}

export function ConvertToTool({ tool }: { tool: ToolDefinition }) {
  const source = sourceFor(tool.id)
  const queue = useFileQueue({ accept: SOURCE_ACCEPT[source], multiple: true, detectPages: false })
  const { toast } = useToast()
  const record = useRecordHistory()
  const [layout, setLayout] = React.useState<TextPdfOptions>({
    pageSize: 'a4',
    orientation: 'portrait',
    margin: 48,
    fontFamily: 'helvetica',
    showPageNumbers: true,
  })
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [results, setResults] = React.useState<ResultFile[]>([])

  const run = async () => {
    if (!queue.files.length) return
    setBusy(true)
    setProgress(0)
    setResults([])
    try {
      const output: ResultFile[] = []
      if (source === 'image') {
        const images = []
        for (const entry of queue.files) {
          const bytes = new Uint8Array(await readAsArrayBuffer(entry.file))
          const isPng = entry.ext === 'png' || entry.file.type.includes('png')
          images.push({ bytes, type: isPng ? ('png' as const) : ('jpg' as const) })
        }
        const blob = await imagesToPdf(images, {
          pageSize: layout.pageSize === 'letter' ? 'letter' : String(layout.pageSize) === 'fit' ? 'fit' : 'a4',
          orientation: layout.orientation === 'landscape' ? 'landscape' : layout.orientation === 'portrait' ? 'portrait' : 'auto',
          margin: 24,
          fitMode: 'contain',
        })
        output.push({ name: `folio-images-${Date.now().toString(36)}.pdf`, blob, size: blob.size })
        setProgress(100)
      } else {
        for (let index = 0; index < queue.files.length; index += 1) {
          const file = queue.files[index].file
          const named =
            source === 'docx'
              ? await docxToPdf(file, layout)
              : source === 'xlsx'
                ? await xlsxToPdf(file, layout)
                : source === 'pptx'
                  ? await pptxToPdf(file, layout)
                  : source === 'md'
                    ? await markdownToPdf(file, layout)
                    : source === 'html'
                      ? await htmlToPdf(file, layout)
                      : await textToPdfFile(file, layout)
          output.push({ name: named.name, blob: named.blob, size: named.blob.size })
          setProgress(Math.round(((index + 1) / queue.files.length) * 100))
        }
      }
      setResults(output)
      record(tool, queue.files.map((entry) => entry.name).join(', ').slice(0, 160), {
        name: output[0]?.name ?? 'document.pdf',
        size: output.reduce((sum, item) => sum + item.size, 0),
      })
      toast({ title: 'PDF created', description: 'Your document is ready to download.', variant: 'success' })
    } catch (error) {
      toast({ title: 'Conversion failed', description: errorMessage(error), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell
      tool={tool}
      aside={
        <ToolPanel title="Page layout" description="Applied to every page of the generated PDF.">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>Paper size</Label>
              <Select
                value={layout.pageSize ?? 'a4'}
                onValueChange={(value) => setLayout((current) => ({ ...current, pageSize: value as TextPdfOptions['pageSize'] }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4">A4</SelectItem>
                  <SelectItem value="letter">Letter</SelectItem>
                  <SelectItem value="legal">Legal</SelectItem>
                  <SelectItem value="a3">A3</SelectItem>
                  <SelectItem value="a5">A5</SelectItem>
                  {source === 'image' ? <SelectItem value="fit">Fit to image</SelectItem> : null}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Orientation</Label>
              <Select
                value={layout.orientation ?? 'portrait'}
                onValueChange={(value) =>
                  setLayout((current) => ({ ...current, orientation: value as TextPdfOptions['orientation'] }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">Portrait</SelectItem>
                  <SelectItem value="landscape">Landscape</SelectItem>
                  {source === 'image' ? <SelectItem value="auto">Auto</SelectItem> : null}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="margin">Margin (pt)</Label>
            <Input
              id="margin"
              type="number"
              min={0}
              max={120}
              value={layout.margin ?? 48}
              onChange={(event) =>
                setLayout((current) => ({ ...current, margin: Math.min(120, Math.max(0, Number(event.target.value) || 0)) }))
              }
            />
          </div>
          {source !== 'image' ? (
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-xs font-medium">Page numbers</p>
                <p className="text-[11px] text-muted-foreground">Add a footer with page numbering.</p>
              </div>
              <Switch
                checked={Boolean(layout.showPageNumbers)}
                onCheckedChange={(checked) => setLayout((current) => ({ ...current, showPageNumbers: checked }))}
              />
            </div>
          ) : null}
          <ProcessBar onRun={run} disabled={!queue.files.length} busy={busy} label="Create PDF" />
          {busy ? <Progress value={progress} /> : null}
        </ToolPanel>
      }
    >
      <UploadDropzone
        accept={SOURCE_ACCEPT[source]}
        multiple
        onFiles={queue.add}
        title={`Drop ${source.toUpperCase()} files`}
        subtitle="Everything is parsed in the browser and laid out into a clean PDF."
      />
      {queue.files.length ? (
        <div className="flex flex-wrap gap-2">
          {queue.files.map((entry) => (
            <Badge key={entry.id} variant="secondary">
              {entry.name} · {formatBytes(entry.size)}
            </Badge>
          ))}
        </div>
      ) : (
        <EmptyQueueHint>Add a source document to convert it into a PDF.</EmptyQueueHint>
      )}
      {results.length ? (
        <ResultPanel
          results={results}
          title="PDF ready"
          zipName="folio-pdfs.zip"
          onReset={() => {
            setResults([])
            queue.clear()
          }}
        />
      ) : null}
    </ToolShell>
  )
}

/* ------------------------------------------------------------------ *
 * Webpage → PDF
 * ------------------------------------------------------------------ */

export function WebToPdfTool({ tool }: { tool: ToolDefinition }) {
  const { toast } = useToast()
  const record = useRecordHistory()
  const localMode = useAppStore((state) => state.localMode)
  const [url, setUrl] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<ResultFile[]>([])
  const [note, setNote] = React.useState('')

  const run = async () => {
    if (!url.trim()) {
      toast({ title: 'Enter a URL', description: 'Include https:// in the address.', variant: 'warning' })
      return
    }
    setBusy(true)
    setResults([])
    setNote('')
    try {
      const outcome = await urlToPdf(url.trim(), { strictLocal: localMode })
      setResults([{ name: outcome.file.name, blob: outcome.file.blob, size: outcome.file.blob.size }])
      setNote(outcome.note)
      record(tool, url.trim(), { name: outcome.file.name, size: outcome.file.blob.size })
      toast({ title: 'Webpage captured', description: outcome.note, variant: 'success' })
    } catch (error) {
      toast({ title: 'Capture failed', description: errorMessage(error), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell
      tool={tool}
      aside={
        <ToolPanel title="Capture" description="Reader text from the page is laid out as a clean PDF.">
          <div className="space-y-1.5">
            <Label htmlFor="url">Webpage URL</Label>
            <Input
              id="url"
              type="url"
              placeholder="https://example.com/article"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void run()
              }}
            />
          </div>
          {localMode ? (
            <Alert
              variant="info"
              title="Strict local mode is on"
              description="Direct fetching still works for CORS-enabled sites. The reader proxy is disabled, so some pages may fail."
            />
          ) : null}
          <ProcessBar onRun={run} disabled={!url.trim()} busy={busy} label="Capture webpage" />
        </ToolPanel>
      }
    >
      <div className="rounded-xl border border-border bg-card/60 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Globe className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Turn any page into a document</h2>
            <p className="text-xs text-muted-foreground">Paste a link — Folio extracts the readable article and typesets it.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            placeholder="https://example.com/article"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="flex-1"
          />
          <Button onClick={run} disabled={busy || !url.trim()}>
            {busy ? <Spinner /> : <ArrowRight className="h-4 w-4" />} Capture
          </Button>
        </div>
      </div>
      {note ? <Alert variant="info" title="Source note" description={note} /> : null}
      {results.length ? (
        <ResultPanel
          results={results}
          title="Webpage PDF ready"
          onReset={() => {
            setResults([])
            setUrl('')
            setNote('')
          }}
        />
      ) : null}
    </ToolShell>
  )
}

export const CONVERT_ICONS = { Gauge, Wrench, ScanText, FileUp, FileDown, Globe, Languages, Sparkles }
