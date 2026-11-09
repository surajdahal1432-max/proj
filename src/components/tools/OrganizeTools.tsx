import * as React from 'react'
import { ArrowDown, ArrowUp, Copy, FileStack, Layers, Plus, RotateCcw, RotateCw, Scissors, Trash2 } from 'lucide-react'
import type { ToolDefinition } from '@/lib/tools'
import { useFileQueue } from '@/hooks/useFileQueue'
import { usePageThumbnails } from '@/hooks/usePageThumbnails'
import { useRecordHistory } from '@/hooks/useRecordHistory'
import { UploadDropzone } from '@/components/UploadDropzone'
import { FileQueue } from '@/components/FileQueue'
import { ResultPanel, type ResultFile } from '@/components/ResultPanel'
import { ToolShell, ToolPanel, ProcessBar, EmptyQueueHint } from '@/components/ToolShell'
import { Button } from '@/components/ui/button'
import { Input, Label, Progress, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls'
import { Badge, Alert, Spinner } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/overlays'
import { baseName, cn, formatBytes, parsePageRanges } from '@/lib/utils'
import { mergePdfs, reorderPages, rotatePdf, splitPdfGroups } from '@/lib/pdf'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong while processing this file.'
}

function PasswordNotice() {
  return (
    <Alert variant="warning" title="Password protected">
      This PDF is encrypted. Use the <strong>Unlock PDF</strong> tool first, then run this operation on the unlocked
      copy.
    </Alert>
  )
}

/* ------------------------------------------------------------------ *
 * Merge
 * ------------------------------------------------------------------ */

