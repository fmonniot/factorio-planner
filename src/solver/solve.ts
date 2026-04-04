import { Matrix, LuDecomposition, pseudoInverse } from 'ml-matrix'
import type { SolverWarning } from '../data/types'

// ---------------------------------------------------------------------------
// Core solve
//
// Solves S · x = d for the throughput vector x (recipe executions / min).
//
// Primary path: LU decomposition for square, non-singular systems.
// Fallback:     Moore-Penrose pseudo-inverse (SVD-based) for rank-deficient or
//               non-square systems. Emits an 'underdetermined' warning because
//               the minimum-norm solution may not match the user's intent.
//
// All entries of x are clamped to ≥ 0 — negative throughput is physically
// meaningless. A negative result signals an infeasible system (e.g. goal rate
// exceeds what the recipes can supply given a pinned constraint), but we still
// return the clamped vector and let the caller decide.
// ---------------------------------------------------------------------------

export interface SolveResult {
  /** Throughput vector: x[j] = recipe executions / min for recipe j */
  throughput: number[]
  /** Non-fatal warnings generated during solving */
  warnings: SolverWarning[]
}

/**
 * Solve the reduced system S · x = d.
 *
 * @param S - reduced stoichiometry matrix (rows = items, cols = recipes)
 * @param d - demand vector aligned with S rows
 * @param recipeIds - recipe ids corresponding to columns of S (for warnings)
 */
export function solveSystem(
  S: number[][],
  d: number[],
  recipeIds: string[],
): SolveResult {
  const warnings: SolverWarning[] = []
  const rows = S.length
  const cols = recipeIds.length

  // Empty system — nothing to solve.
  if (rows === 0 || cols === 0) {
    return { throughput: new Array(cols).fill(0), warnings }
  }

  const Sm = new Matrix(S)
  const dm = Matrix.columnVector(d)

  let xVec: number[]

  if (rows === cols) {
    // Square system: attempt LU decomposition.
    const lu = new LuDecomposition(Sm)
    if (!lu.isSingular()) {
      xVec = lu.solve(dm).getColumn(0)
    } else {
      // Singular square matrix — cycle or redundant recipes.
      warnings.push({ type: 'underdetermined', freeVariables: recipeIds.slice() })
      xVec = pseudoInverse(Sm).mmul(dm).getColumn(0)
    }
  } else {
    // Non-square: least-squares via pseudo-inverse.
    warnings.push({ type: 'underdetermined', freeVariables: recipeIds.slice() })
    xVec = pseudoInverse(Sm).mmul(dm).getColumn(0)
  }

  // Clamp to non-negative.
  const throughput = xVec.map(v => Math.max(0, v))
  return { throughput, warnings }
}
