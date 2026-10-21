import { useEffect, useMemo, useState } from 'react'
import type { GameData } from '../data/types'
import {
  availableMachinesFor,
  categoryLabel,
  defaultMachineCategories,
  defaultMachineRowCounts,
} from '../data/defaultMachines'
import { useBlockStore } from '../store/blockStore'
import { useHorizon } from '../store/horizon'
import { useUiStore } from '../store/uiStore'
import { ITEM_CLASS, SubmenuItem } from './MenuButton'
import { Icon } from './Icon'

const SECTION_HEADING = 'text-[11px] uppercase tracking-wide text-gray-400 px-3 pt-1 pb-1'

interface FlyoutProps {
  gameData: GameData
}

function DefaultMachinesFlyout({ gameData }: FlyoutProps) {
  const horizon = useHorizon(gameData)
  const blocks = useBlockStore(s => s.blocks)
  const overrides = useBlockStore(s => s.defaultMachineOverrides)
  const setDefaultMachine = useBlockStore(s => s.setDefaultMachine)
  const resetDefaultMachines = useBlockStore(s => s.resetDefaultMachines)

  const counts = useMemo(() => defaultMachineRowCounts(blocks, gameData), [blocks, gameData])
  const categories = useMemo(() => defaultMachineCategories(gameData, horizon), [gameData, horizon])
  const used = categories.filter(c => (counts.get(c) ?? 0) > 0)
  const other = categories.filter(c => (counts.get(c) ?? 0) === 0)
  const hasOverrides = Object.keys(overrides).length > 0

  function renderCategory(category: string) {
    const rows = counts.get(category) ?? 0
    return (
      <div
        key={category}
        role="group"
        aria-label={categoryLabel(category)}
        data-category={category}
        className="flex items-center gap-2 px-3 py-1"
      >
        <span className="w-36 truncate text-gray-200" title={category}>{categoryLabel(category)}</span>
        {rows > 0 && <span className="text-[11px] text-gray-500 shrink-0">{rows} {rows === 1 ? 'row' : 'rows'}</span>}
        <div className="flex flex-wrap gap-1 ml-auto justify-end">
          {availableMachinesFor(gameData, horizon, category).map(m => {
            const checked = m.id === horizon.defaultMachines[category]
            return (
              <button
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                aria-label={m.name}
                title={m.name}
                data-machine-id={m.id}
                tabIndex={-1}
                onClick={() => setDefaultMachine(category, m.id)}
                className={`w-6 h-6 rounded flex items-center justify-center text-[10px] text-gray-300 bg-gray-900 outline-none hover:bg-gray-700 focus:bg-gray-700 ${checked ? 'ring-2 ring-teal-400' : 'ring-1 ring-gray-600'}`}
              >
                {m.iconPath ? (
                  <Icon iconPath={m.iconPath} alt="" className="w-5 h-5 object-contain" />
                ) : (
                  m.name.charAt(0).toUpperCase()
                )}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      {used.length > 0 && (
        <>
          <div aria-hidden className={SECTION_HEADING}>Used in this plan</div>
          {used.map(renderCategory)}
        </>
      )}
      {used.length > 0 && other.length > 0 && <div role="separator" className="my-1 border-t border-gray-700" />}
      {other.length > 0 && (
        <>
          <div aria-hidden className={SECTION_HEADING}>Other categories</div>
          {other.map(renderCategory)}
        </>
      )}
      <div role="separator" className="my-1 border-t border-gray-700" />
      <button
        type="button"
        role="menuitem"
        disabled={!hasOverrides}
        tabIndex={-1}
        className={ITEM_CLASS}
        onClick={resetDefaultMachines}
      >
        Reset all
      </button>
      <div className="px-3 pb-1 text-[11px] text-gray-500">Used by rows set to &lsquo;Default&rsquo;</div>
    </>
  )
}

/**
 * The workspace menu's "Default machines" entry: a flyout with one machine choice per
 * crafting category that has several. Opens by itself, focused on the requested
 * category, when `uiStore.defaultMachinesRequest` is set (see `requestDefaultMachines`).
 */
export function DefaultMachinesMenuItem({ gameData }: FlyoutProps) {
  // Captured once and cleared on mount, so a StrictMode remount does not lose it.
  const [request] = useState(() => useUiStore.getState().defaultMachinesRequest)
  useEffect(() => {
    useUiStore.getState().clearDefaultMachinesRequest()
  }, [])

  const category = request?.category
  return (
    <SubmenuItem
      label="Default machines"
      menuLabel="Default machines"
      panelClassName="w-[26rem]"
      defaultOpen={!!request}
      initialFocus={flyout => {
        if (category === undefined) return null
        const group = Array.from(flyout.querySelectorAll<HTMLElement>('[data-category]')).find(
          el => el.dataset.category === category,
        )
        return group?.querySelector<HTMLElement>('[aria-checked="true"]') ?? null
      }}
    >
      <DefaultMachinesFlyout gameData={gameData} />
    </SubmenuItem>
  )
}
