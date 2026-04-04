import { AppShell } from './components/AppShell'
import { GoalsPanel } from './components/GoalsPanel'

function App() {
  return (
    <AppShell
      sidebar={<GoalsPanel />}
      main={
        <div className="text-gray-500 text-sm">Tree view coming soon</div>
      }
      summary={
        <div className="p-4 text-gray-500 text-sm">Summary bar coming soon</div>
      }
    />
  )
}

export default App
