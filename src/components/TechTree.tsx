import { useState } from 'react'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { hasTechnologies } from '../data/horizon'
import { IconButton } from './IconButton'
import { FlaskIcon } from './icons'
import { TechTreeModal } from './lazyModals'

// ---------------------------------------------------------------------------
// TechTreeButton — top-bar entry point
// ---------------------------------------------------------------------------

export function TechTreeButton() {
  const gameData = useGameDataStore(selectGameData)
  const [open, setOpen] = useState(false)

  if (!gameData || !hasTechnologies(gameData)) return null

  return (
    <>
      <IconButton label="Tech tree" onClick={() => setOpen(true)}>
        <FlaskIcon className="w-[17px] h-[17px]" />
      </IconButton>
      {open && <TechTreeModal gameData={gameData} onClose={() => setOpen(false)} />}
    </>
  )
}
