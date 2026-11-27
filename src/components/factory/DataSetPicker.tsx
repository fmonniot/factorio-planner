import { useGameDataStore } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import { SERVER_DATASETS } from '../../store/dataSets'
import { summarizeDataSet, dataSetInfoText } from '../../store/dataSetInfo'
import { useDataSetInfos } from '../useDataSetInfos'

/**
 * What the production table shows while no game data is loaded: the bundled data sets to pick from, with their versions.
 * The pick goes through the workspace menu's data set choice (see `uiStore.dataSetRequest`), so it is the same as
 * picking there.
 */
export function DataSetPicker() {
  const status = useGameDataStore(s => s.status)
  const requestDataSet = useUiStore(s => s.requestDataSet)
  const infos = useDataSetInfos()
  const loading = status.type === 'loading'

  return (
    <div className="flex flex-1 min-h-0 min-w-0 bg-gray-900">
      <div className="flex flex-col flex-1 min-h-0 min-w-0 bg-gray-900 items-center justify-center gap-4 px-4 text-center">
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-sm text-gray-300">Load game data to begin</h2>
          {status.type === 'error' ? (
            <p role="alert" className="text-xs text-red-400 max-w-md">{status.message}</p>
          ) : (
            <p className="text-xs text-gray-400">{loading ? 'Loading…' : 'Choose the game data set your factory is built on.'}</p>
          )}
        </div>
        <div role="group" aria-label="Game data sets" className="flex flex-col gap-2 w-full max-w-sm">
          {SERVER_DATASETS.map(d => {
            const info = infos[d.id]
            const summary = info && summarizeDataSet(info)
            const modVersion = info?.modSet[d.mod]
            const versionId = `data-set-version-${d.id}`
            const infoId = `data-set-info-${d.id}`
            return (
              <button
                key={d.id}
                type="button"
                disabled={loading}
                aria-label={d.label}
                aria-describedby={summary ? `${modVersion ? `${versionId} ` : ''}${infoId}` : undefined}
                onClick={() => requestDataSet(d.id)}
                className="flex flex-col items-start gap-0.5 px-4 py-3 text-left bg-gray-800 border border-gray-600 rounded-lg hover:border-gray-500 hover:bg-gray-700 outline-none focus-visible:ring-1 focus-visible:ring-gray-400 disabled:opacity-50 disabled:pointer-events-none"
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-gray-100">{d.label}</span>
                  {modVersion && <span id={versionId} className="text-xs text-gray-400">{modVersion}</span>}
                </span>
                {/* Keeps its line before the versions arrive, so the list does not jump. */}
                <span id={infoId} className="min-h-4 text-[11px] text-gray-400">{summary && dataSetInfoText(summary)}</span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-gray-400">To use game data exported from your own mods, choose Upload file… in the workspace menu at the top right.</p>
      </div>
    </div>
  )
}
