import type { ReactNode } from 'react'

/**
 * The row under the Factory overview header that holds a view's own controls (the graph's legend, the Areas view's block
 * picker and filters). Every view keeps its controls here, so switching views changes this row and nothing above it.
 */
export function ViewToolbar({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="shrink-0 px-3 py-2 border-b border-gray-700 bg-gray-950/60 flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      {children}
    </div>
  )
}
