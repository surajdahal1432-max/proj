import * as React from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
  ArrowLeft,
  ArrowRight,
  Eraser,
  Loader2,
  Lock,
  MousePointerSquareDashed,
  PenLine,
  Plus,
  Redo2,
  ShieldCheck,
  Stamp,
  Trash2,
  Type,
  Undo2,
  Unlock,
} from 'lucide-react'
import type { ToolDefinition } from '@/lib/tools'
import { loadPdfFromFile, renderPageToDataUrl } from '@/lib/pdfjs'
import {
  addPageNumbers,
  applyImageStamps,
  applyTextAnnotations,
  fillFormFields,
  inspectFormFields,
  redactPdf,
  watermarkPdf,
  type FormFieldInfo,
  type ImageStamp,
  type RedactionBox,
  type TextAnnotation,
} from '@/lib/pdf'
import { PdfWrongPassword, decryptPdf, encryptPdf } from '@/lib/encrypt'
import {
  clampPlacement,
  heightRatioFor,
  imageAspect,
  imageFileToPngBytes,
  signPdfWithPlacement,
  type SignaturePlacement,
} from '@/lib/signature'
import { comparePdfs, comparisonReportPdf } from '@/lib/compare'
import { baseName, cn, formatBytes, uid } from '@/lib/utils'
import { ToolShell, ToolPanel } from '@/components/ToolShell'
import { UploadDropzone } from '@/components/UploadDropzone'
import { ResultPanel, type ResultFile } from '@/components/ResultPanel'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/feedback'
import { Input, Label, Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Switch } from '@/components/ui/controls'
import { useToast } from '@/components/ui/overlays'
import { useRecordHistory } from '@/hooks/useRecordHistory'

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function asPdfFile(blob: Blob, name: string): File {
  return new File([blob], name.endsWith('.pdf') ? name : `${name}.pdf`, { type: 'application/pdf' })
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof PdfWrongPassword) return 'That password did not unlock this document.'
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function usePdfDoc(file: File | null) {
  const [doc, setDoc] = React.useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = React.useState<{ width: number; height: number }[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    if (!file) {
      setDoc(null)
      setSizes([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const loaded = await loadPdfFromFile(file)
        const collected: { width: number; height: number }[] = []
        for (let index = 1; index <= loaded.numPages; index += 1) {
          const page = await loaded.getPage(index)
          const viewport = page.getViewport({ scale: 1 })
          collected.push({ width: viewport.width, height: viewport.height })
        }
        if (!cancelled) {
          setDoc(loaded)
          setSizes(collected)
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'This PDF could not be opened.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [file])

  return { doc, sizes, error, loading }
}

interface PageViewProps {
  doc: PDFDocumentProxy | null
  pageIndex: number
  maxWidth?: number
  className?: string
  children?: (dims: { width: number; height: number }) => React.ReactNode
}

function PdfPageView({ doc, pageIndex, maxWidth = 860, className, children }: PageViewProps) {
  const [image, setImage] = React.useState<{ dataUrl: string; width: number; height: number } | null>(null)

  React.useEffect(() => {
    let cancelled = false
    if (!doc) {
      setImage(null)
      return
    }
    void (async () => {
      try {
        const page = await doc.getPage(pageIndex + 1)
        const rendered = await renderPageToDataUrl(page, { maxWidth })
        if (!cancelled) setImage({ dataUrl: rendered.dataUrl, width: rendered.width, height: rendered.height })
      } catch {
        if (!cancelled) setImage(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, pageIndex, maxWidth])

  if (!image) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-border/60 bg-muted/30 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Rendering page…
      </div>
    )
  }

  return (
    <div className={cn('relative mx-auto w-fit max-w-full overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm', className)}>
      <img src={image.dataUrl} alt={`Page ${pageIndex + 1}`} className="block h-auto max-w-full select-none" draggable={false} />
      {children?.({ width: image.width, height: image.height })}
    </div>
  )
}

function PageStepper({
  pageIndex,
  pageCount,
  onChange,
}: {
  pageIndex: number
  pageCount: number
  onChange: (index: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/60 px-2 py-1.5">
      <Button variant="ghost" size="icon" onClick={() => onChange(Math.max(0, pageIndex - 1))} disabled={pageIndex === 0} aria-label="Previous page">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <span className="text-xs font-medium text-muted-foreground">
        Page {pageIndex + 1} of {Math.max(1, pageCount)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onChange(Math.min(pageCount - 1, pageIndex + 1))}
        disabled={pageIndex >= pageCount - 1}
        aria-label="Next page"
      >
        <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('The signature could not be exported.')
  return new Uint8Array(await blob.arrayBuffer())
}

/* ------------------------------------------------------------------ *
 * Signature pad
 * ------------------------------------------------------------------ */

function SignaturePad({
  onChange,
  penColor = '#0f172a',
}: {
  onChange: (bytes: Uint8Array | null) => void
  penColor?: string
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const drawing = React.useRef(false)
  const last = React.useRef<{ x: number; y: number } | null>(null)

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  const handleDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drawing.current = true
    last.current = point(event)
  }

  const handleMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const canvas = canvasRef.current!
    const context = canvas.getContext('2d')!
    const next = point(event)
    const previous = last.current ?? next
    context.strokeStyle = penColor
    context.lineWidth = 3.2
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(previous.x, previous.y)
    context.lineTo(next.x, next.y)
    context.stroke()
    last.current = next
  }

  const handleUp = async () => {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    const canvas = canvasRef.current
    if (!canvas) return
    onChange(await canvasToPngBytes(canvas))
  }

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg border border-dashed border-border bg-white">
        <canvas
          ref={canvasRef}
          width={640}
          height={220}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerLeave={handleUp}
          className="h-[150px] w-full touch-none"
        />
        <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[11px] uppercase tracking-widest text-slate-400">
          Draw your signature
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={clear} className="gap-1.5">
        <Eraser className="h-3.5 w-3.5" /> Clear
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Visual editor
 * ------------------------------------------------------------------ */

interface EditableText {
  id: string
  page: number
  nx: number
  ny: number
  text: string
  fontSize: number
  color: string
}

interface EditableStamp {
  id: string
  page: number
  nx: number
  ny: number
  nw: number
  nh: number
  pngBytes: Uint8Array
}

export function EditorTool({ tool }: { tool: ToolDefinition }) {
  const { toast } = useToast()
  const record = useRecordHistory()
  const [file, setFile] = React.useState<File | null>(null)
  const { doc, sizes, error, loading } = usePdfDoc(file)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [texts, setTexts] = React.useState<EditableText[]>([])
  const [stamps, setStamps] = React.useState<EditableStamp[]>([])
  const past = React.useRef<{ texts: EditableText[]; stamps: EditableStamp[] }[]>([])
  const future = React.useRef<{ texts: EditableText[]; stamps: EditableStamp[] }[]>([])
  const [placeMode, setPlaceMode] = React.useState<'none' | 'text' | 'stamp'>('none')
  const [draft, setDraft] = React.useState({ text: 'Approved', fontSize: 20, color: '#2563eb' })
  const [signatureBytes, setSignatureBytes] = React.useState<Uint8Array | null>(null)
  const [numbering, setNumbering] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [results, setResults] = React.useState<ResultFile[]>([])

  const pageCount = doc?.numPages ?? 0

  const commit = (next: { texts: EditableText[]; stamps: EditableStamp[] }) => {
    past.current = [...past.current.slice(-29), { texts, stamps }]
    future.current = []
    setTexts(next.texts)
    setStamps(next.stamps)
  }

  const undo = () => {
    const previous = past.current.pop()
    if (!previous) return
    future.current.push({ texts, stamps })
    setTexts(previous.texts)
    setStamps(previous.stamps)
  }

  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push({ texts, stamps })
    setTexts(next.texts)
    setStamps(next.stamps)
  }

  const reset = () => {
    setFile(null)
    setTexts([])
    setStamps([])
    past.current = []
    future.current = []
    setResults([])
    setPageIndex(0)
  }

  const handlePageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (placeMode === 'none' || !file) return
    const rect = event.currentTarget.getBoundingClientRect()
    const nx = (event.clientX - rect.left) / rect.width
    const ny = (event.clientY - rect.top) / rect.height

    if (placeMode === 'text') {
      const entry: EditableText = { id: uid(), page: pageIndex, nx, ny, text: draft.text, fontSize: draft.fontSize, color: draft.color }
      commit({ texts: [...texts, entry], stamps })
      setPlaceMode('none')
    } else if (signatureBytes) {
      const entry: EditableStamp = {
        id: uid(),
        page: pageIndex,
        nx: Math.min(0.95, nx),
        ny: Math.min(0.95, ny),
        nw: 0.28,
        nh: 0.1,
        pngBytes: signatureBytes,
      }
      commit({ texts, stamps: [...stamps, entry] })
      setPlaceMode('none')
    }
  }

  const exportPdf = async () => {
    if (!file) return
    setBusy(true)
    setProgress(15)
    try {
      let current: Blob = file
      if (texts.length) {
        const annotations: TextAnnotation[] = texts.map((entry) => {
          const size = sizes[entry.page] ?? { width: 595, height: 842 }
          return {
            page: entry.page,
            x: entry.nx * size.width,
            y: entry.ny * size.height,
            text: entry.text,
            fontSize: entry.fontSize,
            color: entry.color,
          }
        })
        current = await applyTextAnnotations(asPdfFile(current, file.name), annotations)
      }
      setProgress(45)
      if (stamps.length) {
        const payload: ImageStamp[] = stamps.map((entry) => ({
          page: entry.page,
          x: entry.nx,
          y: entry.ny,
          width: entry.nw,
          height: entry.nh,
          pngBytes: entry.pngBytes,
        }))
        current = await applyImageStamps(asPdfFile(current, file.name), payload)
      }
      setProgress(75)
      if (numbering) {
        current = await addPageNumbers(asPdfFile(current, file.name), {
          format: 'n-of-total',
          fontSize: 10,
          color: '#64748b',
          position: 'bottom-center',
          startAt: 1,
          margin: 24,
          skipFirst: false,
        })
      }
      setProgress(100)
      const name = `${baseName(file.name)}-edited.pdf`
      setResults([{ name, blob: current, size: current.size }])
      record(tool, { inputName: file.name, outputName: name, outputSize: current.size })
      toast({
        title: 'Edits applied',
        description: `${texts.length + stamps.length} object(s) burned into the PDF${numbering ? ' with page numbers' : ''}.`,
        variant: 'success',
      })
    } catch (err) {
      toast({ title: 'Export failed', description: errorMessage(err, 'The PDF could not be written.'), variant: 'error' })
    } finally {
      setBusy(false)
      setProgress(0)
    }
  }

  return (
    <ToolShell tool={tool}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {!file ? (
            <UploadDropzone accept={tool.accept} multiple={false} onFiles={(files) => files[0] && setFile(files[0])} />
          ) : (
            <>
              <PageStepper pageIndex={pageIndex} pageCount={pageCount} onChange={setPageIndex} />
              {error ? (
                <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
              ) : (
                <PdfPageView doc={doc} pageIndex={pageIndex}>
                  {(dims) => (
                    <div
                      className={cn('absolute inset-0', placeMode !== 'none' ? 'cursor-crosshair' : 'cursor-default')}
                      onClick={handlePageClick}
                    >
                      {texts
                        .filter((entry) => entry.page === pageIndex)
                        .map((entry) => {
                          const pdfWidth = sizes[pageIndex]?.width ?? dims.width
                          const scale = dims.width / pdfWidth
                          return (
                            <div
                              key={entry.id}
                              className="pointer-events-none absolute whitespace-pre font-medium leading-tight"
                              style={{
                                left: `${entry.nx * 100}%`,
                                top: `${entry.ny * 100}%`,
                                color: entry.color,
                                fontSize: `${Math.max(6, entry.fontSize * scale)}px`,
                              }}
                            >
                              {entry.text}
                            </div>
                          )
                        })}
                      {stamps
                        .filter((entry) => entry.page === pageIndex)
                        .map((entry) => (
                          <div
                            key={entry.id}
                            className="pointer-events-none absolute border border-dashed border-primary/40"
                            style={{
                              left: `${entry.nx * 100}%`,
                              top: `${entry.ny * 100}%`,
                              width: `${entry.nw * 100}%`,
                              height: `${entry.nh * 100}%`,
                            }}
                          >
                            <span className="absolute -top-4 left-0 text-[10px] font-medium text-primary">signature</span>
                          </div>
                        ))}
                    </div>
                  )}
                </PdfPageView>
              )}
              {loading && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading document…
                </p>
              )}
            </>
          )}
        </div>

        <div className="space-y-4">
          <ToolPanel title="Add content" description="Pick a tool, then click anywhere on the page to place it.">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={placeMode === 'text' ? 'default' : 'outline'}
                onClick={() => setPlaceMode(placeMode === 'text' ? 'none' : 'text')}
                className="gap-1.5"
                disabled={!file}
              >
                <Type className="h-3.5 w-3.5" /> Text box
              </Button>
              <Button
                size="sm"
                variant={placeMode === 'stamp' ? 'default' : 'outline'}
                onClick={() => setPlaceMode(placeMode === 'stamp' ? 'none' : 'stamp')}
                className="gap-1.5"
                disabled={!file || !signatureBytes}
              >
                <Stamp className="h-3.5 w-3.5" /> Signature
              </Button>
            </div>

            <div className="space-y-1.5 pt-1">
              <Label htmlFor="editor-text">Default text</Label>
              <Input id="editor-text" value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Font size</Label>
                <div className="flex items-center gap-2">
                  <Slider value={[draft.fontSize]} min={8} max={64} step={1} onValueChange={(value) => setDraft({ ...draft, fontSize: value[0] ?? 20 })} />
                  <span className="w-8 text-right text-xs text-muted-foreground">{draft.fontSize}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="editor-color">Colour</Label>
                <input
                  id="editor-color"
                  type="color"
                  value={draft.color}
                  onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                  className="h-9 w-full cursor-pointer rounded-lg border border-input bg-background"
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <div>
                <p className="text-sm font-medium">Page numbers</p>
                <p className="text-[11px] text-muted-foreground">Bottom centre, “n / total”.</p>
              </div>
              <Switch checked={numbering} onCheckedChange={setNumbering} aria-label="Add page numbers" />
            </div>
          </ToolPanel>

          <ToolPanel title="Signature" description="Draw once, then place it on any page.">
            <SignaturePad onChange={setSignatureBytes} />
          </ToolPanel>

          <ToolPanel title="Layers" description={`${texts.length} text · ${stamps.length} signature(s)`}>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={undo} disabled={!past.current.length} className="gap-1.5">
                <Undo2 className="h-3.5 w-3.5" /> Undo
              </Button>
              <Button variant="outline" size="sm" onClick={redo} disabled={!future.current.length} className="gap-1.5">
                <Redo2 className="h-3.5 w-3.5" /> Redo
              </Button>
            </div>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
              {texts.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-2 py-1.5">
                  <Input
                    value={entry.text}
                    onChange={(event) => setTexts(texts.map((item) => (item.id === entry.id ? { ...item, text: event.target.value } : item)))}
                    className="h-7 flex-1 border-0 bg-transparent px-1 text-xs"
                  />
                  <Badge variant="secondary">p.{entry.page + 1}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => commit({ texts: texts.filter((item) => item.id !== entry.id), stamps })}
                    aria-label="Remove text"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
              {stamps.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-2 py-1.5">
                  <Stamp className="h-3.5 w-3.5 text-primary" />
                  <span className="flex-1 text-xs">Signature</span>
                  <Badge variant="secondary">p.{entry.page + 1}</Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => commit({ texts, stamps: stamps.filter((item) => item.id !== entry.id) })}
                    aria-label="Remove signature"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
              {!texts.length && !stamps.length && <li className="py-3 text-center text-xs text-muted-foreground">Nothing placed yet.</li>}
            </ul>
            {busy && <Progress value={progress} />}
            <Button onClick={exportPdf} disabled={!file || busy} className="w-full gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Export edited PDF
            </Button>
          </ToolPanel>

          <ResultPanel results={results} title="Edited document" onReset={reset} />
        </div>
      </div>
    </ToolShell>
  )
}

/* ------------------------------------------------------------------ *
 * Signature studio
 * ------------------------------------------------------------------ */

export function SignTool({ tool }: { tool: ToolDefinition }) {
  const { toast } = useToast()
  const record = useRecordHistory()
  const [file, setFile] = React.useState<File | null>(null)
  const { doc, sizes } = usePdfDoc(file)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [signatureBytes, setSignatureBytes] = React.useState<Uint8Array | null>(null)
  const [signatureUrl, setSignatureUrl] = React.useState<string | null>(null)
  const [aspect, setAspect] = React.useState(3.4)
  const [placement, setPlacement] = React.useState<SignaturePlacement>({ page: 0, x: 0.62, y: 0.78, width: 0.3 })
  const [typed, setTyped] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<ResultFile[]>([])
  const drag = React.useRef<{
    mode: 'move' | 'resize'
    startX: number
    startY: number
    rect: SignaturePlacement
    boxWidth: number
    boxHeight: number
  } | null>(null)
  const pageCount = doc?.numPages ?? 0
  const pageSize = sizes[pageIndex] ?? { width: 595, height: 842 }
  // Single source of truth: the preview box and the embedded stamp both use this.
  const heightRatio = heightRatioFor({ ...placement, page: pageIndex }, aspect, pageSize)

  React.useEffect(() => {
    return () => {
      if (signatureUrl) URL.revokeObjectURL(signatureUrl)
    }
  }, [signatureUrl])

  const adoptSignature = async (bytes: Uint8Array) => {
    const ratio = await imageAspect(bytes)
    setSignatureBytes(bytes)
    setAspect(ratio)
    setSignatureUrl(URL.createObjectURL(blobFromBytes(bytes, 'image/png')))
    setPlacement((current) => clampPlacement({ ...current, page: pageIndex }, heightRatioFor(current, ratio, pageSize)))
  }

  const typeSignature = async () => {
    if (!typed.trim()) return
    const canvas = document.createElement('canvas')
    canvas.width = 1200
    canvas.height = 320
    const context = canvas.getContext('2d')
    if (!context) return
    context.font = 'italic 150px "Segoe Script", "Brush Script MT", cursive'
    context.fillStyle = '#0f172a'
    context.textBaseline = 'middle'
    const textWidth = context.measureText(typed).width
    context.fillText(typed, Math.max(24, (canvas.width - textWidth) / 2), canvas.height / 2)
    await adoptSignature(await canvasToPngBytes(canvas))
    toast({ title: 'Signature created', description: 'Drag it into position on the page.', variant: 'success' })
  }

  const uploadSignature = async (files: FileList | null) => {
    const picked = files?.[0]
    if (!picked) return
    try {
      await adoptSignature(await imageFileToPngBytes(picked))
      toast({ title: 'Signature uploaded', description: 'Drag it into position on the page.', variant: 'success' })
    } catch (err) {
      toast({ title: 'Could not read that image', description: errorMessage(err, 'Choose a PNG or JPEG image.'), variant: 'error' })
    }
  }

  const beginDrag = (mode: 'move' | 'resize') => (event: React.PointerEvent<HTMLElement>) => {
    if (!signatureUrl) return
    event.preventDefault()
    event.stopPropagation()
    const surface = (event.currentTarget.closest('[data-signature-surface]') as HTMLElement | null)?.getBoundingClientRect()
    const box = surface ?? event.currentTarget.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      rect: placement,
      boxWidth: box.width,
      boxHeight: box.height,
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return
    const dx = (event.clientX - state.startX) / Math.max(1, state.boxWidth)
    const dy = (event.clientY - state.startY) / Math.max(1, state.boxHeight)
    if (state.mode === 'move') {
      setPlacement(
        clampPlacement({ ...state.rect, page: pageIndex, x: state.rect.x + dx, y: state.rect.y + dy }, heightRatio),
      )
      return
    }
    const width = Math.min(0.9, Math.max(0.05, state.rect.width + dx))
    const next = { ...state.rect, page: pageIndex, width }
    setPlacement(clampPlacement(next, heightRatioFor(next, aspect, pageSize)))
  }

  const endDrag = () => {
    drag.current = null
  }

  const resetPlacement = () => {
    setPlacement((current) =>
      clampPlacement({ ...current, page: pageIndex, x: 0.62, y: 0.78, width: 0.3 }, heightRatio),
    )
  }

  const apply = async () => {
    if (!file || !signatureBytes) return
    setBusy(true)
    try {
      const blob = await signPdfWithPlacement(
        asPdfFile(file, file.name),
        { ...placement, page: pageIndex },
        signatureBytes,
        pageSize,
        aspect,
      )
      const name = `${baseName(file.name)}-signed.pdf`
      setResults([{ name, blob, size: blob.size }])
      record(tool, { inputName: file.name, outputName: name, outputSize: blob.size })
      toast({
        title: 'Signature applied',
        description: `Embedded on page ${pageIndex + 1} of the exported PDF.`,
        variant: 'success',
      })
    } catch (err) {
      toast({ title: 'Could not sign', description: errorMessage(err, 'The signature could not be applied.'), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell tool={tool}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {!file ? (
            <UploadDropzone accept={tool.accept} multiple={false} onFiles={(files) => files[0] && setFile(files[0])} />
          ) : (
            <>
              <PageStepper pageIndex={pageIndex} pageCount={pageCount} onChange={setPageIndex} />
              <PdfPageView doc={doc} pageIndex={pageIndex}>
                {() => (
                  <div
                    data-signature-surface
                    className="absolute inset-0 touch-none"
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    {signatureUrl ? (
                      <div
                        className="absolute cursor-move border-2 border-dashed border-primary/70 bg-primary/5"
                        style={{
                          left: `${placement.x * 100}%`,
                          top: `${placement.y * 100}%`,
                          width: `${placement.width * 100}%`,
                          height: `${heightRatio * 100}%`,
                        }}
                        onPointerDown={beginDrag('move')}
                      >
                        <img
                          src={signatureUrl}
                          alt="Signature preview"
                          draggable={false}
                          className="pointer-events-none h-full w-full object-contain"
                        />
                        <span
                          role="presentation"
                          className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-sm border border-primary bg-background"
                          onPointerDown={beginDrag('resize')}
                        />
                      </div>
                    ) : (
                      <p className="absolute inset-x-0 top-3 text-center text-xs text-muted-foreground">
                        Create or upload a signature to place it on page {pageIndex + 1}.
                      </p>
                    )}
                  </div>
                )}
              </PdfPageView>
            </>
          )}
        </div>
        <div className="space-y-4">
          <ToolPanel title="Draw signature" description="Vector-quality ink, exported as a transparent stamp.">
            <SignaturePad
              onChange={(bytes) => {
                void adoptSignature(bytes)
              }}
            />
          </ToolPanel>
          <ToolPanel title="Or type it" description="Choose a handwriting style.">
            <div className="flex gap-2">
              <Input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Alex Morgan" />
              <Button variant="outline" onClick={typeSignature} className="gap-1.5">
                <PenLine className="h-4 w-4" /> Create
              </Button>
            </div>
            <label className="mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground">
              <Plus className="h-3.5 w-3.5" />
              Upload a signature image
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  void uploadSignature(event.target.files)
                  event.target.value = ''
                }}
              />
            </label>
          </ToolPanel>
          <ToolPanel title="Placement" description="Drag the box on the page, or use the width slider.">
            <div className="space-y-1.5">
              <Label>Signature width</Label>
              <div className="flex items-center gap-2">
                <Slider
                  value={[placement.width]}
                  min={0.05}
                  max={0.6}
                  step={0.01}
                  onValueChange={(value) => {
                    const width = value[0] ?? placement.width
                    const next = { ...placement, page: pageIndex, width }
                    setPlacement(clampPlacement(next, heightRatioFor(next, aspect, pageSize)))
                  }}
                />
                <span className="w-10 text-right text-xs text-muted-foreground">{Math.round(placement.width * 100)}%</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Page {pageIndex + 1} of {Math.max(1, pageCount)} · position {Math.round(placement.x * 100)}% /{' '}
              {Math.round(placement.y * 100)}%
            </p>
            <Button variant="outline" onClick={resetPlacement} className="w-full">
              Reset position
            </Button>
            {busy && <Progress value={60} />}
            <Button onClick={apply} disabled={!file || !signatureBytes || busy} className="w-full gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stamp className="h-4 w-4" />}
              Apply signature
            </Button>
          </ToolPanel>
          <ResultPanel
            results={results}
            title="Signed document"
            onReset={() => {
              setResults([])
              setFile(null)
            }}
          />
        </div>
      </div>
    </ToolShell>
  )
}

/* ------------------------------------------------------------------ *
 * Watermark
 * ------------------------------------------------------------------ */

const WATERMARK_POSITIONS = ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'tile'] as const

export function WatermarkTool({ tool }: { tool: ToolDefinition }) {
  const { toast } = useToast()
  const record = useRecordHistory()
  const [file, setFile] = React.useState<File | null>(null)
  const [text, setText] = React.useState('CONFIDENTIAL')
  const [fontSize, setFontSize] = React.useState(48)
  const [opacity, setOpacity] = React.useState(0.18)
  const [rotation, setRotation] = React.useState(35)
  const [color, setColor] = React.useState('#ef4444')
  const [position, setPosition] = React.useState<(typeof WATERMARK_POSITIONS)[number]>('center')
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<ResultFile[]>([])

  const run = async () => {
    if (!file) return
    setBusy(true)
    try {
      const blob = await watermarkPdf(file, { text, fontSize, opacity, rotation, color, position })
      const name = `${baseName(file.name)}-watermarked.pdf`
      setResults([{ name, blob, size: blob.size }])
      record(tool, { inputName: file.name, outputName: name, outputSize: blob.size })
      toast({ title: 'Watermark applied', description: `“${text}” stamped on every page.`, variant: 'success' })
    } catch (err) {
      toast({ title: 'Watermark failed', description: errorMessage(err, 'The watermark could not be applied.'), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell tool={tool}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {!file ? (
            <UploadDropzone accept={tool.accept} multiple={false} onFiles={(files) => files[0] && setFile(files[0])} />
          ) : (
            <div className="rounded-xl border border-border/60 bg-card/40 p-8">
              <div className="relative mx-auto flex h-64 max-w-md items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-white">
                <span
                  className="select-none whitespace-nowrap font-bold"
                  style={{ color, opacity, fontSize: `${Math.max(12, fontSize * 0.7)}px`, transform: `rotate(-${rotation}deg)` }}
                >
                  {text || 'CONFIDENTIAL'}
                </span>
              </div>
              <p className="mt-3 text-center text-xs text-muted-foreground">Live preview · {formatBytes(file.size)}</p>
            </div>
          )}
        </div>
        <div className="space-y-4">
          <ToolPanel title="Watermark settings">
            <div className="space-y-1.5">
              <Label htmlFor="wm-text">Text</Label>
              <Input id="wm-text" value={text} onChange={(event) => setText(event.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Size</Label>
                <Slider value={[fontSize]} min={8} max={120} step={1} onValueChange={(value) => setFontSize(value[0] ?? 48)} />
              </div>
              <div className="space-y-1.5">
                <Label>Opacity</Label>
                <Slider value={[opacity * 100]} min={2} max={100} step={1} onValueChange={(value) => setOpacity((value[0] ?? 18) / 100)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Rotation</Label>
              <Slider value={[rotation]} min={0} max={90} step={1} onValueChange={(value) => setRotation(value[0] ?? 35)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Position</Label>
                <Select value={position} onValueChange={(value) => setPosition(value as (typeof WATERMARK_POSITIONS)[number])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WATERMARK_POSITIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value.replace('-', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wm-color">Colour</Label>
                <input
                  id="wm-color"
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  className="h-10 w-full cursor-pointer rounded-lg border border-input bg-background"
                />
              </div>
            </div>
            <Button onClick={run} disabled={!file || busy} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply watermark'}
            </Button>
          </ToolPanel>
          <ResultPanel results={results} title="Watermarked document" onReset={() => { setResults([]); setFile(null) }} />
        </div>
      </div>
    </ToolShell>
  )
}

/* ------------------------------------------------------------------ *
 * Permanent redaction
 * ------------------------------------------------------------------ */

export function RedactTool({ tool }: { tool: ToolDefinition }) {
  const { toast } = useToast()
  const record = useRecordHistory()
  const [file, setFile] = React.useState<File | null>(null)
  const { doc } = usePdfDoc(file)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [boxes, setBoxes] = React.useState<RedactionBox[]>([])
  const [drag, setDrag] = React.useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [results, setResults] = React.useState<ResultFile[]>([])
  const [summary, setSummary] = React.useState<string | null>(null)

  const relative = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  const apply = async () => {
    if (!file || !boxes.length) return
    setBusy(true)
    setProgress(10)
    try {
      const outcome = await redactPdf(file, boxes, (done, total) => setProgress(Math.round((done / Math.max(1, total)) * 90) + 10))
      const name = `${baseName(file.name)}-redacted.pdf`
      setResults([{ name, blob: outcome.blob, size: outcome.blob.size }])
      setSummary(`${outcome.boxes} region(s) on ${outcome.redactedPages} page(s) destroyed · ${outcome.removedCharacters} characters removed from the text layer.`)
      record(tool, { inputName: file.name, outputName: name, outputSize: outcome.blob.size })
      toast({ title: 'Redaction complete', description: 'Underlying text and vectors were destroyed, not covered.', variant: 'success' })
    } catch (err) {
      toast({ title: 'Redaction failed', description: errorMessage(err, 'The redaction could not be completed.'), variant: 'error' })
    } finally {
      setBusy(false)
      setProgress(0)
    }
  }

  return (
    <ToolShell tool={tool}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {!file ? (
            <UploadDropzone accept={tool.accept} multiple={false} onFiles={(files) => files[0] && setFile(files[0])} />
          ) : (
            <>
              <PageStepper pageIndex={pageIndex} pageCount={doc?.numPages ?? 0} onChange={setPageIndex} />
              <PdfPageView doc={doc} pageIndex={pageIndex}>
                {() => (
                  <div
                    className="absolute inset-0 cursor-crosshair"
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      const point = relative(event)
                      setDrag({ x0: point.x, y0: point.y, x1: point.x, y1: point.y })
                    }}
                    onPointerMove={(event) => {
                      if (!drag) return
                      const point = relative(event)
                      setDrag({ ...drag, x1: point.x, y1: point.y })
                    }}
                    onPointerUp={() => {
                      if (!drag) return
                      const x = Math.min(drag.x0, drag.x1)
                      const y = Math.min(drag.y0, drag.y1)
                      const width = Math.abs(drag.x1 - drag.x0)
                      const height = Math.abs(drag.y1 - drag.y0)
                      if (width > 0.008 && height > 0.004) setBoxes([...boxes, { page: pageIndex, x, y, width, height }])
                      setDrag(null)
                    }}
                  >
                    {boxes
                      .filter((box) => box.page === pageIndex)
                      .map((box, index) => (
                        <div
                          key={`${box.page}-${index}`}
                          className="absolute border-2 border-rose-500 bg-slate-900/85"
                          style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }}
                        />
                      ))}
                    {drag && (
                      <div
                        className="absolute border-2 border-dashed border-rose-400 bg-rose-500/25"
                        style={{
                          left: `${Math.min(drag.x0, drag.x1) * 100}%`,
                          top: `${Math.min(drag.y0, drag.y1) * 100}%`,
                          width: `${Math.abs(drag.x1 - drag.x0) * 100}%`,
                          height: `${Math.abs(drag.y1 - drag.y0) * 100}%`,
                        }}
                      />
                    )}
                  </div>
                )}
              </PdfPageView>
              <p className="text-center text-xs text-muted-foreground">Drag across any sensitive content to mark it for permanent removal.</p>
            </>
          )}
        </div>
        <div className="space-y-4">
          <ToolPanel title="Redaction marks" description="Regions are burned into pixels; the original page stream is discarded.">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <MousePointerSquareDashed className="h-4 w-4 text-rose-500" /> {boxes.length} region(s)
              </span>
              {boxes.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setBoxes([])} className="gap-1">
                  <Trash2 className="h-3.5 w-3.5" /> Clear
                </Button>
              )}
            </div>
            {busy && <Progress value={progress} />}
            <Button onClick={apply} disabled={!file || !boxes.length || busy} className="w-full gap-1.5" variant="destructive">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Redact permanently
            </Button>
            {summary && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500">{summary}</p>}
          </ToolPanel>
          <ResultPanel results={results} title="Redacted document" onReset={() => { setResults([]); setBoxes([]); setFile(null); setSummary(null) }} />
        </div>
      </div>
    </ToolShell>
  )
}

/* ------------------------------------------------------------------ *
 * Forms
 * ------------------------------------------------------------------ */

export function FormsTool({ tool }: { tool: ToolDefinition }) {
  const { toast } = useToast()
  const record = useRecordHistory()
  const [file, setFile] = React.useState<File | null>(null)
  const [fields, setFields] = React.useState<FormFieldInfo[]>([])
  const [values, setValues] = React.useState<Record<string, string | boolean>>({})
  const [flatten, setFlatten] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [results, setResults] = React.useState<ResultFile[]>([])

  const inspect = async (next: File) => {
    setFile(next)
    setLoading(true)
    try {
      const outcome = await inspectFormFields(next)
      setFields(outcome.fields)
      setValues(Object.fromEntries(outcome.fields.map((field) => [field.name, field.value])))
      toast({
        title: outcome.hasForm ? `${outcome.fields.length} form field(s) found` : 'No interactive fields',
        description: outcome.hasForm ? 'Fill them in below and export.' : 'This PDF has no AcroForm fields to fill.',
        variant: outcome.hasForm ? 'success' : 'info',
      })
    } catch (err) {
      toast({ title: 'Could not read the form', description: errorMessage(err, 'The form fields could not be inspected.'), variant: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (!file) return
    setBusy(true)
    try {
      const blob = await fillFormFields(file, values, flatten)
      const name = `${baseName(file.name)}-filled.pdf`
      setResults([{ name, blob, size: blob.size }])
      record(tool, { inputName: file.name, outputName: name, outputSize: blob.size })
      toast({ title: 'Form saved', description: flatten ? 'Exported as a flattened PDF.' : 'Exported with editable fields.', variant: 'success' })
    } catch (err) {
      toast({ title: 'Could not save the form', description: errorMessage(err, 'The filled form could not be written.'), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell tool={tool}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {!file ? (
            <UploadDropzone accept={tool.accept} multiple={false} onFiles={(files) => files[0] && inspect(files[0])} />
          ) : (
            <ToolPanel title="Detected fields" description={loading ? 'Inspecting the AcroForm…' : `${fields.length} field(s) in this document.`}>
              {loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading fields…</p>}
              {!loading && !fields.length && (
                <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  This PDF has no interactive form fields. Use the visual editor to place text instead.
                </p>
              )}
              <div className="space-y-3">
                {fields.map((field) => (
                  <div key={field.name} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`field-${field.name}`} className="truncate">{field.name}</Label>
                      <Badge variant="outline">{field.type}</Badge>
                      {field.required && <Badge variant="warning">required</Badge>}
                    </div>
                    {field.type === 'checkbox' ? (
                      <Switch
                        id={`field-${field.name}`}
                        checked={Boolean(values[field.name])}
                        onCheckedChange={(checked) => setValues({ ...values, [field.name]: checked })}
                        disabled={field.readOnly}
                      />
                    ) : field.type === 'dropdown' || field.type === 'optionlist' ? (
                      <Select
                        value={String(values[field.name] ?? '')}
                        onValueChange={(value) => setValues({ ...values, [field.name]: value })}
                        disabled={field.readOnly}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose an option" />
                        </SelectTrigger>
                        <SelectContent>
                          {(field.options ?? []).map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id={`field-${field.name}`}
                        value={String(values[field.name] ?? '')}
                        onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
                        disabled={field.readOnly}
                      />
                    )}
                  </div>
                ))}
              </div>
            </ToolPanel>
          )}
        </div>
        <div className="space-y-4">
          <ToolPanel title="Export options">
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <div>
                <p className="text-sm font-medium">Flatten fields</p>
                <p className="text-[11px] text-muted-foreground">Values become permanent page content.</p>
              </div>
              <Switch checked={flatten} onCheckedChange={setFlatten} aria-label="Flatten fields" />
            </div>
            <Button onClick={save} disabled={!file || !fields.length || busy} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save filled form'}
            </Button>
          </ToolPanel>
          <ResultPanel results={results} title="Filled form" onReset={() => { setResults([]); setFile(null); setFields([]) }} />
        </div>
      </div>
    </ToolShell>
  )
}

/* ------------------------------------------------------------------ *
 * Encrypt / decrypt
 * ------------------------------------------------------------------ */

export function EncryptTool({ tool }: { tool: ToolDefinition }) {
  const { toast } = useToast()
  const record = useRecordHistory()
  const [file, setFile] = React.useState<File | null>(null)
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [permissions, setPermissions] = React.useState({ allowPrinting: true, allowCopying: false, allowModifying: false, allowAnnotating: true })
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<ResultFile[]>([])

  const run = async () => {
    if (!file) return
    if (password.length < 4) {
      toast({ title: 'Password too short', description: 'Use at least 4 characters.', variant: 'warning' })
      return
    }
    if (password !== confirm) {
      toast({ title: 'Passwords do not match', description: 'Re-enter the confirmation password.', variant: 'warning' })
      return
    }
    setBusy(true)
    try {
      const blob = await encryptPdf(file, { userPassword: password, ownerPassword: password, encryptMetadata: true, ...permissions })
      const name = `${baseName(file.name)}-protected.pdf`
      setResults([{ name, blob, size: blob.size }])
      record(tool, { inputName: file.name, outputName: name, outputSize: blob.size })
      toast({ title: 'PDF encrypted', description: 'AES-256 protection applied to the document.', variant: 'success' })
    } catch (err) {
      toast({ title: 'Encryption failed', description: errorMessage(err, 'The document could not be encrypted.'), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell tool={tool}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {!file ? (
            <UploadDropzone accept={tool.accept} multiple={false} onFiles={(files) => files[0] && setFile(files[0])} />
          ) : (
            <ToolPanel title="Document" description={`${file.name} · ${formatBytes(file.size)}`}>
              <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Encryption happens entirely in this tab. The password is never transmitted or stored.
              </p>
            </ToolPanel>
          )}
        </div>
        <div className="space-y-4">
          <ToolPanel title="Password & permissions">
            <div className="space-y-1.5">
              <Label htmlFor="enc-password">Password</Label>
              <Input id="enc-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enc-confirm">Confirm password</Label>
              <Input id="enc-confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="••••••••" />
            </div>
            {(
              [
                ['allowPrinting', 'Allow printing'],
                ['allowCopying', 'Allow copying text'],
                ['allowModifying', 'Allow editing'],
                ['allowAnnotating', 'Allow annotations'],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                <span className="text-sm">{label}</span>
                <Switch checked={permissions[key]} onCheckedChange={(checked) => setPermissions({ ...permissions, [key]: checked })} aria-label={label} />
              </div>
            ))}
            <Button onClick={run} disabled={!file || busy} className="w-full gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Encrypt with AES-256
            </Button>
          </ToolPanel>
          <ResultPanel results={results} title="Protected document" onReset={() => { setResults([]); setFile(null); setPassword(''); setConfirm('') }} />
        </div>
      </div>
    </ToolShell>
  )
}

export function DecryptTool({ tool }: { tool: ToolDefinition }) {
  const { toast } = useToast()
  const record = useRecordHistory()
  const [file, setFile] = React.useState<File | null>(null)
  const [password, setPassword] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<ResultFile[]>([])
  const [note, setNote] = React.useState<string | null>(null)

  const run = async () => {
    if (!file) return
    setBusy(true)
    setNote(null)
    try {
      const outcome = await decryptPdf(file, password)
      const name = `${baseName(file.name)}-unlocked.pdf`
      setResults([{ name, blob: outcome.blob, size: outcome.blob.size }])
      setNote(outcome.usedOwnerPassword ? 'Unlocked with the owner password — permissions are now unrestricted.' : 'Password removed successfully.')
      record(tool, { inputName: file.name, outputName: name, outputSize: outcome.blob.size })
      toast({ title: 'Document unlocked', description: 'The password protection was removed.', variant: 'success' })
    } catch (err) {
      toast({ title: 'Unlock failed', description: errorMessage(err, 'That password did not unlock this document.'), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell tool={tool}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {!file ? (
            <UploadDropzone accept={tool.accept} multiple={false} onFiles={(files) => files[0] && setFile(files[0])} />
          ) : (
            <ToolPanel title="Protected document" description={file.name}>
              <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Enter the password you use to open this PDF. Both user and owner passwords are accepted.
              </p>
            </ToolPanel>
          )}
        </div>
        <div className="space-y-4">
          <ToolPanel title="Unlock">
            <div className="space-y-1.5">
              <Label htmlFor="dec-password">Password</Label>
              <Input
                id="dec-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void run()}
                placeholder="••••••••"
              />
            </div>
            <Button onClick={run} disabled={!file || !password || busy} className="w-full gap-1.5">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
              Remove password
            </Button>
            {note && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-500">{note}</p>}
          </ToolPanel>
          <ResultPanel results={results} title="Unlocked document" onReset={() => { setResults([]); setFile(null); setPassword(''); setNote(null) }} />
        </div>
      </div>
    </ToolShell>
  )
}

/* ------------------------------------------------------------------ *
 * Compare
 * ------------------------------------------------------------------ */

export function CompareTool({ tool }: { tool: ToolDefinition }) {
  const { toast } = useToast()
  const record = useRecordHistory()
  const [left, setLeft] = React.useState<File | null>(null)
  const [right, setRight] = React.useState<File | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof comparePdfs>> | null>(null)
  const [results, setResults] = React.useState<ResultFile[]>([])

  const run = async () => {
    if (!left || !right) return
    setBusy(true)
    try {
      const diff = await comparePdfs(left, right)
      setResult(diff)
      toast({
        title: 'Comparison ready',
        description: `${diff.summary.linesAdded} line(s) added, ${diff.summary.linesRemoved} removed.`,
        variant: 'success',
      })
    } catch (err) {
      toast({ title: 'Comparison failed', description: errorMessage(err, 'The documents could not be compared.'), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const exportReport = async () => {
    if (!result || !left || !right) return
    try {
      const blob = await comparisonReportPdf(result, { left: left.name, right: right.name })
      const name = `comparison-${baseName(left.name)}-vs-${baseName(right.name)}.pdf`
      setResults([{ name, blob, size: blob.size }])
      record(tool, { inputName: `${left.name} ↔ ${right.name}`, outputName: name, outputSize: blob.size })
    } catch (err) {
      toast({ title: 'Report failed', description: errorMessage(err, 'The report could not be generated.'), variant: 'error' })
    }
  }

  return (
    <ToolShell tool={tool}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Original version</Label>
            {left ? (
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-sm">
                <span className="truncate">{left.name}</span>
                <Button variant="ghost" size="sm" onClick={() => setLeft(null)}>Change</Button>
              </div>
            ) : (
              <UploadDropzone accept={tool.accept} multiple={false} onFiles={(files) => files[0] && setLeft(files[0])} compact />
            )}
          </div>
          <div className="space-y-2">
            <Label>Revised version</Label>
            {right ? (
              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-sm">
                <span className="truncate">{right.name}</span>
                <Button variant="ghost" size="sm" onClick={() => setRight(null)}>Change</Button>
              </div>
            ) : (
              <UploadDropzone accept={tool.accept} multiple={false} onFiles={(files) => files[0] && setRight(files[0])} compact />
            )}
          </div>
        </div>

        <Button onClick={run} disabled={!left || !right || busy} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Compare documents
        </Button>

        {result && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Similarity', `${(result.summary.similarity * 100).toFixed(1)}%`],
                ['Lines added', `+${result.summary.linesAdded}`],
                ['Lines removed', `-${result.summary.linesRemoved}`],
                ['Words changed', `${result.summary.wordsAdded + result.summary.wordsRemoved}`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border/60 bg-card/60 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
                  <p className="text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>

            <ToolPanel title="Diff" description="Green is added, red is removed.">
              <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
                {result.pages.map((page) => (
                  <div key={page.page} className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">Page {page.page}</p>
                    {page.lines.map((line, index) => (
                      <p key={index} className="whitespace-pre-wrap break-words rounded px-2 py-1 text-xs leading-relaxed">
                        {line.tokens.map((token, tokenIndex) => (
                          <span
                            key={tokenIndex}
                            className={cn(
                              token.kind === 'added' && 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
                              token.kind === 'removed' && 'bg-rose-500/20 text-rose-600 line-through dark:text-rose-400',
                            )}
                          >
                            {token.text}
                          </span>
                        ))}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
              <Button variant="outline" onClick={exportReport} className="gap-1.5">
                Download comparison report
              </Button>
            </ToolPanel>
          </div>
        )}

        <ResultPanel results={results} title="Comparison report" onReset={() => setResults([])} />
      </div>
    </ToolShell>
  )
}
