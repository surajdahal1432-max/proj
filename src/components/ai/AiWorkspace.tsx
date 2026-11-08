import * as React from 'react'
import {
  Bot,
  BrainCircuit,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  Languages,
  Loader2,
  MessageSquareText,
  PlugZap,
  RefreshCw,
  Send,
  Sparkles,
  Table2,
  User,
} from 'lucide-react'
import type { ToolDefinition, AiTab } from '@/lib/tools'
import { readPdfText, type PdfTextDocument } from '@/lib/pdf'
import { detectTables } from '@/lib/convert'
import { rowsToCsv } from '@/lib/xlsx'
import { markdownToPdf } from '@/lib/convert'
import {
  TRANSLATION_LANGUAGES,
  answerLocally,
  answerWithOllama,
  buildChunks,
  documentStats,
  listOllamaModels,
  summarizeLocally,
  summarizeWithOllama,
  translateText,
  type OllamaMessage,
  type SourceCitation,
} from '@/lib/ai'
import { cn, downloadBlob, formatBytes } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import { ToolShell, ToolPanel } from '@/components/ToolShell'
import { UploadDropzone } from '@/components/UploadDropzone'
import { ResultPanel, type ResultFile } from '@/components/ResultPanel'
import { Button } from '@/components/ui/button'
import { Badge, Spinner } from '@/components/ui/feedback'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea } from '@/components/ui/controls'
import { Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '@/components/ui/overlays'
import { useRecordHistory } from '@/hooks/useRecordHistory'

/* ------------------------------------------------------------------ *
 * Ollama status
 * ------------------------------------------------------------------ */

function OllamaBadge() {
  const status = useAppStore((state) => state.ollamaStatus)
  const model = useAppStore((state) => state.ollamaModel)
  if (status === 'online') {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> Ollama · {model}
      </Badge>
    )
  }
  if (status === 'checking') {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking Ollama
      </Badge>
    )
  }
  if (status === 'offline') {
    return (
      <Badge variant="warning" className="gap-1">
        <PlugZap className="h-3 w-3" /> Offline engine
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1">
      <Bot className="h-3 w-3" /> Local retrieval
    </Badge>
  )
}

