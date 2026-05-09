/**
 * Converts the absolute iconPath from game data (which contains the full OS
 * filesystem path including /public/) to a web-relative URL.
 */
export function iconUrl(iconPath: string): string {
  const idx = iconPath.indexOf('/public/')
  if (idx !== -1) return iconPath.slice(idx + '/public'.length)
  return iconPath
}

export function iconUrlWebp(iconPath: string): string {
  return iconUrl(iconPath).replace(/\.png$/i, '.webp')
}
