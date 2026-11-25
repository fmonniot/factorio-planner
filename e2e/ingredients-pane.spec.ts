import { test, expect, type Locator, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'
import { comesFromPopover } from './support/sidePanel'
import { expectPreset, importSwitch as listImportSwitch, setPreset } from './support/sourcesList'

/**
 * Fixture: active block "Gears" needs plates and rods from outside. Selecting an
 * Ingredients slot offers Find recipe and Receive from… in the detail strip, with the
 * Comes from control under them (Sources…, which opens the popover
 * where the rule is set); the right-click menu holds the connection entries.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

const plateSlot = (page: Page) => slot(page, 'Ingredients', 'Iron plate')
const rodSlot = (page: Page) => slot(page, 'Ingredients', 'Iron rod')
const stripAction = (page: Page, name: string) => detail(page, 'Ingredients').getByRole('button', { name })
const comesFrom = (page: Page) => detail(page, 'Ingredients').getByTestId('comes-from')
/** Sources… of the strip opens the Comes from popover, whose list sets the rule; its control is returned. */
async function openRules(page: Page): Promise<Locator> {
  await comesFrom(page).getByTestId('sources-button').click()
  const control = comesFromPopover(page).getByTestId('comes-from')
  await expect(control.getByTestId('sources-list')).toBeVisible()
  return control
}

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
    const control = await openRules(page)
    await listImportSwitch(control).click()
    await expect(listImportSwitch(control)).toHaveAttribute('aria-checked', 'false')
    // No row makes it and Import is off: what the connections do not bring is missing.
    await expect(rodSlot(page)).toHaveAttribute('data-status', 'short')

    const line = control.getByTestId('no-effect')
    await expect(line).toHaveAttribute('data-no-effect', 'not-made')
    await expect(line.getByTestId('no-effect-reason')).toHaveText('No row here makes it')
    // The strip behind the popover says it too.
    await expect(comesFrom(page).getByTestId('no-effect')).toHaveCount(1)
    await line.getByRole('button', { name: 'Remove' }).click()
    await expect(listImportSwitch(control)).toHaveAttribute('aria-checked', 'true')
    await expect(control.getByTestId('no-effect')).toHaveCount(0)
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

  test('the strip has Sources… and no rule buttons; Sources… opens the popover with the list, with each line\'s help in its detail', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(comesFrom(page)).toBeVisible()
    await expect(comesFrom(page)).toHaveAccessibleName('Comes from')
    await expect(comesFrom(page).getByRole('radio')).toHaveCount(0)
    await expect(comesFrom(page).getByRole('switch')).toHaveCount(0)

    // From the keyboard: Tab from Receive from… lands on Sources…, which says what it does.
    await page.mouse.move(0, 0)
    await stripAction(page, 'Receive from…').focus()
    await page.keyboard.press('Tab')
    await expect(comesFrom(page).getByTestId('sources-button')).toBeFocused()
    await expect(page.getByTestId('tooltip')).toContainText('Sources…')
    await page.keyboard.press('Enter')
    const control = comesFromPopover(page).getByTestId('comes-from')
    await expect(control.getByTestId('sources-list')).toBeVisible()
    await control.locator('[data-line="import"]').getByTestId('sources-line-toggle').click()
    await expect(control.locator('[data-line="import"]').getByTestId('sources-detail')).toContainText('Bring it in from outside the plan')
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

  test('sets each preset from the list of the Ingredients slot', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    const control = await openRules(page)
    await expectPreset(control, 'own')

    await setPreset(control, 'connections-first')
    await setPreset(control, 'byproducts-first')
    await expect(comesFrom(page).locator('[data-testid="strip-rule-icon"][data-rule="byproducts-first"]')).toHaveAccessibleName("Don't make more here")
    await setPreset(control, 'own')
  })

  test("Don't make more here and Import off can be chosen together, in either order", async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    const control = await openRules(page)

    // Import off first: the preset stays available.
    await listImportSwitch(control).click()
    await expect(control.getByTestId('sources-make-here-switch')).not.toHaveAttribute('aria-disabled', 'true')
    await setPreset(control, 'byproducts-first')
    await expect(listImportSwitch(control)).toHaveAttribute('aria-checked', 'false')
    await expect(comesFrom(page).locator('[data-testid="strip-rule-icon"][data-rule="import-off"]')).toBeVisible()
    await expect(control.getByTestId('no-effect')).toHaveCount(0)

    // Then the switch back on, and off again, with the preset chosen.
    await listImportSwitch(control).click()
    await expect(listImportSwitch(control)).toHaveAttribute('aria-checked', 'true')
    await expectPreset(control, 'byproducts-first')
    await listImportSwitch(control).click()
    await expect(listImportSwitch(control)).toHaveAttribute('aria-checked', 'false')
    await expectPreset(control, 'byproducts-first')
    // The block runs no row for it and the slot says what is missing.
    await expect(plateSlot(page)).toHaveAttribute('data-status', 'short')
    await expect(plateSlot(page)).toHaveAccessibleName(/^Iron plate, \d[\d.]* per minute, short, has a source rule$/)
  })

  test('the Import switch locks and unlocks the slot; a left click on a locked slot only selects it', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    const control = await openRules(page)
    await listImportSwitch(control).click()
    await expect(plateSlot(page)).toHaveAttribute('data-status', 'locked')

    // Escape closes the popover, then deselects the slot.
    await page.keyboard.press('Escape')
    await expect(comesFromPopover(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
    const again = await openRules(page)
    await expect(listImportSwitch(again)).toHaveAttribute('aria-checked', 'false')
    await listImportSwitch(again).click()
    await expect(plateSlot(page)).not.toHaveAttribute('data-status', 'locked')
  })
})
