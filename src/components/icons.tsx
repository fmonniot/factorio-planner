import type { ReactNode } from 'react'

// Small stroke icons for the UI chrome. Game images live in Icon.tsx / TechIcon.tsx.

function SvgIcon({ className = 'w-4 h-4', children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  )
}

interface IconProps { className?: string }

export const FlagIcon = (p: IconProps) => <SvgIcon {...p}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></SvgIcon>

export const GraphIcon = (p: IconProps) => (
  <SvgIcon {...p}>
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="15" width="6" height="6" rx="1" />
    <path d="M9 6h6M18 9v6" />
  </SvgIcon>
)

export const AreasIcon = (p: IconProps) => (
  <SvgIcon {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </SvgIcon>
)

export const FlaskIcon = (p: IconProps) => (
  <SvgIcon {...p}>
    <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" />
    <path d="M7.5 14h9" />
  </SvgIcon>
)

export const LayersIcon = (p: IconProps) => (
  <SvgIcon {...p}>
    <path d="M12 3 3 8l9 5 9-5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </SvgIcon>
)

export const ChevronDownIcon = (p: IconProps) => <SvgIcon {...p}><path d="m6 9 6 6 6-6" /></SvgIcon>

export const SwapIcon = (p: IconProps) => <SvgIcon {...p}><path d="M7 7h11l-3-3M17 17H6l3 3" /></SvgIcon>

export const PlusIcon = (p: IconProps) => <SvgIcon {...p}><path d="M12 5v14M5 12h14" /></SvgIcon>

export const PencilIcon = (p: IconProps) => <SvgIcon {...p}><path d="M4 20h4L19 9l-4-4L4 16v4z" /></SvgIcon>

export const CopyIcon = (p: IconProps) => (
  <SvgIcon {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </SvgIcon>
)

export const TrashIcon = (p: IconProps) => <SvgIcon {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></SvgIcon>

export const DownloadIcon = (p: IconProps) => <SvgIcon {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></SvgIcon>

export const UploadIcon = (p: IconProps) => <SvgIcon {...p}><path d="M12 20V9M7 14l5-5 5 5M5 4h14" /></SvgIcon>

export const XIcon = (p: IconProps) => <SvgIcon {...p}><path d="M6 6l12 12M18 6 6 18" /></SvgIcon>
