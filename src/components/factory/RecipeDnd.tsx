import { createContext, useContext, useState } from 'react'
import type { ReactNode } from 'react'

// ---------------------------------------------------------------------------
// Drag state
// ---------------------------------------------------------------------------

interface DragState {
  nodeId: string
  kind: 'game-recipe' | 'subplan'
  /** subPlanId of the dragged subplan node — used for cycle detection */
  subPlanId?: string
  sourceSubPlanId: string
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface RecipeDndContextValue {
  dragging: DragState | null
  beginDrag: (state: DragState) => void
  endDrag: () => void
}

const RecipeDndContext = createContext<RecipeDndContextValue | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function RecipeDndProvider({ children }: { children: ReactNode }) {
  const [dragging, setDragging] = useState<DragState | null>(null)

  function beginDrag(state: DragState) {
    setDragging(state)
  }

  function endDrag() {
    setDragging(null)
  }

  return (
    <RecipeDndContext.Provider value={{ dragging, beginDrag, endDrag }}>
      {children}
    </RecipeDndContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

// eslint-disable-next-line react-refresh/only-export-components
export function useRecipeDnd(): RecipeDndContextValue {
  const ctx = useContext(RecipeDndContext)
  if (!ctx) throw new Error('useRecipeDnd must be used inside RecipeDndProvider')
  return ctx
}
