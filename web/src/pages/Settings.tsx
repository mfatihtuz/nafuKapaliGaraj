import { useState, type ComponentType } from 'react'
import { AppHeader, Container } from '../components/Layout'
import { useAuth } from '../auth/AuthContext'
import { useT } from '../i18n'
import {
  IconUser, IconKey, IconUsers, IconBuilding, IconFolder, IconBox, IconTag, IconSliders, IconLogout,
} from '../components/icons'
import { AccountSection } from '../components/settings/AccountSection'
import { SecuritySection } from '../components/settings/SecuritySection'
import { UsersSection } from '../components/settings/UsersSection'
import { OrgSection } from '../components/settings/OrgSection'
import { LabelsSection } from '../components/settings/LabelsSection'
import { CategoriesSection } from '../components/settings/CategoriesSection'
import { LocationsSection } from '../components/settings/LocationsSection'
import { SystemSection } from '../components/settings/SystemSection'

interface Section {
  key: string
  Icon: ComponentType<{ size?: number }>
  owner?: boolean
}

const SECTIONS: Section[] = [
  { key: 'account', Icon: IconUser },
  { key: 'security', Icon: IconKey },
  { key: 'users', Icon: IconUsers, owner: true },
  { key: 'org', Icon: IconBuilding, owner: true },
  { key: 'categories', Icon: IconFolder },
  { key: 'locations', Icon: IconBox },
  { key: 'labels', Icon: IconTag, owner: true },
  { key: 'system', Icon: IconSliders },
]

export function Settings() {
  const { t } = useT()
  const { auth, logout } = useAuth()
  const isOwner = auth?.role === 'owner'
  const canWrite = auth?.role === 'owner' || auth?.role === 'member'
  const sections = SECTIONS.filter((s) => !s.owner || isOwner)
  const [active, setActive] = useState('account')

  function renderSection() {
    switch (active) {
      case 'account': return <AccountSection />
      case 'security': return <SecuritySection />
      case 'users': return <UsersSection />
      case 'org': return <OrgSection />
      case 'labels': return <LabelsSection />
      case 'categories': return <CategoriesSection canWrite={canWrite} />
      case 'locations': return <LocationsSection canWrite={canWrite} />
      case 'system': return <SystemSection />
      default: return null
    }
  }

  return (
    <>
      <AppHeader title={t('settings.title')} />
      <Container wide>
        <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
          {/* Bölüm gezinme */}
          <nav className="mb-4 lg:mb-0">
            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible">
              {sections.map(({ key, Icon }) => (
                <button
                  key={key}
                  onClick={() => setActive(key)}
                  className={`navitem shrink-0 whitespace-nowrap ${
                    active === key ? 'bg-white text-brand-800 shadow-sm ring-1 ring-line lg:ring-0 lg:bg-brand-50' : 'text-brand-500 hover:bg-white/60'
                  }`}
                >
                  <Icon size={18} />
                  {t(`settings.sections.${key}`)}
                </button>
              ))}
              <button
                onClick={() => void logout()}
                className="navitem shrink-0 whitespace-nowrap text-red-600 hover:bg-red-50 lg:mt-2"
              >
                <IconLogout size={18} /> {t('auth.logout')}
              </button>
            </div>
          </nav>

          {/* İçerik */}
          <div className="min-w-0">{renderSection()}</div>
        </div>
      </Container>
    </>
  )
}
