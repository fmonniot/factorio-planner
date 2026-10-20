import { useRef, useState, useEffect, useLayoutEffect, useId, type ReactNode } from 'react'
import { useGameDataStore } from '../store/gameDataStore'
import { useBlockStore, selectAppState } from '../store/blockStore'
import { customSourceId, customFilename, normalizeDatasetId } from '../store/sourceId'
import { removeCustomPlans, checkPlanImport, replacePlan } from '../store/persistence'
import type { AppState } from '../data/types'
import { Modal } from './Modal'

// ---------------------------------------------------------------------------
// Server-bundled game datasets
// ---------------------------------------------------------------------------

const SERVER_DATASETS = [
  { id: 'nullius', label: 'Nullius', url: `${import.meta.env.BASE_URL}data/nullius/game-data.json` },
  { id: 'kompetenz-seablock', label: 'Seablock', url: `${import.meta.env.BASE_URL}data/kompetenz-seablock/game-data.json` },
] as const

export type ServerDatasetId = typeof SERVER_DATASETS[number]['id']

const STORAGE_KEY = 'factorio-planner:game-data-source'

/**
 * The persisted data set id. Older versions stored `kompetenz-seablock/`; that
 * value is normalised and rewritten so it no longer matches nothing.
 */
function readPersistedDatasetId(): string | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === null) return null
  const normalized = normalizeDatasetId(stored)
  if (normalized !== stored) {
    try {
      localStorage.setItem(STORAGE_KEY, normalized)
    } catch {
      // Quota full or storage blocked: the normalised id is still usable.
    }
  }
  return normalized
}

// ---------------------------------------------------------------------------
// IndexedDB helpers for custom uploaded game data
// ---------------------------------------------------------------------------

