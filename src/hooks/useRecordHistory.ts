import * as React from 'react'
import { useAppStore } from '@/store/useAppStore'
import type { ToolDefinition } from '@/lib/tools'

/** Records a completed operation in the local-only history drawer. */
export function useRecordHistory() {
  const addHistory = useAppStore((state) => state.addHistory)
  const localMode = useAppStore((state) => state.localMode)

  return React.useCallback(
    (
      tool: ToolDefinition,
      inputName: string | { inputName: string; outputName: string; outputSize: number },
      output?: { name: string; size: number },
    ) => {
      const resolvedInput = typeof inputName === 'string' ? inputName : inputName.inputName
      const resolvedOutput =
        typeof inputName === 'string'
          ? output
          : { name: inputName.outputName, size: inputName.outputSize }
      if (!resolvedOutput) return

      addHistory({
        toolId: tool.id,
        toolName: tool.name,
        inputName: resolvedInput,
        outputName: resolvedOutput.name,
        outputSize: resolvedOutput.size,
        local: localMode,
      })
    },
    [addHistory, localMode],
  )
}
