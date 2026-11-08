import * as React from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BadgeCheck,
  Cloud,
  Cpu,
  FileSearch,
  Files,
  Gauge,
  Layers,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  Wand2,
  Zap,
} from 'lucide-react'
import { CATEGORIES, TOOLS, type ToolCategory } from '@/lib/tools'
import { cn, extensionOf, formatBytes } from '@/lib/utils'
import { DROP_ACCEPT, stashFiles, suggestTool } from '@/lib/handoff'
import { useAppStore } from '@/store/useAppStore'
import { UploadDropzone } from '@/components/UploadDropzone'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/feedback'
import { ToolCard } from '@/components/ToolCard'

const FEATURES = [
  {
    icon: Cpu,
    title: 'Runs in your browser',
    body: 'Merge, split, compress, sign and edit with WebAssembly-backed engines. Your files never leave the tab.',
  },
  {
    icon: Layers,
    title: 'Batch pipelines',
    body: 'Queue dozens of documents, watch per-file progress, and export everything as a single ZIP.',
  },
  {
    icon: ShieldCheck,
    title: 'Real redaction',
    body: 'Redaction rewrites the content stream so hidden text is gone — not covered by a black box.',
  },
  {
    icon: Wand2,
    title: 'Offline AI',
    body: 'Point Folio at your own Ollama endpoint for private summaries, Q&A and translation.',
  },
]

export function HomePage() {
  const navigate = useNavigate()
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState<ToolCategory | 'all'>('all')
  const [suggestion, setSuggestion] = React.useState<{ toolId: string; files: File[] } | null>(null)
  const localMode = useAppStore((state) => state.localMode)
  const recentTools = useAppStore((state) => state.recentTools)

  const filtered = React.useMemo(() => {
    const term = query.trim().toLowerCase()
    return TOOLS.filter((tool) => {
      const inCategory = category === 'all' || tool.category === category
      if (!inCategory) return false
      if (!term) return true
      return (
        tool.name.toLowerCase().includes(term) ||
        tool.tagline.toLowerCase().includes(term) ||
        tool.description.toLowerCase().includes(term)
      )
    })
  }, [category, query])

  const handleFiles = (files: File[]) => {
    if (!files.length) return
    const first = files[0]
    const toolId = suggestTool(extensionOf(first.name), files.length)
    setSuggestion({ toolId, files })
  }

  const suggestionTool = suggestion ? TOOLS.find((tool) => tool.id === suggestion.toolId) : null

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-10 sm:px-6">
      {/* ---------------------------------- hero --------------------------------- */}
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card/40 px-5 py-12 sm:px-10 sm:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full bg-primary/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl"
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <Badge variant="outline" className="mb-5 gap-1.5 px-3 py-1 text-[11px]">
            {localMode ? <Lock className="h-3 w-3 text-emerald-500" /> : <Cloud className="h-3 w-3 text-sky-500" />}
            {localMode ? 'Strict local-only mode is on' : 'Cloud workers available'}
          </Badge>
          <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-5xl">
            Every PDF Tool You Need.{' '}
            <span className="bg-gradient-to-r from-primary via-indigo-400 to-sky-400 bg-clip-text text-transparent">
              100% Private, Lightning Fast.
            </span>
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
            Edit, convert, organize, compress, sign, and interrogate your PDF documents locally or in the cloud without
            paywalls.
          </p>

          <div className="mt-8">
            <UploadDropzone accept={DROP_ACCEPT} multiple onFiles={handleFiles} />
          </div>

          {suggestion && suggestionTool && (
            <div className="mx-auto mt-4 flex max-w-xl flex-col gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] p-4 text-left sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  Suggested workflow · {suggestionTool.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {suggestion.files.length} file{suggestion.files.length === 1 ? '' : 's'} ·{' '}
                  {formatBytes(suggestion.files.reduce((total, file) => total + file.size, 0))} detected
                </p>
              </div>
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  stashFiles(suggestion.files)
                  navigate(`/tool/${suggestion.toolId}`)
                }}
              >
                Continue <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          <div className="mt-8 grid grid-cols-2 gap-3 text-left sm:grid-cols-4">
            {[
              { icon: Files, label: `${TOOLS.length} tools`, hint: 'no limits' },
              { icon: Lock, label: '0 uploads', hint: 'local engine' },
              { icon: Gauge, label: 'Instant', hint: 'worker threads' },
              { icon: BadgeCheck, label: 'No paywall', hint: 'no watermarks' },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border/70 bg-background/40 px-3 py-2.5">
                <item.icon className="mb-1 h-4 w-4 text-primary" />
                <p className="text-sm font-semibold">{item.label}</p>
                <p className="text-[11px] text-muted-foreground">{item.hint}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------- discovery ------------------------------- */}
      <section className="mt-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Tool library</h2>
            <p className="text-sm text-muted-foreground">Filter by category or search instantly — {filtered.length} shown.</p>
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

        <div className="mt-4 flex flex-wrap gap-1.5">
          {CATEGORIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setCategory(entry.id)}
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

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>

        {!filtered.length && (
          <div className="mt-6 rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <FileSearch className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm font-medium">No tools match “{query}”</p>
            <p className="mt-1 text-xs text-muted-foreground">Try “merge”, “sign”, “ocr” or “translate”.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setQuery('')
                setCategory('all')
              }}
            >
              Reset filters
            </Button>
          </div>
        )}
      </section>

      {recentTools.length > 0 && (
        <section className="mt-12">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-4 w-4" /> Recently used
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {recentTools
              .map((id) => TOOLS.find((tool) => tool.id === id))
              .filter((tool): tool is (typeof TOOLS)[number] => Boolean(tool))
              .slice(0, 4)
              .map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
          </div>
        </section>
      )}

      {/* -------------------------------- features ------------------------------- */}
      <section className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-xl border border-border/70 bg-card/40 p-4">
            <feature.icon className="mb-2 h-5 w-5 text-primary" />
            <p className="text-sm font-semibold">{feature.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{feature.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-10 overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-primary/10 via-card/40 to-sky-500/5 p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Zap className="h-4 w-4 text-primary" /> Interrogate a document with AI
            </h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Summarise, ask questions with page citations, extract tables and translate — on-device or through your own
              Ollama endpoint.
            </p>
          </div>
          <Button asChild className="gap-1.5">
            <Link to="/ai">
              Open AI workspace <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  )
}
