import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { loadPlanFixture } from './support/loadPlan'
import { menuTrigger, openAppMenu, pickPlanFile, selectDataset } from './support/appMenu'
import { fixtureMessage, startFakeBridge, type FakeBridge } from './support/fakeBridge'

const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')
const schema = JSON.parse(readFileSync(path.resolve('contract/snapshot.schema.json'), 'utf8')) as object

const NO_GAME = fixtureMessage('status-no-mod')

const connectedStatus = (extra: Record<string, unknown> = {}) => ({
  type: 'status',
  protocol: 1,
  bridge: '0.1.0',
  mod: { link: 'connected', protocol: 1, stored: 'a'.repeat(16), unknownIds: 0 },
  ...extra,
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const viewerItem = (page: Page) => page.getByRole('menuitem', { name: /^In-game viewer/ })
const viewerDialog = (page: Page) => page.getByRole('dialog', { name: 'In-game viewer' })
const badge = (page: Page) => viewerDialog(page).getByTestId('viewer-badge')
const troubleshootDialog = (page: Page) => page.getByRole('dialog', { name: 'Troubleshoot the in-game viewer' })

async function openApp(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.getByTestId('block-tab')).toHaveCount(2)
}

async function openViewer(page: Page) {
  await openAppMenu(page)
  if (!(await viewerDialog(page).isVisible())) await viewerItem(page).click()
  await expect(viewerDialog(page)).toBeVisible()
  return viewerDialog(page)
}

/** Types the bridge address, switches the connection on and leaves the dialog open. */
async function switchOn(page: Page, bridge: FakeBridge) {
  await setAddress(page, bridge.url)
  await (await openViewer(page)).getByLabel('Connect to the bridge').check()
}

/** Types the bridge address through the flyout's Change link. */
async function setAddress(page: Page, url: string) {
  const dialog = await openViewer(page)
  await dialog.getByRole('button', { name: 'Change' }).click()
  await dialog.getByLabel('Bridge address').fill(url)
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.getByTestId('viewer-address')).toHaveText(url)
}

/** Opens the Troubleshoot dialog from the flyout (which closes the menu behind it). */
async function openTroubleshoot(page: Page) {
  await (await openViewer(page)).getByRole('button', { name: 'Troubleshoot…' }).click()
  await expect(troubleshootDialog(page)).toBeVisible()
  return troubleshootDialog(page)
}

/** The connection says nothing on the workspace menu's trigger. */
async function expectViewerOff(page: Page) {
  await expect(menuTrigger(page)).not.toHaveAccessibleName(/In-game viewer/)
  await expect(page.getByTestId('viewer-dot')).toHaveCount(0)
}

async function expectBadge(page: Page, label: string, timeout = 5000) {
  await openViewer(page)
  await expect(badge(page)).toHaveText(label, { timeout })
}

/** Edits the plan: a goal of 250 for the first item in the picker. */
async function addGoal(page: Page) {
  const overlay = page.locator('.fixed.inset-0')
  await page.getByTitle('Add product').click()
  await overlay.getByLabel('Amount').fill('250')
  await overlay.locator('[data-testid="item-slot"]').first().click()
  await expect(overlay).not.toBeVisible()
}

let bridge: FakeBridge
test.beforeEach(async () => { bridge = await startFakeBridge(NO_GAME) })
test.afterEach(async () => { await bridge.stop().catch(() => {}) })

// ---------------------------------------------------------------------------

