import { useRef, useState, useEffect, useId, useMemo, type ReactNode } from 'react'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { useUiStore } from '../store/uiStore'
import { useBlockStore, selectAppState } from '../store/blockStore'
import { usePlansStore, selectActivePlanEntry } from '../store/plansStore'
import { customSourceId, customFilename, customDisplayName, normalizeDatasetId } from '../store/sourceId'
import { removeCustomPlans, checkPlanImport, importPlanAsNew, exportFileName, exportPlanJson, makeDataSetStamp, dataSetMismatchMessage } from '../store/persistence'
import type { AppState, GameData, PlanDataSetStamp } from '../data/types'
import { Modal } from './Modal'
import { MenuButton, ITEM_CLASS } from './MenuButton'
import { usePlanSection } from './PlanMenu'
import { DefaultMachinesMenuItem } from './DefaultMachinesMenu'
import { Segment, Segmented } from './SegmentedControl'
import { LayersIcon, ChevronDownIcon, DownloadIcon, UploadIcon } from './icons'

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

/** Surface a failed data set switch or upload through the inline status label. */
function reportError(what: string, err: unknown) {
  const detail = err instanceof Error ? err.message : String(err)
  useGameDataStore.setState({ status: { type: 'error', message: `${what}: ${detail}` } })
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
  // Set once the user picks a data set, so a still-pending read of the stored
  // upload does not override the pick.
  const userPickedRef = useRef(false)

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
      if (cancelled || userPickedRef.current || useGameDataStore.getState().status.type !== 'empty') return
      if (entry) {
        importJson(entry.json, customSourceId(entry.filename))
        setSelectedValue(customSourceId(entry.filename))
      }
    }).catch(() => { /* no readable stored upload: stay empty */ })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function selectServerDataset(id: ServerDatasetId) {
    // A radio item fires on the current choice too; reloading would wipe the
    // upload and custom plans. After an error, picking it again retries.
    if (id === selectedValue && useGameDataStore.getState().status.type !== 'error') return
    const dataset = SERVER_DATASETS.find(d => d.id === id)
    if (!dataset) return
    userPickedRef.current = true
    try {
      await clearCustomData()
    } catch (err) {
      reportError('Could not switch data set', err)
      return
    }
    setSelectedValue(id)
    localStorage.setItem(STORAGE_KEY, id)
    removeCustomPlans()
    importUrl(dataset.url, dataset.id)
  }

  async function handleUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    userPickedRef.current = true
    try {
      const json = await file.text()
      await saveCustomData(json, file.name)
    } catch (err) {
      reportError('Could not store the uploaded file', err)
      return
    }
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

const DATASET_LABELS: Record<string, string> = Object.fromEntries(SERVER_DATASETS.map(d => [d.id, d.label]))

/** Display name of a data set id: the bundled label, the uploaded file name, else the id itself. */
function dataSetName(sourceId: string): string {
  return DATASET_LABELS[normalizeDatasetId(sourceId)] ?? customDisplayName(sourceId) ?? sourceId
}

