import { customDisplayName, normalizeDatasetId } from './sourceId'

/** The game data sets served with the app. `mod` is the mod the data set is named after, whose version is the data set's version. */
export const SERVER_DATASETS = [
  { id: 'nullius', label: 'Nullius', mod: 'nullius', url: `${import.meta.env.BASE_URL}data/nullius/game-data.json`, infoUrl: `${import.meta.env.BASE_URL}data/nullius/info.json` },
  { id: 'kompetenz-seablock', label: 'Seablock', mod: 'SeaBlock', url: `${import.meta.env.BASE_URL}data/kompetenz-seablock/game-data.json`, infoUrl: `${import.meta.env.BASE_URL}data/kompetenz-seablock/info.json` },
] as const

export type ServerDatasetId = typeof SERVER_DATASETS[number]['id']

export const DATASET_LABELS: Record<string, string> = Object.fromEntries(SERVER_DATASETS.map(d => [d.id, d.label]))

/** Display name of a data set id: the bundled label, the uploaded file name, else the id itself. */
export function dataSetName(sourceId: string): string {
  return DATASET_LABELS[normalizeDatasetId(sourceId)] ?? customDisplayName(sourceId) ?? sourceId
}