test.describe('In-game viewer connection', () => {
  test('is off by default and opens no connection', async ({ page }) => {
    // Point the saved address at the fake bridge: only switching the connection on may reach it.
    await page.addInitScript(url => localStorage.setItem('factorio-planner:ui', JSON.stringify({ bridgeUrl: url, summaryCollapsed: false })), bridge.url)
    await openApp(page)
    await expectViewerOff(page)
    await addGoal(page)
    await page.waitForTimeout(500)
    expect(bridge.connections).toBe(0)
  })

  test('connects, announces the plan, and shows no game', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expectBadge(page, 'Bridge, no game')
    await expect.poll(() => bridge.connections).toBe(1)
    await expect.poll(() => bridge.announces().length).toBe(1)
    expect(bridge.announces()[0].protocol).toBe(1)
    expect(bridge.snapshots()).toHaveLength(0)
    await expect(menuTrigger(page)).toHaveAccessibleName(/\. In-game viewer: Bridge, no game$/)
  })

  test('the badge follows the bridge status', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expectBadge(page, 'Bridge, no game')

    bridge.broadcast(connectedStatus())
    await expectBadge(page, 'Connected')

    bridge.broadcast(fixtureMessage('status-delivered'))
    await expectBadge(page, 'Data set mismatch')
    await expect(await openTroubleshoot(page)).toContainText('does not know 2')
    await troubleshootDialog(page).getByRole('button', { name: 'Done' }).click()

    bridge.broadcast(fixtureMessage('status-stalled'))
    await expectBadge(page, 'Game quiet')

    bridge.broadcast(fixtureMessage('status-mismatch'))
    await expectBadge(page, 'Mod version mismatch')

    bridge.broadcast(connectedStatus())
    await expectBadge(page, 'Connected')
  })

  test('another protocol version: says so and sends nothing', async ({ page }) => {
    bridge.initialStatus = { ...NO_GAME, protocol: 2 }
    await openApp(page)
    await switchOn(page, bridge)
    await expectBadge(page, 'Version mismatch')
    await expect(viewerDialog(page).getByRole('button', { name: 'Send to Factorio' })).toBeDisabled()
    await expect(await openTroubleshoot(page)).toContainText('Update the planner and the bridge together')
    await troubleshootDialog(page).getByRole('button', { name: 'Done' }).click()
    await addGoal(page)
    await page.waitForTimeout(500)
    expect(bridge.received).toHaveLength(0)
    expect(bridge.connections).toBe(1)
  })

  test('Send to Factorio sends a snapshot whose id is the hash of its bytes', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expect.poll(() => bridge.announces().length).toBe(1)
    const announced = bridge.announces()[0].id

    await viewerDialog(page).getByRole('button', { name: 'Send to Factorio' }).click()
    await expect.poll(() => bridge.snapshots().length).toBe(1)
    const sent = bridge.snapshots()[0]
    expect(sent.idMatchesBytes).toBe(true)
    expect(sent.id).toBe(announced)

    const snapshot = JSON.parse(sent.bytes.toString('utf8')) as { v: number; blocks: { name: string }[] }
    const validate = new Ajv2020({ strict: false }).compile(schema)
    expect(validate(snapshot), JSON.stringify(validate.errors)).toBe(true)
    expect(snapshot.v).toBe(1)
    expect(snapshot.blocks.map(b => b.name)).toEqual(['Plates', 'Gears'])
  })

  test('without auto-send an edit is announced, not sent', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expect.poll(() => bridge.announces().length).toBe(1)
    await viewerDialog(page).getByRole('button', { name: 'Send to Factorio' }).click()
    await expect.poll(() => bridge.snapshots().length).toBe(1)
    bridge.clear()

    await addGoal(page)
    await expect.poll(() => bridge.announces().length).toBe(1)
    expect(bridge.announces()[0].id).not.toBe('')
    await page.waitForTimeout(300)
    expect(bridge.snapshots()).toHaveLength(0)
  })

  test('with auto-send an edit is sent after the solve', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expect.poll(() => bridge.announces().length).toBe(1)
    await viewerDialog(page).getByLabel('Send after every change').check()
    bridge.clear()

    await addGoal(page)
    await expect.poll(() => bridge.snapshots().length).toBe(1)
    const sent = bridge.snapshots()[0]
    expect(sent.idMatchesBytes).toBe(true)
    expect(bridge.announces()).toHaveLength(0)
    expect(JSON.parse(sent.bytes.toString('utf8')).blocks).toHaveLength(2)
  })

  test('the address and auto-send persist, the connection does not', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await viewerDialog(page).getByLabel('Send after every change').check()
    await expect.poll(() => bridge.connections).toBe(1)
    await page.reload()
    await expect(page.getByTestId('block-tab').first()).toBeVisible()
    await expectViewerOff(page)
    const dialog = await openViewer(page)
    await expect(dialog.getByTestId('viewer-address')).toHaveText(bridge.url)
    await expect(dialog.getByLabel('Send after every change')).toBeChecked()
    await page.waitForTimeout(300)
    expect(bridge.connections).toBe(1)
  })

  test('switching off closes the connection and stops the retries', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expectBadge(page, 'Bridge, no game')
    await viewerDialog(page).getByLabel('Connect to the bridge').uncheck()
    await expectViewerOff(page)
    bridge.clear()
    await addGoal(page)
    await page.waitForTimeout(300)
    expect(bridge.received).toHaveLength(0)
  })
})

