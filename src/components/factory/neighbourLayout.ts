// Geometry of the reactor neighbour layout builder: a cols × rows rectangle of
// reactors, each touching up to four others (diagonals do not count).

export const MAX_SIDE = 30
export const FOLD_LIMIT = 5

/** Average number of neighbours per reactor in a full cols × rows rectangle. */
export function rectangleAverage(cols: number, rows: number): number {
  // Each shared side counts for both reactors it touches.
  return (2 * (cols * (rows - 1) + rows * (cols - 1))) / (cols * rows)
}

/** Neighbours (0–4) of the reactor at (col, row) in a cols × rows rectangle. */
export function tileNeighbours(col: number, row: number, cols: number, rows: number): number {
  return Number(col > 0) + Number(col < cols - 1) + Number(row > 0) + Number(row < rows - 1)
}

/** Positions drawn along an axis of length n; `-1` is the gap track of a folded axis. */
export function foldAxis(n: number): number[] {
  if (n <= FOLD_LIMIT) return Array.from({ length: n }, (_, i) => i)
  return [0, 1, -1, n - 2, n - 1]
}

const EPSILON = 1e-9

/**
 * The rectangle whose average equals `count`: smallest area, then most square, then
 * cols ≤ rows. `null` when no rectangle up to MAX_SIDE gives that average.
 */
export function findRectangle(count: number): { cols: number; rows: number } | null {
  let best: { cols: number; rows: number } | null = null
  for (let cols = 1; cols <= MAX_SIDE; cols++) {
    for (let rows = cols; rows <= MAX_SIDE; rows++) {
      if (Math.abs(rectangleAverage(cols, rows) - count) > EPSILON) continue
      if (!best || isBetter({ cols, rows }, best)) best = { cols, rows }
    }
  }
  return best
}

function isBetter(a: { cols: number; rows: number }, b: { cols: number; rows: number }): boolean {
  const areaDiff = a.cols * a.rows - b.cols * b.rows
  if (areaDiff !== 0) return areaDiff < 0
  return Math.abs(a.cols - a.rows) < Math.abs(b.cols - b.rows)
}

/** Up to 2 decimals, trailing zeros trimmed. */
export function formatAverage(x: number): string {
  return String(Number(x.toFixed(2)))
}
