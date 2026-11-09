import * as React from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import {
  ArrowRight,
  Check,
  Cloud,
  FileText,
  History,
  Menu,
  Moon,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react'
import { cn, formatBytes, formatRelativeTime } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { TOOLS } from '@/lib/tools'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/controls'
import { Tooltip, Sheet } from '@/components/ui/overlays'
import { Badge } from '@/components/ui/feedback'

const NAV = [
  { label: 'All Tools', to: '/tools' },
  { label: 'Organize', to: '/tools?category=organize' },
  { label: 'Convert', to: '/tools?category=convert' },
  { label: 'Edit & Sign', to: '/tools?category=edit' },
  { label: 'Security', to: '/tools?category=security' },
  { label: 'AI Workspace', to: '/ai' },
]

export function FolioMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="folio-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(243 82% 66%)" />
          <stop offset="100%" stopColor="hsl(190 90% 55%)" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="29" height="29" rx="9" fill="url(#folio-mark)" />
      <path d="M11 8.5h7.2L23 13.3v10.2H11z" fill="hsl(224 40% 8%)" opacity="0.85" />
      <path d="M18.2 8.5v4.8H23" fill="none" stroke="hsl(0 0% 100%)" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M14 16h6M14 19h4" stroke="hsl(0 0% 100%)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function Header() {
  const theme = useAppStore((state) => state.theme)
  const toggleTheme = useAppStore((state) => state.toggleTheme)
  const setHistoryOpen = useAppStore((state) => state.setHistoryOpen)
  const history = useAppStore((state) => state.history)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const location = useLocation()

  React.useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname, location.search])

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
  }, [theme])

  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2.5" aria-label="Folio home">
          <FolioMark className="h-8 w-8" />
          <span className="flex flex-col leading-none">
            <span className="text-lg font-bold tracking-tight">Folio</span>
            <span className="hidden text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground sm:block">
              PDF Studio
            </span>
          </span>
        </Link>

        <Tooltip label="Documents are processed by Folio's own processing service">
          <span className="ml-1 hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 md:inline-flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            Server Engine
          </span>
        </Tooltip>

        <nav className="mx-auto hidden items-center gap-0.5 lg:flex" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  isActive && 'bg-accent text-foreground',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
          <Tooltip label="Processing history">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setHistoryOpen(true)}
              aria-label="Open history"
              className="relative"
            >
              <History className="h-4 w-4" />
              {history.length > 0 ? (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
              ) : null}
            </Button>
          </Tooltip>

          <Tooltip label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </Tooltip>

          <Tooltip label="Settings">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/settings" aria-label="Settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
          </Tooltip>

          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {mobileOpen ? (
        <div className="border-t border-border bg-background px-4 pb-4 pt-2 lg:hidden">
          <nav className="grid gap-1" aria-label="Mobile">
            {[...NAV, { label: 'Settings', to: '/settings' }].map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
                    isActive && 'bg-accent text-foreground',
                  )
                }
              >
                {item.label}
                <ArrowRight className="h-3.5 w-3.5 opacity-40" />
              </NavLink>
            ))}
          </nav>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card/60 px-3 py-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-medium">Processed by Folio&apos;s server</span>
          </div>
        </div>
      ) : null}

      <HistoryDrawer />
    </header>
  )
}

export function HistoryDrawer() {
  const open = useAppStore((state) => state.historyOpen)
  const setOpen = useAppStore((state) => state.setHistoryOpen)
  const history = useAppStore((state) => state.history)
  const removeHistory = useAppStore((state) => state.removeHistory)
  const clearHistory = useAppStore((state) => state.clearHistory)

  return (
    <Sheet open={open} onOpenChange={setOpen} title="Processing history" description="Stored only in this browser.">
      {history.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <FileText className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No activity yet</p>
          <p className="max-w-[220px] text-xs text-muted-foreground">
            Every file you process will be listed here with its size and timestamp — never uploaded.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between pb-1">
            <span className="text-xs text-muted-foreground">
              {history.length} entr{history.length === 1 ? 'y' : 'ies'}
            </span>
            <Button variant="ghost" size="sm" onClick={clearHistory}>
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </Button>
          </div>
          {history.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-border bg-card/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{entry.toolName}</p>
                  <p className="truncate text-xs text-muted-foreground" title={entry.outputName}>
                    {entry.outputName}
                  </p>
                </div>
                <Badge variant={entry.local ? 'success' : 'info'} className="shrink-0">
                  {entry.local ? 'local' : 'cloud'}
                </Badge>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{formatBytes(entry.outputSize)}</span>
                <span>{formatRelativeTime(entry.createdAt)}</span>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/tool/${entry.toolId}`} onClick={() => setOpen(false)}>
                    <ArrowRight className="h-3.5 w-3.5" /> Run again
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => removeHistory(entry.id)}
                >
                  <X className="h-3.5 w-3.5" /> Remove
                </Button>
              </div>
            </div>
          ))}
          <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
            Folio keeps a lightweight log of what you processed. Files themselves are never stored — only names and
            sizes in this browser&apos;s local storage.
          </p>
        </div>
      )}
    </Sheet>
  )
}

export function Footer() {
  const featured = TOOLS.filter((tool) => tool.featured).slice(0, 6)
  return (
    <footer className="mt-16 border-t border-border bg-card/30">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-4">
        <div className="space-y-3">
          <Link to="/" className="flex items-center gap-2.5">
            <FolioMark className="h-7 w-7" />
            <span className="text-base font-bold">Folio</span>
          </Link>
          <p className="text-xs leading-relaxed text-muted-foreground">
            A private-by-default PDF studio. No paywalls, no watermarks — documents are processed by Folio&apos;s own
            server and deleted right after your download.
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-emerald-500" />
            Documents are processed by Folio&apos;s server, then deleted.          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Popular tools</p>
          <ul className="space-y-1.5">
            {featured.map((tool) => (
              <li key={tool.id}>
                <Link to={`/tool/${tool.id}`} className="text-xs text-muted-foreground hover:text-foreground">
                  {tool.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Workspace</p>
          <ul className="space-y-1.5">
            <li>
              <Link to="/tools" className="text-xs text-muted-foreground hover:text-foreground">
                All tools
              </Link>
            </li>
            <li>
              <Link to="/ai" className="text-xs text-muted-foreground hover:text-foreground">
                AI workspace
              </Link>
            </li>
            <li>
              <Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">
                Settings & Ollama
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Privacy</p>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li>Files stay on your device</li>
            <li>No accounts required</li>
            <li>No file retention</li>
            <li>AES-256 encryption built in</li>
          </ul>
        </div>
      </div>
      <div className="border-t border-border/70">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-4 text-[11px] text-muted-foreground sm:flex-row sm:px-6">
          <p>© {new Date().getFullYear()} Folio. Built for people who care where their documents go.</p>
          <p className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Powered by PDF.js, pdf-lib & Tesseract
          </p>
        </div>
      </div>
    </footer>
  )
}