export function MergeTool({ tool }: { tool: ToolDefinition }) {
  const queue = useFileQueue({ accept: ['pdf'], multiple: true })
  const { toast } = useToast()
  const record = useRecordHistory()
  const [busy, setBusy] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [results, setResults] = React.useState<ResultFile[]>([])

  const run = async () => {
    if (queue.files.length < 2) {
      toast({ title: 'Add at least two PDFs', description: 'Merging needs two or more documents.', variant: 'warning' })
      return
    }
    setBusy(true)
    setProgress(0)
    setResults([])
    try {
      const blob = await mergePdfs(
        queue.files.map((entry) => entry.file),
        (done, total) => setProgress(Math.round((done / Math.max(1, total)) * 100)),
      )
      const name = `${baseName(queue.files[0].name)}-merged-${queue.files.length}.pdf`
      setResults([{ name, blob, size: blob.size }])
      record(tool, queue.files.map((entry) => entry.name).join(' + ').slice(0, 180), { name, size: blob.size })
      toast({
        title: 'Documents merged',
        description: `${queue.files.length} files combined into ${formatBytes(blob.size)}.`,
        variant: 'success',
      })
    } catch (error) {
      toast({ title: 'Merge failed', description: errorMessage(error), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell
      tool={tool}
      aside={
        <>
          <ToolPanel title="Merge summary" description="Files are combined top to bottom in the order shown.">
            <dl className="space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Documents</dt>
                <dd className="font-semibold">{queue.files.length}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Pages</dt>
                <dd className="font-semibold">{queue.totalPages || '—'}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Total size</dt>
                <dd className="font-semibold">{formatBytes(queue.totalSize)}</dd>
              </div>
            </dl>
            <ProcessBar
              onRun={run}
              disabled={queue.files.length < 2}
              busy={busy}
              label="Merge PDFs"
              hint={queue.files.length < 2 ? 'Add two or more PDF files to begin.' : 'Everything runs in your browser.'}
            />
            {busy ? <Progress value={progress} /> : null}
          </ToolPanel>
          {queue.files.some((entry) => entry.needsPassword) ? <PasswordNotice /> : null}
        </>
      }
    >
      <UploadDropzone
        accept={['pdf']}
        multiple
        onFiles={queue.add}
        title="Drop PDFs to merge"
        subtitle="Or click to browse — add as many files as you like, then drag to reorder."
      />

      {queue.rejected.length ? (
        <Alert
          variant="error"
          title="Some files were skipped"
          description={queue.rejected.map((item) => `${item.name}: ${item.reason}`).join(' · ')}
        />
      ) : null}

      {queue.files.length ? (
        <ToolPanel title="Merge order" description="Drag the handles, or use the arrows to change the order.">
          <FileQueue
            files={queue.files}
            reorderable
            onMove={queue.move}
            onRemove={queue.remove}
            onDuplicate={(id) => {
              const index = queue.files.findIndex((entry) => entry.id === id)
              if (index >= 0) {
                const clone = new File([queue.files[index].file], queue.files[index].name, {
                  type: queue.files[index].file.type,
                })
                void queue.add([clone])
              }
            }}
          />
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-muted-foreground">
              {queue.loading ? 'Reading page counts…' : 'Order is applied top to bottom.'}
            </span>
            <Button variant="ghost" size="sm" onClick={queue.clear}>
              Clear all
            </Button>
          </div>
        </ToolPanel>
      ) : (
        <EmptyQueueHint>Add your first PDF to start building a merged document.</EmptyQueueHint>
      )}

      {results.length ? (
        <ResultPanel
          results={results}
          title="Merged document ready"
          zipName="folio-merged.zip"
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
 * Split
 * ------------------------------------------------------------------ */

export function SplitTool({ tool }: { tool: ToolDefinition }) {
  const queue = useFileQueue({ accept: ['pdf'], multiple: false })
  const { toast } = useToast()
  const record = useRecordHistory()
  const [mode, setMode] = React.useState<'ranges' | 'interval' | 'each'>('ranges')
  const [rangeInput, setRangeInput] = React.useState('1-3, 5, 8-12')
  const [interval, setIntervalValue] = React.useState(2)
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<ResultFile[]>([])

  const file = queue.single?.file ?? null
  const pageCount = queue.single?.pageCount ?? 0

  const groups = React.useMemo<number[][]>(() => {
    if (!pageCount) return []
    if (mode === 'each') return Array.from({ length: pageCount }, (_, index) => [index])
    if (mode === 'interval') {
      const size = Math.max(1, interval)
      const output: number[][] = []
      for (let start = 0; start < pageCount; start += size) {
        output.push(Array.from({ length: Math.min(size, pageCount - start) }, (_, offset) => start + offset))
      }
      return output
    }
    return rangeInput
      .split(',')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => parsePageRanges(segment, pageCount))
      .filter((group) => group.length > 0)
  }, [mode, interval, rangeInput, pageCount])

  const run = async () => {
    if (!file) {
      toast({ title: 'Add a PDF first', variant: 'warning' })
      return
    }
    if (!groups.length) {
      toast({ title: 'No valid page ranges', description: 'Try a format like 1-3, 5, 8-12.', variant: 'warning' })
      return
    }
    setBusy(true)
    setResults([])
    try {
      const parts = await splitPdfGroups(file, groups, baseName(file.name))
      const output = parts.map((part) => ({
        name: `${baseName(file.name)}-${part.label}.pdf`,
        blob: part.blob,
        size: part.blob.size,
      }))
      setResults(output)
      record(tool, file.name, { name: output[0]?.name ?? 'split.pdf', size: output.reduce((sum, item) => sum + item.size, 0) })
      toast({
        title: `Split into ${output.length} file${output.length === 1 ? '' : 's'}`,
        description: 'Download individually or grab everything as a ZIP.',
        variant: 'success',
      })
    } catch (error) {
      toast({ title: 'Split failed', description: errorMessage(error), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell
      tool={tool}
      aside={
        <ToolPanel title="Split settings" description="Choose how the document should be divided.">
          <div className="space-y-1.5">
            <Label>Split method</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ranges">Custom page ranges</SelectItem>
                <SelectItem value="interval">Fixed interval</SelectItem>
                <SelectItem value="each">Every page separately</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {mode === 'ranges' ? (
            <div className="space-y-1.5">
              <Label htmlFor="ranges">Page ranges</Label>
              <Input
                id="ranges"
                value={rangeInput}
                onChange={(event) => setRangeInput(event.target.value)}
                placeholder="1-3, 5, 8-12"
              />
              <p className="text-[11px] text-muted-foreground">Each comma-separated group becomes its own PDF.</p>
            </div>
          ) : null}

          {mode === 'interval' ? (
            <div className="space-y-1.5">
              <Label htmlFor="interval">Pages per file</Label>
              <Input
                id="interval"
                type="number"
                min={1}
                max={Math.max(1, pageCount)}
                value={interval}
                onChange={(event) => setIntervalValue(Math.max(1, Number(event.target.value) || 1))}
              />
            </div>
          ) : null}

          <div className="rounded-lg bg-muted/50 p-2.5 text-[11px] text-muted-foreground">
            {pageCount ? (
              <>
                <span className="font-semibold text-foreground">{groups.length}</span> output file
                {groups.length === 1 ? '' : 's'} from {pageCount} page{pageCount === 1 ? '' : 's'}.
              </>
            ) : (
              'Add a PDF to preview the split result.'
            )}
          </div>

          <ProcessBar
            onRun={run}
            disabled={!file || !groups.length}
            busy={busy}
            label="Split PDF"
            hint={file ? 'Result files are generated locally.' : undefined}
          />
        </ToolPanel>
      }
    >
      <UploadDropzone
        accept={['pdf']}
        onFiles={queue.add}
        title="Drop a PDF to split"
        subtitle="We read the page count locally, then divide it exactly how you ask."
        compact={Boolean(queue.single)}
      />

      {queue.single?.needsPassword ? <PasswordNotice /> : null}

      {queue.single ? (
        <ToolPanel title="Document" description="Only one document is split at a time.">
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background/50 p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Scissors className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{queue.single.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {formatBytes(queue.single.size)}
                {pageCount ? ` · ${pageCount} pages` : ''}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={queue.clear} aria-label="Remove file">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          {groups.length && pageCount ? (
            <div className="flex flex-wrap gap-1.5">
              {groups.slice(0, 24).map((group, index) => (
                <Badge key={index} variant="secondary">
                  {group.length > 1 ? `${group[0] + 1}–${group[group.length - 1] + 1}` : group[0] + 1}
                </Badge>
              ))}
              {groups.length > 24 ? <Badge variant="outline">+{groups.length - 24} more</Badge> : null}
            </div>
          ) : null}
        </ToolPanel>
      ) : null}

      {results.length ? (
        <ResultPanel
          results={results}
          title={`${results.length} split file${results.length === 1 ? '' : 's'} ready`}
          originalSize={queue.single?.size}
          zipName={`${baseName(queue.single?.name ?? 'folio')}-split.zip`}
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
 * Rearrange (visual grid with rotate / delete / duplicate)
 * ------------------------------------------------------------------ */

interface PageItem {
  key: string
  source: number
}

export function RearrangeTool({ tool }: { tool: ToolDefinition }) {
  const queue = useFileQueue({ accept: ['pdf'], multiple: false })
  const { toast } = useToast()
  const record = useRecordHistory()
  const file = queue.single?.file ?? null
  const { thumbs, pageCount, loading } = usePageThumbnails(file, 180)
  const [items, setItems] = React.useState<PageItem[]>([])
  const [rotations, setRotations] = React.useState<Record<number, number>>({})
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<ResultFile[]>([])
  const dragIndex = React.useRef<number | null>(null)
  const [overIndex, setOverIndex] = React.useState<number | null>(null)

  React.useEffect(() => {
    setItems(Array.from({ length: pageCount }, (_, index) => ({ key: `p${index}`, source: index })))
    setRotations({})
    setResults([])
  }, [pageCount, file])

  const move = (from: number, to: number) => {
    setItems((current) => {
      if (to < 0 || to >= current.length || from === to) return current
      const next = [...current]
      const [entry] = next.splice(from, 1)
      next.splice(to, 0, entry)
      return next
    })
  }

  const rotatePage = (source: number, delta: number) => {
    setRotations((current) => ({ ...current, [source]: (((current[source] ?? 0) + delta) % 360 + 360) % 360 }))
  }

  const run = async () => {
    if (!file || !items.length) {
      toast({ title: 'Nothing to save', description: 'Keep at least one page.', variant: 'warning' })
      return
    }
    setBusy(true)
    setResults([])
    try {
      const order = items.map((item) => item.source)
      let blob = await reorderPages(file, order)
      const perPage: Record<number, number> = {}
      items.forEach((item, position) => {
        const angle = rotations[item.source] ?? 0
        if (angle) perPage[position] = angle
      })
      if (Object.keys(perPage).length) {
        const intermediate = new File([blob], 'reordered.pdf', { type: 'application/pdf' })
        blob = await rotatePdf(intermediate, { perPage })
      }
      const name = `${baseName(file.name)}-organized.pdf`
      setResults([{ name, blob, size: blob.size }])
      record(tool, file.name, { name, size: blob.size })
      toast({
        title: 'Layout saved',
        description: `${items.length} page${items.length === 1 ? '' : 's'} in the new order.`,
        variant: 'success',
      })
    } catch (error) {
      toast({ title: 'Could not save layout', description: errorMessage(error), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell
      tool={tool}
      wide
      aside={
        <ToolPanel title="Export" description="Page order, rotations, duplicates and deletions are all applied.">
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Pages in output</span>
              <span className="font-semibold">{items.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Rotated pages</span>
              <span className="font-semibold">{Object.values(rotations).filter(Boolean).length}</span>
            </div>
          </div>
          <ProcessBar onRun={run} disabled={!items.length} busy={busy} label="Save new PDF" />
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setItems(Array.from({ length: pageCount }, (_, index) => ({ key: `p${index}`, source: index })))
              setRotations({})
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset layout
          </Button>
        </ToolPanel>
      }
    >
      <UploadDropzone
        accept={['pdf']}
        onFiles={queue.add}
        title="Drop a PDF to reorganize"
        subtitle="Drag pages to reorder, rotate them individually, duplicate or remove."
        compact={Boolean(file)}
      />

      {queue.single?.needsPassword ? <PasswordNotice /> : null}

      {!file ? <EmptyQueueHint>Add a PDF and every page appears here as a thumbnail.</EmptyQueueHint> : null}

      {file && loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> Rendering pages… {thumbs.length}/{pageCount || '?'}
        </div>
      ) : null}

      {items.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {items.map((item, index) => {
            const rotation = rotations[item.source] ?? 0
            return (
              <div
                key={item.key}
                draggable
                onDragStart={() => {
                  dragIndex.current = index
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setOverIndex(index)
                }}
                onDragEnd={() => {
                  if (dragIndex.current !== null) move(dragIndex.current, index)
                  dragIndex.current = null
                  setOverIndex(null)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                }}
                className={cn(
                  'group relative overflow-hidden rounded-lg border bg-card transition-all',
                  overIndex === index ? 'border-primary ring-2 ring-primary/40' : 'border-border',
                )}
              >
                <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-muted/40 p-1.5">
                  {thumbs[item.source] ? (
                    <img
                      src={thumbs[item.source]}
                      alt={`Page ${item.source + 1}`}
                      className="max-h-full max-w-full rounded-sm shadow-sm transition-transform"
                      style={{ transform: `rotate(${rotation}deg)` }}
                      draggable={false}
                    />
                  ) : (
                    <div className="h-full w-full animate-pulse rounded bg-muted" />
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-border px-1.5 py-1">
                  <span className="text-[11px] font-semibold">#{index + 1}</span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => rotatePage(item.source, 90)}
                      aria-label="Rotate page 90 degrees"
                      title="Rotate 90°"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => {
                        const clone: PageItem = { key: `d${Date.now()}-${index}`, source: item.source }
                        setItems((current) => {
                          const next = [...current]
                          next.splice(index + 1, 0, clone)
                          return next
                        })
                      }}
                      aria-label="Duplicate page"
                      title="Duplicate"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}
                      aria-label="Delete page"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                {rotation ? (
                  <span className="absolute left-1.5 top-1.5 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                    {rotation}°
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {results.length ? (
        <ResultPanel
          results={results}
          title="Reorganized PDF ready"
          originalSize={queue.single?.size}
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
 * Extract pages
 * ------------------------------------------------------------------ */

// Selection, ordering and per-page downloads live in their own module.
export { ExtractTool } from './ExtractTool'

export function RotateTool({ tool }: { tool: ToolDefinition }) {
  const queue = useFileQueue({ accept: ['pdf'], multiple: false })
  const { toast } = useToast()
  const record = useRecordHistory()
  const file = queue.single?.file ?? null
  const { thumbs, pageCount } = usePageThumbnails(file, 180)
  const [rotations, setRotations] = React.useState<Record<number, number>>({})
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<ResultFile[]>([])

  React.useEffect(() => {
    setRotations({})
    setResults([])
  }, [file])

  const applyAll = (delta: number) => {
    setRotations((current) => {
      const next: Record<number, number> = {}
      for (let index = 0; index < pageCount; index += 1) {
        next[index] = ((((current[index] ?? 0) + delta) % 360) + 360) % 360
      }
      return next
    })
  }

  const run = async () => {
    if (!file) {
      toast({ title: 'Add a PDF first', variant: 'warning' })
      return
    }
    setBusy(true)
    setResults([])
    try {
      const perPage = Object.fromEntries(Object.entries(rotations).filter(([, angle]) => angle !== 0)) as Record<
        number,
        number
      >
      const blob = await rotatePdf(file, Object.keys(perPage).length ? { perPage } : { global: 0 })
      const name = `${baseName(file.name)}-rotated.pdf`
      setResults([{ name, blob, size: blob.size }])
      record(tool, file.name, { name, size: blob.size })
      toast({ title: 'Rotation applied', description: 'Your rotated PDF is ready to download.', variant: 'success' })
    } catch (error) {
      toast({ title: 'Rotation failed', description: errorMessage(error), variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <ToolShell
      tool={tool}
      wide
      aside={
        <ToolPanel title="Rotate" description="Apply a global rotation or adjust pages one by one.">
          <div className="grid grid-cols-3 gap-1.5">
            {[90, 180, 270].map((angle) => (
              <Button key={angle} variant="outline" size="sm" onClick={() => applyAll(angle)}>
                <RotateCw className="h-3.5 w-3.5" /> {angle}°
              </Button>
            ))}
          </div>
          <ProcessBar onRun={run} disabled={!file} busy={busy} label="Save rotated PDF" />
        </ToolPanel>
      }
    >
      <UploadDropzone
        accept={['pdf']}
        onFiles={queue.add}
        title="Drop a PDF to rotate"
        subtitle="Rotate every page at once, or fine-tune individual pages."
        compact={Boolean(file)}
      />

      {file && pageCount ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {Array.from({ length: pageCount }, (_, index) => {
            const angle = rotations[index] ?? 0
            return (
              <div key={index} className="overflow-hidden rounded-lg border border-border bg-card">
                <div className="flex aspect-[3/4] items-center justify-center overflow-hidden bg-muted/40 p-1.5">
                  {thumbs[index] ? (
                    <img
                      src={thumbs[index]}
                      alt={`Page ${index + 1}`}
                      className="max-h-full max-w-full rounded-sm transition-transform"
                      style={{ transform: `rotate(${angle}deg)` }}
                    />
                  ) : (
                    <div className="h-full w-full animate-pulse rounded bg-muted" />
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-border px-1.5 py-1">
                  <span className="text-[11px] font-semibold">{index + 1}</span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => setRotations((c) => ({ ...c, [index]: (((c[index] ?? 0) + 270) % 360) }))}
                      aria-label="Rotate left"
                    >
                      <ArrowDown className="h-3 w-3 -rotate-90" />
                    </button>
                    <span className="w-8 text-center text-[10px] text-muted-foreground">{angle}°</span>
                    <button
                      type="button"
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={() => setRotations((c) => ({ ...c, [index]: (((c[index] ?? 0) + 90) % 360) }))}
                      aria-label="Rotate right"
                    >
                      <ArrowUp className="h-3 w-3 rotate-90" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <EmptyQueueHint>Add a PDF to rotate its pages.</EmptyQueueHint>
      )}

      {results.length ? (
        <ResultPanel
          results={results}
          title="Rotated PDF ready"
          originalSize={queue.single?.size}
          onReset={() => {
            setResults([])
            queue.clear()
          }}
        />
      ) : null}
    </ToolShell>
  )
}

export const ORGANIZE_ICONS = { FileStack, Layers, Plus }
