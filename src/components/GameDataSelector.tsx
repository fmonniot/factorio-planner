import { useRef, useState, useEffect } from 'react'
import { useGameDataStore } from '../store/gameDataStore'
import { useBlockStore } from '../store/blockStore'

// ---------------------------------------------------------------------------
// Server-bundled game datasets
// ---------------------------------------------------------------------------

const SERVER_DATASETS = [
  { id: 'nullius', label: 'Nullius', url: '/data/nullius/game-data.json' },
] as const

const STORAGE_KEY = 'factorio-planner:game-data-source'

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
    return localStorage.getItem(STORAGE_KEY) ?? ''
  })

  useEffect(() => {
    const persisted = localStorage.getItem(STORAGE_KEY)
    if (persisted) {
      const dataset = SERVER_DATASETS.find(d => d.id === persisted)
      if (dataset) {
        importUrl(dataset.url)
        return
      }
    }
    loadCustomData().then(entry => {
      if (entry) {
        importJson(entry.json)
        setSelectedValue(`custom:${entry.filename}`)
      }
    })
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
      importUrl(dataset.url)
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const json = await file.text()
    await saveCustomData(json, file.name)
    localStorage.removeItem(STORAGE_KEY)
    setSelectedValue(`custom:${file.name}`)
    importFile(file)
  }

  const customFilename = selectedValue.startsWith('custom:')
    ? selectedValue.slice('custom:'.length)
    : null

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
        {customFilename && (
          <option value={`custom:${customFilename}`}>{customFilename}</option>
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
    const { blocks, activeBlockId } = useBlockStore.getState()
    const json = JSON.stringify({ blocks, activeBlockId }, null, 2)
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
