import { GameDataSelector, ExportPlanButton } from './GameDataSelector'
import { BlockTabs } from './BlockTabs'

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
        <ExportPlanButton />
        <GameDataSelector />
      </header>

      {/* Block tabs */}
      <BlockTabs />

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
