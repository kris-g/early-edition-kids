// Small line icons (24px grid, currentColor). No icon library needed for a handful.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>

function Svg({ children, ...props }: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const TodayIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 5.5h13a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 0 1.5 1.5H6A2 2 0 0 1 4 17.5z" />
    <path d="M18.5 9H20v9" />
    <path d="M7.5 9h7M7.5 12.5h7M7.5 16h4" />
  </Svg>
)

export const IssuesIcon = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="5" rx="1.5" />
    <rect x="4" y="11" width="16" height="9" rx="1.5" />
    <path d="M9 15h6" />
  </Svg>
)

export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
)

export const TopicsIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
)

export const MoreIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
)

export const RefreshIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
    <path d="M20 20v-4h-4" />
  </Svg>
)

export const ChevronLeft = (p: P) => (
  <Svg {...p}>
    <path d="m15 5-7 7 7 7" />
  </Svg>
)

export const ChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

export const ChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
)

export const ExternalIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </Svg>
)

export const EyeIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Svg>
)

export const EyeOffIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.9 3.7" />
    <path d="M6.6 6.7C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.8 0 3.3-.6 4.6-1.3" />
    <path d="M9.9 9.9a2.8 2.8 0 0 0 4.2 4.2" />
    <path d="m3 3 18 18" />
  </Svg>
)

export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l2.5 2" />
  </Svg>
)

export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
)

export const AlertIcon = (p: P) => (
  <Svg {...p}>
    <path d="M12 4 2.8 19.5h18.4z" />
    <path d="M12 10v4.5M12 17.2v.1" />
  </Svg>
)

export const InfoIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.1" />
  </Svg>
)

export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
)

export const KindleIcon = (p: P) => (
  <Svg {...p}>
    <rect x="5.5" y="3" width="13" height="18" rx="2" />
    <path d="M8.5 7h7M8.5 10h7M8.5 13h4" />
  </Svg>
)

// --- from the approved mockups ---------------------------------------------

/** The sunrise mark beside "Early Edition". */
export const LogoMark = (p: P) => (
  <svg viewBox="0 0 48 48" width="1em" height="1em" aria-hidden="true" focusable="false" {...p}>
    <path d="M6 36h36" stroke="currentColor" strokeWidth={3.5} strokeLinecap="round" fill="none" />
    <path d="M13 36a11 11 0 0 1 22 0z" fill="currentColor" />
    <path
      d="M24 12v6M10.5 18.5l4 4M37.5 18.5l-4 4"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      fill="none"
    />
  </svg>
)

export const PaperIcon = (p: P) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M7.5 9h6M7.5 12.5h6M7.5 16h3.5" />
  </Svg>
)

export const ReadingIcon = (p: P) => (
  <Svg strokeWidth={2.6} {...p}>
    <path d="M5 20V11M12 20V4M19 20v-6" />
  </Svg>
)

export const CalendarIcon = (p: P) => (
  <Svg strokeWidth={2} {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
)

export const SparkleIcon = (p: P) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M18.5 16l.7 2 .8.5-.8.5-.7 2-.7-2-.8-.5.8-.5z" fill="currentColor" stroke="none" />
  </Svg>
)

export const SunIcon = (p: P) => (
  <Svg strokeWidth={2} {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
  </Svg>
)

export const MoonIcon = (p: P) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z" />
  </Svg>
)

export const FlameIcon = (p: P) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" {...p}>
    <path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 .5 1.5 1.5 2 2 2 0-3 0-5 1-8z" fill="currentColor" />
  </svg>
)

export const DotsIcon = (p: P) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" {...p}>
    <circle cx="5" cy="12" r="1.8" fill="currentColor" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
    <circle cx="19" cy="12" r="1.8" fill="currentColor" />
  </svg>
)

/** Filled circle with a tick; the tick takes `tickColor` (the surface behind it). */
export const CheckCircleIcon = ({ tickColor = 'var(--card)', ...p }: P & { tickColor?: string }) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" {...p}>
    <circle cx="12" cy="12" r="10" fill="currentColor" />
    <path
      d="M7.5 12.5l3 3 6-6.5"
      fill="none"
      style={{ stroke: tickColor }}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export const HalfCircleIcon = (p: P) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" {...p}>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth={2} />
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
  </svg>
)

export const EmptyCircleIcon = (p: P) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false" {...p}>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth={2} />
  </svg>
)
