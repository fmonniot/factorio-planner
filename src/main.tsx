import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadPersistedPlan, initPlanPersistence } from './store/persistence'
import { wireSolver } from './store/solverStore'

// Restore previous session plan, then start auto-saving.
loadPersistedPlan()
const cleanupPersistence = initPlanPersistence()
const cleanupSolver = wireSolver()

// Dispose wiring on Vite HMR module replacement (dev-only).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cleanupPersistence()
    cleanupSolver()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
