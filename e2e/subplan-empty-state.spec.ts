import { test } from '@playwright/test'

/**
 * Subplan empty-state tests — skipped pending port to new factory UI.
 *
 * The old UI showed warning cards ("No goals" / "No recipe nodes") inside the
 * TreeView for each subplan. The new UI uses SubfactorySidebar (flat list) +
 * ProductionTable with no such inline warning cards.
 *
 * TODO: decide where to surface empty-subplan warnings in the new UI
 * (e.g. FactorySummary, SubfactorySidebar item badge, or ProductionTable empty
 * state), then restore these tests with updated selectors.
 */
test.describe('Subplan empty state', () => {
  test.skip('empty subplan shows warnings that clear as goals and nodes are added', async () => {
    // TODO: restore once empty-subplan diagnostics are ported to the new UI
  })
})
