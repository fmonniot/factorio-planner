import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { loadPersistedAppState, initAppStatePersistence } from './store/persistence'
import { loadPersistedUiState, initUiStatePersistence } from './store/uiStore'
import { wireSolver } from './store/solverStore'

// Restore previous session, then start auto-saving.
loadPersistedAppState()
loadPersistedUiState()
const cleanupPersistence = initAppStatePersistence()
const cleanupUi = initUiStatePersistence()
const cleanupSolver = wireSolver()

// Dispose wiring on Vite HMR module replacement (dev-only).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cleanupPersistence()
    cleanupUi()
    cleanupSolver()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
