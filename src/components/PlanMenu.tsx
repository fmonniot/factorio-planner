import { useState, type ReactNode } from 'react'
import { useGameDataStore } from '../store/gameDataStore'
import { useBlockStore } from '../store/blockStore'
import { usePlansStore, selectActivePlanEntry } from '../store/plansStore'
import type { LoadAppStateResult } from '../store/persistence'
import { switchPlan, createPlan, duplicatePlan, renamePlan, deletePlan } from '../store/persistence'
import { Modal } from './Modal'
import { PlanNameDialog } from './PlanNameDialog'
import { ITEM_CLASS } from './MenuButton'
import { PlusIcon, PencilIcon, CopyIcon, TrashIcon } from './icons'
import { TipWrap } from './TipWrap'

type PlanDialog = null | { kind: 'rename' } | { kind: 'delete' } | { kind: 'error'; message: string }

const SECONDARY_BUTTON = 'text-xs bg-gray-800 text-gray-300 hover:text-gray-100 border border-gray-600 rounded px-3 py-1'

const TILE_CLASS = 'flex flex-col items-center gap-0.5 py-1.5 bg-gray-900 border border-gray-700 rounded-md text-[11px] hover:bg-gray-700 focus:bg-gray-700 outline-none disabled:opacity-50 disabled:cursor-not-allowed'

interface PlanSection {
  /** The active plan, or null while there is no plan index (no data set chosen yet) or no plan is open. */
  active: { id: string; name: string } | null
  /** True while the data set has no plan (the last one was deleted): the section then offers only a new plan. */
  noPlan: boolean
  /** The Plans heading, radio group and action tiles, for the workspace panel. */
  renderItems: (close: (returnFocus: boolean) => void) => ReactNode
  /** Rename / delete / error modals; render them outside the panel, which unmounts on close. */
  dialogs: ReactNode
}

/**
 * The plans of the active data set (switch, create, rename, duplicate, delete)
 * as a section of the workspace menu. Actions apply to the active plan. The
 * owner must stay mounted so the dialogs outlive the panel.
 */
export function usePlanSection(): PlanSection {
  const status = useGameDataStore(s => s.status)
  const index = usePlansStore(s => s.index)
  const active = usePlansStore(selectActivePlanEntry)
  const activeBlockCount = useBlockStore(s => s.blocks.length)
  const [dialog, setDialog] = useState<PlanDialog>(null)

  if (index === null) return { active: null, noPlan: false, renderItems: () => null, dialogs: null }
  const noPlan = index.plans.length === 0
  if (!active && !noPlan) return { active: null, noPlan: false, renderItems: () => null, dialogs: null }

  const close = () => setDialog(null)
  const hasPlan = active !== undefined
  // Run a plan action; a refused one (stale plan, changed game data) is shown instead of silently ignored.
  const run = (result: LoadAppStateResult) => setDialog(result.type === 'error' ? { kind: 'error', message: result.message } : null)
  const loaded = status.type === 'loaded'

  function renderItems(closeMenu: (returnFocus: boolean) => void) {
    if (index === null) return null
    return (
      <>
        <div aria-hidden className="text-[11px] uppercase tracking-wide text-gray-400 px-3 pt-2 pb-1">Plans</div>
        {noPlan && <div className="px-3 pb-1 text-xs text-gray-400">No plan open</div>}
        {!noPlan && (
          <div role="group" aria-label="Plans" className="flex flex-col">
            {index.plans.map(p => {
              const checked = p.id === index.activePlanId
              return (
                <TipWrap key={p.id} tip={p.name} when={!loaded} className="flex flex-col">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    disabled={!loaded}
                    data-tip={loaded ? p.name : undefined}
                    tabIndex={-1}
                    className={`${ITEM_CLASS} disabled:pointer-events-none`}
                    onClick={() => { run(switchPlan(p.id)); closeMenu(true) }}
                  >
                    <span aria-hidden className="w-3 inline-block shrink-0">{checked ? '✓' : ''}</span>
                    <span className="truncate max-w-64">{p.name}</span>
                  </button>
                </TipWrap>
              )
            })}
          </div>
        )}
        <div className="grid grid-cols-4 gap-1 px-2 py-1">
          <button type="button" role="menuitem" aria-label="New plan" disabled={!loaded} tabIndex={-1} className={`${TILE_CLASS} text-gray-200`} onClick={() => { run(createPlan()); closeMenu(true) }}>
            <PlusIcon /><span aria-hidden>New</span>
          </button>
          <button type="button" role="menuitem" aria-label="Rename plan" disabled={!loaded || !hasPlan} tabIndex={-1} className={`${TILE_CLASS} text-gray-200`} onClick={() => { setDialog({ kind: 'rename' }); closeMenu(false) }}>
            <PencilIcon /><span aria-hidden>Rename</span>
          </button>
          <button type="button" role="menuitem" aria-label="Duplicate plan" disabled={!loaded || !hasPlan} tabIndex={-1} className={`${TILE_CLASS} text-gray-200`} onClick={() => { run(duplicatePlan()); closeMenu(true) }}>
            <CopyIcon /><span aria-hidden>Duplicate</span>
          </button>
          <button type="button" role="menuitem" aria-label="Delete plan" disabled={!loaded || !hasPlan} tabIndex={-1} className={`${TILE_CLASS} text-red-400`} onClick={() => { setDialog({ kind: 'delete' }); closeMenu(false) }}>
            <TrashIcon /><span aria-hidden>Delete</span>
          </button>
        </div>
      </>
    )
  }

  const dialogs = (
    <>
      {active && dialog?.kind === 'rename' && (
        <PlanNameDialog
          initialName={active.name}
          onClose={close}
          onSubmit={name => run(renamePlan(active.id, name))}
        />
      )}
      {active && dialog?.kind === 'delete' && (
        <Modal onClose={close} className="p-4 w-96 text-sm">
          <h2 className="font-semibold text-gray-100 mb-2">Delete plan &quot;{active.name}&quot;?</h2>
          <p className="text-gray-300 mb-3">
            Its {activeBlockCount} {activeBlockCount === 1 ? 'block' : 'blocks'} will be lost. This cannot be undone; export it first to keep it.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className={SECONDARY_BUTTON}>Cancel</button>
            <button
              type="button"
              onClick={() => run(deletePlan(active.id))}
              className="text-xs bg-red-600 text-white hover:bg-red-500 rounded px-3 py-1"
            >
              Delete plan
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'error' && (
        <Modal onClose={close} className="p-4 w-96 text-sm">
          <h2 className="font-semibold text-gray-100 mb-2">Plan action failed</h2>
          <pre className="whitespace-pre-wrap text-red-400 text-xs mb-3">{dialog.message}</pre>
          <div className="flex justify-end">
            <button type="button" onClick={close} className={SECONDARY_BUTTON}>Close</button>
          </div>
        </Modal>
      )}
    </>
  )

  return { active: active ?? null, noPlan, renderItems, dialogs }
}
