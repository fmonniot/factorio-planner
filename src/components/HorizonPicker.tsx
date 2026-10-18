import { useMemo, useState } from 'react'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { useBlockStore } from '../store/blockStore'
import { useAvailableRecipeIds } from '../store/horizon'
import { hasTechnologies } from '../data/horizon'
import { Modal } from './Modal'
import type { GameData } from '../data/types'

// ---------------------------------------------------------------------------
// Horizon modal
// ---------------------------------------------------------------------------

function HorizonModal({ gameData, onClose }: { gameData: GameData; onClose: () => void }) {
  const targets = useBlockStore(s => s.horizonTechnologyIds)
  const setTargets = useBlockStore(s => s.setHorizonTechnologyIds)
  const available = useAvailableRecipeIds()
  const [query, setQuery] = useState('')

  const validTargets = targets.filter(id => gameData.technologies[id])

  const { visibleCount, availableCount } = useMemo(() => {
    const visible = Object.values(gameData.recipes).filter(r => !r.hidden)
    return {
      visibleCount: visible.length,
      availableCount: available ? visible.filter(r => available.has(r.id)).length : visible.length,
    }
  }, [gameData, available])

  const technologies = useMemo(() => {
    const q = query.toLowerCase()
    return Object.values(gameData.technologies)
      .filter(t => !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [gameData, query])

  function toggle(id: string) {
    setTargets(targets.includes(id) ? targets.filter(t => t !== id) : [...targets, id])
  }

  return (
    <Modal onClose={onClose} className="w-[32rem] max-w-[95vw] max-h-[85vh] flex flex-col">
      <div className="p-3 border-b border-gray-700">
        <h2 className="text-lg font-semibold text-amber-200">Research horizon</h2>
        <p className="mt-1 text-xs text-gray-400">
          Only recipes unlocked by these technologies and their prerequisites are offered. Recipes already in the plan keep working.
        </p>
      </div>

      <div className="px-3 py-2 border-b border-gray-700 space-y-2">
        <div className="flex flex-wrap items-center gap-1">
          {validTargets.length === 0 && (
            <span className="text-sm text-gray-500">No limit: every recipe is offered.</span>
          )}
          {validTargets.map(id => {
            const name = gameData.technologies[id].name
            return (
              <span
                key={id}
                data-testid="horizon-target"
                className="inline-flex items-center gap-1 bg-amber-900/40 border border-amber-600 rounded px-2 py-0.5 text-xs text-gray-100"
              >
                {name}
                <button
                  type="button"
                  aria-label={`Remove ${name}`}
                  onClick={() => toggle(id)}
                  className="text-gray-400 hover:text-gray-100 leading-none"
                >×</button>
              </span>
            )
          })}
          <button
            type="button"
            disabled={targets.length === 0}
            onClick={() => setTargets([])}
            className="ml-auto text-xs text-gray-400 hover:text-gray-100 disabled:opacity-40 disabled:hover:text-gray-400"
          >Clear</button>
        </div>
        <div data-testid="horizon-recipe-count" className="text-xs text-gray-400">
          {availableCount} of {visibleCount} recipes available
        </div>
        <input
          type="text"
          placeholder="Search technologies…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full bg-gray-800 text-gray-100 px-3 py-1.5 rounded text-sm placeholder-gray-500 outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="overflow-y-auto flex-1 p-2 space-y-1">
        {technologies.map(t => {
          const isTarget = targets.includes(t.id)
          return (
            <button
              key={t.id}
              type="button"
              data-testid="horizon-tech"
              data-tech-id={t.id}
              aria-pressed={isTarget}
              onClick={() => toggle(t.id)}
              className={`w-full text-left px-2 py-1 rounded border text-sm ${isTarget ? 'bg-amber-900/40 border-amber-600 text-gray-100' : 'bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700'}`}
            >
              {t.name} <span className="text-xs text-gray-500">{t.id}</span>
            </button>
          )
        })}
      </div>

      <div className="p-3 border-t border-gray-700 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-sm bg-gray-800 text-gray-200 hover:text-white border border-gray-600 rounded px-3 py-1"
        >Done</button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// HorizonButton — top-bar entry point
// ---------------------------------------------------------------------------

export function HorizonButton() {
  const gameData = useGameDataStore(selectGameData)
  const targets = useBlockStore(s => s.horizonTechnologyIds)
  const [open, setOpen] = useState(false)

  if (!gameData || !hasTechnologies(gameData)) return null

  const valid = targets.filter(id => gameData.technologies[id])
  const label =
    valid.length === 0 ? 'none'
    : valid.length === 1 ? gameData.technologies[valid[0]].name
    : `${valid.length} technologies`

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs bg-gray-800 text-gray-400 hover:text-gray-100 border border-gray-600 rounded px-2 py-1"
        title="Limit recipes to those unlocked by chosen technologies"
      >
        Horizon: {label}
      </button>
      {open && <HorizonModal gameData={gameData} onClose={() => setOpen(false)} />}
    </>
  )
}
