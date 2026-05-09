/**
 * Converts the absolute iconPath from game data (which contains the full OS
 * filesystem path including /public/) to a web-relative URL, prefixed with
 * Vite's BASE_URL so it works under a subpath deploy (GitHub Pages).
 */
export function iconUrl(iconPath: string): string {
  const idx = iconPath.indexOf('/public/')
  const path = idx !== -1 ? iconPath.slice(idx + '/public'.length) : iconPath
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}

export function iconUrlWebp(iconPath: string): string {
  return iconUrl(iconPath).replace(/\.png$/i, '.webp')
}
