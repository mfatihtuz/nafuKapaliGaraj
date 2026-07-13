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
