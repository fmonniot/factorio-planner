import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Same fixture as block-connection.spec.ts: block "Plates" (goal iron plate
 * 60/min) and the active block "Gears" (goal iron gear 30/min) which imports
 * 30 plate/min from outside.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')
const PLATES_ID = 'bbbb0001-0000-0000-0000-000000000001'

const plateTile = (page: Page) => page.locator('button[title^="Iron plate — click to forbid"]')
const node = (page: Page, name: string) => page.getByTestId('graph-node').filter({ has: page.getByRole('button', { name, exact: true }) })

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(plateTile(page)).toBeVisible({ timeout: 10000 })
}

async function openGraph(page: Page) {
  await page.getByRole('button', { name: 'Block graph' }).click()
  await expect(page.getByRole('heading', { name: 'Block graph' })).toBeVisible()
}

async function closeGraph(page: Page) {
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('heading', { name: 'Block graph' })).toHaveCount(0)
}

async function connectPlatesToGears(page: Page) {
  // Gears becomes a target only once the Plates solve has landed.
  await node(page, 'Plates').getByTestId('graph-connect-handle').click()
  await expect(page.getByTestId('graph-connect-hint')).toBeVisible()
  await expect(node(page, 'Gears')).toHaveAttribute('data-connect', 'target')
  await node(page, 'Gears').getByRole('button', { name: 'Gears', exact: true }).click()
  await page.getByRole('menuitem', { name: /Iron plate/ }).click()
  await expect(page.getByTestId('graph-edge')).toHaveCount(1)
}

test.describe('block graph', () => {
  test('opens and shows the blocks', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await expect(page.getByTestId('graph-node')).toHaveCount(2)
    await expect(page.getByTestId('graph-edge')).toHaveCount(0)
    await expect(node(page, 'Gears')).toHaveAttribute('data-active', 'true')
  })

  test('creates a connection from the source side', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await connectPlatesToGears(page)

    const edge = page.getByTestId('graph-edge')
    await expect(edge).toHaveAttribute('data-from', PLATES_ID)
    await expect(page.getByTestId('graph-edge-label')).toContainText('30.0')
    await expect(page.getByTestId('graph-edge-label')).toHaveAttribute('data-status', 'ok')

    // Gears (still the active block) now receives the plates.
    await closeGraph(page)
    await expect(page.getByTestId('connection-chip')).toContainText('Plates')
    await expect(page.getByTestId('connection-chip')).toContainText('30.0')
    await expect(plateTile(page)).toHaveCount(0)
  })

  test('rejects a cycle and a connection with nothing left to send', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await connectPlatesToGears(page)

    await node(page, 'Gears').getByTestId('graph-connect-handle').click()
    await expect(node(page, 'Plates')).toHaveAttribute('data-connect', 'blocked')
    await expect(node(page, 'Plates')).toHaveAttribute('title', /cycle/)
    await page.getByRole('button', { name: 'Cancel' }).click()

    await node(page, 'Plates').getByTestId('graph-connect-handle').click()
    await expect(node(page, 'Gears')).toHaveAttribute('data-connect', 'blocked')
  })

  test('removes a connection from its edge', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await connectPlatesToGears(page)

    await page.getByTestId('graph-edge-remove').click()
    await expect(page.getByTestId('graph-edge')).toHaveCount(0)
    await closeGraph(page)
    await expect(page.getByTestId('connection-chip')).toHaveCount(0)
    await expect(plateTile(page)).toContainText('30.0')
  })

  test('clicking a block opens it', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await node(page, 'Plates').getByRole('button', { name: 'Plates', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Block graph' })).toHaveCount(0)
    await expect(page.locator('button[title="Plates"]')).toBeVisible()
  })
})
