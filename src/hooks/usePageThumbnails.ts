import * as React from 'react'
import { closePdf, loadPdfFromFile, renderThumbnail } from '@/lib/pdfjs'

export interface ThumbnailState {
  thumbs: string[]
  pageCount: number
  loading: boolean
  error: string | null
}

/**
 * Renders page thumbnails in sequence so large documents stay responsive.
 * Thumbnails are data URLs that can be used directly in <img src>.
 */
export function usePageThumbnails(file: File | null, maxWidth = 200): ThumbnailState {
  const [state, setState] = React.useState<ThumbnailState>({
    thumbs: [],
    pageCount: 0,
    loading: false,
    error: null,
  })

  React.useEffect(() => {
    let cancelled = false
    if (!file) {
      setState({ thumbs: [], pageCount: 0, loading: false, error: null })
      return
    }
    setState({ thumbs: [], pageCount: 0, loading: true, error: null })

    const run = async () => {
      try {
        const doc = await loadPdfFromFile(file)
        if (cancelled) return
        setState((current) => ({ ...current, pageCount: doc.numPages }))
        const collected: string[] = []
        for (let index = 1; index <= doc.numPages; index += 1) {
          const page = await doc.getPage(index)
          const url = await renderThumbnail(page, maxWidth)
          collected.push(url)
          page.cleanup()
          if (cancelled) return
          setState({ thumbs: [...collected], pageCount: doc.numPages, loading: true, error: null })
        }
        await closePdf(doc)
        if (!cancelled) setState({ thumbs: collected, pageCount: doc.numPages, loading: false, error: null })
      } catch (error) {
        if (cancelled) return
        setState({
          thumbs: [],
          pageCount: 0,
          loading: false,
          error: error instanceof Error ? error.message : 'Could not render this PDF.',
        })
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [file, maxWidth])

  return state
}
