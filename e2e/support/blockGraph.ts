import { expect, type Locator, type Page } from '@playwright/test'

export async function openGraph(page: Page) {
  await page.getByRole('button', { name: 'Factory overview' }).click()
  await expect(page.getByRole('heading', { name: 'Factory overview' })).toBeVisible()
}

/** Opens the Factory overview on its Areas view (the view is remembered, so it is chosen explicitly). */
export async function openAreas(page: Page) {
  await page.getByRole('button', { name: 'Factory overview' }).click()
  await expect(page.getByRole('heading', { name: 'Factory overview' })).toBeVisible()
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Areas' }).click()
  await expect(page.getByTestId('areas-view')).toBeVisible()
}

/** Chooses a block (or "All blocks") in the Areas view's block picker. */
export async function pickAreasBlock(page: Page, name: string | RegExp) {
  await page.getByTestId('block-picker').click()
  await page.getByRole('listbox', { name: 'Block' }).getByRole('option', { name }).click()
}

export async function closeGraph(page: Page) {
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('heading', { name: 'Factory overview' })).toHaveCount(0)
}

/** An edge's summary chip: by one of its connections, by the consumer's block name, or by both block names. */
export type EdgeRef = { connectionId: string } | { to: string } | { from: string; to: string }

export function edgeSummary(page: Page, ref: EdgeRef): Locator {
  if ('connectionId' in ref) return page.locator(`[data-testid="graph-edge-summary"][data-connection-ids~="${ref.connectionId}"]`)
  const name = 'from' in ref ? new RegExp(` from ${ref.from} to ${ref.to}$`) : new RegExp(` to ${ref.to}$`)
  return page.getByTestId('graph-edge-summary').and(page.getByRole('button', { name }))
}

/**
 * Pin an edge and return the detail strip, where its connections are chips with the limit and remove controls. A chip that
 * is not lit does not take pointer events, so this goes by the keyboard: focus the chip, then Enter. An edge that is
 * already pinned is left alone.
 */
export async function pinEdge(page: Page, ref: EdgeRef): Promise<Locator> {
  const summary = edgeSummary(page, ref)
  await expect(summary).toHaveCount(1)
  if ((await summary.getAttribute('data-pinned')) !== 'true') {
    await summary.focus()
    await page.keyboard.press('Enter')
  }
  await expect(summary).toHaveAttribute('data-pinned', 'true')
  return page.getByTestId('graph-detail')
}

/** How many elements matching `selector` the strip holds, summed over every edge (each is pinned in turn, then unpinned). */
export async function countRows(page: Page, selector: string): Promise<number> {
  const summaries = page.getByTestId('graph-edge-summary')
  const n = await summaries.count()
  let total = 0
  for (let i = 0; i < n; i++) {
    await summaries.nth(i).focus()
    await page.keyboard.press('Enter')
    await expect(summaries.nth(i)).toHaveAttribute('data-pinned', 'true')
    total += await page.getByTestId('graph-detail').locator(selector).count()
    await page.keyboard.press('Escape')
    await expect(summaries.nth(i)).not.toHaveAttribute('data-pinned', 'true')
  }
  return total
}

/** A point on the drawn edge, in page coordinates, where the mouse can point at it. */
export async function pointOnEdge(page: Page, edge: Locator): Promise<{ x: number; y: number }> {
  return edge.evaluate(el => {
    const path = el as unknown as SVGPathElement
    const p = path.getPointAtLength(path.getTotalLength() / 2)
    const m = path.getScreenCTM()!
    return { x: p.x * m.a + p.y * m.c + m.e, y: p.x * m.b + p.y * m.d + m.f }
  })
}

/** Switch the modal between its views, by the pill in the header. */
export async function setView(page: Page, view: 'Graph' | 'Matrix' | 'Power') {
  const pill = page.getByRole('button', { name: view, exact: true })
  await pill.click()
  await expect(pill).toHaveAttribute('aria-pressed', 'true')
}

/** A filled cell of the matrix: by one of its connections, by the consumer's block name, or by both block names. */
export function matrixCell(page: Page, ref: EdgeRef): Locator {
  if ('connectionId' in ref) return page.locator(`[data-testid="matrix-cell"][data-connection-ids~="${ref.connectionId}"]`)
  const name = 'from' in ref ? new RegExp(` from ${ref.from} to ${ref.to}(,|$)`) : new RegExp(` to ${ref.to}(,|$)`)
  return page.getByTestId('matrix-cell').and(page.getByRole('button', { name }))
}

/** Select a cell and return the panel, where its connections are chips with the limit and remove controls. */
export async function selectCell(page: Page, ref: EdgeRef): Promise<Locator> {
  const cell = matrixCell(page, ref)
  await expect(cell).toHaveCount(1)
  if ((await cell.getAttribute('aria-pressed')) !== 'true') await cell.click()
  await expect(cell).toHaveAttribute('aria-pressed', 'true')
  return page.getByTestId('matrix-panel')
}

/** A row of the Power view's list: of a kind (a block, a group or a recipe) whose text holds `name`. */
export function powerRow(page: Page, kind: 'block' | 'group' | 'recipe', name: string): Locator {
  return page.locator(`[data-testid="power-row"][data-kind="${kind}"]`).filter({ hasText: name })
}