function CitationList({ citations }: { citations: SourceCitation[] }) {
  if (!citations.length) return null
  return (
    <ul className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
      {citations.map((citation, index) => (
        <li key={`${citation.page}-${index}`} className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="mr-1 rounded bg-primary/10 px-1 py-0.5 font-semibold text-primary">p.{citation.page}</span>
          {citation.quote}
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ *
 * Workspace
 * ------------------------------------------------------------------ */

export function AiWorkspace({ tool, initialTab }: { tool: ToolDefinition; initialTab?: AiTab }) {
  const { toast } = useToast()
  const record = useRecordHistory()

  const host = useAppStore((state) => state.ollamaHost)
  const model = useAppStore((state) => state.ollamaModel)
  const ollamaStatus = useAppStore((state) => state.ollamaStatus)
  const ollamaError = useAppStore((state) => state.ollamaError)
  const ollamaModels = useAppStore((state) => state.ollamaModels)
  const setOllamaStatus = useAppStore((state) => state.setOllamaStatus)
  const setOllamaModels = useAppStore((state) => state.setOllamaModels)

  const [file, setFile] = React.useState<File | null>(null)
  const [document, setDocument] = React.useState<PdfTextDocument | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [tab, setTab] = React.useState<AiTab>(initialTab ?? tool.aiTab ?? 'summarize')
  const [engine, setEngine] = React.useState<'local' | 'ollama'>('local')
  const [busy, setBusy] = React.useState(false)
  const [results, setResults] = React.useState<ResultFile[]>([])

  /* ---------------------------- summarize ---------------------------- */
  const [style, setStyle] = React.useState<'bullets' | 'paragraph'>('bullets')
  const [summary, setSummary] = React.useState<{ text: string; citations: SourceCitation[]; source: string } | null>(null)

  /* ------------------------------- chat ------------------------------ */
  const [messages, setMessages] = React.useState<{ id: string; role: 'user' | 'assistant'; content: string; citations?: SourceCitation[] }[]>([])
  const [question, setQuestion] = React.useState('')
  const [streaming, setStreaming] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)

  /* ------------------------------ tables ----------------------------- */
  const [tables, setTables] = React.useState<{ page: number; rows: string[][] }[]>([])

  /* ---------------------------- translate ---------------------------- */
  const [language, setLanguage] = React.useState('Spanish')
  const [translation, setTranslation] = React.useState('')
  const [translateProgress, setTranslateProgress] = React.useState(0)

  const stats = React.useMemo(() => (document ? documentStats(document) : null), [document])
  const chunks = React.useMemo(() => (document ? buildChunks(document) : []), [document])

  const testOllama = async () => {
    setOllamaStatus('checking')
    try {
      const models = await listOllamaModels(host)
      setOllamaModels(models)
      setOllamaStatus('online')
      toast({
        title: 'Ollama connected',
        description: models.length ? `${models.length} model(s) available.` : 'Connected, but no models are pulled yet.',
        variant: 'success',
      })
    } catch (error) {
      setOllamaStatus('offline', error instanceof Error ? error.message : 'Ollama is unreachable.')
      toast({ title: 'Ollama unreachable', description: 'Local retrieval will be used instead.', variant: 'warning' })
    }
  }

  const openFile = async (next: File) => {
    setFile(next)
    setLoading(true)
    setSummary(null)
    setTables([])
    setTranslation('')
    setMessages([])
    setResults([])
    try {
      const text = await readPdfText(next)
      if (!text.pages.some((page) => page.text.trim())) {
        toast({
          title: 'No text layer found',
          description: 'This looks like a scan — run OCR first to make it searchable.',
          variant: 'warning',
        })
      }
      setDocument(text)
    } catch (error) {
      toast({
        title: 'Could not read this PDF',
        description: error instanceof Error ? error.message : 'The document could not be parsed.',
        variant: 'error',
      })
    } finally {
      setLoading(false)
    }
  }

  const runSummary = async () => {
    if (!document) return
    setBusy(true)
    try {
      if (engine === 'ollama' && ollamaStatus === 'online') {
        const text = await summarizeWithOllama(document, { host, model, style })
        setSummary({
          text,
          citations: summarizeLocally(document, 6).citations,
          source: `Ollama · ${model}`,
        })
      } else {
        const local = summarizeLocally(document, style === 'bullets' ? 8 : 10)
        setSummary({
          text: style === 'bullets' ? local.bullets.map((bullet) => `- ${bullet}`).join('\n') : local.summary,
          citations: local.citations,
          source: 'On-device extractive engine',
        })
      }
      toast({ title: 'Summary ready', variant: 'success' })
    } catch (error) {
      toast({
        title: 'Summarisation failed',
        description: error instanceof Error ? error.message : 'The summary could not be generated.',
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const ask = async () => {
    const prompt = question.trim()
    if (!prompt || !document || streaming) return
    setQuestion('')
    const userMessage = { id: `${Date.now()}-u`, role: 'user' as const, content: prompt }
    const assistantId = `${Date.now()}-a`
    setMessages((previous) => [...previous, userMessage, { id: assistantId, role: 'assistant', content: '' }])
    setStreaming(true)

    const useOllama = engine === 'ollama' && ollamaStatus === 'online'
    try {
      if (useOllama) {
        const controller = new AbortController()
        abortRef.current = controller
        const history: OllamaMessage[] = messages.slice(-6).map((message) => ({ role: message.role, content: message.content }))
        let buffer = ''
        await answerWithOllama(prompt, document, {
          host,
          model,
          history,
          signal: controller.signal,
          onToken: (token) => {
            buffer += token
            setMessages((previous) =>
              previous.map((message) => (message.id === assistantId ? { ...message, content: buffer } : message)),
            )
          },
        })
      } else {
        const answer = answerLocally(prompt, chunks)
        setMessages((previous) =>
          previous.map((message) =>
            message.id === assistantId ? { ...message, content: answer.answer, citations: answer.citations } : message,
          ),
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The question could not be answered.'
      setMessages((previous) => previous.map((entry) => (entry.id === assistantId ? { ...entry, content: `⚠️ ${message}` } : entry)))
      toast({ title: 'Answer failed', description: message, variant: 'error' })
    } finally {
      abortRef.current = null
      setStreaming(false)
    }
  }

  const extractTables = () => {
    if (!document) return
    const found = detectTables(document)
    setTables(found)
    toast({
      title: found.length ? `${found.length} table(s) detected` : 'No tables detected',
      description: found.length
        ? 'Preview them below and export as CSV or JSON.'
        : 'This document has no clearly aligned tabular rows.',
      variant: found.length ? 'success' : 'info',
    })
  }

  const downloadCsv = (rows: string[][], index: number) => {
    const csv = rowsToCsv(rows)
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${tool.id}-table-${index + 1}.csv`)
  }

  const downloadJson = () => {
    const payload = tables.map((table) => ({ page: table.page, rows: table.rows }))
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `${tool.id}-tables.json`)
  }

  const runTranslation = async () => {
    if (!document) return
    if (ollamaStatus !== 'online') {
      toast({
        title: 'Ollama required',
        description: 'Translation needs a local model. Connect Ollama in Settings to continue.',
        variant: 'warning',
      })
      return
    }
    setBusy(true)
    setTranslateProgress(0)
    setTranslation('')
    try {
      const parts: string[] = []
      for (let index = 0; index < document.pages.length; index += 1) {
        const page = document.pages[index]
        const text = page.text.trim().slice(0, 6000)
        if (!text) continue
        const translated = await translateText(text, language, { host, model })
        parts.push(`## Page ${page.pageNumber}\n\n${translated}`)
        setTranslateProgress(Math.round(((index + 1) / document.pages.length) * 100))
      }
      setTranslation(parts.join('\n\n'))
      toast({ title: 'Translation complete', description: `${language} · ${document.pages.length} page(s).`, variant: 'success' })
    } catch (error) {
      toast({
        title: 'Translation failed',
        description: error instanceof Error ? error.message : 'The document could not be translated.',
        variant: 'error',
      })
    } finally {
      setBusy(false)
    }
  }

  const exportText = async (text: string, suffix: string) => {
    if (!document || !file || !text) return
    try {
      const markdown = `# ${suffix} — ${file.name}\n\n${text}`
      const pdf = await markdownToPdf(new File([markdown], `${suffix}.md`, { type: 'text/markdown' }), {
        title: `${suffix} — ${file.name}`,
        showPageNumbers: true,
      })
      setResults([{ name: pdf.name, blob: pdf.blob, size: pdf.blob.size }])
      record(tool, { inputName: file.name, outputName: pdf.name, outputSize: pdf.blob.size })
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'The document could not be generated.',
        variant: 'error',
      })
    }
  }

  return (
    <ToolShell tool={tool}>
      <div className="space-y-5">
        {!file ? (
          <UploadDropzone accept={tool.accept} multiple={false} onFiles={(files) => files[0] && void openFile(files[0])} />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(file.size)}
                {stats ? ` · ${stats.pages} pages · ${stats.words.toLocaleString()} words · ~${stats.readingMinutes} min read` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <OllamaBadge />
              <Button variant="outline" size="sm" onClick={() => setFile(null)}>
                Change file
              </Button>
            </div>
          </div>
        )}

        {loading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner /> Extracting text locally…
          </p>
        )}

        {document && (
          <Tabs value={tab} onValueChange={(value) => setTab(value as AiTab)}>
            <TabsList>
              <TabsTrigger value="summarize">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Summarize
              </TabsTrigger>
              <TabsTrigger value="chat">
                <MessageSquareText className="mr-1.5 h-3.5 w-3.5" /> Q&amp;A
              </TabsTrigger>
              <TabsTrigger value="tables">
                <Table2 className="mr-1.5 h-3.5 w-3.5" /> Tables
              </TabsTrigger>
              <TabsTrigger value="translate">
                <Languages className="mr-1.5 h-3.5 w-3.5" /> Translate
              </TabsTrigger>
            </TabsList>

            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/40 px-3 py-2">
              <BrainCircuit className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium">Engine</span>
              <div className="flex gap-1">
                <Button size="sm" variant={engine === 'local' ? 'default' : 'ghost'} onClick={() => setEngine('local')}>
                  On-device
                </Button>
                <Button
                  size="sm"
                  variant={engine === 'ollama' ? 'default' : 'ghost'}
                  onClick={() => setEngine('ollama')}
                  disabled={ollamaStatus !== 'online'}
                >
                  Ollama
                </Button>
              </div>
              {ollamaStatus === 'online' ? (
                <Select value={model} onValueChange={(value) => useAppStore.getState().setOllamaModel(value)}>
                  <SelectTrigger className="h-8 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(ollamaModels.length ? ollamaModels : [model]).map((entry) => (
                      <SelectItem key={entry} value={entry}>
                        {entry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Button size="sm" variant="outline" onClick={testOllama} className="gap-1.5">
                  {ollamaStatus === 'checking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Test Ollama
                </Button>
              )}
              {engine === 'local' && (
                <span className="text-[11px] text-muted-foreground">Runs instantly, no model required.</span>
              )}
              {ollamaError && ollamaStatus === 'offline' && (
                <span className="text-[11px] text-amber-500">{ollamaError}</span>
              )}
            </div>

            {/* --------------------------- Summarize --------------------------- */}
            <TabsContent value="summarize">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <ToolPanel title="Executive summary" description="Extractive on-device engine or your local Ollama model.">
                  {summary ? (
                    <div className="space-y-3">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{summary.text}</p>
                      <CitationList citations={summary.citations} />
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Badge variant="outline">{summary.source}</Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5"
                          onClick={() => {
                            void navigator.clipboard?.writeText(summary.text)
                            toast({ title: 'Summary copied', variant: 'success' })
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" /> Copy
                        </Button>
                        <Button size="sm" className="gap-1.5" onClick={() => void exportText(summary.text, 'summary')}>
                          <Download className="h-3.5 w-3.5" /> Export PDF
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                      Choose a style and generate a summary with page citations.
                    </p>
                  )}
                </ToolPanel>

                <div className="space-y-4">
                  <ToolPanel title="Options">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={style === 'bullets' ? 'default' : 'outline'}
                        onClick={() => setStyle('bullets')}
                        className="flex-1"
                      >
                        Bullets
                      </Button>
                      <Button
                        size="sm"
                        variant={style === 'paragraph' ? 'default' : 'outline'}
                        onClick={() => setStyle('paragraph')}
                        className="flex-1"
                      >
                        Paragraphs
                      </Button>
                    </div>
                    <Button onClick={runSummary} disabled={busy} className="w-full gap-1.5">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      Generate summary
                    </Button>
                  </ToolPanel>
                  {stats && (
                    <ToolPanel title="Key terms" description={`${stats.words.toLocaleString()} words · ${stats.sentences} sentences`}>
                      <div className="flex flex-wrap gap-1.5">
                        {stats.topKeywords.map((keyword) => (
                          <Badge key={keyword.term} variant="secondary">
                            {keyword.term} · {keyword.count}
                          </Badge>
                        ))}
                      </div>
                    </ToolPanel>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* ------------------------------ Chat ----------------------------- */}
            <TabsContent value="chat">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                <ToolPanel title="Ask this document" description="Answers cite the page they came from.">
                  <div className="max-h-[440px] space-y-3 overflow-y-auto pr-1">
                    {!messages.length && (
                      <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                        Ask anything — “What are the payment terms?” or “Summarise the risks in section 3.”
                      </p>
                    )}
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          'flex gap-2.5 rounded-lg border p-3 text-sm',
                          message.role === 'user'
                            ? 'border-primary/25 bg-primary/[0.06]'
                            : 'border-border bg-card/60',
                        )}
                      >
                        <div
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                            message.role === 'user' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {message.role === 'user' ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="whitespace-pre-wrap leading-relaxed">
                            {message.content || (streaming ? '…' : '')}
                          </p>
                          {message.citations && <CitationList citations={message.citations} />}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-end gap-2">
                    <Textarea
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          void ask()
                        }
                      }}
                      rows={2}
                      placeholder="Ask a question about this document…"
                    />
                    <Button onClick={() => void ask()} disabled={!question.trim() || streaming} className="gap-1.5">
                      {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Ask
                    </Button>
                  </div>
                </ToolPanel>

                <ToolPanel title="Retrieval" description={`${chunks.length} chunk(s) indexed in this tab.`}>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Text is split into page-aware chunks and ranked by keyword overlap. Nothing leaves the browser unless
                    you explicitly use Ollama.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {['What is this document about?', 'List the key figures.', 'What are the next steps?'].map((sample) => (
                      <Button key={sample} size="sm" variant="outline" onClick={() => setQuestion(sample)}>
                        {sample}
                      </Button>
                    ))}
                  </div>
                  {messages.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setMessages([])}>
                      Clear conversation
                    </Button>
                  )}
                </ToolPanel>
              </div>
            </TabsContent>

            {/* ----------------------------- Tables ---------------------------- */}
            <TabsContent value="tables">
              <ToolPanel title="Table extraction" description="Detected from aligned text rows and columns.">
                <div className="flex flex-wrap gap-2">
                  <Button onClick={extractTables} className="gap-1.5">
                    <Table2 className="h-4 w-4" /> Detect tables
                  </Button>
                  {tables.length > 0 && (
                    <>
                      <Button variant="outline" onClick={downloadJson} className="gap-1.5">
                        <FileSpreadsheet className="h-4 w-4" /> JSON
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          const csv = tables.map((table, index) => `# Page ${table.page} — Table ${index + 1}\n${rowsToCsv(table.rows)}`).join('\n\n')
                          downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${tool.id}-tables.csv`)
                        }}
                        className="gap-1.5"
                      >
                        <Download className="h-4 w-4" /> All CSV
                      </Button>
                    </>
                  )}
                </div>

                {tables.map((table, index) => (
                  <div key={`${table.page}-${index}`} className="space-y-2 rounded-lg border border-border/60 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">
                        Table {index + 1} · page {table.page} · {table.rows.length} rows
                      </p>
                      <Button size="sm" variant="ghost" onClick={() => downloadCsv(table.rows, index)} className="gap-1.5">
                        <Download className="h-3.5 w-3.5" /> CSV
                      </Button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-xs">
                        <tbody>
                          {table.rows.slice(0, 12).map((row, rowIndex) => (
                            <tr key={rowIndex} className={rowIndex === 0 ? 'bg-muted/40 font-semibold' : ''}>
                              {row.map((cell, cellIndex) => (
                                <td key={cellIndex} className="border border-border/60 px-2 py-1 align-top">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {!tables.length && (
                  <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                    Run detection to find tables in this document.
                  </p>
                )}
              </ToolPanel>
            </TabsContent>

            {/* --------------------------- Translate --------------------------- */}
            <TabsContent value="translate">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <ToolPanel title="Translation" description="Layout is preserved as page-by-page Markdown.">
                  {translation ? (
                    <div className="space-y-3">
                      <div className="max-h-[440px] overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-card/40 p-3 text-sm leading-relaxed">
                        {translation}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => downloadBlob(new Blob([translation], { type: 'text/markdown' }), `${tool.id}-${language}.md`)} className="gap-1.5">
                          <Download className="h-3.5 w-3.5" /> Markdown
                        </Button>
                        <Button size="sm" onClick={() => void exportText(translation, `translated-${language}`)} className="gap-1.5">
                          <Download className="h-3.5 w-3.5" /> PDF
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                      {ollamaStatus === 'online'
                        ? 'Pick a language and translate every page.'
                        : 'Connect Ollama in Settings to translate offline with your own model.'}
                    </p>
                  )}
                </ToolPanel>
                <ToolPanel title="Target language">
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSLATION_LANGUAGES.map((entry) => (
                        <SelectItem key={entry.code} value={entry.code}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {busy && (
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${translateProgress}%` }} />
                    </div>
                  )}
                  <Button onClick={runTranslation} disabled={busy || ollamaStatus !== 'online'} className="w-full gap-1.5">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
                    Translate document
                  </Button>
                </ToolPanel>
              </div>
            </TabsContent>
          </Tabs>
        )}

        <ResultPanel results={results} title="Generated document" onReset={() => setResults([])} />
      </div>
    </ToolShell>
  )
}
