import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { OLLAMA_DEFAULT_HOST } from '@/lib/ai'

export type Theme = 'dark' | 'light'

export interface HistoryEntry {
  id: string
  toolId: string
  toolName: string
  inputName: string
  outputName: string
  outputSize: number
  createdAt: number
  local: boolean
}

export type OllamaStatus = 'unknown' | 'checking' | 'online' | 'offline'

interface AppState {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void

  localMode: boolean
  setLocalMode: (value: boolean) => void
  toggleLocalMode: () => void

  ollamaHost: string
  ollamaModel: string
  ollamaStatus: OllamaStatus
  ollamaError: string | null
  ollamaModels: string[]
  setOllamaHost: (host: string) => void
  setOllamaModel: (model: string) => void
  setOllamaStatus: (status: OllamaStatus, error?: string | null) => void
  setOllamaModels: (models: string[]) => void

  history: HistoryEntry[]
  addHistory: (entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => void
  removeHistory: (id: string) => void
  clearHistory: () => void

  recentTools: string[]
  markToolUsed: (toolId: string) => void

  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void
  historyOpen: boolean
  setHistoryOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),

      localMode: true,
      setLocalMode: (value) => set({ localMode: value }),
      toggleLocalMode: () => set({ localMode: !get().localMode }),

      ollamaHost: OLLAMA_DEFAULT_HOST,
      ollamaModel: 'llama3',
      ollamaStatus: 'unknown',
      ollamaError: null,
      ollamaModels: [],
      setOllamaHost: (host) => set({ ollamaHost: host, ollamaStatus: 'unknown', ollamaError: null }),
      setOllamaModel: (model) => set({ ollamaModel: model }),
      setOllamaStatus: (status, error = null) => set({ ollamaStatus: status, ollamaError: error }),
      setOllamaModels: (models) =>
        set((state) => ({
          ollamaModels: models,
          ollamaModel: models.includes(state.ollamaModel) ? state.ollamaModel : (models[0] ?? state.ollamaModel),
        })),

      history: [],
      addHistory: (entry) =>
        set((state) => ({
          history: [
            {
              ...entry,
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              createdAt: Date.now(),
            },
            ...state.history,
          ].slice(0, 200),
        })),
      removeHistory: (id) => set((state) => ({ history: state.history.filter((item) => item.id !== id) })),
      clearHistory: () => set({ history: [] }),

      recentTools: [],
      markToolUsed: (toolId) =>
        set((state) => ({ recentTools: [toolId, ...state.recentTools.filter((id) => id !== toolId)].slice(0, 6) })),

      settingsOpen: false,
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      historyOpen: false,
      setHistoryOpen: (open) => set({ historyOpen: open }),
    }),
    {
      name: 'folio-app-state',
      partialize: (state) => ({
        theme: state.theme,
        localMode: state.localMode,
        ollamaHost: state.ollamaHost,
        ollamaModel: state.ollamaModel,
        history: state.history,
        recentTools: state.recentTools,
      }),
    },
  ),
)
