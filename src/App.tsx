import * as React from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { ArrowLeft, FileQuestion } from 'lucide-react'
import { Header, Footer } from '@/components/layout/Header'
import { ToastProvider, TooltipProvider } from '@/components/ui/overlays'
import { Button } from '@/components/ui/button'
import { HomePage } from '@/pages/Home'
import { ToolsPage } from '@/pages/Tools'
import { ToolPage } from '@/pages/ToolPage'
import { AiPage } from '@/pages/AiPage'
import { SettingsPage } from '@/pages/Settings'

function ScrollToTop() {
  const { pathname, search } = useLocation()
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname, search])
  return null
}

function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <FileQuestion className="h-5 w-5 text-muted-foreground" />
      </div>
      <h1 className="text-lg font-bold">Page not found</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The page you were looking for has moved. Everything is reachable from the tool library.
      </p>
      <Button asChild className="mt-4 gap-1.5">
        <Link to="/">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Folio
        </Link>
      </Button>
    </div>
  )
}

export default function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <ToastProvider>
        <ScrollToTop />
        <div className="flex min-h-screen flex-col bg-background text-foreground">
          <Header />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/tools" element={<ToolsPage />} />
              <Route path="/tool/:toolId" element={<ToolPage />} />
              <Route path="/ai" element={<AiPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </main>
          <Footer />
        </div>
      </ToastProvider>
    </TooltipProvider>
  )
}
