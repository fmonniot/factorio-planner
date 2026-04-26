import { useState } from 'react'
import type { GameData, BeaconConfig } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { Popover } from './Popover'

// ---------------------------------------------------------------------------
// BeaconPopover
// ---------------------------------------------------------------------------

interface BeaconPopoverProps {
  nodeId: string
  beacon: BeaconConfig
  gameData: GameData
  onClose: () => void
}

export function BeaconPopover({ nodeId, beacon, gameData, onClose }: BeaconPopoverProps) {
  const updateNodeBeacon = useBlockStore(s => s.updateNodeBeacon)

  const modules = Object.values(gameData.modules).sort((a, b) => a.name.localeCompare(b.name))

  function update(patch: Partial<BeaconConfig>) {
    updateNodeBeacon(nodeId, { ...beacon, ...patch })
  }

  return (
    <Popover onClose={onClose} className="w-56 p-2 text-xs space-y-2">
      <div className="text-gray-400">Beacon</div>

      {/* Module */}
      <div className="flex items-center gap-2">
        <span className="text-gray-500 w-16 shrink-0">Module</span>
        <select
          value={beacon.moduleId}
          onChange={e => update({ moduleId: e.target.value })}
          className="flex-1 bg-gray-700 text-gray-200 rounded px-1 py-0.5 border border-gray-600 outline-none text-xs"
        >
          {modules.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      {/* Beacon count */}
      <div className="flex items-center gap-2">
        <span className="text-gray-500 w-16 shrink-0">Count</span>
        <input
          type="number"
          min={0}
          step={1}
          value={beacon.beaconCount}
          onChange={e => {
            const v = parseInt(e.target.value, 10)
            if (isFinite(v) && v >= 0) update({ beaconCount: v })
          }}
          className="w-16 bg-gray-700 text-gray-200 rounded px-1 py-0.5 border border-gray-600 outline-none text-right text-xs"
        />
      </div>

      {/* Modules per beacon */}
      <div className="flex items-center gap-2">
        <span className="text-gray-500 w-16 shrink-0">Per beacon</span>
        <input
          type="number"
          min={1}
          step={1}
          value={beacon.modulesPerBeacon}
          onChange={e => {
            const v = parseInt(e.target.value, 10)
            if (isFinite(v) && v >= 1) update({ modulesPerBeacon: v })
          }}
          className="w-16 bg-gray-700 text-gray-200 rounded px-1 py-0.5 border border-gray-600 outline-none text-right text-xs"
        />
      </div>

      {/* Distribution efficiency */}
      <div className="flex items-center gap-2">
        <span className="text-gray-500 w-16 shrink-0">Efficiency</span>
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={beacon.distributionEfficiency}
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (isFinite(v) && v >= 0 && v <= 1) update({ distributionEfficiency: v })
          }}
          className="w-16 bg-gray-700 text-gray-200 rounded px-1 py-0.5 border border-gray-600 outline-none text-right text-xs"
        />
      </div>

      <button
        onClick={() => { updateNodeBeacon(nodeId, undefined); onClose() }}
        className="w-full text-center text-gray-600 hover:text-red-400 pt-1 border-t border-gray-700"
      >
        Remove beacon
      </button>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Trigger cell
// ---------------------------------------------------------------------------

interface BeaconCellProps {
  nodeId: string
  beacon: BeaconConfig | undefined
  gameData: GameData
}

export function BeaconCell({ nodeId, beacon, gameData }: BeaconCellProps) {
  const [open, setOpen] = useState(false)
  const updateNodeBeacon = useBlockStore(s => s.updateNodeBeacon)

  function enable() {
    const firstModule = Object.values(gameData.modules).sort((a, b) =>
      a.name.localeCompare(b.name),
    )[0]
    if (!firstModule) return
    updateNodeBeacon(nodeId, {
      moduleId: firstModule.id,
      beaconCount: 4,
      modulesPerBeacon: 2,
      distributionEfficiency: 0.5,
    })
    setOpen(true)
  }

  return (
    <div className="relative">
      {beacon ? (
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="text-xs text-gray-300 hover:text-gray-100"
          title="Edit beacon"
          aria-label="Edit beacon"
        >
          ×{beacon.beaconCount}
        </button>
      ) : (
        <button
          type="button"
          onClick={enable}
          className="w-5 h-5 flex items-center justify-center rounded bg-gray-800 text-gray-500 hover:text-gray-200 hover:bg-gray-700 text-xs leading-none"
          title="Add beacon"
          aria-label="Add beacon"
        >
          +
        </button>
      )}

      {open && beacon && (
        <BeaconPopover
          nodeId={nodeId}
          beacon={beacon}
          gameData={gameData}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
