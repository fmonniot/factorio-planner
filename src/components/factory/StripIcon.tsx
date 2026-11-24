import { useId } from 'react'
import type { ReactNode } from 'react'

/**
 * The icons of the summary strip toolbar: 12 × 12, stroke 1.5, round caps and joins, `currentColor`. One icon per action
 * and one action per icon, in every pane. Each is drawn from what a Factorio player reads at a glance (a machine, a train,
 * a chest, a bus, an inventory slot); a small mark in the bottom-right corner, where the game prints a slot's count, says what
 * the action does to it, and an off state is the same icon struck through.
 */

/** Draws an icon; `mask` is an id unique to the rendered icon, for the icons that cut a gap round a slash or a corner mark. */
type Draw = (mask: string) => ReactNode

/** A filled shape: the fill replaces the stroke. */
const F = { fill: 'currentColor', stroke: 'none' } as const

const SLASH = 'M1.8 1.8l8.4 8.4'

/** Off: the icon under a mask that cuts a gap round the slash, plus the slash itself. */
const struck = (inner: ReactNode, mask: string): ReactNode => (
  <>
    <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="12" height="12">
      <rect width="12" height="12" fill="#fff" />
      <path d={SLASH} stroke="#000" strokeWidth="3.6" strokeLinecap="round" />
    </mask>
    <g mask={`url(#${mask})`}>{inner}</g>
    <path d={SLASH} />
  </>
)

/** A mark in the bottom-right corner, with a gap cut around it in the icon. */
const corner = (inner: ReactNode, mark: ReactNode, mask: string): ReactNode => (
  <>
    <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="12" height="12">
      <rect width="12" height="12" fill="#fff" />
      <circle cx="9.3" cy="9.3" r="3.4" fill="#000" />
    </mask>
    <g mask={`url(#${mask})`}>{inner}</g>
    {mark}
  </>
)

const PLUS = <path d="M9.3 7.4v3.8M7.4 9.3h3.8" />
const MINUS = <path d="M7.4 9.3h3.8" />
const RAISE = <path d="M9.3 11.2V7.6M7.7 9.1l1.6-1.6 1.6 1.6" />

/** Machine: an assembler seen from above, a box with a gear in it. Made in this block. */
const MACHINE = (
  <>
    <rect x="1.25" y="1.25" width="9.5" height="9.5" rx="1.6" />
    <path {...F} fillRule="evenodd" d="M5.35 4L5.38 2.81L6.62 2.81L6.65 4L7.41 4.44L8.45 3.87L9.07 4.94L8.05 5.56L8.05 6.44L9.07 7.06L8.45 8.13L7.41 7.56L6.65 8L6.62 9.19L5.38 9.19L5.35 8L4.59 7.56L3.55 8.13L2.93 7.06L3.95 6.44L3.95 5.56L2.93 4.94L3.55 3.87L4.59 4.44Z M6.95 6a0.95 0.95 0 1 0 -1.9 0a0.95 0.95 0 1 0 1.9 0Z" />
  </>
)
/** The same, smaller, for the icon that carries a corner mark. */
const MACHINE_SMALL = (
  <>
    <rect x="1.25" y="1.25" width="7.6" height="7.6" rx="1.4" />
    <path {...F} fillRule="evenodd" d="M4.5 3.55L4.51 2.51L5.59 2.51L5.6 3.55L6.08 3.82L6.98 3.31L7.52 4.25L6.63 4.77L6.63 5.33L7.52 5.85L6.98 6.79L6.08 6.28L5.6 6.55L5.59 7.59L4.51 7.59L4.5 6.55L4.02 6.28L3.12 6.79L2.58 5.85L3.47 5.33L3.47 4.77L2.58 4.25L3.12 3.31L4.02 3.82Z M5.85 5.05a0.8 0.8 0 1 0 -1.6 0a0.8 0.8 0 1 0 1.6 0Z" />
  </>
)
/** Train: a locomotive seen head-on. Comes from another block of the plan. */
const TRAIN = (
  <>
    <rect x="2.25" y="1.25" width="7.5" height="7.6" rx="2" />
    <path d="M4.1 3.7h3.8" />
    <circle {...F} cx="4.45" cy="6.45" r=".85" />
    <circle {...F} cx="7.55" cy="6.45" r=".85" />
    <path d="M3.9 9.3l-1.1 1.5M8.1 9.3l1.1 1.5" />
  </>
)
/** Chest: a chest with its lid band and latch. What is left over. */
const CHEST = (
  <>
    <rect x="1.25" y="2.75" width="9.5" height="8" rx="1.1" />
    <path d="M1.25 5.6h9.5M6 5.6v2" />
  </>
)
/** Slot: an inventory slot holding one item. */
const SLOT = (
  <>
    <rect x="1.25" y="1.25" width="7.6" height="7.6" rx="1.3" />
    <path fill="currentColor" d="M5.05 3.05l2 2-2 2-2-2z" />
  </>
)
/** Import: an arrow coming down across the dashed edge of the plan. */
const EDGE_ARROW = <path d="M6 .9v9.6M3.5 8L6 10.5 8.5 8" />
const edgeDots = (xs: number[]) => xs.map(x => <circle key={x} {...F} cx={x} cy="4.4" r=".8" />)

