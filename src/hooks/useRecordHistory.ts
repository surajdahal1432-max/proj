import * as React from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { ToolDefinition } from '@/lib/tools'

/** Records a completed operation in the local-only history drawer. */
export function useRecordHistory() {
  const addHistory = useAppStore((state) => state.addHistory)
  const localMode = useAppStore((state) => state.localMode)

  return React.useCallback(
    (tool: ToolDefinition, inputName: string, output: { name: string; size: number }) => {
      addHistory({
        toolId: tool.id,
        toolName: tool.name,
        inputName,
        outputName: output.name,
        outputSize: output.size,
        local: localMode,
      })
    },
    [addHistory, localMode],
  )
}
