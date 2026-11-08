import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FileQuestion } from 'lucide-react'
import { TOOLS, type ToolDefinition } from '@/lib/tools'
import { consumeStashedFiles, dispatchHandoff } from '@/lib/handoff'
import { Button } from '@/components/ui/button'
import { MergeTool, SplitTool, RearrangeTool, ExtractTool, RotateTool } from '@/components/tools/OrganizeTools'
import {
  CompressTool,
  RepairTool,
  OcrTool,
  ConvertFromTool,
  ConvertToTool,
  WebToPdfTool,
} from '@/components/tools/ConvertTools'
import {
  EditorTool,
  SignTool,
  WatermarkTool,
  RedactTool,
  FormsTool,
  EncryptTool,
  DecryptTool,
  CompareTool,
} from '@/components/tools/EditorTools'
import { AiWorkspace } from '@/components/ai/AiWorkspace'

function renderTool(tool: ToolDefinition) {
  switch (tool.kind) {
    case 'merge':
      return <MergeTool tool={tool} />
    case 'split':
      return <SplitTool tool={tool} />
    case 'rearrange':
      return <RearrangeTool tool={tool} />
    case 'extract':
      return <ExtractTool tool={tool} />
    case 'rotate':
      return <RotateTool tool={tool} />
    case 'compress':
      return <CompressTool tool={tool} />
    case 'repair':
      return <RepairTool tool={tool} />
    case 'ocr':
      return <OcrTool tool={tool} />
    case 'convertFrom':
      return <ConvertFromTool tool={tool} />
    case 'convertTo':
      return <ConvertToTool tool={tool} />
    case 'webToPdf':
      return <WebToPdfTool tool={tool} />
    case 'editor':
      return <EditorTool tool={tool} />
    case 'sign':
      return <SignTool tool={tool} />
    case 'watermark':
      return <WatermarkTool tool={tool} />
    case 'redact':
      return <RedactTool tool={tool} />
    case 'forms':
      return <FormsTool tool={tool} />
    case 'encrypt':
      return <EncryptTool tool={tool} />
    case 'decrypt':
      return <DecryptTool tool={tool} />
    case 'compare':
      return <CompareTool tool={tool} />
    case 'ai':
      return <AiWorkspace tool={tool} initialTab={tool.aiTab} />
    default:
      return null
  }
}

export function ToolPage() {
  const { toolId } = useParams<{ toolId: string }>()
  const tool = TOOLS.find((entry) => entry.id === toolId)

  React.useEffect(() => {
    const files = consumeStashedFiles()
    if (!files.length) return
    const timer = window.setTimeout(() => dispatchHandoff(files), 80)
    return () => window.clearTimeout(timer)
  }, [toolId])

  if (!tool) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <FileQuestion className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-lg font-bold">That tool does not exist</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The link may be outdated. Browse the full library to find what you need.
        </p>
        <Button asChild className="mt-4 gap-1.5">
          <Link to="/tools">
            <ArrowLeft className="h-3.5 w-3.5" /> All tools
          </Link>
        </Button>
      </div>
    )
  }

  return <div key={tool.id}>{renderTool(tool)}</div>
}