test.describe('In-game viewer in the workspace menu', () => {
  test('the entry shows the status and the trigger carries a dot', async ({ page }) => {
    await openApp(page)
    const menu = await openAppMenu(page)
    await expect(viewerItem(page)).toContainText('Off')
    await page.keyboard.press('Escape')
    await expectViewerOff(page)

    await switchOn(page, bridge)
    await expectBadge(page, 'Bridge, no game')
    await expect(viewerItem(page)).toContainText('No game')
    await expect(page.getByTestId('viewer-dot')).toBeVisible()
    await expect(menuTrigger(page)).toHaveAccessibleName(/^Plan: .*\. In-game viewer: Bridge, no game$/)
    await expect(menu).toBeVisible()
  })

  test('the flyout opens from the keyboard and Escape steps back to the entry', async ({ page }) => {
    await openApp(page)
    await menuTrigger(page).focus()
    await page.keyboard.press('Enter')
    await viewerItem(page).focus()
    await page.keyboard.press('ArrowRight')
    await expect(viewerDialog(page).getByRole('switch', { name: 'Connect to the bridge' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(viewerItem(page)).toBeFocused()
    await expect(viewerDialog(page)).toBeHidden()
  })

  test('Troubleshoot walks the bridge, the game and the plan', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    const dialog = await openTroubleshoot(page)
    await expect(dialog.getByTestId('troubleshoot-bridge')).toContainText('Running')
    const game = dialog.getByTestId('troubleshoot-game')
    await expect(game).toContainText('No game answered')
    await expect(game).toContainText('--enable-lua-udp 34198')
    await expect(dialog.getByTestId('troubleshoot-plan')).toContainText('Waiting')

    // The planner keeps listening while the dialog is open.
    bridge.broadcast(connectedStatus())
    await expect(game).toContainText('Answering')
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(troubleshootDialog(page)).toBeHidden()
  })

  test('Troubleshoot shows the game port the bridge reports', async ({ page }) => {
    const custom = await startFakeBridge(fixtureMessage('status-game-port'))
    try {
      await openApp(page)
      await switchOn(page, custom)
      await expectBadge(page, 'Bridge, no game')
      const game = (await openTroubleshoot(page)).getByTestId('troubleshoot-game')
      await expect(game).toContainText('--enable-lua-udp 40000')
      await expect(game).not.toContainText('34198')
    } finally {
      await custom.stop()
    }
  })

  test('Troubleshoot falls back to 34198 for a bridge that does not report a port', async ({ page }) => {
    bridge.initialStatus = { type: 'status', protocol: 1, bridge: '0.1.0', mod: { link: 'none' } }
    await openApp(page)
    await switchOn(page, bridge)
    const game = (await openTroubleshoot(page)).getByTestId('troubleshoot-game')
    await expect(game).toContainText('--enable-lua-udp 34198')

    bridge.broadcast({ ...NO_GAME, gamePort: 41000 })
    await expect(game).toContainText('--enable-lua-udp 41000')
  })

  test('changing the address while connected reconnects to the new bridge', async ({ page }) => {
    const other = await startFakeBridge(NO_GAME)
    try {
      await openApp(page)
      await switchOn(page, bridge)
      await expect.poll(() => bridge.connections).toBe(1)
      await setAddress(page, other.url)
      await expect.poll(() => other.connections).toBe(1)
      await expectBadge(page, 'Bridge, no game')
    } finally {
      await other.stop()
    }
  })
})

test.describe('In-game viewer connection, after switching off', () => {
  test('announces only the plan edited while it was off, never the stale one', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expect.poll(() => bridge.announces().length).toBe(1)
    const stale = bridge.announces()[0].id

    await viewerDialog(page).getByLabel('Connect to the bridge').uncheck()
    await expectViewerOff(page)
    await addGoal(page)
    bridge.clear()

    await (await openViewer(page)).getByLabel('Connect to the bridge').check()
    await expect.poll(() => bridge.announces().length).toBeGreaterThan(0)
    await page.waitForTimeout(500)
    expect(bridge.announces().map(a => a.id)).toHaveLength(1)
    expect(bridge.announces()[0].id).not.toBe(stale)
  })
})

test.describe('In-game viewer errors', () => {
  test('says so when the bridge sends a status it cannot read, and does not hang on Connecting', async ({ page }) => {
    await bridge.stop()
    await bridge.restart({ type: 'status', protocol: 1, mod: 'oops' })
    await openApp(page)
    await switchOn(page, bridge)
    await expectBadge(page, 'Unreadable status')
    await expect(viewerDialog(page).getByRole('button', { name: 'Send to Factorio' })).toBeDisabled()
    // A readable status recovers.
    bridge.broadcast(NO_GAME)
    await expectBadge(page, 'Bridge, no game')
  })

  test('the alert about a refused plan goes away when the bridge does', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expect.poll(() => bridge.announces().length).toBe(1)
    bridge.answerWithError = 'too-large'
    await viewerDialog(page).getByRole('button', { name: 'Send to Factorio' }).click()
    await expect(viewerDialog(page).getByTestId('viewer-notice')).toContainText('too large for the in-game viewer')
    await bridge.stop()
    await expectBadge(page, 'No bridge', 10_000)
    await expect(viewerDialog(page).getByTestId('viewer-notice')).toHaveCount(0)
  })

  test('shows a bridge error in plain words and forgets the refused bytes', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expect.poll(() => bridge.announces().length).toBe(1)

    bridge.answerWithError = 'bad-envelope'
    await viewerDialog(page).getByRole('button', { name: 'Send to Factorio' }).click()
    await expect.poll(() => bridge.snapshots().length).toBe(1)
    await expect(viewerDialog(page).getByTestId('viewer-notice')).toContainText('could not read the snapshot')
    // Nothing is resent by itself.
    await page.waitForTimeout(300)
    expect(bridge.snapshots()).toHaveLength(1)

    // A restart gives an empty bridge, and the refused bytes are not restored onto it.
    bridge.answerWithError = null
    await bridge.stop()
    await bridge.restart(NO_GAME)
    await expect.poll(() => bridge.connections, { timeout: 10_000 }).toBe(2)
    await expectBadge(page, 'Bridge, no game', 12_000)
    await expect.poll(() => bridge.announces().length).toBeGreaterThan(1)
    expect(bridge.snapshots()).toHaveLength(1)
  })

  test('says the bridge refused a plan as too large', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expect.poll(() => bridge.announces().length).toBe(1)
    bridge.answerWithError = 'too-large'
    await viewerDialog(page).getByRole('button', { name: 'Send to Factorio' }).click()
    await expect(viewerDialog(page).getByTestId('viewer-notice')).toContainText('too large for the in-game viewer')
  })

  test('a plan above the size limit is announced, not sent, and the player is told', async ({ page }) => {
    // Block names go into the snapshot, so two long names make a snapshot above 8,000,000 bytes.
    const plan = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { blocks: { name: string }[] }
    for (const block of plan.blocks) block.name = 'x'.repeat(4_200_000)
    await page.goto('/')
    await selectDataset(page, 'Nullius')

    await switchOn(page, bridge)
    await expectBadge(page, 'Bridge, no game')
    await viewerDialog(page).getByLabel('Send after every change').check()
    await page.keyboard.press('Escape')
    bridge.clear()

    await pickPlanFile(page, { name: 'huge.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) })
    await expect.poll(() => bridge.announces().length, { timeout: 20_000 }).toBeGreaterThan(0)
    const dialog = await openViewer(page)
    await expect(dialog.getByTestId('viewer-notice')).toContainText('too large for the in-game viewer')
    // The import may pass through a small plan first (auto-send is on); the large one is never sent.
    const sentSizes = () => bridge.snapshots().map(s => s.bytes.length)
    expect(Math.max(0, ...sentSizes())).toBeLessThan(1_000_000)
    // Send announces too, it never sends the bytes.
    const announced = bridge.announces().length
    await dialog.getByRole('button', { name: 'Send to Factorio' }).click()
    await expect.poll(() => bridge.announces().length).toBe(announced + 1)
    expect(Math.max(0, ...sentSizes())).toBeLessThan(1_000_000)
  })
})

