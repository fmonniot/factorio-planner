import { useState } from 'react'
import { createPlan } from '../../store/persistence'
import { useUiStore } from '../../store/uiStore'
import { PlusIcon, UploadIcon } from '../icons'

const BUTTON_CLASS = 'flex items-center justify-center gap-2 px-4 py-2 text-sm bg-gray-800 text-gray-100 border border-gray-600 rounded-lg hover:border-gray-500 hover:bg-gray-700 outline-none focus-visible:ring-1 focus-visible:ring-gray-400'

/**
 * What the production table shows while the loaded data set has no plan, which is where deleting its last plan leaves
 * it. A new plan is made here; an import goes through the workspace menu's flow (see `uiStore.planImportRequest`),
 * which owns the file picker and its warnings.
 */
export function NoPlanScreen() {
  const requestPlanImport = useUiStore(s => s.requestPlanImport)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-1 min-h-0 min-w-0 bg-gray-900">
      <div className="flex flex-col flex-1 min-h-0 min-w-0 bg-gray-900 items-center justify-center gap-4 px-4 text-center">
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-sm text-gray-300">No plan open</h2>
          <p className="text-xs text-gray-400">Start a new plan, or import one you exported before.</p>
          {error && <p role="alert" className="text-xs text-red-400 max-w-md">{error}</p>}
        </div>
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <button
            type="button"
            onClick={() => {
              const result = createPlan()
              setError(result.type === 'error' ? result.message : null)
            }}
            className={BUTTON_CLASS}
          >
            <PlusIcon />New plan
          </button>
          <button type="button" onClick={requestPlanImport} className={BUTTON_CLASS}>
            <UploadIcon />Import plan…
          </button>
        </div>
      </div>
    </div>
  )
}
