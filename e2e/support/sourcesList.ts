import type { Locator } from '@playwright/test'

/**
 * Opens the detail of a line of the Sources list (its name button), unless it is open already, and returns the line. The
 * controls of a block line (limit, Make it a product, move, Remove) and the text of every line are in its detail.
 */
export async function openLine(line: Locator): Promise<Locator> {
  const toggle = line.getByTestId('sources-line-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  return line
}
