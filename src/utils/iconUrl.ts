/**
 * Turns an `iconPath` from game data into a URL prefixed with Vite's BASE_URL
 * so it works under a subpath deploy (GitHub Pages). Bundles hold paths
 * relative to `public/` (`/data/<dataset>/icons/<id>.png`); the `/public/`
 * branch only handles legacy absolute paths (e.g. data loaded from an old export).
 */
export function iconUrl(iconPath: string): string {
  const idx = iconPath.indexOf('/public/')
  const path = idx !== -1 ? iconPath.slice(idx + '/public'.length) : iconPath
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}

export function iconUrlWebp(iconPath: string): string {
  return iconUrl(iconPath).replace(/\.png$/i, '.webp')
}
