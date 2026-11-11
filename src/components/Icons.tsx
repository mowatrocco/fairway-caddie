// Simple line icons, drawn for this app. 24×24, currentColor.

const common = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const FlagIcon = () => (
  <svg {...common}>
    <path d="M6 21V3" />
    <path d="M6 4h11l-3 4 3 4H6" />
  </svg>
)

export const CardIcon = () => (
  <svg {...common}>
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
)

export const BagIcon = () => (
  <svg {...common}>
    <path d="M8 8h8v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1z" />
    <path d="M9.5 8 8 3M12 8V2.5M14.5 8 16 3.5" />
    <path d="M8 12h8" />
  </svg>
)

export const ChartIcon = () => (
  <svg {...common}>
    <path d="M4 20h16" />
    <path d="M7 16v-5M12 16V7M17 16v-8" />
  </svg>
)

export const GearIcon = () => (
  <svg {...common}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </svg>
)

export const UpIcon = () => (
  <svg {...common}>
    <path d="m6 15 6-6 6 6" />
  </svg>
)

export const DownIcon = () => (
  <svg {...common}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const PlusIcon = () => (
  <svg {...common}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const CloseIcon = () => (
  <svg {...common}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)
