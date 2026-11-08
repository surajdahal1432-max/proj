import * as React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronRight, ShieldCheck, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolDefinition } from '@/lib/tools'
import { CATEGORIES } from '@/lib/tools'
import { Badge } from '@/components/ui/feedback'
import { useAppStore } from '@/store/useAppStore'

export interface ToolShellProps {
  tool: ToolDefinition
  children: React.ReactNode
  aside?: React.ReactNode
  wide?: boolean
}

export function ToolShell({ tool, children, aside, wide }: ToolShellProps) {
  const localMode = useAppStore((state) => state.localMode)
  const Icon = tool.icon
  const category = CATEGORIES.find((entry) => entry.id === tool.category)

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6">
      <nav className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="Breadcrumb">
        <Link to="/tools" className="transition-colors hover:text-foreground">
          All tools
        </Link>
        <ChevronRight className="h-3 w-3 opacity-50" />
        <span className="capitalize">{tool.category}</span>
        <ChevronRight className="h-3 w-3 opacity-50" />
        <span className="text-foreground">{tool.name}</span>
      </nav>

      <header className="mt-4 flex flex-wrap items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-cyan-400/10 text-primary ring-1 ring-primary/20">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-[26px]">{tool.name}</h1>
            <Badge variant="secondary">{category?.label ?? tool.category}</Badge>
            {localMode ? (
              <Badge variant="success">
                <ShieldCheck className="h-3 w-3" /> Local
              </Badge>
            ) : (
              <Badge variant="outline">
                <Sparkles className="h-3 w-3" /> Cloud-ready
              </Badge>
            )}
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{tool.description}</p>
        </div>
        <Link
          to="/tools"
          className="hidden items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Link>
      </header>

      <div
        className={cn(
          'mt-7 grid items-start gap-6',
          aside ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1',
          wide && 'lg:grid-cols-1',
        )}
      >
        <div className="min-w-0 space-y-5">{children}</div>
        {aside && !wide ? <aside className="space-y-4 lg:sticky lg:top-24">{aside}</aside> : null}
      </div>
    </div>
  )
}

export function ToolPanel({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  footer?: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-card/60 p-4', className)}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-3">{children}</div>
      {footer ? <div className="mt-4 border-t border-border pt-3">{footer}</div> : null}
    </section>
  )
}

export function ProcessBar({
  onRun,
  disabled,
  busy,
  label,
  hint,
  secondary,
}: {
  onRun: () => void
  disabled?: boolean
  busy?: boolean
  label: string
  hint?: string
  secondary?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/60 p-3">
      <button
        type="button"
        onClick={onRun}
        disabled={disabled || busy}
        className={cn(
          'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        {busy ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
            Processing…
          </>
        ) : (
          label
        )}
      </button>
      {secondary}
      {hint ? <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function EmptyQueueHint({ children }: { children?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
      {children ?? 'Add a file above to unlock the settings for this tool.'}
    </div>
  )
}
