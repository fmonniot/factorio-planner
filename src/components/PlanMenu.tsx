import { useState } from 'react'
import { useGameDataStore } from '../store/gameDataStore'
import { useBlockStore } from '../store/blockStore'
import { usePlansStore, selectActivePlanEntry } from '../store/plansStore'
import type { LoadAppStateResult } from '../store/persistence'
import { switchPlan, createPlan, duplicatePlan, renamePlan, deletePlan, PLAN_NAME_MAX_LENGTH } from '../store/persistence'
import { Modal } from './Modal'
import { MenuButton, ITEM_CLASS } from './MenuButton'

type PlanDialog = null | { kind: 'rename' } | { kind: 'delete' } | { kind: 'error'; message: string }

const SECONDARY_BUTTON = 'text-xs bg-gray-800 text-gray-300 hover:text-gray-100 border border-gray-600 rounded px-3 py-1'

function PlanNameDialog({ initialName, onSubmit, onClose }: { initialName: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initialName)
  const blank = name.trim() === ''
  return (
    <Modal onClose={onClose} className="p-4 w-80 text-sm">
      <form
        onSubmit={e => {
          e.preventDefault()
          if (!blank) onSubmit(name)
        }}
      >
        <h2 className="font-semibold text-gray-100 mb-2">Rename plan</h2>
        <input
          aria-label="Plan name"
          value={name}
          maxLength={PLAN_NAME_MAX_LENGTH}
          autoFocus
          onFocus={e => e.currentTarget.select()}
          onChange={e => setName(e.target.value)}
          className="w-full mb-3 text-xs bg-gray-800 text-gray-100 border border-gray-600 rounded px-2 py-1"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>Cancel</button>
          <button
            type="submit"
            disabled={blank}
            className="text-xs bg-blue-600 text-white hover:bg-blue-500 rounded px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Rename
          </button>
        </div>
      </form>
    </Modal>
  )
}

/**
 * Top-bar menu for the plans of the active data set: switch, create, rename,
 * duplicate, delete. Always mounted so its dialogs outlive the panel, which
 * unmounts when it closes. Actions apply to the active plan.
 */
export function PlanMenu() {
  const status = useGameDataStore(s => s.status)
  const index = usePlansStore(s => s.index)
  const active = usePlansStore(selectActivePlanEntry)
  const activeBlockCount = useBlockStore(s => s.blocks.length)
  const [dialog, setDialog] = useState<PlanDialog>(null)

  if (index === null || !active) return null

  const close = () => setDialog(null)
  // Run a plan action; a refused one (stale plan, changed game data) is shown instead of silently ignored.
  const run = (result: LoadAppStateResult) => setDialog(result.type === 'error' ? { kind: 'error', message: result.message } : null)

  return (
    <>
      <MenuButton
        align="left"
        label={<span className="truncate max-w-40">{active.name}</span>}
        ariaLabel={`Plan: ${active.name}`}
        title="Switch, create, rename, duplicate or delete plans"
        menuLabel="Plans"
        disabled={status.type !== 'loaded'}
      >
        {closeMenu => (
          <>
            <div role="group" aria-label="Plans" className="flex flex-col">
              {index.plans.map(p => {
                const checked = p.id === index.activePlanId
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    title={p.name}
                    tabIndex={-1}
                    className={ITEM_CLASS}
                    onClick={() => { run(switchPlan(p.id)); closeMenu(true) }}
                  >
                    <span aria-hidden className="w-3 inline-block shrink-0">{checked ? '✓' : ''}</span>
                    <span className="truncate max-w-64">{p.name}</span>
                  </button>
                )
              })}
            </div>
            <div role="separator" className="my-1 border-t border-gray-700" />
            <button type="button" role="menuitem" tabIndex={-1} className={ITEM_CLASS} onClick={() => { run(createPlan()); closeMenu(true) }}>
              New plan
            </button>
            <button type="button" role="menuitem" tabIndex={-1} className={ITEM_CLASS} onClick={() => { setDialog({ kind: 'rename' }); closeMenu(false) }}>
              Rename…
            </button>
            <button type="button" role="menuitem" tabIndex={-1} className={ITEM_CLASS} onClick={() => { run(duplicatePlan()); closeMenu(true) }}>
              Duplicate
            </button>
            <button type="button" role="menuitem" tabIndex={-1} className={ITEM_CLASS} onClick={() => { setDialog({ kind: 'delete' }); closeMenu(false) }}>
              Delete…
            </button>
          </>
        )}
      </MenuButton>
      {dialog?.kind === 'rename' && (
        <PlanNameDialog
          initialName={active.name}
          onClose={close}
          onSubmit={name => run(renamePlan(active.id, name))}
        />
      )}
      {dialog?.kind === 'delete' && (
        <Modal onClose={close} className="p-4 w-96 text-sm">
          <h2 className="font-semibold text-gray-100 mb-2">Delete plan &quot;{active.name}&quot;?</h2>
          <p className="text-gray-300 mb-3">
            Its {activeBlockCount} {activeBlockCount === 1 ? 'block' : 'blocks'} will be lost. This cannot be undone; export it first to keep it.
            {index.plans.length === 1 && ' An empty plan replaces it.'}
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
}
