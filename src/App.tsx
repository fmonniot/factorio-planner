import { useState } from 'react'
import { AppShell } from './components/AppShell'
import { PlansTree } from './components/PlansTree'
import { GoalsPanel } from './components/GoalsPanel'
import { NodesPanel } from './components/NodesPanel'
import { TreeView } from './components/TreeView'
import { TableView } from './components/TableView'
import { SummaryBar, FlowRow } from './components/SummaryBar'

type ViewMode = 'tree' | 'table'

function MainArea() {
  const [mode, setMode] = useState<ViewMode>('tree')

  return (
    <div className="flex flex-col h-full">
      {/* View toggle + flow row */}
      <div className="flex items-center gap-3 mb-3 shrink-0 min-w-0">
        <button
          className={`text-xs px-3 py-1 rounded ${
            mode === 'tree'
              ? 'bg-blue-700 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => setMode('tree')}
        >
          Tree
        </button>
        <button
          className={`text-xs px-3 py-1 rounded ${
            mode === 'table'
              ? 'bg-blue-700 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-gray-200'
          }`}
          onClick={() => setMode('table')}
        >
          Table
        </button>
        <div className="flex-1 min-w-0">
          <FlowRow />
        </div>
      </div>

      {/* View content */}
      <div className="flex-1 overflow-hidden">
        {mode === 'tree' ? <TreeView /> : <TableView />}
      </div>
    </div>
  )
}

function App() {
  return (
    <AppShell
      sidebar={
        <div className="flex flex-col h-full overflow-y-auto">
          <PlansTree />
          <div className="border-t border-gray-700" />
          <GoalsPanel />
          <div className="border-t border-gray-700" />
          <NodesPanel />
        </div>
      }
      main={<MainArea />}
      summary={<SummaryBar />}
    />
  )
}

export default App
