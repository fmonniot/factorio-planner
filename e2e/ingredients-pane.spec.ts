import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'

/**
 * Fixture: active block "Gears" needs plates and rods from outside. Selecting an
 * Ingredients slot offers Find recipe and Receive from… in the detail strip, with the
 * Comes from control under them (the three presets and the Import switch); the
 * right-click menu holds the connection entries.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

const plateSlot = (page: Page) => slot(page, 'Ingredients', 'Iron plate')
const rodSlot = (page: Page) => slot(page, 'Ingredients', 'Iron rod')
const stripAction = (page: Page, name: string) => detail(page, 'Ingredients').getByRole('button', { name })
const comesFrom = (page: Page) => detail(page, 'Ingredients').getByTestId('comes-from')
const preset = (page: Page, name: string) => comesFrom(page).getByRole('radio', { name })
const importSwitch = (page: Page) => comesFrom(page).getByTestId('import-switch')

test.describe('Ingredients pane', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })
  })

  test('Find recipe opens the producer picker and adds a row', async ({ page }) => {
    const rows = page.locator('main table tbody tr')
    const before = await rows.count()

    await selectSlot(page, 'Ingredients', 'Iron plate')
    await stripAction(page, 'Find recipe').click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expect(page.getByText("Choose a recipe to produce 'Iron plate'")).toBeVisible()

    const overlay = page.locator('.fixed.inset-0')
    await overlay.locator('[data-testid="recipe-slot"][data-recipe-id="nullius-iron-plate"]').click()

    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
    await expect(rows).toHaveCount(before + 1)
  })

  test('Escape closes the Receive from… menu first, then clears the selection', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await stripAction(page, 'Receive from…').click()
    await expect(page.getByRole('menu')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).not.toBeVisible()
    await expect(plateSlot(page)).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('Escape')
    await expect(plateSlot(page)).toHaveAttribute('aria-pressed', 'false')
  })

  test('Import can be turned off on a raw item that no row makes; the control says it changes nothing and removes it', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron rod')
    await importSwitch(page).click()
    await expect(importSwitch(page)).toHaveAttribute('aria-checked', 'false')
    // No row makes it and Import is off: what the connections do not bring is missing.
    await expect(rodSlot(page)).toHaveAttribute('data-status', 'short')

    const line = comesFrom(page).getByTestId('no-effect')
    await expect(line).toHaveAttribute('data-no-effect', 'not-made')
    await expect(line).toContainText('No row in this block makes Iron rod.')
    await line.getByRole('button', { name: 'Remove' }).click()
    await expect(importSwitch(page)).toHaveAttribute('aria-checked', 'true')
    await expect(comesFrom(page).getByTestId('no-effect')).toHaveCount(0)
    await expect(rodSlot(page)).not.toHaveAttribute('data-status', 'short')
    await expect(rodSlot(page)).not.toHaveAttribute('data-status', 'locked')
  })

  test('right click on a slot lists the source blocks and no sourcing or import entry', async ({ page }) => {
    await plateSlot(page).click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Make in a new block…' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /imports/i })).toHaveCount(0)
    await expect(menu.getByRole('menuitemradio')).toHaveCount(0)
    await expect(menu.getByRole('menuitemcheckbox')).toHaveCount(0)
  })

  test('Receive from… in the strip opens the same menu', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await stripAction(page, 'Receive from…').click()
    const menu = page.getByRole('menu')
    await expect(menu.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Make in a new block…' })).toBeVisible()
  })

  test('each preset and the Import switch has its help text, on hover and on keyboard focus', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(comesFrom(page)).toBeVisible()
    await expect(comesFrom(page)).toHaveAccessibleName('Comes from')
    const help = [
      ['Make it here', 'Made here; connections and imports cover what is missing.'],
      ['Receive it first', "Taken from this block's connections first; made here for the rest."],
      ["Don't make more here", 'Runs no row for this item: uses what this block already makes, then its connections, then Import.'],
    ]
    for (const [name, text] of help) {
      await expect(preset(page, name)).toHaveAccessibleDescription(text)
      await preset(page, name).hover()
      await expect(page.getByRole('tooltip').filter({ hasText: text })).toBeVisible()
    }
    await importSwitch(page).hover()
    await expect(page.getByRole('tooltip').filter({ hasText: 'Bring it in from outside the plan.' })).toBeVisible()

    // From the keyboard: Tab from Receive from… lands on the first preset.
    await page.mouse.move(0, 0)
    await stripAction(page, 'Receive from…').focus()
    await page.keyboard.press('Tab')
    await expect(preset(page, 'Make it here')).toBeFocused()
    await expect(page.getByRole('tooltip').filter({ hasText: 'Made here; connections' })).toBeVisible()
  })
})

/**
 * Fixture: the Gears block has a plate row pinned low, so it makes Iron plate and still imports the rest.
 * The item can be given any rule: the presets and the Import switch have an effect on it.
 */
test.describe('Ingredients pane — an item the block makes and still imports', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, path.resolve('e2e/fixtures/block-partial-import.json'))
    await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })
  })

  test('sets each preset from the Ingredients slot', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(preset(page, 'Make it here')).toBeChecked()

    await preset(page, 'Receive it first').click()
    await expect(preset(page, 'Receive it first')).toBeChecked()
    await preset(page, "Don't make more here").click()
    await expect(preset(page, "Don't make more here")).toBeChecked()
    await expect(comesFrom(page).getByTestId('sourcing-sentence')).toContainText('Uses what this block already makes (Iron plate')
    await preset(page, 'Make it here').click()
    await expect(preset(page, 'Make it here')).toBeChecked()
  })

  test("Don't make more here and Import off can be chosen together, in either order", async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    const third = preset(page, "Don't make more here")

    // Import off first: the preset stays available.
    await importSwitch(page).click()
    await expect(third).not.toHaveAttribute('aria-disabled', 'true')
    await third.click()
    await expect(third).toBeChecked()
    await expect(importSwitch(page)).toHaveAttribute('aria-checked', 'false')
    await expect(comesFrom(page).getByTestId('sourcing-sentence')).toContainText('Import is off')
    await expect(comesFrom(page).getByTestId('no-effect')).toHaveCount(0)

    // Then the switch back on, and off again, with the preset chosen.
    await importSwitch(page).click()
    await expect(importSwitch(page)).toHaveAttribute('aria-checked', 'true')
    await expect(third).toBeChecked()
    await importSwitch(page).click()
    await expect(importSwitch(page)).toHaveAttribute('aria-checked', 'false')
    await expect(third).toBeChecked()
    // The block runs no row for it and the slot says what is missing.
    await expect(plateSlot(page)).toHaveAttribute('data-status', 'short')
    await expect(plateSlot(page)).toHaveAccessibleName(/^Iron plate, \d[\d.]* per minute, short, has a source rule$/)
  })

  test('the Import switch locks and unlocks the slot; a left click on a locked slot only selects it', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await importSwitch(page).click()
    await expect(plateSlot(page)).toHaveAttribute('data-status', 'locked')

    await page.keyboard.press('Escape')
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
    await expect(importSwitch(page)).toHaveAttribute('aria-checked', 'false')
    await importSwitch(page).click()
    await expect(plateSlot(page)).not.toHaveAttribute('data-status', 'locked')
  })
})
