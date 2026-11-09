import * as React from 'react'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileDown,
  ListOrdered,
  Shuffle,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { ToolDefinition } from '@/lib/tools'
import { useFileQueue } from '@/hooks/useFileQueue'
import { usePageThumbnails } from '@/hooks/usePageThumbnails'
import { useRecordHistory } from '@/hooks/useRecordHistory'
import { UploadDropzone } from '@/components/UploadDropzone'
import { ResultPanel, type ResultFile } from '@/components/ResultPanel'
import { ToolShell, ToolPanel, ProcessBar, EmptyQueueHint } from '@/components/ToolShell'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/controls'
import { Badge } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/overlays'
import { baseName, cn, downloadBlob, parsePageRanges } from '@/lib/utils'
import { extractPagesToPdf } from '@/lib/serverTools'
import { closePdf, loadPdfFromFile, renderThumbnail } from '@/lib/pdfjs'

const ZOOM_STEPS = [480, 720, 1080]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong while extracting pages.'
}

function sequenceLabel(pages: number[], limit = 8): string {
  const shown = pages.slice(0, limit).map((index) => index + 1).join('-')
  return pages.length > limit ? `${shown}-and-${pages.length - limit}-more` : shown
}

/**
 * Extract Pages.
 *
 * Selection is kept as an explicit *sequence*, not a set, so the exported document always follows
 * the order the user sees. Every selected page can be downloaded on its own without re-running the
 * extraction, and the whole selection can be exported as one PDF, as separate PDFs, or as a ZIP.
 */
