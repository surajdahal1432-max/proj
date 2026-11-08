import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/15 text-primary',
        secondary: 'border-border bg-secondary text-secondary-foreground',
        outline: 'border-border text-muted-foreground',
        success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
        warning: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
        destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin text-primary', className)} aria-hidden="true" />
}

const ALERT_STYLES = {
  info: { icon: Info, className: 'border-primary/30 bg-primary/5 text-foreground', iconClass: 'text-primary' },
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-500/30 bg-emerald-500/5 text-foreground',
    iconClass: 'text-emerald-500',
  },
  warning: {
    icon: TriangleAlert,
    className: 'border-amber-500/30 bg-amber-500/5 text-foreground',
    iconClass: 'text-amber-500',
  },
  error: {
    icon: AlertCircle,
    className: 'border-destructive/40 bg-destructive/5 text-foreground',
    iconClass: 'text-destructive',
  },
} as const

export function Alert({
  variant = 'info',
  title,
  children,
  action,
  className,
}: {
  variant?: keyof typeof ALERT_STYLES
  title: string
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  const style = ALERT_STYLES[variant]
  const Icon = style.icon
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-lg border p-3.5 text-sm', style.className, className)}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', style.iconClass)} />
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-snug">{title}</p>
        {children ? <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</div> : null}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-primary/10 p-3">
        <Icon className="h-6 w-6 text-primary" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: React.ReactNode
  hint?: string
  tone?: 'default' | 'success' | 'primary'
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-lg font-semibold tabular-nums',
          tone === 'success' && 'text-emerald-500',
          tone === 'primary' && 'text-primary',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-tight">{children}</h2>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}
