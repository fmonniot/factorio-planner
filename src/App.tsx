import { AppShell } from './components/AppShell'
import { GoalsPanel } from './components/GoalsPanel'
import { TreeView } from './components/TreeView'

function App() {
  return (
    <AppShell
      sidebar={<GoalsPanel />}
      main={<TreeView />}
      summary={
        <div className="p-4 text-gray-500 text-sm">Summary bar coming soon</div>
      }
    />
  )
}

export default App