const IDB_NAME = 'factorio-planner'
const IDB_STORE = 'game-data'
const IDB_KEY = 'custom'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function saveCustomData(json: string, filename: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put({ json, filename }, IDB_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function loadCustomData(): Promise<{ json: string; filename: string } | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function clearCustomData(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(IDB_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ---------------------------------------------------------------------------
// Game data set state
// ---------------------------------------------------------------------------

interface GameDataSource {
  /** '' (none yet), a server data set id, or `customSourceId(filename)`. */
  selectedValue: string
  uploadedFilename: string | null
  selectServerDataset: (id: ServerDatasetId) => Promise<void>
  fileInputRef: React.RefObject<HTMLInputElement | null>
  openUploadPicker: () => void
  handleUploadChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
}

/**
 * Owns the selected data set and the mount-time auto-load. It must live in a
 * component that is always mounted, since the load has to run on page load
 * whether or not the menu is open.
 */
function useGameDataSource(): GameDataSource {
  const importFile = useGameDataStore(s => s.importGameDataFile)
  const importJson = useGameDataStore(s => s.importGameData)
  const importUrl = useGameDataStore(s => s.importGameDataUrl)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedValue, setSelectedValue] = useState<string>(() => {
    return readPersistedDatasetId() ?? ''
  })

  useEffect(() => {
    const persisted = readPersistedDatasetId()
    if (persisted) {
      const dataset = SERVER_DATASETS.find(d => d.id === persisted)
      if (dataset) {
        importUrl(dataset.url, dataset.id)
        return
      }
    }
    let cancelled = false
    loadCustomData().then(entry => {
      // Ignore the stored upload if the user already picked something meanwhile.
      if (cancelled || useGameDataStore.getState().status.type !== 'empty') return
      if (entry) {
        importJson(entry.json, customSourceId(entry.filename))
        setSelectedValue(customSourceId(entry.filename))
      }
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function selectServerDataset(id: ServerDatasetId) {
    // A radio item fires on the current choice too; reloading would wipe the
    // upload and custom plans. After an error, picking it again retries.
    if (id === selectedValue && useGameDataStore.getState().status.type !== 'error') return
    const dataset = SERVER_DATASETS.find(d => d.id === id)
    if (!dataset) return
    setSelectedValue(id)
    localStorage.setItem(STORAGE_KEY, id)
    await clearCustomData()
    removeCustomPlans()
    importUrl(dataset.url, dataset.id)
  }

  async function handleUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const json = await file.text()
    await saveCustomData(json, file.name)
    localStorage.removeItem(STORAGE_KEY)
    setSelectedValue(customSourceId(file.name))
    importFile(file)
  }

  return {
    selectedValue,
    uploadedFilename: customFilename(selectedValue),
    selectServerDataset,
    fileInputRef,
    openUploadPicker: () => fileInputRef.current?.click(),
    handleUploadChange,
  }
}

// ---------------------------------------------------------------------------
// Plan export and import
// ---------------------------------------------------------------------------

function exportPlan() {
  const json = JSON.stringify(selectAppState(useBlockStore.getState()), null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `factorio-plan-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

type ImportDialog =
  | null
  | { kind: 'confirm'; fileName: string; appState: AppState; unknownIds: string[]; sourceId: string }
  | { kind: 'error'; fileName: string; message: string }

const blocksLabel = (n: number) => `${n} ${n === 1 ? 'block' : 'blocks'}`

/**
 * The import flow: `startImport` opens the file picker, `dialog` is the
 * confirm / error modal. The pick is async, so the owner must stay mounted
 * after the menu closes for the dialog to appear.
 */
function usePlanImport(): { startImport: () => void; dialog: ReactNode } {
  const currentBlockCount = useBlockStore(s => s.blocks.length)
  const [dialog, setDialog] = useState<ImportDialog>(null)

  async function handleFile(file: File) {
    let json: string
    try {
      json = await file.text()
    } catch {
      setDialog({ kind: 'error', fileName: file.name, message: 'Could not read the file.' })
      return
    }
    const current = useGameDataStore.getState().status
    if (current.type !== 'loaded') {
      setDialog({ kind: 'error', fileName: file.name, message: 'Load game data before importing a plan.' })
      return
    }
    const check = checkPlanImport(json, current.gameData, current.sourceId)
    if (check.type === 'error') {
      setDialog({ kind: 'error', fileName: file.name, message: check.message })
    } else {
      setDialog({ kind: 'confirm', fileName: file.name, appState: check.appState, unknownIds: check.unknownIds, sourceId: check.sourceId })
    }
  }

  // The input lives in the DOM only while a pick is in flight (some WebKit
  // versions do not fire `change` on a detached input); a fresh one per click
  // lets the same file be picked twice.
  function startImport() {
    document.querySelectorAll('[data-plan-import-input]').forEach(el => el.remove())
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.hidden = true
    input.style.display = 'none'
    input.setAttribute('data-plan-import-input', '')
    input.onchange = () => {
      const file = input.files?.[0]
      input.remove()
      if (file) void handleFile(file)
    }
    input.addEventListener('cancel', () => input.remove())
    document.body.appendChild(input)
    input.click()
  }

  const close = () => setDialog(null)

  const dialogs = (
    <>
      {dialog?.kind === 'confirm' && (
        <Modal onClose={close} className="p-4 w-96 text-sm">
          <h2 className="font-semibold text-gray-100 mb-2">Import plan</h2>
          <p className="text-gray-300 mb-3">
            Replace the current plan ({blocksLabel(currentBlockCount)}) with &quot;{dialog.fileName}&quot; ({blocksLabel(dialog.appState.blocks.length)})?
            {' '}This cannot be undone; export the current plan first to keep it.
          </p>
          {dialog.unknownIds.length > 0 && (
            <p className="text-amber-400 text-xs mb-3" data-testid="import-unknown-ids">
              {dialog.unknownIds.length} recipe(s) or item(s) are not in the loaded game data and cannot be produced: {dialog.unknownIds.slice(0, 5).join(', ')}{dialog.unknownIds.length > 5 ? '…' : ''}. The plan may have been made for another data set.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={close}
              className="text-xs bg-gray-800 text-gray-300 hover:text-gray-100 border border-gray-600 rounded px-3 py-1"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const result = replacePlan(dialog.appState, dialog.sourceId)
                if (result.type === 'error') {
                  setDialog({ kind: 'error', fileName: dialog.fileName, message: result.message })
                } else {
                  close()
                }
              }}
              className="text-xs bg-blue-600 text-white hover:bg-blue-500 rounded px-3 py-1"
            >
              Replace plan
            </button>
          </div>
        </Modal>
      )}
      {dialog?.kind === 'error' && (
        <Modal onClose={close} className="p-4 w-96 text-sm">
          <h2 className="font-semibold text-gray-100 mb-2">Could not import &quot;{dialog.fileName}&quot;</h2>
          <pre className="whitespace-pre-wrap text-red-400 text-xs mb-3">{dialog.message}</pre>
          <div className="flex justify-end">
            <button
              onClick={close}
              className="text-xs bg-gray-800 text-gray-300 hover:text-gray-100 border border-gray-600 rounded px-3 py-1"
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </>
  )

  return { startImport, dialog: dialogs }
}

// ---------------------------------------------------------------------------
// AppMenu
// ---------------------------------------------------------------------------

const ITEM_SELECTOR = '[role^="menuitem"]:not(:disabled)'
const ITEM_CLASS = 'text-left whitespace-nowrap px-3 py-1 text-gray-200 hover:bg-gray-700 focus:bg-gray-700 outline-none flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed'

/**
 * Top-bar menu for app-level entries: game data set, plan export and import.
 * Always mounted: the data-set auto-load, the hidden upload input and the
 * import dialogs must outlive the panel, which unmounts when it closes.
 */
export function AppMenu() {
  const status = useGameDataStore(s => s.status)
  const {
    selectedValue, uploadedFilename, selectServerDataset, fileInputRef, openUploadPicker, handleUploadChange,
  } = useGameDataSource()
  const { startImport, dialog } = usePlanImport()
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  function close(returnFocus: boolean) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!open) return
    const panel = panelRef.current
    if (!panel) return
    const target = panel.querySelector<HTMLElement>('[aria-checked="true"]')
      ?? panel.querySelector<HTMLElement>(ITEM_SELECTOR)
    target?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return

    // Capture phase + preventDefault so Escape does not also clear the
    // summary pane selection (see RowActionsMenu).
    function onKeyDown(e: KeyboardEvent) {
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [])
      const index = items.indexOf(document.activeElement as HTMLElement)
      const focusAt = (i: number) => items[(i + items.length) % items.length]?.focus()
      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          close(true)
          break
        case 'ArrowDown':
          e.preventDefault()
          focusAt(index + 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          focusAt(index < 0 ? -1 : index - 1)
          break
        case 'Home':
          e.preventDefault()
          focusAt(0)
          break
        case 'End':
          e.preventDefault()
          focusAt(-1)
          break
        case 'Tab':
          close(true)
          break
      }
    }

    // Covers trigger and panel, so a trigger click toggles instead of
    // closing and immediately reopening.
    function onPointerDown(e: PointerEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) close(false)
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open])

  return (
    <>
      <div className="flex items-center gap-2">
        {status.type === 'loading' && (
          <span className="text-xs text-gray-400">Loading…</span>
        )}
        {status.type === 'error' && (
          <span className="text-xs text-red-400" title={status.message}>Error loading data</span>
        )}
        <div ref={wrapperRef} className="relative">
          <button
            ref={triggerRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            title="Game data set, plan export and import"
            className="flex items-center gap-1 text-xs bg-gray-800 text-gray-400 hover:text-gray-100 border border-gray-600 rounded px-2 py-1"
            onClick={() => setOpen(o => !o)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true) }
            }}
          >
            Menu<span aria-hidden className="text-[10px] opacity-60">▾</span>
          </button>
          {open && (
            <div
              ref={panelRef}
              id={menuId}
              role="menu"
              aria-label="Plan and game data"
              className="absolute top-full right-0 mt-1 z-50 min-w-48 bg-gray-800 border border-gray-600 rounded shadow-lg py-1 flex flex-col text-xs"
            >
              <div role="group" aria-label="Game data" className="flex flex-col">
                <div aria-hidden className="px-3 pt-1 pb-0.5 text-[10px] uppercase text-gray-500">Game data</div>
                {SERVER_DATASETS.map(d => {
                  const checked = selectedValue === d.id
                  return (
                    <button
                      key={d.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={checked}
                      tabIndex={-1}
                      className={ITEM_CLASS}
                      onClick={() => { void selectServerDataset(d.id); close(true) }}
                    >
                      <span aria-hidden className="w-3 inline-block">{checked ? '✓' : ''}</span>{d.label}
                    </button>
                  )
                })}
                {uploadedFilename && (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={true}
                    title={uploadedFilename}
                    tabIndex={-1}
                    className={ITEM_CLASS}
                    onClick={() => close(true)}
                  >
                    <span aria-hidden className="w-3 inline-block">✓</span>
                    <span className="truncate max-w-64">{uploadedFilename}</span>
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={ITEM_CLASS}
                  onClick={() => { openUploadPicker(); close(true) }}
                >
                  <span aria-hidden className="w-3 inline-block" />Upload file…
                </button>
              </div>
              <div role="separator" className="my-1 border-t border-gray-700" />
              <button
                type="button"
                role="menuitem"
                title="Export plan as JSON"
                tabIndex={-1}
                className={ITEM_CLASS}
                onClick={() => { exportPlan(); close(true) }}
              >
                Export plan
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={status.type !== 'loaded'}
                title="Import a plan from a JSON file (replaces the current plan)"
                tabIndex={-1}
                className={ITEM_CLASS}
                onClick={() => { startImport(); close(true) }}
              >
                Import plan
              </button>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleUploadChange}
        />
      </div>
      {dialog}
    </>
  )
}
