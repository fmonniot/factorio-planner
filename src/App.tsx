import { AppShell } from './components/AppShell'
import { GoalsPanel } from './components/GoalsPanel'
import { TreeView } from './components/TreeView'
import { SummaryBar } from './components/SummaryBar'

function App() {
  return (
    <AppShell
      sidebar={<GoalsPanel />}
      main={<TreeView />}
      summary={<SummaryBar />}
    />
  )
}

export default App
