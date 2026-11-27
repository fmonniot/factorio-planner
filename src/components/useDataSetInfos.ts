import { useEffect, useState } from 'react'
import { SERVER_DATASETS, type ServerDatasetId } from '../store/dataSets'
import { DataSetInfoSchema } from '../data/schema'
import type { DataSetInfo } from '../data/types'

type Infos = Partial<Record<ServerDatasetId, DataSetInfo>>

// What has been read so far, so a menu opened again shows the versions at once. Only a success is kept: a failed read is tried again.
let cache: Infos = {}
// The reads under way, so the menu and the start screen asking together make one request each.
let pending: Partial<Record<ServerDatasetId, Promise<DataSetInfo | null>>> = {}

/** Forget what was read (tests only). */
export function clearDataSetInfoCache() {
  cache = {}
  pending = {}
}

function read(d: (typeof SERVER_DATASETS)[number]): Promise<DataSetInfo | null> {
  return (pending[d.id] ??= fetch(d.infoUrl)
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then(json => {
      const parsed = DataSetInfoSchema.safeParse(json)
      if (!parsed.success) return null
      cache = { ...cache, [d.id]: parsed.data }
      return parsed.data
    })
    .catch(() => null)
    .finally(() => { delete pending[d.id] }))
}

/**
 * The versions of each bundled data set, read from the small `info.json` beside its bundle, so a player sees what a data
 * set holds before loading it. A data set whose info cannot be read has none: it is shown without.
 */
export function useDataSetInfos(): Infos {
  const [infos, setInfos] = useState<Infos>(cache)
  useEffect(() => {
    let cancelled = false
    for (const d of SERVER_DATASETS) {
      // Also for one already read: another reader may have filled the cache between this render and now.
      const cached = cache[d.id]
      void (cached ? Promise.resolve(cached) : read(d)).then(info => { if (info && !cancelled) setInfos(cache) })
    }
    return () => { cancelled = true }
  }, [])
  return infos
}
