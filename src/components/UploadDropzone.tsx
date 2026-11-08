import * as React from 'react'
import { FolderUp, UploadCloud } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface UploadDropzoneProps {
  accept?: string[]
  multiple?: boolean
  onFiles: (files: File[]) => void
  title?: string
  subtitle?: string
  compact?: boolean
  disabled?: boolean
  className?: string
}

export function UploadDropzone({
  accept,
  multiple = false,
  onFiles,
  title,
  subtitle,
  compact,
  disabled,
  className,
}: UploadDropzoneProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)
  const dragDepth = React.useRef(0)

  const acceptAttr = React.useMemo(
    () => (accept && accept.length ? accept.map((ext) => `.${ext}`).join(',') : undefined),
    [accept],
  )

  const handleFiles = (list: FileList | null) => {
    if (!list || disabled) return
    const files = Array.from(list)
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }

  React.useEffect(() => {
    if (disabled) return
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.files
      if (items && items.length) {
        event.preventDefault()
        handleFiles(items)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, multiple])

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title ?? 'Upload files'}
      aria-disabled={disabled}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault()
        dragDepth.current += 1
        if (!disabled) setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        handleFiles(event.dataTransfer.files)
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-border bg-card/40 text-center transition-all duration-200 hover:border-primary/50 hover:bg-primary/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        compact ? 'gap-2 px-4 py-7' : 'gap-3 px-6 py-14 sm:py-16',
        dragging && 'scale-[1.005] border-primary bg-primary/[0.07] shadow-lg shadow-primary/10',
        disabled && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--primary)/0.10),transparent_65%)] opacity-0 transition-opacity group-hover:opacity-100"
      />
      <div
        className={cn(
          'relative flex items-center justify-center rounded-full bg-primary/10 text-primary transition-transform',
          compact ? 'h-10 w-10' : 'h-14 w-14',
          dragging && 'scale-110',
        )}
      >
        {dragging ? (
          <FolderUp className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
        ) : (
          <UploadCloud className={compact ? 'h-5 w-5' : 'h-6 w-6'} />
        )}
      </div>
      <div className="relative space-y-1">
        <p className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}>
          {title ?? (multiple ? 'Drop files here or click to browse' : 'Drop your file here or click to browse')}
        </p>
        <p className="text-xs text-muted-foreground">
          {subtitle ??
            (accept && accept.length
              ? `${accept.map((ext) => ext.toUpperCase()).join(' · ')}${multiple ? ' — batch supported' : ''}`
              : 'PDF · DOCX · XLSX · PPTX · PNG · JPG · MD')}
        </p>
      </div>
      {!compact ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="relative mt-1"
          onClick={(event) => {
            event.stopPropagation()
            inputRef.current?.click()
          }}
        >
          Select {multiple ? 'files' : 'file'}
        </Button>
      ) : null}
      <p className="relative text-[11px] text-muted-foreground/80">Processed on this device — nothing uploaded</p>
      <input
        ref={inputRef}
        type="file"
        accept={acceptAttr}
        multiple={multiple}
        className="sr-only"
        onChange={(event) => {
          handleFiles(event.target.files)
          event.target.value = ''
        }}
      />
    </div>
  )
}
