import { useRef, useState } from 'react'
import type { GameData, Machine } from '../../../data/types'
import { useBlockStore } from '../../../store/blockStore'
import { useHorizon } from '../../../store/horizon'
import { withinHorizon } from '../../../data/horizon'
import { acceptedFuels, defaultFuel, hasFuelData, resolveRowFuel } from '../../../data/fuel'
import { Icon } from '../../Icon'
import { BeyondTag, Chevron } from './PanelParts'
import { fmtFuelValue } from './fuelFormat'
import { useDismiss } from './useDismiss'

/** The fuel of a burner row: the fuel in use, and a list of the accepted fuels within the research horizon. */
export function FuelPicker({ nodeId, machine, fuelItemId, gameData }: {
  nodeId: string
  machine: Machine | undefined
  fuelItemId: string | undefined
  gameData: GameData
}) {
  const updateNodeFuel = useBlockStore(s => s.updateNodeFuel)
  const horizon = useHorizon(gameData)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, () => setOpen(false))

  const fuel = resolveRowFuel(gameData, machine, fuelItemId)
  const fuelDefault = machine ? defaultFuel(gameData, machine) : undefined
  const fuelOptions = machine ? acceptedFuels(gameData, machine).filter(f => withinHorizon(horizon.itemIds, f.id)) : []
  // A machine with fuel categories whose every accepted fuel is filtered out (burnt result, hidden) is not "no data".
  const hasData = hasFuelData(gameData, machine)

  function select(id: string | undefined) {
    updateNodeFuel(nodeId, id)
    setOpen(false)
  }

  if (!fuel) {
    return (
      <div data-testid="no-fuel-data" className="px-2 py-1.5 text-xs text-gray-500 italic">
        {hasData ? 'No usable fuel for this machine' : 'No fuel data in this data set'}
      </div>
    )
  }

  return (
    <div ref={ref}>
      <button
        type="button"
        data-testid="fuel-button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full bg-gray-800 hover:bg-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
      >
        {fuel.iconPath ? (
          <Icon iconPath={fuel.iconPath} alt="" className="w-7 h-7 object-contain shrink-0" />
        ) : (
          <span className="w-7 h-7 bg-gray-700 rounded flex items-center justify-center text-[9px] text-gray-400 shrink-0">?</span>
        )}
        <span className="flex-1 text-left">
          {fuel.name}
          {!withinHorizon(horizon.itemIds, fuel.id) && <> <BeyondTag /></>}
        </span>
        <span className="text-gray-500 text-xs">{fmtFuelValue(fuel.fuelValueKj ?? 0)}</span>
        <Chevron />
      </button>
      {open && (
        <div className="mt-1 bg-gray-800 border border-gray-700 rounded p-1.5 space-y-1 max-h-48 overflow-y-auto">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 mb-1">Select fuel</div>
          <button
            type="button"
            data-testid="fuel-default"
            onClick={() => select(undefined)}
            className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 ${fuelItemId === undefined ? 'text-teal-400' : 'text-gray-300'}`}
          >
            {fuelDefault ? `Default (${fuelDefault.name})` : 'Default'}
          </button>
          {fuelOptions.map(f => (
            <button
              key={f.id}
              type="button"
              data-testid="fuel-option"
              data-item-id={f.id}
              onClick={() => select(f.id)}
              className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 flex items-center gap-1.5 ${f.id === fuelItemId ? 'text-teal-400' : 'text-gray-300'}`}
            >
              {f.iconPath && <Icon iconPath={f.iconPath} alt="" className="w-5 h-5 object-contain shrink-0" />}
              <span className="flex-1">{f.name}</span>
              <span className="text-gray-500">{fmtFuelValue(f.fuelValueKj ?? 0)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
