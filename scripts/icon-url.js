import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const toPosix = p => p.split(sep).join('/')

/**
 * URL prefix (relative to the web root, i.e. `public/`) of an icons output
 * directory, e.g. "/data/nullius/icons". Never returns an absolute filesystem
 * path: a directory outside `public/` gets a warning and a cwd-relative path.
 */
export function iconPublicUrl(dir, publicDir = DEFAULT_PUBLIC_DIR) {
  const abs = resolve(dir)
  const rel = relative(publicDir, abs)
  if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) return '/' + toPosix(rel)
  process.stderr.write(`[warn] icons dir ${dir} is outside ${publicDir}; iconPaths cannot be made public-relative\n`)
  return toPosix(relative(process.cwd(), abs))
}
