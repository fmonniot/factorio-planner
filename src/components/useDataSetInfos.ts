import { useEffect, useState } from 'react'
import { SERVER_DATASETS, type ServerDatasetId } from '../store/dataSets'
import { DataSetInfoSchema } from '../data/schema'
import type { DataSetInfo } from '../data/types'

type Infos = Partial<Record<ServerDatasetId, DataSetInfo>>

// What has been read so far, so a menu opened again shows the versions at once. Only a success is kept: a failed read is tried again.
let cache: Infos = {}

/** Forget what was read (tests only). */
export function clearDataSetInfoCache() {
  cache = {}
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
      if (cache[d.id]) continue
      fetch(d.infoUrl)
        .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then(json => {
          const parsed = DataSetInfoSchema.safeParse(json)
          if (!parsed.success) return
          cache = { ...cache, [d.id]: parsed.data }
          if (!cancelled) setInfos(cache)
        })
        .catch(() => { /* shown without its versions */ })
    }
    return () => { cancelled = true }
  }, [])
  return infos
}
