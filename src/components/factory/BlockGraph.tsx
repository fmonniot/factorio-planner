import { useState } from 'react'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { IconButton } from '../IconButton'
import { GraphIcon } from '../icons'
import { BlockGraphModal } from '../lazyModals'

// ---------------------------------------------------------------------------
// BlockGraphButton — top-bar entry point
// ---------------------------------------------------------------------------

export function BlockGraphButton() {
  const gameData = useGameDataStore(selectGameData)
  const [open, setOpen] = useState(false)

  if (!gameData) return null

  return (
    <>
      <IconButton label="Factory overview" onClick={() => setOpen(true)}>
        <GraphIcon className="w-[17px] h-[17px]" />
      </IconButton>
      {open && <BlockGraphModal gameData={gameData} onClose={() => setOpen(false)} />}
    </>
  )
}
