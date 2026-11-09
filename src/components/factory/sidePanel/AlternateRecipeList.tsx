import { useEffect, useRef, useState } from 'react'
import type { GameData, Recipe } from '../../../data/types'
import { powerInputItemId, type RecipeEntry } from '../../../data/powerFuelGroups'
import { Icon } from '../../Icon'
import { BeyondTag } from './PanelParts'
import { fmtFuelValue } from './fuelFormat'

/** The Alternate recipe list: plain recipes, and one expandable entry per machine with several power (per-fuel) recipes. */
export function AlternateRecipeList({ entries, gameData, available, onSelect }: {
  entries: RecipeEntry[]
  gameData: GameData
  /** Recipes inside the research horizon; null = no limit. Power recipes beyond it are listed and flagged. */
  available: ReadonlySet<string> | null
  onSelect: (recipeId: string) => void
}) {
  const [openMachineId, setOpenMachineId] = useState<string | null>(null)
  const openRef = useRef<HTMLDivElement>(null)
  const isBeyond = (r: Recipe) => !!available && !available.has(r.id)
  // The list sits inside a short scroll area: bring the expanded fuels into view.
  useEffect(() => {
    if (openMachineId) openRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [openMachineId])
  return (
    <>
      {entries.map(e => {
        if (e.kind === 'recipe') {
          return (
            <button
              key={e.recipe.id}
              data-testid="alt-recipe"
              data-recipe-id={e.recipe.id}
              onClick={() => onSelect(e.recipe.id)}
              className="w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 text-gray-300"
            >
              {e.recipe.name}
              {isBeyond(e.recipe) && <BeyondTag />}
            </button>
          )
        }
        const machine = gameData.machines[e.machineId]
        const open = openMachineId === e.machineId
        return (
          <div key={`group:${e.machineId}`}>
            <button
              type="button"
              data-testid="alt-recipe-group"
              data-machine-id={e.machineId}
              data-recipe-count={e.recipes.length}
              aria-expanded={open}
              onClick={() => setOpenMachineId(open ? null : e.machineId)}
              className="w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 text-gray-300 flex items-center gap-1.5"
            >
              {machine?.iconPath && (
                <Icon iconPath={machine.iconPath} alt={machine.name} className="w-5 h-5 object-contain shrink-0" />
              )}
              <span className="flex-1">{machine?.name ?? e.machineId}</span>
              <span className="text-gray-400">({e.recipes.length} recipes)</span>
              <span className="text-gray-400">{open ? '▾' : '▸'}</span>
            </button>
            {open && (
              <div ref={openRef} className="ml-3 border-l border-gray-700 pl-1">
                {e.recipes.map(r => {
                  const fuel = gameData.items[powerInputItemId(r) ?? '']
                  return (
                    <button
                      key={r.id}
                      data-testid="alt-recipe-fuel"
                      data-recipe-id={r.id}
                      data-beyond-horizon={isBeyond(r) ? 'true' : undefined}
                      onClick={() => onSelect(r.id)}
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 text-gray-300 flex items-center gap-1.5"
                    >
                      {fuel?.iconPath && (
                        <Icon iconPath={fuel.iconPath} alt={fuel.name} className="w-5 h-5 object-contain shrink-0" />
                      )}
                      <span className="flex-1">{fuel?.name ?? powerInputItemId(r) ?? r.name}{isBeyond(r) && <BeyondTag />}</span>
                      {fuel?.type === 'item' && fuel.fuelValueKj !== undefined && (
                        <span className="text-gray-400">{fmtFuelValue(fuel.fuelValueKj)}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
