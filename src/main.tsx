import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { FactoryShell } from './components/factory/FactoryShell.tsx'
import { initAppStatePersistence } from './store/persistence'
import { loadPersistedUiState, initUiStatePersistence } from './store/uiStore'
import { wireSolver } from './store/solverStore'
import { wireViewer } from './viewer/viewer'

// Restore previous session. The plan itself is loaded per data set, once game
// data has finished loading (see persistence.ts).
loadPersistedUiState()
const cleanupPersistence = initAppStatePersistence()
const cleanupUi = initUiStatePersistence()
const cleanupSolver = wireSolver()
const cleanupViewer = wireViewer()

// Dispose wiring on Vite HMR module replacement (dev-only).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cleanupPersistence()
    cleanupUi()
    cleanupSolver()
    cleanupViewer()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FactoryShell />
  </StrictMode>,
)
