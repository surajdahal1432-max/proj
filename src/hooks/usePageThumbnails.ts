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
 *
 * `pageCount` is published as soon as the document opens, before any page is
 * rendered, so selection UIs never have to wait for previews. A page that
 * fails to render leaves an empty thumbnail slot instead of discarding the
 * whole document.
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
      let doc: Awaited<ReturnType<typeof loadPdfFromFile>> | null = null
      try {
        doc = await loadPdfFromFile(file)
        if (cancelled) return
        const total = doc.numPages
        setState({ thumbs: [], pageCount: total, loading: true, error: null })

        const collected: string[] = []
        for (let index = 1; index <= total; index += 1) {
          let url = ''
          try {
            const page = await doc.getPage(index)
            url = await renderThumbnail(page, maxWidth)
            page.cleanup()
          } catch {
            // One unrenderable page must not invalidate the rest of the document.
            url = ''
          }
          collected.push(url)
          if (cancelled) return
          setState({ thumbs: [...collected], pageCount: total, loading: true, error: null })
        }
        if (!cancelled) setState({ thumbs: collected, pageCount: total, loading: false, error: null })
      } catch (error) {
        if (cancelled) return
        setState({
          thumbs: [],
          pageCount: 0,
          loading: false,
          error: error instanceof Error ? error.message : 'Could not open this PDF.',
        })
      } finally {
        if (doc) {
          await closePdf(doc).catch(() => undefined)
        }
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [file, maxWidth])

  return state
}
