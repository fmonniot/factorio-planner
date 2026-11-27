import { useRef, useState, useEffect, useId, useMemo, type ReactNode } from 'react'
import { TipWrap } from './TipWrap'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { useUiStore } from '../store/uiStore'
import { useBlockStore, selectAppState } from '../store/blockStore'
import { usePlansStore, selectActivePlanEntry } from '../store/plansStore'
import { customSourceId, customFilename, normalizeDatasetId } from '../store/sourceId'
import { removeCustomPlans, checkPlanImport, importPlanAsNew, exportFileName, exportPlanJson, makeDataSetStamp, dataSetMismatchMessage } from '../store/persistence'
import type { AppState, GameData, PlanDataSetStamp } from '../data/types'
import { SERVER_DATASETS, DATASET_LABELS, dataSetName, type ServerDatasetId } from '../store/dataSets'
import { summarizeDataSet, dataSetInfoText } from '../store/dataSetInfo'
import { Modal } from './Modal'
import { MenuButton, ITEM_CLASS } from './MenuButton'
import { useDataSetInfos } from './useDataSetInfos'
import { usePlanSection } from './PlanMenu'
import { DefaultMachinesMenuItem } from './DefaultMachinesMenu'
import { useViewerTriggerName } from '../viewer/viewer'
import { ViewerMenuItem, ViewerStatusDot, ViewerTroubleshootDialog } from './ViewerMenu'
import { LayersIcon, ChevronDownIcon, DownloadIcon, UploadIcon } from './icons'

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

  // The empty table's picker asks for a bundled data set here, since this hook owns the choice.
  const request = useUiStore(s => s.dataSetRequest)
  useEffect(() => {
    if (!request) return
    useUiStore.getState().clearDataSetRequest()
    void selectServerDataset(request.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

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
  // Not revoked at once: WebKit (the desktop app on macOS and Linux) decides on the download asynchronously and reads
  // the blob after `click()` returns, so an immediate revoke can save nothing. A minute is far longer than that takes.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
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

/** What the menu shows about a loaded data set: the game version and the size of what was exported. */
function gameDataInfo(gd: GameData) {
  return summarizeDataSet({
    factorioVersion: gd.factorioVersion,
    modSet: gd.modSet,
    recipeCount: Object.values(gd.recipes).filter(r => !r.hidden).length,
  })
}

/** What the menu says about a data set: its game version and the size of what was exported. */
type DataSetSummary = ReturnType<typeof summarizeDataSet>

/**
 * The menu's Game data group: the bundled data sets, the uploaded file and Upload file…. It lives only while the menu is
 * open, which is when the versions of the data sets that are not loaded are read.
 */
function GameDataGroup({ close, selectedValue, uploadedFilename, loadedInfo, selectServerDataset, openUploadPicker }: {
  close: (returnFocus: boolean) => void
  selectedValue: string
  uploadedFilename: string | null
  /** The loaded data set's own summary, which says more than a data set's info.json can once it is checked. */
  loadedInfo: DataSetSummary | null
  selectServerDataset: (id: ServerDatasetId) => Promise<void>
  openUploadPicker: () => void
}) {
  const infos = useDataSetInfos()
  const idPrefix = useId()
  const uploadInfoId = `${idPrefix}-upload-info`
  return (
    <div role="group" aria-label="Game data" className="flex flex-col">
      <div aria-hidden className="text-[11px] uppercase tracking-wide text-gray-400 px-3 pt-1 pb-1">Game data</div>
      {SERVER_DATASETS.map(d => {
        const checked = selectedValue === d.id
        const read = infos[d.id]
        // The loaded data set's own summary once checked; otherwise what its info.json says.
        const summary = checked && loadedInfo ? loadedInfo : read ? summarizeDataSet(read) : null
        const modVersion = (checked ? loadedInfo?.modSet[d.mod] : undefined) ?? read?.modSet[d.mod]
        const versionId = `${idPrefix}-${d.id}-version`
        const infoId = `${idPrefix}-${d.id}-info`
        return (
          <button
            key={d.id}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            aria-label={d.label}
            aria-describedby={summary ? `${modVersion ? `${versionId} ` : ''}${infoId}` : undefined}
            tabIndex={-1}
            className={ITEM_CLASS}
            onClick={() => { void selectServerDataset(d.id); close(true) }}
          >
            <span className="flex flex-col items-start">
              <span className="flex items-center gap-1">
                <span aria-hidden className="w-3 inline-block">{checked ? '✓' : ''}</span>{d.label}
                {modVersion && <span id={versionId} className="text-[11px] text-gray-400 pl-1">{modVersion}</span>}
              </span>
              {summary && (
                <span id={infoId} className="block text-[11px] text-gray-400 pl-4" data-tip={summary.mods.join('\n')}>
                  {dataSetInfoText(summary)}
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
          aria-describedby={loadedInfo ? uploadInfoId : undefined}
          data-tip={uploadedFilename}
          tabIndex={-1}
          className={ITEM_CLASS}
          onClick={() => close(true)}
        >
          <span className="flex flex-col items-start min-w-0">
            <span className="flex items-center gap-1">
              <span aria-hidden className="w-3 inline-block">✓</span>
              <span className="truncate max-w-64">{uploadedFilename}</span>
            </span>
            {loadedInfo && (
              <span id={uploadInfoId} className="block text-[11px] text-gray-400 pl-4" data-tip={loadedInfo.mods.join('\n')}>
                {dataSetInfoText(loadedInfo)}
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
  )
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
  // The no-plan screen asks for an import here, since this hook owns the flow (file picker, warnings, errors).
  const importRequest = useUiStore(s => s.planImportRequest)
  useEffect(() => {
    if (!importRequest) return
    useUiStore.getState().clearPlanImportRequest()
    startImport()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importRequest])
  const [troubleshooting, setTroubleshooting] = useState(false)
  const viewerName = useViewerTriggerName()
  const plans = usePlanSection()
  const gameData = useGameDataStore(selectGameData)
  const defaultMachinesSignal = useUiStore(s => s.defaultMachinesRequest?.seq)
  const info = useMemo(() => (gameData ? gameDataInfo(gameData) : null), [gameData])

  const topLine = plans.active?.name ?? (plans.noPlan ? 'No plan open' : 'Choose game data')
  const datasetLabel = DATASET_LABELS[selectedValue] ?? uploadedFilename
  const statusSuffix = status.type === 'loading' ? ', loading' : status.type === 'error' ? ', error loading data' : ''
  const ariaLabel = (plans.active ? `Plan: ${plans.active.name}` : plans.noPlan ? 'No plan open' : 'Choose game data') + statusSuffix + (viewerName ? `. ${viewerName}` : '')

  return (
    <>
      <MenuButton
        label={
          <>
            <span aria-hidden className="w-6 h-6 rounded bg-gray-700 flex items-center justify-center text-gray-300 shrink-0">
              <LayersIcon />
            </span>
            {/* Below md only the loading and error lines show: when loaded, both other lines are hidden, so the wrapper goes too. */}
            <span className={`flex-col items-start min-w-0 leading-tight text-left ${status.type === 'loaded' ? 'max-md:hidden md:flex' : 'flex'}`}>
              <span className="max-md:hidden text-xs font-semibold text-gray-100 truncate max-w-full">{topLine}</span>
              {status.type === 'loading' && <span className="text-[11px] text-gray-400 truncate max-w-full">Loading…</span>}
              {status.type === 'error' && (
                <span className="text-[11px] text-red-400 truncate max-w-full" data-tip={status.message}>Error loading data</span>
              )}
              {status.type === 'loaded' && datasetLabel && (
                <span className="max-md:hidden text-[11px] text-gray-400 truncate max-w-full">{datasetLabel}</span>
              )}
            </span>
            <ViewerStatusDot />
          </>
        }
        ariaLabel={ariaLabel}
        title={plans.active ? `${plans.active.name}. Plans, game data, in-game viewer, export and import` : 'Plans, game data, in-game viewer, export and import'}
        menuLabel="Plan and game data"
        align="right"
        triggerClassName="relative flex items-center max-md:h-9 max-md:gap-2.5 max-md:pl-1.5 max-md:pr-2 max-md:bg-gray-800 max-md:border max-md:border-gray-600 max-md:hover:border-gray-500 max-md:rounded-lg md:h-8 md:w-[132px] md:justify-center md:gap-1.5 md:px-1.5 md:rounded-md md:hover:bg-gray-800 md:focus-visible:bg-gray-800 outline-none focus-visible:ring-1 focus-visible:ring-gray-500"
        caret={<ChevronDownIcon className="w-3.5 h-3.5 text-gray-400" />}
        panelClassName="w-72"
        openSignal={defaultMachinesSignal}
      >
        {close => (
          <>
            {plans.renderItems(close)}
            {(plans.active || plans.noPlan) && <div role="separator" className="my-1 border-t border-gray-700" />}
            <GameDataGroup
              close={close}
              selectedValue={selectedValue}
              uploadedFilename={uploadedFilename}
              loadedInfo={info}
              selectServerDataset={selectServerDataset}
              openUploadPicker={openUploadPicker}
            />
            <div role="separator" className="my-1 border-t border-gray-700" />
            <ViewerMenuItem onTroubleshoot={() => { setTroubleshooting(true); close(true) }} />
            <div role="separator" className="my-1 border-t border-gray-700" />
            {status.type === 'loaded' && gameData && (
              <>
                <DefaultMachinesMenuItem gameData={gameData} />
                <div role="separator" className="my-1 border-t border-gray-700" />
              </>
            )}
            <button
              type="button"
              role="menuitem"
              data-tip="Export plan as JSON"
              disabled={plans.noPlan}
              tabIndex={-1}
              className={`${ITEM_CLASS} disabled:pointer-events-none`}
              onClick={() => { exportPlan(); close(true) }}
            >
              <DownloadIcon />Export plan
            </button>
            <TipWrap tip="Import a plan from a JSON file as a new plan" className="flex flex-col">
              <button
                type="button"
                role="menuitem"
                disabled={status.type !== 'loaded'}
                tabIndex={-1}
                className={`${ITEM_CLASS} disabled:pointer-events-none`}
                onClick={() => { startImport(); close(true) }}
              >
                <UploadIcon />Import plan…
              </button>
            </TipWrap>
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
      {troubleshooting && <ViewerTroubleshootDialog onClose={() => setTroubleshooting(false)} />}
    </>
  )
}
