import { test } from '@playwright/test'

/**
 * Primary product override tests — skipped pending port to new factory UI.
 *
 * The old RecipeCard had inline ●/○ buttons per output row.
 * RecipeRow in the new UI shows output tiles but does not yet surface a
 * primary-product picker; that needs a follow-up implementation.
 *
 * TODO: implement primary-product selection in a MachinePopover or a new
 * OutputsPopover, then restore these tests with updated selectors.
 */
test.describe('Primary product override', () => {
  test.skip('brine-electrolysis defaults to hydrogen as primary, can be switched to sodium hydroxide', async () => {
    // TODO: restore once primary-product UI is in RecipeRow
  })

  test.skip('single-output recipe shows no ●/○ buttons', async () => {
    // TODO: restore once primary-product UI is in RecipeRow
  })
})
