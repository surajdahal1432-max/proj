import type { PdfTextDocument } from './pdf'
import { guardedFetch } from './privacy'

export interface DocumentChunk {
  page: number
  text: string
}

export interface SourceCitation {
  page: number
  quote: string
}

export const OLLAMA_DEFAULT_HOST = 'http://localhost:11434'
export const OLLAMA_MODELS = ['llama3', 'llama3.1', 'mistral', 'phi3', 'gemma2', 'qwen2.5']

/* ------------------------------------------------------------------ *
 * Document context
 * ------------------------------------------------------------------ */

export function buildChunks(document: PdfTextDocument, maxCharsPerChunk = 1600): DocumentChunk[] {
  const chunks: DocumentChunk[] = []
  for (const page of document.pages) {
    const clean = page.text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim()
    if (!clean) continue
    const paragraphs = clean.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
    let buffer = ''
    for (const paragraph of paragraphs.length ? paragraphs : [clean]) {
      if ((buffer + '\n\n' + paragraph).length > maxCharsPerChunk && buffer) {
        chunks.push({ page: page.pageNumber, text: buffer })
        buffer = paragraph
      } else {
        buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph
      }
    }
    if (buffer) chunks.push({ page: page.pageNumber, text: buffer })
  }
  return chunks
}

export function documentText(document: PdfTextDocument): string {
  return document.pages.map((page) => page.text).join('\n\n')
}

/* ------------------------------------------------------------------ *
 * Local, dependency-free analysis (used when Ollama is unavailable)
 * ------------------------------------------------------------------ */

const STOP_WORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by can cannot could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other ought our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why with would you your yours yourself yourselves`.split(
    /\s+/,
  ),
)

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“'])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30)
}

export interface KeywordStat {
  term: string
  count: number
}

export function keywords(text: string, limit = 18): KeywordStat[] {
  const counts = new Map<string, number>()
  for (const word of tokenize(text)) counts.set(word, (counts.get(word) ?? 0) + 1)
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit)
}

export function documentStats(document: PdfTextDocument) {
  const text = documentText(document)
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  const sentences = splitSentences(text).length
  return {
    pages: document.pages.length,
    words,
    characters: text.length,
    sentences,
    readingMinutes: Math.max(1, Math.round(words / 220)),
    topKeywords: keywords(text, 12),
  }
}

/** Extractive summariser: sentence scoring by keyword density + position. */
export function summarizeLocally(document: PdfTextDocument, sentenceCount = 8): {
  summary: string
  bullets: string[]
  citations: SourceCitation[]
} {
  const scored: { sentence: string; score: number; page: number; order: number }[] = []
  const globalKeywords = new Map(keywords(documentText(document), 40).map((entry) => [entry.term, entry.count]))

  let order = 0
  for (const page of document.pages) {
    for (const sentence of splitSentences(page.text)) {
      const terms = tokenize(sentence)
      if (!terms.length) continue
      const density = terms.reduce((sum, term) => sum + (globalKeywords.get(term) ?? 0), 0) / Math.sqrt(terms.length)
      const positionBoost = order < 12 ? 1.35 : 1
      const lengthPenalty = sentence.length > 320 ? 0.75 : 1
      scored.push({
        sentence,
        score: density * positionBoost * lengthPenalty,
        page: page.pageNumber,
        order: order++,
      })
    }
  }

  const selected = scored
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(3, sentenceCount))
    .sort((a, b) => a.order - b.order)

  const bullets = selected.map((item) => item.sentence)
  const summary = bullets.join(' ')
  const citations = selected.slice(0, 6).map((item) => ({
    page: item.page,
    quote: item.sentence.slice(0, 240),
  }))

  return { summary, bullets, citations }
}

export interface LocalAnswer {
  answer: string
  citations: SourceCitation[]
  confidence: number
}

/** Retrieval + extractive answering with page citations, fully offline. */
export function answerLocally(question: string, chunks: DocumentChunk[]): LocalAnswer {
  const questionTerms = tokenize(question)
  if (!questionTerms.length) {
    return { answer: 'Ask a question with at least one keyword from the document.', citations: [], confidence: 0 }
  }

  const ranked = chunks
    .map((chunk) => {
      const sentences = splitSentences(chunk.text)
      const best = sentences
        .map((sentence) => {
          const terms = new Set(tokenize(sentence))
          const overlap = questionTerms.filter((term) => terms.has(term)).length
          const exactBoost = sentence.toLowerCase().includes(question.toLowerCase()) ? 3 : 0
          return { sentence, score: overlap + exactBoost }
        })
        .sort((a, b) => b.score - a.score)[0]
      const chunkScore = questionTerms.filter((term) => chunk.text.toLowerCase().includes(term)).length
      return { chunk, best, chunkScore }
    })
    .filter((entry) => entry.chunkScore > 0)
    .sort((a, b) => b.chunkScore - a.chunkScore)
    .slice(0, 4)

  if (!ranked.length) {
    return {
      answer:
        'I could not find that in this document. Try different keywords, or connect Ollama for reasoning-based answers.',
      citations: [],
      confidence: 0,
    }
  }

  const citations = ranked
    .filter((entry) => entry.best && entry.best.score > 0)
    .map((entry) => ({ page: entry.chunk.page, quote: entry.best!.sentence.slice(0, 260) }))

  const answer = citations.length
    ? citations.map((citation) => `${citation.quote} [p.${citation.page}]`).join('\n\n')
    : 'The document mentions these terms, but no single passage answers the question directly. Connect Ollama for a synthesised answer.'

  const confidence = Math.min(0.95, ranked[0].chunkScore / Math.max(3, questionTerms.length * 1.4))
  return { answer, citations, confidence }
}

/* ------------------------------------------------------------------ *
 * Ollama (local LLM) integration
 * ------------------------------------------------------------------ */

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function normalizeHost(host: string): string {
  const trimmed = (host || OLLAMA_DEFAULT_HOST).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(trimmed)) return `http://${trimmed}`
  return trimmed
}

