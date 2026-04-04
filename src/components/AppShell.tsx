import { useRef } from 'react'
import { useGameDataStore } from '../store/gameDataStore'

// ---------------------------------------------------------------------------
// Game data status badge + file import trigger (minimal, Phase 6 adds polish)
// ---------------------------------------------------------------------------

function GameDataHeader() {
  const status = useGameDataStore(s => s.status)
  const importFile = useGameDataStore(s => s.importGameDataFile)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) importFile(file)
    // Reset so the same file can be re-selected if needed.
    e.target.value = ''
  }

  return (
    <div className="flex items-center gap-2">
      {status.type === 'loaded' && (
        <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded">
          Game data loaded
        </span>
      )}
      {status.type === 'error' && (
        <span className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded" title={status.message}>
          Game data error
        </span>
      )}
      {status.type === 'loading' && (
        <span className="text-xs text-gray-400">Loading…</span>
      )}
      <button
        className="text-xs text-gray-400 hover:text-gray-200 underline"
        onClick={() => inputRef.current?.click()}
      >
        {status.type === 'loaded' ? 'Replace' : 'Load game data'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shell layout
// ---------------------------------------------------------------------------

interface AppShellProps {
  sidebar: React.ReactNode
  main: React.ReactNode
  summary: React.ReactNode
}

export function AppShell({ sidebar, main, summary }: AppShellProps) {
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* Header */}
      <header className="h-12 bg-gray-900 border-b border-gray-700 flex items-center px-4 shrink-0 gap-4">
        <span className="font-semibold text-gray-100">Factorio Planner</span>
        <span className="flex-1" />
        <GameDataHeader />
      </header>

      {/* Sidebar + main content */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 bg-gray-900 border-r border-gray-700 flex flex-col overflow-hidden shrink-0">
          {sidebar}
        </aside>
        <main className="flex-1 overflow-auto p-4">
          {main}
        </main>
      </div>

      {/* Summary bar */}
      <div className="shrink-0 bg-gray-900 border-t border-gray-700">
        {summary}
      </div>
    </div>
  )
}
