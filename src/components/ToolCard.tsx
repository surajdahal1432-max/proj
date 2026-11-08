import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import type { ToolDefinition } from '@/lib/tools'
import { cn } from '@/lib/utils'

export function ToolCard({ tool, className }: { tool: ToolDefinition; className?: string }) {
  const Icon = tool.icon
  return (
    <Link
      to={`/tool/${tool.id}`}
      className={cn(
        'group relative flex flex-col rounded-xl border border-border/70 bg-card/50 p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-lg hover:shadow-primary/5',
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-primary transition-colors group-hover:bg-primary/20">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-colors group-hover:text-primary" />
      </div>
      <p className="text-sm font-semibold leading-tight">{tool.name}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{tool.tagline}</p>
      {tool.featured && (
        <span className="mt-2.5 w-fit rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          Popular
        </span>
      )}
    </Link>
  )
}