function exportPlan() {
  const appState = selectAppState(useBlockStore.getState())
  const status = useGameDataStore.getState().status
  const json = status.type === 'loaded'
    ? exportPlanJson(appState, makeDataSetStamp(status.sourceId, dataSetName(status.sourceId), status.gameData.factorioVersion))
    : JSON.stringify(appState, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = exportFileName(selectActivePlanEntry(usePlansStore.getState())?.name ?? '', new Date())
  a.click()
  URL.revokeObjectURL(url)
}

type ImportDialog =
  | null
  | {
    kind: 'warning'; fileName: string; appState: AppState; unknownIds: string[]; sourceId: string
    /** The file's stamp: none, naming the loaded data set, or naming another one. */
    stamp: { kind: 'none' } | { kind: 'match' } | { kind: 'mismatch'; stamp: PlanDataSetStamp }
    loadedName: string; loadedVersion: string
  }
  | { kind: 'error'; fileName: string; message: string }

/**
 * The import flow: `startImport` opens the file picker, `dialog` is the
 * warning / error modal. The pick is async, so the owner must stay mounted
 * after the menu closes for the dialog to appear.
 */
function usePlanImport(): { startImport: () => void; dialog: ReactNode } {
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
    } else if (check.unknownIds.length === 0 && !check.dataSetMismatch) {
      // Nothing is overwritten and nothing looks off: no need to ask.
      const result = importPlanAsNew(check.appState, check.sourceId, file.name)
      if (result.type === 'error') setDialog({ kind: 'error', fileName: file.name, message: result.message })
    } else {
      setDialog({
        kind: 'warning',
        fileName: file.name,
        appState: check.appState,
        unknownIds: check.unknownIds,
        sourceId: check.sourceId,
        stamp: check.stamp === null ? { kind: 'none' } : check.dataSetMismatch ? { kind: 'mismatch', stamp: check.stamp } : { kind: 'match' },
        loadedName: dataSetName(current.sourceId),
        loadedVersion: current.gameData.factorioVersion,
      })
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
      {dialog?.kind === 'warning' && (
        <Modal onClose={close} className="p-4 w-96 text-sm">
          <h2 className="font-semibold text-gray-100 mb-2">Import &quot;{dialog.fileName}&quot;?</h2>
          {dialog.stamp.kind === 'mismatch' && (
            <p className="text-amber-400 text-xs mb-3" data-testid="import-data-set-mismatch">
              {dataSetMismatchMessage(dialog.stamp.stamp, dialog.loadedName, dialog.loadedVersion)}{dialog.unknownIds.length === 0 ? ' All its recipes and goal items exist in the loaded game data.' : ''}
            </p>
          )}
          {dialog.unknownIds.length > 0 && (
            <p className="text-amber-400 text-xs mb-3" data-testid="import-unknown-ids">
              {dialog.unknownIds.length} recipe(s) or item(s) are not in the loaded game data and cannot be produced: {dialog.unknownIds.slice(0, 5).join(', ')}{dialog.unknownIds.length > 5 ? '…' : ''}.
              {dialog.stamp.kind === 'none' ? ' The plan may have been made for another data set.' : dialog.stamp.kind === 'mismatch' ? '' : ' The game data may have changed since the plan was exported.'}
            </p>
          )}
          <p className="text-gray-300 mb-3">It will be added as a new plan.</p>
          <div className="flex justify-end gap-2">
            <button
              onClick={close}
              className="text-xs bg-gray-800 text-gray-300 hover:text-gray-100 border border-gray-600 rounded px-3 py-1"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                const result = importPlanAsNew(dialog.appState, dialog.sourceId, dialog.fileName)
                if (result.type === 'error') {
                  setDialog({ kind: 'error', fileName: dialog.fileName, message: result.message })
                } else {
                  close()
                }
              }}
              className="text-xs bg-blue-600 text-white hover:bg-blue-500 rounded px-3 py-1"
            >
              Import anyway
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
// WorkspaceMenu
// ---------------------------------------------------------------------------

const BUILT_IN_MODS = ['base', 'elevated-rails', 'quality', 'space-age']

/** What the menu shows about a loaded data set: the game version and the size of what was exported. */
function gameDataInfo(gd: GameData) {
  const mods = Object.keys(gd.modSet).filter(m => !BUILT_IN_MODS.includes(m))
  return {
    version: gd.factorioVersion,
    modCount: mods.length,
    recipeCount: Object.values(gd.recipes).filter(r => !r.hidden).length,
    mods,
  }
}

/**
 * Top-bar menu for the workspace: the plans of the active data set, the game
 * data set, plan export and import. Always mounted: the data-set auto-load,
 * the hidden upload input and the plan / import dialogs must outlive the
 * panel, which unmounts when it closes. The trigger is never disabled, since
 * the game data group has to stay reachable.
 */
export function WorkspaceMenu() {
  const status = useGameDataStore(s => s.status)
  const {
    selectedValue, uploadedFilename, selectServerDataset, fileInputRef, openUploadPicker, handleUploadChange,
  } = useGameDataSource()
  const { startImport, dialog } = usePlanImport()
  const plans = usePlanSection()
  const gameData = useGameDataStore(selectGameData)
  const rateUnit = useUiStore(s => s.rateUnit)
  const setRateUnit = useUiStore(s => s.setRateUnit)
  const defaultMachinesSignal = useUiStore(s => s.defaultMachinesRequest?.seq)
  const infoId = useId()
  const info = useMemo(() => (gameData ? gameDataInfo(gameData) : null), [gameData])
  const infoText = info
    ? `Factorio ${info.version} · ${info.modCount} ${info.modCount === 1 ? 'mod' : 'mods'} · ${info.recipeCount} ${info.recipeCount === 1 ? 'recipe' : 'recipes'}`
    : null

  const topLine = plans.active?.name ?? 'Choose game data'
  const datasetLabel = DATASET_LABELS[selectedValue] ?? uploadedFilename
  const statusSuffix = status.type === 'loading' ? ', loading' : status.type === 'error' ? ', error loading data' : ''
  const ariaLabel = (plans.active ? `Plan: ${plans.active.name}` : 'Choose game data') + statusSuffix

  return (
    <>
      <MenuButton
        label={
          <>
            <span aria-hidden className="w-6 h-6 rounded bg-gray-700 flex items-center justify-center text-gray-300 shrink-0">
              <LayersIcon />
            </span>
            <span className="flex flex-col items-start leading-tight text-left">
              <span className="text-xs font-semibold text-gray-100 truncate max-w-40">{topLine}</span>
              {status.type === 'loading' && <span className="text-[11px] text-gray-400">Loading…</span>}
              {status.type === 'error' && (
                <span className="text-[11px] text-red-400" title={status.message}>Error loading data</span>
              )}
              {status.type === 'loaded' && datasetLabel && (
                <span className="text-[11px] text-gray-400 truncate max-w-40">{datasetLabel}</span>
              )}
            </span>
          </>
        }
        ariaLabel={ariaLabel}
        title="Plans, game data, export and import"
        menuLabel="Plan and game data"
        align="right"
        triggerClassName="h-9 flex items-center gap-2.5 pl-1.5 pr-2 bg-gray-800 border border-gray-600 hover:border-gray-500 rounded-lg"
        caret={<ChevronDownIcon className="w-3.5 h-3.5 text-gray-400" />}
        panelClassName="w-72"
        openSignal={defaultMachinesSignal}
      >
        {close => (
          <>
            {plans.renderItems(close)}
            {plans.active && <div role="separator" className="my-1 border-t border-gray-700" />}
            <div role="group" aria-label="Game data" className="flex flex-col">
              <div aria-hidden className="text-[11px] uppercase tracking-wide text-gray-400 px-3 pt-1 pb-1">Game data</div>
              {SERVER_DATASETS.map(d => {
                const checked = selectedValue === d.id
                const showInfo = checked && infoText !== null
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={checked}
                    aria-label={d.label}
                    aria-describedby={showInfo ? infoId : undefined}
                    tabIndex={-1}
                    className={ITEM_CLASS}
                    onClick={() => { void selectServerDataset(d.id); close(true) }}
                  >
                    <span className="flex flex-col items-start">
                      <span className="flex items-center gap-1">
                        <span aria-hidden className="w-3 inline-block">{checked ? '✓' : ''}</span>{d.label}
                      </span>
                      {showInfo && info && (
                        <span id={infoId} className="block text-[11px] text-gray-400 pl-4" title={info.mods.join('\n')}>
                          {infoText}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
              {uploadedFilename && (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={true}
                  aria-label={uploadedFilename}
                  aria-describedby={infoText !== null ? infoId : undefined}
                  title={uploadedFilename}
                  tabIndex={-1}
                  className={ITEM_CLASS}
                  onClick={() => close(true)}
                >
                  <span className="flex flex-col items-start min-w-0">
                    <span className="flex items-center gap-1">
                      <span aria-hidden className="w-3 inline-block">✓</span>
                      <span className="truncate max-w-64">{uploadedFilename}</span>
                    </span>
                    {info && (
                      <span id={infoId} className="block text-[11px] text-gray-400 pl-4" title={info.mods.join('\n')}>
                        {infoText}
                      </span>
                    )}
                  </span>
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
            {status.type === 'loaded' && gameData && (
              <>
                <div role="group" aria-label="Rate unit" className="flex items-center px-3 py-1 gap-2">
                  <span aria-hidden className="text-gray-400 mr-auto">Rate unit</span>
                  <Segmented size="sm">
                    {(['sec', 'min'] as const).map(unit => (
                      <Segment
                        key={unit}
                        role="menuitemradio"
                        pressed={rateUnit === unit}
                        tabIndex={-1}
                        onClick={() => setRateUnit(unit)}
                      >
                        /{unit}
                      </Segment>
                    ))}
                  </Segmented>
                </div>
                <DefaultMachinesMenuItem gameData={gameData} />
                <div role="separator" className="my-1 border-t border-gray-700" />
              </>
            )}
            <button
              type="button"
              role="menuitem"
              title="Export plan as JSON"
              tabIndex={-1}
              className={ITEM_CLASS}
              onClick={() => { exportPlan(); close(true) }}
            >
              <DownloadIcon />Export plan
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={status.type !== 'loaded'}
              title="Import a plan from a JSON file as a new plan"
              tabIndex={-1}
              className={ITEM_CLASS}
              onClick={() => { startImport(); close(true) }}
            >
              <UploadIcon />Import plan…
            </button>
          </>
        )}
      </MenuButton>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleUploadChange}
      />
      {plans.dialogs}
      {dialog}
    </>
  )
}
