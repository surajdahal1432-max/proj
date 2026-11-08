import * as React from 'react'
import { Archive, CheckCircle2, Download, ExternalLink, RotateCcw } from 'lucide-react'
import { formatBytes } from '@/lib/utils'
import { downloadBlob } from '@/lib/utils'
import { zipBlobs } from '@/lib/zip'
import { Button } from '@/components/ui/button'
import { Badge, StatTile } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/overlays'
import { cn } from '@/lib/utils'

export interface ResultFile {
  name: string
  blob: Blob
  size: number
}

export interface ResultPanelProps {
  results: ResultFile[]
  title?: string
  originalSize?: number
  zipName?: string
  onReset?: () => void
  className?: string
  note?: React.ReactNode
  previewUrls?: Record<string, string>
}

export function ResultPanel({
  results,
  title = 'Your files are ready',
  originalSize,
  zipName = 'folio-results.zip',
  onReset,
  className,
  note,
  previewUrls,
}: ResultPanelProps) {
  const { toast } = useToast()
  const [zipping, setZipping] = React.useState(false)

  const totalSize = results.reduce((sum, file) => sum + file.size, 0)
  const reduction =
    originalSize && originalSize > 0 ? Math.round(((originalSize - totalSize) / originalSize) * 100) : null

  const downloadZip = async () => {
    setZipping(true)
    try {
      const blob = await zipBlobs(results.map((file) => ({ name: file.name, blob: file.blob })))
      downloadBlob(blob, zipName)
      toast({ title: 'ZIP bundle downloaded', description: `${results.length} files · ${formatBytes(blob.size)}`, variant: 'success' })
    } catch (error) {
      toast({
        title: 'Could not build ZIP',
        description: error instanceof Error ? error.message : 'Unexpected error',
        variant: 'error',
      })
    } finally {
      setZipping(false)
    }
  }

  if (!results.length) return null

  return (
    <div className={cn('rounded-xl border border-emerald-500/30 bg-emerald-500/[0.04] p-4', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">
              {results.length} file{results.length === 1 ? '' : 's'} · {formatBytes(totalSize)} · never left this device
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {results.length > 1 ? (
            <Button size="sm" variant="outline" onClick={downloadZip} loading={zipping}>
              <Archive className="h-4 w-4" /> ZIP ({results.length})
            </Button>
          ) : null}
          {onReset ? (
            <Button size="sm" variant="ghost" onClick={onReset}>
              <RotateCcw className="h-4 w-4" /> Start over
            </Button>
          ) : null}
        </div>
      </div>

      {originalSize || reduction !== null ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <StatTile label="Original" value={originalSize ? formatBytes(originalSize) : '—'} />
          <StatTile label="Result" value={formatBytes(totalSize)} tone="primary" />
          <StatTile
            label="Difference"
            value={reduction === null ? '—' : reduction >= 0 ? `-${reduction}%` : `+${Math.abs(reduction)}%`}
            tone={reduction !== null && reduction > 0 ? 'success' : 'default'}
            hint={reduction !== null && reduction > 0 ? 'smaller' : undefined}
          />
        </div>
      ) : null}

      <ul className="mt-3 space-y-2">
        {results.map((file) => (
          <li
            key={file.name}
            className="flex items-center gap-3 rounded-lg border border-border bg-card/70 p-2.5"
          >
            {previewUrls?.[file.name] ? (
              <img
                src={previewUrls[file.name]}
                alt=""
                className="h-10 w-10 rounded border border-border object-cover"
                loading="lazy"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={file.name}>
                {file.name}
              </p>
              <p className="text-[11px] text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            <Badge variant="success">Ready</Badge>
            <Button size="sm" variant="subtle" onClick={() => downloadBlob(file.blob, file.name)}>
              <Download className="h-4 w-4" /> Download
            </Button>
          </li>
        ))}
      </ul>

      {note ? <div className="mt-3 text-xs leading-relaxed text-muted-foreground">{note}</div> : null}
    </div>
  )
}

export function OpenPreviewButton({ blob }: { blob: Blob }) {
  const url = React.useMemo(() => URL.createObjectURL(blob), [blob])
  React.useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <Button size="sm" variant="ghost" asChild={false} onClick={() => window.open(url, '_blank', 'noopener')}>
      <ExternalLink className="h-4 w-4" /> Preview
    </Button>
  )
}
