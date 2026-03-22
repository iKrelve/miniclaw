/**
 * SettingsView — Sidebar-tabbed settings layout (CodePilot-aligned).
 *
 * Left sidebar navigation (w-52) + right scrollable content area.
 * Each tab renders an independent Section component.
 */

import { useState } from 'react'
import { Settings, Key, Globe } from 'lucide-react'
import { cn } from '../../lib/utils'
import { GeneralSection } from './GeneralSection'
import { ProviderSection } from './ProviderSection'
import { ProxySection } from './ProxySection'

type Section = 'general' | 'providers' | 'proxy'

interface NavItem {
  id: Section
  label: string
  icon: typeof Settings
}

const navItems: NavItem[] = [
  { id: 'general', label: '通用', icon: Settings },
  { id: 'providers', label: 'Provider', icon: Key },
  { id: 'proxy', label: 'API 代理', icon: Globe },
]

export function SettingsView() {
  const [active, setActive] = useState<Section>('general')

  return (
    <div className="flex h-full">
      {/* Sidebar navigation */}
      <nav className="flex w-52 shrink-0 flex-col gap-1 border-r border-zinc-200 dark:border-zinc-800 p-3">
        <h2 className="px-3 pb-3 pt-1 text-base font-semibold">设置</h2>
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActive(item.id)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-left transition-colors',
              active === item.id
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 hover:text-zinc-700 dark:hover:text-zinc-300',
            )}
          >
            <item.icon size={16} className="shrink-0" />
            {item.label}
          </button>
        ))}
      </nav>

      {/* Content area */}
      <div className="flex-1 overflow-auto p-6">
        {active === 'general' && <GeneralSection />}
        {active === 'providers' && <ProviderSection />}
        {active === 'proxy' && <ProxySection />}
      </div>
    </div>
  )
}
