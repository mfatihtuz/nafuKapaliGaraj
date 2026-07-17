import type { ComponentType } from 'react'
import { IconScan, IconSearch, IconPlus, IconTag, IconSettings, IconProject } from './icons'

export interface NavItem {
  to: string
  key: string
  Icon: ComponentType<{ size?: number }>
  /** true ise yalnızca yazma yetkisi olanlara (Yönetici/Üye) gösterilir. */
  write?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/scan', key: 'nav.scan', Icon: IconScan },
  { to: '/search', key: 'nav.search', Icon: IconSearch },
  { to: '/intake', key: 'nav.intake', Icon: IconPlus, write: true },
  { to: '/projects', key: 'nav.projects', Icon: IconProject, write: true },
  { to: '/labels', key: 'nav.labels', Icon: IconTag },
  { to: '/settings', key: 'nav.settings', Icon: IconSettings },
]

/** Rol yetkisine göre görünür navigasyon öğeleri. */
export function navItemsFor(canWrite: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => canWrite || !item.write)
}
