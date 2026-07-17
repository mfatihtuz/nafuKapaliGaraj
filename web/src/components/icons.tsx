// Satır-içi SVG ikonlar (ek bağımlılık yok). stroke=currentColor ile renklenir.
import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }
function base({ size = 24, ...props }: P) {
  return {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const, ...props,
  }
}

export const IconScan = (p: P) => (
  <svg {...base(p)}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" /></svg>
)
export const IconSearch = (p: P) => (
  <svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
)
export const IconPlus = (p: P) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
)
export const IconMinus = (p: P) => (
  <svg {...base(p)}><path d="M5 12h14" /></svg>
)
export const IconTag = (p: P) => (
  <svg {...base(p)}><path d="M12.6 2.6 21 11a2 2 0 0 1 0 2.8l-6.2 6.2a2 2 0 0 1-2.8 0L3.6 11.6a2 2 0 0 1-.6-1.4V4a1 1 0 0 1 1-1h6.2a2 2 0 0 1 1.4.6Z" /><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" /></svg>
)
export const IconSettings = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 4.6V3a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 17 4.6l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 20.5 10H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" /></svg>
)
export const IconBack = (p: P) => (
  <svg {...base(p)}><path d="m15 18-6-6 6-6" /></svg>
)
export const IconChevronRight = (p: P) => (
  <svg {...base(p)}><path d="m9 18 6-6-6-6" /></svg>
)
export const IconMoveArrow = (p: P) => (
  <svg {...base(p)}><path d="M8 3 4 7l4 4" /><path d="M4 7h16" /><path d="m16 21 4-4-4-4" /><path d="M20 17H4" /></svg>
)
export const IconTrash = (p: P) => (
  <svg {...base(p)}><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
)
export const IconEdit = (p: P) => (
  <svg {...base(p)}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
)
export const IconCheck = (p: P) => (
  <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
)
export const IconCamera = (p: P) => (
  <svg {...base(p)}><path d="M14.5 4h-5L8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-4l-1.5-2Z" /><circle cx="12" cy="13" r="3.5" /></svg>
)
export const IconImage = (p: P) => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></svg>
)
export const IconCart = (p: P) => (
  <svg {...base(p)}><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" /></svg>
)
export const IconImageOff = (p: P) => (
  <svg {...base(p)}><path d="M10.4 4H19a2 2 0 0 1 2 2v8.6M21 21H5a2 2 0 0 1-2-2V6M2 2l20 20M8.5 8.5 3 21" /></svg>
)
export const IconUpload = (p: P) => (
  <svg {...base(p)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M12 3v13M7 8l5-5 5 5" /></svg>
)
export const IconUndo = (p: P) => (
  <svg {...base(p)}><path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H9" /></svg>
)
export const IconBarcode = (p: P) => (
  <svg {...base(p)}><path d="M3 5v14M7 5v14M11 5v14M14 5v14M18 5v14M21 5v14" /></svg>
)
export const IconProject = (p: P) => (
  <svg {...base(p)}><path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1ZM8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 12l2 2 4-4" /></svg>
)
export const IconLoan = (p: P) => (
  <svg {...base(p)}><path d="M3 12a2 2 0 0 1 2-2h3l3 2h3a1 1 0 0 1 0 4h-4M3 12v6h4l7 2 7-4v-1a2 2 0 0 0-3-1.7M17 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /></svg>
)
export const IconSparkle = (p: P) => (
  <svg {...base(p)}><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" /></svg>
)
export const IconBox = (p: P) => (
  <svg {...base(p)}><path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v8" /></svg>
)
export const IconSync = (p: P) => (
  <svg {...base(p)}><path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M3 21v-5h5" /></svg>
)
export const IconWifiOff = (p: P) => (
  <svg {...base(p)}><path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 3-2M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8a15 15 0 0 0-6-3.4M12 20h.01" /></svg>
)
export const IconGlobe = (p: P) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z" /></svg>
)
export const IconUsers = (p: P) => (
  <svg {...base(p)}><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="3.5" /><path d="M22 20v-2a4 4 0 0 0-3-3.87M16 3.5a4 4 0 0 1 0 7" /></svg>
)
export const IconUser = (p: P) => (
  <svg {...base(p)}><path d="M19 20a7 7 0 0 0-14 0" /><circle cx="12" cy="8" r="4" /></svg>
)
export const IconBuilding = (p: P) => (
  <svg {...base(p)}><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M4 21h18M8 7h2M8 11h2M8 15h2" /></svg>
)
export const IconKey = (p: P) => (
  <svg {...base(p)}><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.5 12.5 8-8M17 7l2 2M15 9l1.5 1.5" /></svg>
)
export const IconShield = (p: P) => (
  <svg {...base(p)}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>
)
export const IconFolder = (p: P) => (
  <svg {...base(p)}><path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2.5h9a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2Z" /></svg>
)
export const IconLayers = (p: P) => (
  <svg {...base(p)}><path d="m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5" /></svg>
)
export const IconChevronDown = (p: P) => (
  <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
)
export const IconLogout = (p: P) => (
  <svg {...base(p)}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
)
export const IconX = (p: P) => (
  <svg {...base(p)}><path d="M18 6 6 18M6 6l12 12" /></svg>
)
export const IconDatabase = (p: P) => (
  <svg {...base(p)}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></svg>
)
export const IconSliders = (p: P) => (
  <svg {...base(p)}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
)
export const IconMenu = (p: P) => (
  <svg {...base(p)}><path d="M3 6h18M3 12h18M3 18h18" /></svg>
)