export async function listOllamaModels(host: string): Promise<string[]> {
  const base = normalizeHost(host)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await guardedFetch(`${base}/api/tags`, { signal: controller.signal })
    if (!response.ok) throw new Error(`Ollama responded ${response.status}`)
    const payload = (await response.json()) as { models?: { name: string }[] }
    return (payload.models ?? []).map((model) => model.name).sort()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`No response from Ollama at ${base}. Is “ollama serve” running?`)
    }
    throw new Error(
      `Could not reach Ollama at ${base}. Start it with “ollama serve”, then allow this origin via OLLAMA_ORIGINS.`,
    )
  } finally {
    clearTimeout(timer)
  }
}

export interface OllamaChatOptions {
  host: string
  model: string
  messages: OllamaMessage[]
  temperature?: number
  onToken?: (token: string) => void
  signal?: AbortSignal
}

export async function ollamaChat(options: OllamaChatOptions): Promise<string> {
  const base = normalizeHost(options.host)
  const response = await guardedFetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: Boolean(options.onToken),
      options: { temperature: options.temperature ?? 0.2 },
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Ollama error ${response.status}: ${detail.slice(0, 240) || 'request failed'}`)
  }

  if (!options.onToken || !response.body) {
    const payload = (await response.json()) as { message?: { content?: string } }
    return payload.message?.content?.trim() ?? ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
        const token = json.message?.content ?? ''
        if (token) {
          full += token
          options.onToken(token)
        }
      } catch {
        // Partial JSON line; keep buffering.
      }
    }
  }
  return full.trim()
}

export function contextPrompt(chunks: DocumentChunk[], maxChars = 9000): string {
  let used = 0
  const parts: string[] = []
  for (const chunk of chunks) {
    const block = `[page ${chunk.page}]\n${chunk.text}`
    if (used + block.length > maxChars) break
    parts.push(block)
    used += block.length
  }
  return parts.join('\n\n---\n\n')
}

export async function summarizeWithOllama(
  document: PdfTextDocument,
  options: { host: string; model: string; style: 'bullets' | 'paragraph'; signal?: AbortSignal },
): Promise<string> {
  const chunks = buildChunks(document)
  const context = contextPrompt(chunks)
  const styleInstruction =
    options.style === 'bullets'
      ? 'Return 5-8 concise bullet points, each starting with "- ".'
      : 'Return 2-3 tight paragraphs of executive summary.'
  return ollamaChat({
    host: options.host,
    model: options.model,
    signal: options.signal,
    messages: [
      {
        role: 'system',
        content:
          'You are Folio, a document analyst. Answer only from the supplied document. Cite page numbers like [p.3]. Never invent facts.',
      },
      { role: 'user', content: `Summarise this document.\n\n${styleInstruction}\n\nDOCUMENT:\n${context}` },
    ],
  })
}

export async function answerWithOllama(
  question: string,
  document: PdfTextDocument,
  options: { host: string; model: string; history?: OllamaMessage[]; signal?: AbortSignal; onToken?: (token: string) => void },
): Promise<string> {
  const chunks = buildChunks(document)
  const context = contextPrompt(chunks, 9000)
  return ollamaChat({
    host: options.host,
    model: options.model,
    signal: options.signal,
    onToken: options.onToken,
    messages: [
      {
        role: 'system',
        content:
          'You are Folio, a retrieval assistant. Use ONLY the document context. If the answer is absent, say so plainly. Cite pages as [p.N].',
      },
      ...(options.history ?? []).slice(-6),
      { role: 'user', content: `DOCUMENT CONTEXT:\n${context}\n\nQUESTION: ${question}` },
    ],
  })
}

export const TRANSLATION_LANGUAGES = [
  { code: 'English', label: 'English' },
  { code: 'Spanish', label: 'Spanish' },
  { code: 'French', label: 'French' },
  { code: 'German', label: 'German' },
  { code: 'Portuguese', label: 'Portuguese' },
  { code: 'Italian', label: 'Italian' },
  { code: 'Dutch', label: 'Dutch' },
  { code: 'Japanese', label: 'Japanese' },
  { code: 'Korean', label: 'Korean' },
  { code: 'Chinese (Simplified)', label: 'Chinese (Simplified)' },
  { code: 'Arabic', label: 'Arabic' },
  { code: 'Hindi', label: 'Hindi' },
  { code: 'Russian', label: 'Russian' },
]

export async function translateText(
  text: string,
  targetLanguage: string,
  options: { host: string; model: string; signal?: AbortSignal },
): Promise<string> {
  return ollamaChat({
    host: options.host,
    model: options.model,
    signal: options.signal,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content:
          'You are a professional translator. Translate faithfully, preserve paragraph breaks, do not add commentary, and keep numbers and proper nouns intact.',
      },
      { role: 'user', content: `Translate the following into ${targetLanguage}:\n\n${text}` },
    ],
  })
}
