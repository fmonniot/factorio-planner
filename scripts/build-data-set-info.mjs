// Writes public/data/<data set>/info.json for every bundled data set (see scripts/data-set-info.js).
// Run it after exporting or patching a bundle: `npm run data-info`.
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { dataSetInfoOf } from './data-set-info.js'

const root = join(import.meta.dirname, '..', 'public', 'data')

for (const name of readdirSync(root)) {
  const bundlePath = join(root, name, 'game-data.json')
  if (!existsSync(bundlePath)) continue
  writeFileSync(join(root, name, 'info.json'), JSON.stringify(dataSetInfoOf(JSON.parse(readFileSync(bundlePath, 'utf8'))), null, 2) + '\n')
  console.log(`wrote public/data/${name}/info.json`)
}
