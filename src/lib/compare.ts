import { readPdfText, type PdfTextDocument } from './pdf'
import { blocksToPdf } from './textPdf'
import { baseName } from './utils'

export type DiffKind = 'same' | 'added' | 'removed'

export interface DiffToken {
  text: string
  kind: DiffKind
}

export interface DiffLine {
  kind: DiffKind
  leftNumber: number | null
  rightNumber: number | null
  tokens: DiffToken[]
  text: string
}

export interface PageDiff {
  page: number
  lines: DiffLine[]
  added: number
  removed: number
}

export interface ComparisonResult {
  pages: PageDiff[]
  summary: {
    pagesCompared: number
    linesAdded: number
    linesRemoved: number
    wordsAdded: number
    wordsRemoved: number
    similarity: number
    identical: boolean
  }
  leftTitle: string
  rightTitle: string
}

const MAX_LCS_CELLS = 4_000_000

/** Token-level LCS diff, falling back to whole-line replacement for huge inputs. */
export function diffTokens(left: string[], right: string[]): DiffToken[] {
  const n = left.length
  const m = right.length
  if (n * m > MAX_LCS_CELLS) {
    const out: DiffToken[] = []
    if (n) out.push({ text: left.join(' '), kind: 'removed' })
    if (m) out.push({ text: right.join(' '), kind: 'added' })
    return out
  }

  const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }

  const tokens: DiffToken[] = []
  const push = (text: string, kind: DiffKind) => {
    const last = tokens[tokens.length - 1]
    if (last && last.kind === kind) last.text += text
    else tokens.push({ text, kind })
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      push(` ${left[i]}`, 'same')
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push(` ${left[i]}`, 'removed')
      i++
    } else {
      push(` ${right[j]}`, 'added')
      j++
    }
  }
  while (i < n) {
    push(` ${left[i]}`, 'removed')
    i++
  }
  while (j < m) {
    push(` ${right[j]}`, 'added')
    j++
  }

  return tokens.map((token) => ({ ...token, text: token.text.replace(/^\s+/, '') })).filter((token) => token.text.length > 0)
}

function splitWords(line: string): string[] {
  return line.split(/\s+/).filter(Boolean)
}

function normaliseLines(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
}

export function diffDocuments(left: PdfTextDocument, right: PdfTextDocument): ComparisonResult {
  const pageCount = Math.max(left.pages.length, right.pages.length)
  const pages: PageDiff[] = []
  let linesAdded = 0
  let linesRemoved = 0
  let wordsAdded = 0
  let wordsRemoved = 0
  let sameWords = 0
  let totalWords = 0

  for (let index = 0; index < pageCount; index++) {
    const leftLines = normaliseLines(left.pages[index]?.text ?? '')
    const rightLines = normaliseLines(right.pages[index]?.text ?? '')
    const lineTokens = diffTokens(leftLines, rightLines)

    // Rebuild line rows from the token stream so each row keeps numbering.
    const lines: DiffLine[] = []
    let leftNumber = 1
    let rightNumber = 1
    for (const token of lineTokens) {
      if (token.kind === 'same') {
        lines.push({
          kind: 'same',
          leftNumber: leftNumber++,
          rightNumber: rightNumber++,
          tokens: [{ text: token.text, kind: 'same' }],
          text: token.text,
        })
      } else if (token.kind === 'removed') {
        lines.push({
          kind: 'removed',
          leftNumber: leftNumber++,
          rightNumber: null,
          tokens: [{ text: token.text, kind: 'removed' }],
          text: token.text,
        })
        linesRemoved++
        wordsRemoved += splitWords(token.text).length
      } else {
        lines.push({
          kind: 'added',
          leftNumber: null,
          rightNumber: rightNumber++,
          tokens: [{ text: token.text, kind: 'added' }],
          text: token.text,
        })
        linesAdded++
        wordsAdded += splitWords(token.text).length
      }
    }

    // Word-level detail for same rows that differ internally.
    const detailed = lines.map((line) => {
      if (line.kind !== 'same') return line
      const leftLine = leftLines[(line.leftNumber ?? 1) - 1] ?? ''
      const rightLine = rightLines[(line.rightNumber ?? 1) - 1] ?? ''
      if (leftLine === rightLine) return line
      const tokens = diffTokens(splitWords(leftLine), splitWords(rightLine))
      return { ...line, tokens, kind: 'same' as DiffKind }
    })

    for (const line of detailed) {
      const same = line.tokens.filter((token) => token.kind === 'same').length
      const changed = line.tokens.filter((token) => token.kind !== 'same').length
      sameWords += same
      totalWords += same + changed
    }

    pages.push({ page: index + 1, lines: detailed, added: linesAdded, removed: linesRemoved })
  }

  const similarity = totalWords === 0 ? 1 : Math.max(0, Math.min(1, sameWords / totalWords))

  return {
    pages,
    summary: {
      pagesCompared: pageCount,
      linesAdded,
      linesRemoved,
      wordsAdded,
      wordsRemoved,
      similarity,
      identical: linesAdded === 0 && linesRemoved === 0 && similarity > 0.999,
    },
    leftTitle: left.title || 'Original',
    rightTitle: right.title || 'Revised',
  }
}

export async function comparePdfs(leftFile: File, rightFile: File, passwords: { left?: string; right?: string } = {}) {
  const [left, right] = await Promise.all([
    readPdfText(leftFile, passwords.left),
    readPdfText(rightFile, passwords.right),
  ])
  return diffDocuments(left, right)
}

/** Export the comparison as a readable report PDF. */
export async function comparisonReportPdf(
  result: ComparisonResult,
  names: { left: string; right: string },
): Promise<Blob> {
  const blocks = [
    { style: 'title' as const, text: 'Document comparison report' },
    {
      style: 'body' as const,
      text: `Original: ${baseName(names.left)}  •  Revised: ${baseName(names.right)}`,
    },
    {
      style: 'body' as const,
      text: `Similarity ${(result.summary.similarity * 100).toFixed(1)}%  •  ${result.summary.linesAdded} lines added  •  ${result.summary.linesRemoved} lines removed  •  ${result.summary.wordsAdded} words added  •  ${result.summary.wordsRemoved} words removed`,
    },
  ]

  for (const page of result.pages) {
    blocks.push({ style: 'h2' as const, text: `Page ${page.page}` })
    for (const line of page.lines) {
      if (line.kind === 'same' && line.tokens.every((token) => token.kind === 'same')) {
        blocks.push({ style: 'body' as const, text: line.text })
      } else {
        const rendered = line.tokens
          .map((token) =>
            token.kind === 'removed'
              ? `[-${token.text}-]`
              : token.kind === 'added'
                ? `{+${token.text}+}`
                : token.text,
          )
          .join(' ')
        blocks.push({ style: 'body' as const, text: rendered })
      }
    }
  }

  blocks.push({
    style: 'body' as const,
    text: 'Legend: [-removed text-] appears only in the original; {+added text+} appears only in the revised document.',
  })

  return blocksToPdf(blocks, { title: 'Document comparison' })
}
