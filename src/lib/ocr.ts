import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { rasterizePdf } from './pdf'
import { baseName, clamp } from './utils'

export interface OcrWord {
  text: string
  confidence: number
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrPageResult {
  pageNumber: number
  text: string
  confidence: number
  words: OcrWord[]
  width: number
  height: number
}

export interface OcrOptions {
  languages?: string[]
  dpi?: number
  onProgress?: (progress: { page: number; total: number; percent: number; status: string }) => void
}

export const OCR_LANGUAGES: { code: string; label: string }[] = [
  { code: 'eng', label: 'English' },
  { code: 'spa', label: 'Spanish' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'por', label: 'Portuguese' },
  { code: 'ita', label: 'Italian' },
  { code: 'nld', label: 'Dutch' },
  { code: 'rus', label: 'Russian' },
  { code: 'ara', label: 'Arabic' },
  { code: 'hin', label: 'Hindi' },
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'kor', label: 'Korean' },
]

type TesseractWorker = {
  recognize: (image: Blob | string, options?: unknown, output?: unknown) => Promise<{
    data: {
      text: string
      confidence: number
      words?: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[]
    }
  }>
  terminate: () => Promise<unknown>
}

/**
 * Runs Tesseract entirely in the browser (no upload). Language packs are fetched
 * once from the public tessdata mirror; the document itself never leaves the tab.
 */
export async function ocrPdf(file: File, options: OcrOptions = {}): Promise<{
  blob: Blob
  text: string
  confidence: number
  pages: OcrPageResult[]
}> {
  const languages = options.languages?.length ? options.languages : ['eng']
  const dpi = options.dpi ?? 200
  const report = options.onProgress ?? (() => {})

  report({ page: 0, total: 0, percent: 2, status: 'Rendering pages' })
  const rasters = await rasterizePdf(file, { dpi, quality: 0.92 })

  const { createWorker } = await import('tesseract.js')
  report({ page: 0, total: rasters.length, percent: 6, status: 'Loading OCR engine' })

  const worker = (await createWorker(languages, 1, {
    logger: (message: { status: string; progress: number }) => {
      if (message.status === 'recognizing text') {
        report({
          page: 0,
          total: rasters.length,
          percent: clamp(6 + message.progress * 10, 6, 16),
          status: 'Recognizing text',
        })
      }
    },
  })) as unknown as TesseractWorker

  const pages: OcrPageResult[] = []
  try {
    for (let index = 0; index < rasters.length; index++) {
      const raster = rasters[index]
      const image = new Blob([raster.bytes as unknown as BlobPart], { type: 'image/jpeg' })
      const result = await worker.recognize(image)
      const words: OcrWord[] = (result.data.words ?? []).map((word) => ({
        text: word.text,
        confidence: word.confidence,
        x0: word.bbox.x0,
        y0: word.bbox.y0,
        x1: word.bbox.x1,
        y1: word.bbox.y1,
      }))
      pages.push({
        pageNumber: index + 1,
        text: result.data.text,
        confidence: result.data.confidence,
        words,
        width: raster.width,
        height: raster.height,
      })
      report({
        page: index + 1,
        total: rasters.length,
        percent: clamp(16 + ((index + 1) / rasters.length) * 74, 16, 90),
        status: `Recognized page ${index + 1} of ${rasters.length}`,
      })
    }
  } finally {
    await worker.terminate()
  }

  report({ page: rasters.length, total: rasters.length, percent: 93, status: 'Building searchable PDF' })

  const doc = await PDFDocument.create()
  doc.setProducer('Folio')
  doc.setTitle(baseName(file.name))
  const font = await doc.embedFont(StandardFonts.Helvetica)

  for (let index = 0; index < rasters.length; index++) {
    const raster = rasters[index]
    const result = pages[index]
    const pageWidth = (raster.width * 72) / dpi
    const pageHeight = (raster.height * 72) / dpi
    const page = doc.addPage([pageWidth, pageHeight])
    const image = await doc.embedJpg(raster.bytes)
    page.drawImage(image, { x: 0, y: 0, width: pageWidth, height: pageHeight })

    const scaleX = pageWidth / raster.width
    const scaleY = pageHeight / raster.height

    for (const word of result.words) {
      const clean = word.text.replace(/[^\x20-\x7E]/g, '').trim()
      if (!clean) continue
      const boxWidth = (word.x1 - word.x0) * scaleX
      const fontSize = clamp((word.y1 - word.y0) * scaleY * 0.92, 3, 48)
      const textWidth = font.widthOfTextAtSize(clean, fontSize)
      const x = word.x0 * scaleX
      const y = pageHeight - word.y1 * scaleY + (word.y1 - word.y0) * scaleY * 0.12
      page.drawText(clean, {
        x,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
        opacity: 0,
        maxWidth: Math.max(boxWidth, textWidth, 4),
      })
    }
  }

  const bytes = await doc.save()
  const text = pages.map((page) => page.text).join('\n\n')
  const confidence = pages.length
    ? pages.reduce((sum, page) => sum + page.confidence, 0) / pages.length
    : 0

  report({ page: rasters.length, total: rasters.length, percent: 100, status: 'Searchable PDF ready' })
  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' }),
    text,
    confidence,
    pages,
  }
}

export async function ocrTextOnly(file: File, options: OcrOptions = {}): Promise<{ text: string; confidence: number }> {
  const result = await ocrPdf(file, options)
  return { text: result.text, confidence: result.confidence }
}