export function ExtractTool({ tool }: { tool: ToolDefinition }) {
  const queue = useFileQueue({ accept: ['pdf'], multiple: false })
  const { toast } = useToast()
  const record = useRecordHistory()
  const file = queue.single?.file ?? null
  const { thumbs, pageCount, loading, error } = usePageThumbnails(file, 180)

  const [order, setOrder] = React.useState<number[]>([])
  const [rangeInput, setRangeInput] = React.useState('')
  const [rangeError, setRangeError] = React.useState<string | null>(null)
  const [nth, setNth] = React.useState(2)
  const [busy, setBusy] = React.useState(false)
  const [pendingPage, setPendingPage] = React.useState<number | null>(null)
  const [results, setResults] = React.useState<ResultFile[]>([])
  const [focused, setFocused] = React.useState(0)
  const [zoom, setZoom] = React.useState(1)
  const [previewUrl, setPreviewUrl] = React.useState('')
  const [previewError, setPreviewError] = React.useState<string | null>(null)

  const docRef = React.useRef<Awaited<ReturnType<typeof loadPdfFromFile>> | null>(null)
  const docFileRef = React.useRef<File | null>(null)

  React.useEffect(() => {
    setOrder([])
    setRangeInput('')
    setRangeError(null)
    setResults([])
    setFocused(0)
    setPreviewUrl('')
    setPreviewError(null)
  }, [file])

  React.useEffect(() => {
    if (!pageCount) return
    setOrder((current) => current.filter((index) => index < pageCount))
    setFocused((current) => Math.min(current, pageCount - 1))
  }, [pageCount])

  // Preview renders the focused page at the requested zoom width, on demand.
  React.useEffect(() => {
    let cancelled = false
    if (!file || !pageCount) {
      setPreviewUrl('')
      return
    }
    const run = async () => {
      try {
        if (docFileRef.current !== file || !docRef.current) {
          if (docRef.current) await closePdf(docRef.current)
          docRef.current = await loadPdfFromFile(file)
          docFileRef.current = file
        }
        const doc = docRef.current
        if (!doc) return
        const page = await doc.getPage(Math.min(focused + 1, doc.numPages))
        const url = await renderThumbnail(page, ZOOM_STEPS[zoom])
        page.cleanup()
        if (!cancelled) {
          setPreviewUrl(url)
          setPreviewError(null)
        }
      } catch (err) {
        if (!cancelled) setPreviewError(errorMessage(err))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [file, focused, zoom, pageCount])

  React.useEffect(
    () => () => {
      void closePdf(docRef.current)
      docRef.current = null
      docFileRef.current = null
    },
    [],
  )

  const isSelected = (index: number) => order.includes(index)

  const toggle = (index: number) => {
    setOrder((current) =>
      current.includes(index) ? current.filter((value) => value !== index) : [...current, index],
    )
  }

  const setSelection = (indices: number[]) => setOrder([...new Set(indices)])

  const selectAll = () => setSelection(Array.from({ length: pageCount }, (_, index) => index))
  const invert = () => setSelection(Array.from({ length: pageCount }, (_, index) => index).filter((index) => !order.includes(index)))
  const selectOdd = () => setSelection(Array.from({ length: pageCount }, (_, index) => index).filter((index) => index % 2 === 0))
  const selectEven = () => setSelection(Array.from({ length: pageCount }, (_, index) => index).filter((index) => index % 2 === 1))
  const selectEveryNth = () => {
    const step = Math.max(1, nth)
    setSelection(Array.from({ length: pageCount }, (_, index) => index).filter((index) => index % step === 0))
  }

  const addRange = () => {
    if (!pageCount) {
      setRangeError('Add a PDF first.')
      return
    }
    const parsed = parsePageRanges(rangeInput, pageCount)
    if (!parsed.length) {
      setRangeError('Use pages like 1-3, 5, 8-12.')
      return
    }
    setRangeError(null)
    setOrder((current) => [...new Set([...current, ...parsed])])
    setRangeInput('')
  }

  const move = (index: number, direction: -1 | 1) => {
    setOrder((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(target, 0, item)
      return next
    })
  }

  const downloadSingle = async (index: number) => {
    if (!file) return
    setPendingPage(index)
    try {
      const blob = await extractPagesToPdf(file, [index])
      const name = `${baseName(file.name)}-page-${index + 1}.pdf`
      downloadBlob(blob, name)
      record(tool, file.name, { name, size: blob.size })
      toast({ title: `Page ${index + 1} downloaded`, description: name, variant: 'success' })
    } catch (err) {
      toast({ title: 'Could not export this page', description: errorMessage(err), variant: 'error' })
    } finally {
      setPendingPage(null)
    }
  }

  const runCombined = async () => {
    if (!file || !order.length) {
      toast({ title: 'Select at least one page', variant: 'warning' })
      return
    }
    setBusy(true)
    setResults([])
    try {
      const blob = await extractPagesToPdf(file, order)
      const name = `${baseName(file.name)}-pages-${sequenceLabel(order)}.pdf`
      setResults([{ name, blob, size: blob.size }])
      record(tool, file.name, { name, size: blob.size })
      toast({
        title: 'Combined PDF ready',
        description: `${order.length} page${order.length === 1 ? '' : 's'} in the order shown.`,
        variant: 'success',
      })
    } catch (err) {
      toast({ title: 'Extraction failed', description: errorMessage(err), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const runIndividual = async () => {
    if (!file || !order.length) {
      toast({ title: 'Select at least one page', variant: 'warning' })
      return
    }
    setBusy(true)
    setResults([])
    try {
      const output: ResultFile[] = []
      for (const index of order) {
        const blob = await extractPagesToPdf(file, [index])
        output.push({ name: `${baseName(file.name)}-page-${index + 1}.pdf`, blob, size: blob.size })
      }
      setResults(output)
      record(tool, file.name, {
        name: output[0]?.name ?? 'page.pdf',
        size: output.reduce((sum, item) => sum + item.size, 0),
      })
      toast({
        title: `${output.length} single-page PDF${output.length === 1 ? '' : 's'} ready`,
        description: 'Download any page individually, or take the whole set as a ZIP.',
        variant: 'success',
      })
    } catch (err) {
      toast({ title: 'Extraction failed', description: errorMessage(err), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const goTo = (index: number) => {
    if (!pageCount) return
    const next = Math.min(Math.max(index, 0), pageCount - 1)
    setFocused(next)
  }

  return (
    <ToolShell
      tool={tool}
      wide
      aside={
        <ToolPanel title="Selection" description="Pages are exported in the order listed below.">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Selected</span>
            <span className="font-semibold">
              {order.length}
              {pageCount ? ` / ${pageCount}` : ''}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="extract-range">Page ranges</Label>
            <div className="flex gap-2">
              <Input
                id="extract-range"
                value={rangeInput}
                onChange={(event) => setRangeInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addRange()
                }}
                placeholder="1-3, 5, 8-12"
              />
              <Button variant="outline" size="sm" onClick={addRange} disabled={!pageCount}>
                Add
              </Button>
            </div>
            {rangeError ? <p className="text-xs text-destructive">{rangeError}</p> : null}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" disabled={!pageCount} onClick={selectAll}>
              All
            </Button>
            <Button variant="ghost" size="sm" disabled={!pageCount} onClick={() => setOrder([])}>
              Clear
            </Button>
            <Button variant="outline" size="sm" disabled={!pageCount} onClick={invert}>
              <Shuffle className="h-3.5 w-3.5" /> Invert
            </Button>
            <Button variant="outline" size="sm" disabled={!pageCount} onClick={selectOdd}>
              Odd
            </Button>
            <Button variant="outline" size="sm" disabled={!pageCount} onClick={selectEven}>
              Even
            </Button>
          </div>

          <div className="flex items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="extract-nth">Every Nth</Label>
              <Input
                id="extract-nth"
                type="number"
                min={1}
                max={Math.max(1, pageCount)}
                value={nth}
                onChange={(event) => setNth(Math.max(1, Number(event.target.value) || 1))}
                className="w-20"
              />
            </div>
            <Button variant="outline" size="sm" disabled={!pageCount} onClick={selectEveryNth}>
              <ListOrdered className="h-3.5 w-3.5" /> Apply
            </Button>
          </div>

          {order.length ? (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">Export sequence</p>
              <ol className="max-h-44 space-y-1 overflow-y-auto pr-1">
                {order.map((index, position) => (
                  <li
                    key={`${index}-${position}`}
                    className="flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-xs"
                  >
                    <span className="w-4 shrink-0 text-[10px] text-muted-foreground">{position + 1}.</span>
                    <span className="min-w-0 flex-1 truncate">Page {index + 1}</span>
                    <button
                      type="button"
                      onClick={() => move(position, -1)}
                      disabled={position === 0}
                      aria-label={`Move page ${index + 1} earlier`}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(position, 1)}
                      disabled={position === order.length - 1}
                      aria-label={`Move page ${index + 1} later`}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(index)}
                      aria-label={`Remove page ${index + 1} from selection`}
                      className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <ProcessBar
            onRun={runCombined}
            disabled={!order.length}
            busy={busy}
            label="Extract as one PDF"
            secondary={
              <Button variant="outline" size="sm" disabled={!order.length || busy} onClick={runIndividual}>
                <FileDown className="h-3.5 w-3.5" /> Separate
              </Button>
            }
          />
          <p className="text-xs text-muted-foreground">
            One PDF follows the sequence above. Separate produces one PDF per page with individual downloads and a
            ZIP bundle.
          </p>
        </ToolPanel>
      }
    >
      <UploadDropzone
        accept={['pdf']}
        onFiles={queue.add}
        title="Drop a PDF to extract pages"
        subtitle="Pick pages, arrange their order, then export them together or one by one."
        compact={Boolean(file)}
      />

      {file && error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {file && pageCount ? (
        <>
          <ToolPanel title="Preview" description="Selection is preserved while you preview and zoom.">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="icon" onClick={() => goTo(focused - 1)} disabled={focused === 0} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs font-medium">
                  Page {focused + 1} of {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => goTo(focused + 1)}
                  disabled={focused >= pageCount - 1}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setZoom((current) => Math.max(0, current - 1))}
                  disabled={zoom === 0}
                  aria-label="Zoom out"
                >
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="w-12 text-center text-[11px] text-muted-foreground">{ZOOM_STEPS[zoom]}px</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setZoom((current) => Math.min(ZOOM_STEPS.length - 1, current + 1))}
                  disabled={zoom === ZOOM_STEPS.length - 1}
                  aria-label="Zoom in"
                >
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => void downloadSingle(focused)} disabled={pendingPage === focused}>
                  <Download className="h-3.5 w-3.5" /> Page {focused + 1}
                </Button>
              </div>
            </div>
            <div className="flex min-h-[240px] items-center justify-center overflow-auto rounded-lg border border-border bg-muted/30 p-3">
              {previewError ? (
                <p className="text-sm text-destructive">{previewError}</p>
              ) : previewUrl ? (
                <img src={previewUrl} alt={`Preview of page ${focused + 1}`} className="max-h-[520px] max-w-full rounded-sm shadow-sm" />
              ) : (
                <span className="animate-pulse text-xs text-muted-foreground">Rendering page…</span>
              )}
            </div>
          </ToolPanel>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {loading
                ? `Rendering previews… ${thumbs.length}/${pageCount}`
                : `${pageCount} page${pageCount === 1 ? '' : 's'} · click a thumbnail to add or remove it`}
            </p>
            {order.length ? <Badge variant="secondary">{order.length} selected</Badge> : null}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
            {Array.from({ length: pageCount }, (_, index) => {
              const active = isSelected(index)
              const position = order.indexOf(index)
              const thumb = thumbs[index]
              return (
                <div
                  key={index}
                  className={cn(
                    'group relative overflow-hidden rounded-lg border bg-card transition-all',
                    active ? 'border-primary ring-2 ring-primary/40' : 'border-border hover:border-primary/40',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      toggle(index)
                      setFocused(index)
                    }}
                    aria-pressed={active}
                    aria-label={`Page ${index + 1}${active ? ' (selected)' : ''}`}
                    className="block w-full text-left"
                  >
                    <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-muted/40 p-1.5">
                      {thumb ? (
                        <img src={thumb} alt={`Page ${index + 1}`} className="max-h-full max-w-full rounded-sm" />
                      ) : (
                        <span className={cn('text-xs text-muted-foreground', loading && 'animate-pulse')}>
                          {loading ? '…' : `Page ${index + 1}`}
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center justify-between gap-1 border-t border-border px-2 py-1">
                    <span className="text-[11px] font-semibold">Page {index + 1}</span>
                    <div className="flex items-center gap-1">
                      {active ? <span className="text-[10px] text-primary">#{position + 1}</span> : null}
                      <button
                        type="button"
                        onClick={() => void downloadSingle(index)}
                        disabled={pendingPage === index}
                        aria-label={`Download page ${index + 1} as PDF`}
                        className="rounded p-0.5 text-muted-foreground hover:text-primary disabled:opacity-40"
                      >
                        <Download className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFocused(index)
                          setZoom(ZOOM_STEPS.length - 1)
                        }}
                        aria-label={`Preview page ${index + 1}`}
                        className="rounded p-0.5 text-muted-foreground hover:text-primary"
                      >
                        <Eye className="h-3 w-3" />
                      </button>
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded-full border text-[9px]',
                          active ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-transparent',
                        )}
                      >
                        ✓
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : file ? null : (
        <EmptyQueueHint>Add a PDF to see its pages.</EmptyQueueHint>
      )}

      {results.length ? (
        <ResultPanel
          results={results}
          title={
            results.length > 1
              ? `${results.length} single-page PDFs ready`
              : 'Extracted document ready'
          }
          originalSize={queue.single?.size}
          zipName={`${baseName(queue.single?.name ?? 'folio')}-pages.zip`}
          onReset={() => {
            setResults([])
            setOrder([])
            queue.clear()
          }}
        />
      ) : null}
    </ToolShell>
  )
}
