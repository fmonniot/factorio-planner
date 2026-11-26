import { IconButton } from '../IconButton'
import { UndoIcon, RedoIcon } from '../icons'
import { useBlockStore, selectCanUndo, selectCanRedo, selectUndoBlockName, selectRedoBlockName } from '../../store/blockStore'
import { undoHint, redoHint, undoLabel } from './useUndoShortcuts'

/** The Undo and Redo buttons of the top bar: one history across every block. */
export function UndoRedoButtons() {
  const canUndo = useBlockStore(selectCanUndo)
  const canRedo = useBlockStore(selectCanRedo)
  const undoName = useBlockStore(selectUndoBlockName)
  const redoName = useBlockStore(selectRedoBlockName)
  return (
    <>
      <IconButton label={undoLabel('Undo', undoName, undoHint())} onClick={() => useBlockStore.getState().undo()} disabled={!canUndo}>
        <UndoIcon className="w-[17px] h-[17px]" />
      </IconButton>
      <IconButton label={undoLabel('Redo', redoName, redoHint())} onClick={() => useBlockStore.getState().redo()} disabled={!canRedo}>
        <RedoIcon className="w-[17px] h-[17px]" />
      </IconButton>
    </>
  )
}
