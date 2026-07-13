import type { ComponentType } from 'react'
import { IconScan, IconSearch, IconPlus, IconTag, IconSettings } from './icons'

export interface NavItem {
  to: string
  key: string
  Icon: ComponentType<{ size?: number }>
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/scan', key: 'nav.scan', Icon: IconScan },
  { to: '/search', key: 'nav.search', Icon: IconSearch },
  { to: '/intake', key: 'nav.intake', Icon: IconPlus },
  { to: '/labels', key: 'nav.labels', Icon: IconTag },
  { to: '/settings', key: 'nav.settings', Icon: IconSettings },
]
