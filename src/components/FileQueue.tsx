import * as React from 'react'
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Copy,
  Download,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  GripVertical,
  Loader2,
  Lock,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { cn, formatBytes } from '@/lib/utils'
import { Badge, Spinner } from '@/components/ui/feedback'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/controls'
import { Tooltip } from '@/components/ui/overlays'
import type { QueueFile } from '@/hooks/useFileQueue'
import { downloadBlob } from '@/lib/utils'

const EXT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  docx: FileText,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  pptx: FileType2,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  webp: FileImage,
  md: FileType2,
  txt: FileType2,
  html: FileType2,
  htm: FileType2,
}

export interface FileQueueProps {
  files: QueueFile[]
  onRemove?: (id: string) => void
  onMove?: (from: number, to: number) => void
  onDuplicate?: (id: string) => void
  onDownload?: (file: QueueFile) => void
  reorderable?: boolean
  showResults?: boolean
  className?: string
  emptyHint?: string
}

export function FileQueue({
  files,
  onRemove,
  onMove,
  onDuplicate,
  onDownload,
  reorderable,
  showResults = true,
  className,
  emptyHint,
}: FileQueueProps) {
  const [dragIndex, setDragIndex] = React.useState<number | null>(null)
  const [overIndex, setOverIndex] = React.useState<number | null>(null)

  if (!files.length) {
    return emptyHint ? <p className={cn('text-xs text-muted-foreground', className)}>{emptyHint}</p> : null
  }

  return (
    <ul className={cn('space-y-2', className)}>
      {files.map((entry, index) => {
        const Icon = EXT_ICONS[entry.ext] ?? FileText
        const isDragging = dragIndex === index
        return (
          <li
            key={entry.id}
            draggable={reorderable}
            onDragStart={() => reorderable && setDragIndex(index)}
            onDragEnd={() => {
              setDragIndex(null)
              setOverIndex(null)
            }}
            onDragOver={(event) => {
              if (!reorderable) return
              event.preventDefault()
              setOverIndex(index)
            }}
            onDrop={(event) => {
              if (!reorderable) return
              event.preventDefault()
              if (dragIndex !== null && dragIndex !== index) onMove?.(dragIndex, index)
              setDragIndex(null)
              setOverIndex(null)
            }}
            className={cn(
              'group relative flex items-center gap-3 rounded-lg border border-border bg-card/60 p-2.5 transition-all',
              reorderable && 'cursor-grab active:cursor-grabbing',
              isDragging && 'opacity-40',
              overIndex === index && dragIndex !== index && 'border-primary/60 ring-1 ring-primary/30',
            )}
          >
            {reorderable ? (
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
            ) : null}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium" title={entry.name}>
                  {entry.name}
                </p>
                {entry.needsPassword ? (
                  <Badge variant="warning" className="shrink-0 gap-1">
                    <Lock className="h-3 w-3" /> Locked
                  </Badge>
                ) : null}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span className="tabular-nums">{formatBytes(entry.size)}</span>
                {entry.pageCount ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {entry.pageCount} page{entry.pageCount === 1 ? '' : 's'}
                    </span>
                  </>
                ) : null}
                <span aria-hidden="true">·</span>
                <span className="uppercase">{entry.ext || 'file'}</span>
                {entry.result && showResults ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-emerald-500">→ {formatBytes(entry.result.size)}</span>
                  </>
                ) : null}
              </div>
              {entry.status === 'processing' ? (
                <div className="mt-2 flex items-center gap-2">
                  <Progress value={entry.progress} className="h-1.5" />
                  <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(entry.progress)}%
                  </span>
                </div>
              ) : null}
              {entry.error ? (
                <p className="mt-1 flex items-start gap-1 text-[11px] text-destructive">
                  <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                  {entry.error}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              {entry.status === 'done' ? (
                <CheckCircle2 className="mr-1 h-4 w-4 text-emerald-500" aria-label="Completed" />
              ) : null}
              {entry.status === 'processing' ? <Loader2 className="mr-1 h-4 w-4 animate-spin text-primary" /> : null}
              {entry.result && onDownload ? (
                <Tooltip label="Download result">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDownload(entry)}
                    aria-label={`Download ${entry.result.name}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              ) : null}
              {entry.result ? (
                <Tooltip label="Download">
                  <span className="sr-only">Result ready</span>
                </Tooltip>
              ) : null}
              {onDuplicate ? (
                <Tooltip label="Duplicate">
                  <Button variant="ghost" size="icon-sm" onClick={() => onDuplicate(entry.id)} aria-label="Duplicate file">
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </Tooltip>
              ) : null}
              {reorderable && onMove ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === 0}
                    onClick={() => onMove(index, index - 1)}
                    aria-label="Move up"
                    className="hidden sm:inline-flex"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === files.length - 1}
                    onClick={() => onMove(index, index + 1)}
                    aria-label="Move down"
                    className="hidden sm:inline-flex"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : null}
              {onRemove ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onRemove(entry.id)}
                  aria-label={`Remove ${entry.name}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function downloadQueueResult(entry: QueueFile) {
  if (entry.result) downloadBlob(entry.result.blob, entry.result.name)
}

export { Spinner, Trash2 }