test.describe('In-game viewer reconnection', () => {
  test('retries until the bridge is there', async ({ page }) => {
    const down = await startFakeBridge(NO_GAME)
    const url = down.url
    await down.stop()
    await openApp(page)
    await setAddress(page, url)
    await (await openViewer(page)).getByLabel('Connect to the bridge').check()
    await expectBadge(page, 'No bridge')
    await expect(await openTroubleshoot(page)).toContainText('uBlock')
    await troubleshootDialog(page).getByRole('button', { name: 'Done' }).click()

    const back = await startFakeBridge(NO_GAME, down.port)
    try {
      await expectBadge(page, 'Bridge, no game', 12_000)
      expect(back.connections).toBe(1)
    } finally {
      await back.stop()
    }
  })

  test('restores the last bytes sent onto an empty bridge after a restart', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expect.poll(() => bridge.announces().length).toBe(1)
    await viewerDialog(page).getByRole('button', { name: 'Send to Factorio' }).click()
    await expect.poll(() => bridge.snapshots().length).toBe(1)
    const first = bridge.snapshots()[0]

    await bridge.stop()
    await expectBadge(page, 'No bridge')
    bridge.clear()
    await bridge.restart(NO_GAME)

    await expect.poll(() => bridge.snapshots().length, { timeout: 12_000 }).toBe(1)
    const restored = bridge.snapshots()[0]
    expect(restored.id).toBe(first.id)
    expect(restored.bytes.equals(first.bytes)).toBe(true)
    // The plan did not change, so nothing is announced after the restore.
    await page.waitForTimeout(300)
    expect(bridge.announces()).toHaveLength(0)
  })

  test('announces a plan edited since the bytes it restores', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expect.poll(() => bridge.announces().length).toBe(1)
    await viewerDialog(page).getByRole('button', { name: 'Send to Factorio' }).click()
    await expect.poll(() => bridge.snapshots().length).toBe(1)
    const first = bridge.snapshots()[0]

    await bridge.stop()
    await addGoal(page)
    bridge.clear()
    await bridge.restart(NO_GAME)

    await expect.poll(() => bridge.received.length, { timeout: 12_000 }).toBe(2)
    expect(bridge.received[0]).toMatchObject({ kind: 'snapshot', id: first.id })
    expect(bridge.received[1]).toMatchObject({ kind: 'announce' })
    expect((bridge.received[1] as { id: string }).id).not.toBe(first.id)
  })

  test('does not restore onto a bridge that holds something', async ({ page }) => {
    await openApp(page)
    await switchOn(page, bridge)
    await expect.poll(() => bridge.announces().length).toBe(1)
    await viewerDialog(page).getByRole('button', { name: 'Send to Factorio' }).click()
    await expect.poll(() => bridge.snapshots().length).toBe(1)

    // The restarted bridge already holds a snapshot another planner sent.
    await bridge.stop()
    await expectBadge(page, 'No bridge')
    bridge.clear()
    await bridge.restart(connectedStatus({
      newest: 'b'.repeat(16),
      transfer: { id: 'b'.repeat(16), state: 'delivered', sent: 1, count: 1 },
    }))

    await expectBadge(page, 'Connected', 12_000)
    // It never restores; and since the bridge holds another plan than this one, it announces ours,
    // so the game does not keep showing the other plan while the badge says Connected.
    await expect.poll(() => bridge.announces().length).toBe(1)
    await page.waitForTimeout(500)
    expect(bridge.snapshots()).toHaveLength(0)
    expect(bridge.announces()).toHaveLength(1)
  })
})
