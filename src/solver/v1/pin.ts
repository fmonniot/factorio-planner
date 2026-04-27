// ---------------------------------------------------------------------------
// Pinned rates
//
// A user-pinned recipe has a fixed throughput that must not be solved for.
// We handle this by substituting the pinned values into the system before
// solving:
//
//   S · x = d
//   S_free · x_free + S_pinned · x_pinned = d
//   S_free · x_free = d − S_pinned · x_pinned
//
// Steps:
//   1. Separate recipes into "pinned" and "free" groups.
//   2. Compute the adjusted demand: d_adj = d − S_pinned · x_pinned.
//   3. Build S_free (remove pinned columns from S).
//   4. Solve S_free · x_free = d_adj.
//   5. Reconstitute the full throughput vector with pinned slots filled in.
// ---------------------------------------------------------------------------

export interface PinnedSystem {
  /** Reduced S with pinned columns removed */
  S: number[][]
  /** Adjusted demand vector: d − S_pinned · x_pinned */
  d: number[]
  /** Recipe ids for the free (un-pinned) columns of S */
  freeRecipeIds: string[]
}

/**
 * Apply pinned throughput rates to the reduced system, returning a smaller
 * system that only needs to be solved for the free recipes.
 *
 * @param S         - reduced stoichiometry matrix (rows × all recipe cols)
 * @param d         - demand vector aligned with S rows
 * @param recipeIds - recipe ids corresponding to columns of S
 * @param pinnedRates - map of recipeId → fixed throughput (exec/min)
 */
export function applyPinnedRates(
  S: number[][],
  d: number[],
  recipeIds: string[],
  pinnedRates: Map<string, number>,
): PinnedSystem {
  const rows = S.length
  const freeRecipeIds: string[] = []
  const pinnedCols: number[] = []
  const freeCols: number[] = []

  for (let j = 0; j < recipeIds.length; j++) {
    if (pinnedRates.has(recipeIds[j])) {
      pinnedCols.push(j)
    } else {
      freeCols.push(j)
      freeRecipeIds.push(recipeIds[j])
    }
  }

  // Compute adjusted demand: subtract contribution of pinned columns.
  const dAdj = d.slice()
  for (let i = 0; i < rows; i++) {
    for (const j of pinnedCols) {
      dAdj[i] -= S[i][j] * pinnedRates.get(recipeIds[j])!
    }
  }

  // Build S_free: only the free columns.
  const SFree: number[][] = S.map(row => freeCols.map(j => row[j]))

  return { S: SFree, d: dAdj, freeRecipeIds }
}

/**
 * Merge a partial throughput vector (free recipes) with the pinned values
 * back into a full throughput vector aligned with the original recipeIds.
 *
 * @param freeThroughput  - throughput for the free recipes (from solveSystem)
 * @param freeRecipeIds   - recipe ids for freeThroughput entries
 * @param recipeIds       - all recipe ids (original ordering)
 * @param pinnedRates     - map of recipeId → fixed throughput
 */
export function mergeThroughput(
  freeThroughput: number[],
  freeRecipeIds: string[],
  recipeIds: string[],
  pinnedRates: Map<string, number>,
): number[] {
  const freeMap = new Map(freeRecipeIds.map((id, i) => [id, freeThroughput[i]]))
  return recipeIds.map(id => pinnedRates.get(id) ?? freeMap.get(id) ?? 0)
}
