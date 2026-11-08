import { useSearchParams } from 'react-router-dom'
import { TOOLS, type AiTab } from '@/lib/tools'
import { AiWorkspace } from '@/components/ai/AiWorkspace'

const TABS: AiTab[] = ['summarize', 'chat', 'tables', 'translate']

export function AiPage() {
  const [params] = useSearchParams()
  const requested = params.get('tab') as AiTab | null
  const tool = TOOLS.find((entry) => entry.id === 'ai-workspace') ?? TOOLS[TOOLS.length - 1]
  const initialTab = requested && TABS.includes(requested) ? requested : 'summarize'

  return <AiWorkspace tool={tool} initialTab={initialTab} />
}
