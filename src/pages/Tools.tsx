import * as React from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import { CATEGORIES, TOOLS, type ToolCategory } from '@/lib/tools'
import { cn } from '@/lib/utils'
import { ToolCard } from '@/components/ToolCard'

export function ToolsPage() {
  const [params, setParams] = useSearchParams()
  const rawCategory = params.get('category') as ToolCategory | null
  const category = rawCategory && CATEGORIES.some((entry) => entry.id === rawCategory) ? rawCategory : 'all'
  const [query, setQuery] = React.useState('')

  const filtered = React.useMemo(() => {
    const term = query.trim().toLowerCase()
    return TOOLS.filter((tool) => {
      if (category !== 'all' && tool.category !== category) return false
      if (!term) return true
      return `${tool.name} ${tool.tagline} ${tool.description}`.toLowerCase().includes(term)
    })
  }, [category, query])

  const grouped = React.useMemo(() => {
    const order: ToolCategory[] = ['organize', 'convert', 'edit', 'security', 'ai']
    return order
      .map((id) => ({
        id,
        label: CATEGORIES.find((entry) => entry.id === id)?.label ?? id,
        tools: filtered.filter((tool) => tool.category === id),
      }))
      .filter((group) => group.tools.length > 0)
  }, [filtered])

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">All tools</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {TOOLS.length} document tools that run in your browser. No sign-up, no watermarks, no page limits.
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tools…"
            aria-label="Search tools"
            className="h-10 w-full rounded-lg border border-input bg-card/60 pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {CATEGORIES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => {
              if (entry.id === 'all') {
                params.delete('category')
              } else {
                params.set('category', entry.id)
              }
              setParams(params, { replace: true })
            }}
            className={cn(
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              category === entry.id
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {grouped.map((group) => (
        <section key={group.id} className="mt-9">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group.label}</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        </section>
      ))}

      {!filtered.length && (
        <div className="mt-10 rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <p className="text-sm font-medium">No tools match your filters</p>
          <p className="mt-1 text-xs text-muted-foreground">Clear the search or pick another category.</p>
        </div>
      )}
    </div>
  )
}
