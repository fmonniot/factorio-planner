import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { useBlockStore } from '../store/blockStore'
import { hasTechnologies } from '../data/horizon'
import { IconButton } from './IconButton'
import { FlagIcon, XIcon } from './icons'
import { TechIcon } from './TechIcon'
import { TechTreeModal } from './TechTree'
import { Popover } from './factory/Popover'
import type { GameData } from '../data/types'

// ---------------------------------------------------------------------------
// Targets popover
// ---------------------------------------------------------------------------

const LINK_BUTTON = 'text-xs text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline'

function HorizonTargetsPopover({ gameData, onClose, onEdit, ignoreRef }: {
  gameData: GameData
  onClose: (reason: 'escape' | 'outside') => void
  onEdit: () => void
  ignoreRef: RefObject<HTMLElement | null>
}) {
  const targets = useBlockStore(s => s.horizonTechnologyIds)
  const setTargets = useBlockStore(s => s.setHorizonTechnologyIds)
  const editRef = useRef<HTMLButtonElement>(null)
  const valid = targets.filter(id => gameData.technologies[id])

  // Focus the edit button on open, not a remove button (a second Enter would delete a target), and
  // again whenever a target goes away, since that removes the focused button.
  useEffect(() => {
    editRef.current?.focus()
  }, [valid.length])

  return (
    <Popover onClose={onClose} ignoreRef={ignoreRef} className="right-0 top-full w-72 p-3 max-h-[70vh] flex flex-col">
      <div role="dialog" aria-label="Horizon targets" className="text-gray-200 flex flex-col min-h-0">
        <h2 className="text-sm font-semibold text-gray-100 mb-1">Research horizon</h2>
        <p className="text-xs text-gray-400 mb-2">
          {valid.length > 0
            ? 'Pickers only offer what these technologies and their prerequisites unlock.'
            : 'No targets: pickers offer every recipe, machine and module.'}
        </p>
        {valid.length > 0 && (
          <ul data-testid="horizon-target-list" className="flex flex-col gap-1 mb-2 overflow-y-auto min-h-0">
            {valid.map(id => {
              const tech = gameData.technologies[id]
              return (
                <li key={id} className="flex items-center gap-2 bg-gray-950 border border-gray-700 rounded-md px-2 py-1">
                  <TechIcon tech={tech} className="w-5 h-5 text-xs" />
                  <span className="flex-1 min-w-0 truncate text-xs" title={tech.name}>{tech.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${tech.name}`}
                    onClick={() => setTargets(targets.filter(t => t !== id))}
                    className="text-gray-400 hover:text-gray-100"
                  >
                    <XIcon className="w-3.5 h-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <div className="flex items-center justify-between">
          <button ref={editRef} type="button" onClick={onEdit} className={LINK_BUTTON}>
            {valid.length > 0 ? 'Edit horizon…' : 'Choose technologies…'}
          </button>
          {valid.length > 0 && (
            <button type="button" aria-label="Clear horizon" onClick={() => setTargets([])} className={LINK_BUTTON}>
              Clear
            </button>
          )}
        </div>
      </div>
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// HorizonButton — top-bar entry point
// ---------------------------------------------------------------------------

export function HorizonButton() {
  const gameData = useGameDataStore(selectGameData)
  const targets = useBlockStore(s => s.horizonTechnologyIds)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  if (!gameData || !hasTechnologies(gameData)) return null

  const valid = targets.filter(id => gameData.technologies[id])
  const label =
    valid.length === 0 ? 'none'
    : valid.length === 1 ? gameData.technologies[valid[0]].name
    : `${valid.length} technologies`

  return (
    <div ref={wrapperRef} className="relative">
      <IconButton
        label={`Horizon: ${label}`}
        onClick={() => setPopoverOpen(o => !o)}
        hasPopup="dialog"
        expanded={popoverOpen}
        hideTooltip={popoverOpen}
        buttonRef={buttonRef}
        extra={valid.length > 0 && (
          <span
            data-testid="horizon-dot"
            className="absolute top-1.5 right-1.5 w-[7px] h-[7px] rounded-full bg-blue-400 ring-2 ring-gray-900 pointer-events-none"
          />
        )}
      >
        <FlagIcon className="w-[17px] h-[17px]" />
      </IconButton>
      {popoverOpen && (
        <HorizonTargetsPopover
          gameData={gameData}
          ignoreRef={wrapperRef}
          onClose={reason => { setPopoverOpen(false); if (reason === 'escape') buttonRef.current?.focus() }}
          onEdit={() => { setPopoverOpen(false); setTreeOpen(true) }}
        />
      )}
      {treeOpen && <TechTreeModal gameData={gameData} onClose={() => { setTreeOpen(false); buttonRef.current?.focus() }} />}
    </div>
  )
}
