import { useRef, useState, useEffect } from 'react'
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
// GameDataSelector
// ---------------------------------------------------------------------------

export function GameDataSelector() {
  const status = useGameDataStore(s => s.status)
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

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value
    if (value === 'upload') {
      e.target.value = selectedValue
      fileInputRef.current?.click()
      return
    }
    const dataset = SERVER_DATASETS.find(d => d.id === value)
    if (dataset) {
      setSelectedValue(value)
      localStorage.setItem(STORAGE_KEY, value)
      await clearCustomData()
      removeCustomPlans()
      importUrl(dataset.url, dataset.id)
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const json = await file.text()
    await saveCustomData(json, file.name)
    localStorage.removeItem(STORAGE_KEY)
    setSelectedValue(customSourceId(file.name))
    importFile(file)
  }

  const uploadedFilename = customFilename(selectedValue)

  return (
    <div className="flex items-center gap-2">
      {status.type === 'loading' && (
        <span className="text-xs text-gray-400">Loading…</span>
      )}
      {status.type === 'error' && (
        <span className="text-xs text-red-400" title={status.message}>Error loading data</span>
      )}
      <select
        value={selectedValue}
        onChange={handleChange}
        className="text-xs bg-gray-800 text-gray-200 border border-gray-600 rounded px-2 py-1 outline-none focus:ring-1 focus:ring-blue-500"
        aria-label="Game data source"
      >
        {selectedValue === '' && (
          <option value="" disabled>Select game data…</option>
        )}
        {SERVER_DATASETS.map(d => (
          <option key={d.id} value={d.id}>{d.label}</option>
        ))}
        <option disabled>─────────</option>
        <option value="upload">Upload file…</option>
        {uploadedFilename && (
          <option value={selectedValue}>{uploadedFilename}</option>
        )}
      </select>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ExportPlanButton
// ---------------------------------------------------------------------------

export function ExportPlanButton() {
  function handleExport() {
    const json = JSON.stringify(selectAppState(useBlockStore.getState()), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `factorio-plan-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button
      onClick={handleExport}
      className="text-xs bg-gray-800 text-gray-400 hover:text-gray-100 border border-gray-600 rounded px-2 py-1"
      title="Export plan as JSON"
    >
      Export plan
    </button>
  )
}

// ---------------------------------------------------------------------------
// ImportPlanButton
// ---------------------------------------------------------------------------

type ImportDialog =
  | null
  | { kind: 'confirm'; fileName: string; appState: AppState; unknownIds: string[] }
  | { kind: 'error'; fileName: string; message: string }

const blocksLabel = (n: number) => `${n} ${n === 1 ? 'block' : 'blocks'}`

export function ImportPlanButton() {
  const status = useGameDataStore(s => s.status)
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
    const check = checkPlanImport(json, current.gameData)
    if (check.type === 'error') {
      setDialog({ kind: 'error', fileName: file.name, message: check.message })
    } else {
      setDialog({ kind: 'confirm', fileName: file.name, appState: check.appState, unknownIds: check.unknownIds })
    }
  }

  // The input is created per click and never attached to the DOM, so the same
  // file can be picked twice and the game-data upload input stays the only one.
  function handleClick() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) void handleFile(file)
    }
    input.click()
  }

  const close = () => setDialog(null)

  return (
    <>
      <button
        onClick={handleClick}
        disabled={status.type !== 'loaded'}
        className="text-xs bg-gray-800 text-gray-400 hover:text-gray-100 border border-gray-600 rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
        title="Import a plan from a JSON file (replaces the current plan)"
      >
        Import plan
      </button>
      {dialog?.kind === 'confirm' && (
        <Modal onClose={close} className="p-4 w-96 text-sm">
          <h2 className="font-semibold text-gray-100 mb-2">Import plan</h2>
          <p className="text-gray-300 mb-3">
            Replace the current plan ({blocksLabel(currentBlockCount)}) with &quot;{dialog.fileName}&quot; ({blocksLabel(dialog.appState.blocks.length)})?
            {' '}This cannot be undone; export the current plan first to keep it.
          </p>
          {dialog.unknownIds.length > 0 && (
            <p className="text-amber-400 text-xs mb-3" data-testid="import-unknown-ids">
              {dialog.unknownIds.length} recipe(s) or item(s) are not in the loaded game data and will be ignored: {dialog.unknownIds.slice(0, 5).join(', ')}{dialog.unknownIds.length > 5 ? '…' : ''}. The plan may have been made for another data set.
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
                const result = replacePlan(dialog.appState)
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
}
