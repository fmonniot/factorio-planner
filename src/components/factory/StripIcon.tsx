import type { ReactNode } from 'react'

/**
 * The icons of the summary strip toolbar: 12 × 12, stroke 1.5, round caps and joins, `currentColor`. One icon per action
 * and one action per icon, in every pane (see initiatives/summary-strip-icons).
 */
const PATHS = {
  /** Find recipe. */
  search: <><circle cx="5" cy="5" r="3.2" /><path d="M7.6 7.6l3 3" /></>,
  /** Add extra output. */
  plus: <path d="M6 2v8M2 6h8" />,
  /** Remove extra. */
  minus: <path d="M2 6h8" />,
  /** Served order…: a list, its bullets drawn as dots. */
  list: <><path d="M4.5 3h6M4.5 6h6M4.5 9h6" /><path d="M1.6 3h.1M1.6 6h.1M1.6 9h.1" strokeWidth="2" /></>,
  /** Move earlier. */
  left: <path d="M7.5 2.5L4 6l3.5 3.5" />,
  /** Move later. */
  right: <path d="M4.5 2.5L8 6 4.5 9.5" />,
  /** Remove product. */
  trash: <path d="M2 3.5h8M4.5 3.5V2h3v1.5M3 3.5l.4 6.5h5.2L9 3.5" />,
  /** Make it a product. */
  flag: <path d="M3 10.5V2M3 2.5h6L7.6 4.5 9 6.5H3" />,
  /** Add consumer recipe…: an arrow pointing out. */
  arrowR: <path d="M1.5 6h9M7.2 2.9L10.3 6 7.2 9.1" />,
  /** Receive from…: an arrow pointing in. */
  arrowL: <path d="M10.5 6h-9M4.8 2.9L1.7 6 4.8 9.1" />,
  /** Use it all here. */
  flame: <path d="M6 1.4c.4 1.9 2.7 2.7 2.7 5.1a2.7 2.7 0 01-5.4 0c0-1 .4-1.6 1-2.2.1.8.5 1.1.9 1.2C5.1 4.1 5.4 2.7 6 1.4z" />,
} satisfies Record<string, ReactNode>

export type StripIconName = keyof typeof PATHS

export function StripIcon({ name }: { name: StripIconName }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