const ICONS = {
  /** Find recipe: a lens over a gear, what makes things. */
  find: () => (
    <>
      <circle cx="4.9" cy="4.9" r="3.7" />
      <path {...F} fillRule="evenodd" d="M4.51 3.93L4.43 3.01L5.37 3.01L5.29 3.93L5.55 4.07L6.3 3.55L6.77 4.36L5.94 4.75L5.94 5.05L6.77 5.44L6.3 6.25L5.55 5.73L5.29 5.87L5.37 6.79L4.43 6.79L4.51 5.87L4.25 5.73L3.5 6.25L3.03 5.44L3.86 5.05L3.86 4.75L3.03 4.36L3.5 3.55L4.25 4.07Z" />
      <path d="M7.6 7.6l3 3" />
    </>
  ),
  /** Served order…: taps off a bus. The bus rises out of the block (the dot) and its lanes leave for the other blocks, the top one served first. */
  served: () => (
    <g transform="translate(12 0) scale(-1 1)">
      <path d="M9.5 9.8V.9M8.3 2.1l1.2-1.2 1.2 1.2" />
      <path d="M1.2 3.9h8.3M2.8 6.3h6.7M4.4 8.7h5.1" />
      <circle {...F} cx="9.5" cy="10.65" r="1.1" />
    </g>
  ),
  /** Add extra output: the item's slot with a plus where the game prints the count. */
  'extra-add': m => corner(SLOT, PLUS, m),
  /** Remove extra. */
  'extra-remove': m => corner(SLOT, MINUS, m),
  /** Move earlier. */
  left: () => <path d="M7.5 2.5L4 6l3.5 3.5" />,
  /** Move later. */
  right: () => <path d="M4.5 2.5L8 6 4.5 9.5" />,
  /** Move up, in the Sources list. */
  up: () => <path d="M2.5 7.5L6 4l3.5 3.5" />,
  /** Move down, in the Sources list. */
  down: () => <path d="M2.5 4.5L6 8l3.5-3.5" />,
  /** Remove a connection, in the Sources list. */
  x: () => <path d="M3 3l6 6M9 3l-6 6" />,
  /** Remove product. */
  trash: () => <path d="M2 3.5h8M4.5 3.5V2h3v1.5M3 3.5l.4 6.5h5.2L9 3.5" />,
  /** Add consumer recipe…: a machine with a plus. */
  consumer: m => corner(MACHINE_SMALL, PLUS, m),
  /** Use it all here: the Leftover chest, struck. */
  'use-all': m => struck(CHEST, m),
  /** Make it a product: the slot, promoted by an up arrow. */
  'make-product': m => corner(SLOT, RAISE, m),
  /** Receive from…: a train with a plus. */
  receive: m => corner(<g transform="translate(-1.1 -.3)">{TRAIN}</g>, PLUS, m),
  /** Preset Make it here: an assembler. */
  make: () => MACHINE,
  /** Preset Don't make more here: the assembler, struck. */
  'dont-make': m => struck(MACHINE, m),
  /** Preset Receive it first: a train. */
  'receive-first': () => TRAIN,
  /** Import on: an arrow down from beyond the edge of the plan. */
  import: () => (
    <>
      {edgeDots([1.2, 3.4, 8.6, 10.8])}
      {EDGE_ARROW}
    </>
  ),
  /** Import off: only the arrow is struck; the dots stay whole, minus the one the slash would cut. */
  'import-off': m => (
    <>
      {struck(EDGE_ARROW, m)}
      {edgeDots([1.2, 8.6, 10.8])}
    </>
  ),
  /** Leftover on: a chest, what nobody uses is kept. */
  leftover: () => CHEST,
  /** Leftover off: the chest, struck. */
  'leftover-off': m => struck(CHEST, m),
  /** Sources…: lanes join a bus that runs down into the block; the dot is where the first items come from. */
  sources: () => (
    <>
      <path d="M9.1 .9v9.9M7.7 9.4l1.4 1.4 1.4-1.4" />
      <path d="M2.6 2.6h6.5M4 5h5.1M5.4 7.4h3.7" />
      <circle {...F} cx="2.6" cy="2.6" r="1.2" />
    </>
  ),
} satisfies Record<string, Draw>

export type StripIconName = keyof typeof ICONS

export function StripIcon({ name }: { name: StripIconName }) {
  // useId returns ":r1:"-style ids, which are valid in url(#…) once the colons are escaped away.
  const mask = `strip-mask-${useId().replace(/:/g, '')}`
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
      data-icon={name}
    >
      {(ICONS[name] as Draw)(mask)}
    </svg>
  )
}
