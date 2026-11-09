import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  Check,
  Cpu,
  Database,
  Loader2,
  Moon,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react'
import { OLLAMA_DEFAULT_HOST, OLLAMA_MODELS, listOllamaModels } from '@/lib/ai'
import { useAppStore } from '@/store/useAppStore'
import { ToolPanel } from '@/components/ToolShell'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/feedback'
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/controls'
import { useToast } from '@/components/ui/overlays'

export function SettingsPage() {
  const { toast } = useToast()
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)

  const host = useAppStore((state) => state.ollamaHost)
  const model = useAppStore((state) => state.ollamaModel)
  const status = useAppStore((state) => state.ollamaStatus)
  const error = useAppStore((state) => state.ollamaError)
  const models = useAppStore((state) => state.ollamaModels)
  const setOllamaHost = useAppStore((state) => state.setOllamaHost)
  const setOllamaModel = useAppStore((state) => state.setOllamaModel)
  const setOllamaStatus = useAppStore((state) => state.setOllamaStatus)
  const setOllamaModels = useAppStore((state) => state.setOllamaModels)

  const history = useAppStore((state) => state.history)
  const clearHistory = useAppStore((state) => state.clearHistory)
  const recentTools = useAppStore((state) => state.recentTools)

  const [hostDraft, setHostDraft] = React.useState(host)
  const [testing, setTesting] = React.useState(false)

  const test = async () => {
    setTesting(true)
    setOllamaHost(hostDraft.trim() || OLLAMA_DEFAULT_HOST)
    setOllamaStatus('checking')
    try {
      const available = await listOllamaModels(hostDraft.trim() || OLLAMA_DEFAULT_HOST)
      setOllamaModels(available)
      setOllamaStatus('online')
      toast({
        title: 'Ollama connected',
        description: available.length ? `Models: ${available.join(', ')}` : 'Connected — pull a model to get started.',
        variant: 'success',
      })
    } catch (caught) {
      setOllamaStatus('offline', caught instanceof Error ? caught.message : 'Connection failed.')
      toast({
        title: 'Could not reach Ollama',
        description: 'Check that Ollama is running and that CORS allows this origin.',
        variant: 'error',
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-10 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Settings</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything here is stored in this browser only — there is no account and no server-side profile.
      </p>

      <div className="mt-6 space-y-5">
        <ToolPanel title="Appearance" description="Dark is the default studio theme.">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={theme === 'dark' ? 'default' : 'outline'} onClick={() => setTheme('dark')} className="gap-1.5">
              <Moon className="h-4 w-4" /> Dark
            </Button>
            <Button variant={theme === 'light' ? 'default' : 'outline'} onClick={() => setTheme('light')} className="gap-1.5">
              <Sun className="h-4 w-4" /> Light
            </Button>
          </div>
        </ToolPanel>

        <ToolPanel
          title="Processing"
          description="Every tool runs on Folio's own processing service. Files are uploaded only when you start a job and are deleted after your download."
        >
          <div className="flex items-start gap-2 rounded-lg border border-border bg-card/50 px-3 py-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-500" />
            <div>
              <p className="text-sm font-medium">Server engine active</p>
              <p className="text-[11px] text-muted-foreground">
                Jobs run in isolated temporary directories with automatic cleanup and expiry.
              </p>
            </div>
          </div>
        </ToolPanel>

        <ToolPanel
          title="Local AI · Ollama"
          description="Point Folio at your own Ollama server for private summaries, Q&A and translation."
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ollama-host">Ollama host URL</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="ollama-host"
                  value={hostDraft}
                  onChange={(event) => setHostDraft(event.target.value)}
                  placeholder={OLLAMA_DEFAULT_HOST}
                  spellCheck={false}
                  autoComplete="off"
                />
                <Button onClick={test} disabled={testing} className="gap-1.5">
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Test connection
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Start Ollama with <code className="rounded bg-muted px-1">OLLAMA_ORIGINS=* ollama serve</code> so the
                browser is allowed to connect. Requests go directly from your browser to your machine.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {status === 'online' && (
                <Badge variant="success" className="gap-1">
                  <Check className="h-3 w-3" /> Connected
                </Badge>
              )}
              {status === 'checking' && (
                <Badge variant="secondary" className="gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Checking
                </Badge>
              )}
              {status === 'offline' && (
                <Badge variant="warning" className="gap-1">
                  <PlugZap className="h-3 w-3" /> Unreachable
                </Badge>
              )}
              {status === 'unknown' && <Badge variant="outline">Not tested yet</Badge>}
              {error && status === 'offline' && <span className="text-[11px] text-amber-500">{error}</span>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ollama-model">Model</Label>
              <Select value={model} onValueChange={setOllamaModel}>
                <SelectTrigger id="ollama-model">
                  <SelectValue placeholder="Choose a model" />
                </SelectTrigger>
                <SelectContent>
                  {(models.length ? models : OLLAMA_MODELS).map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {entry}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {models.length
                  ? `${models.length} model(s) detected on your server.`
                  : 'Popular local models: llama3, mistral, phi3.'}
              </p>
            </div>

            <div className="rounded-lg border border-border/60 bg-card/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
                <Cpu className="h-3.5 w-3.5" /> Without Ollama
              </p>
              Summaries and document Q&amp;A still work through the built-in extractive engine. Translation needs a local
              model.
            </div>
          </div>
        </ToolPanel>

        <ToolPanel
          title="Local data"
          description="Processing history and preferences live in this browser's local storage."
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                {history.length} history entr{history.length === 1 ? 'y' : 'ies'} · {recentTools.length} recent tools
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearHistory}
                  disabled={!history.length}
                  className="gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear history
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    window.localStorage.removeItem('folio-app-state')
                    toast({ title: 'Preferences reset', description: 'Reload the page to apply defaults.', variant: 'success' })
                  }}
                  className="gap-1.5"
                >
                  <Database className="h-3.5 w-3.5" /> Reset preferences
                </Button>
              </div>
            </div>
          }
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            Folio records only the tool used, the file name and the output size. Documents are never copied into storage
            and are released from memory when you close the tab. Read the{' '}
            <Link to="/tools" className="text-primary underline-offset-2 hover:underline">
              tool library
            </Link>{' '}
            to see which operations run locally.
          </p>
        </ToolPanel>
      </div>
    </div>
  )
}
