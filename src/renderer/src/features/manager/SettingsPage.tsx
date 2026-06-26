import { useEffect, useState } from 'react'
import type { AppSettings } from '@shared/types'
import { getSettings } from '@renderer/features/orders/order-service'
import { MdBackup, MdDevices, MdKeyboard, MdLock, MdPalette, MdPrint, MdSave } from 'react-icons/md'

import { GeneralTab } from './settings/GeneralTab'
import { ThemeTab } from './settings/ThemeTab'
import { PinTab } from './settings/PinTab'
import { PrintersTab } from './settings/PrintersTab'
import { BackupTab } from './settings/BackupTab'
import { ShortcutsTab } from './settings/ShortcutsTab'
import { NetworkTab } from './settings/NetworkTab'

type SettingsTab = 'general' | 'theme' | 'pin' | 'printers' | 'network' | 'backup' | 'shortcuts'

export function SettingsPage(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('general')

  useEffect(() => {
    void getSettings().then(setSettings)
  }, [])

  if (!settings) return <p className="app-loading">جارٍ التحميل…</p>

  const settingsTabs: { key: SettingsTab; labelAr: string; icon: React.ReactNode }[] = [
    { key: 'general',   labelAr: 'عام',          icon: <MdSave /> },
    { key: 'theme',     labelAr: 'المظهر',        icon: <MdPalette /> },
    { key: 'pin',       labelAr: 'PIN والقفل',    icon: <MdLock /> },
    { key: 'printers',  labelAr: 'الطابعات',      icon: <MdPrint /> },
    { key: 'backup',    labelAr: 'نسخ احتياطي',   icon: <MdBackup /> },
    { key: 'shortcuts', labelAr: 'الاختصارات',    icon: <MdKeyboard /> },
    { key: 'network', labelAr: 'Network', icon: <MdDevices /> },
  ]

  function handleSettingsTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    const currentIndex = settingsTabs.findIndex((t) => t.key === activeSettingsTab)
    let nextIndex = currentIndex
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % settingsTabs.length
    else if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + settingsTabs.length) % settingsTabs.length
    else if (e.key === 'Home') nextIndex = 0
    else if (e.key === 'End') nextIndex = settingsTabs.length - 1
    else return
    e.preventDefault()
    setActiveSettingsTab(settingsTabs[nextIndex]!.key)
  }

  return (
    <div className="unified-page">
      <div className="inner-tabs" role="tablist" onKeyDown={handleSettingsTabKeyDown}>
        {settingsTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeSettingsTab === t.key}
            tabIndex={activeSettingsTab === t.key ? 0 : -1}
            className={`inner-tab${activeSettingsTab === t.key ? ' inner-tab--active' : ''}`}
            onClick={() => setActiveSettingsTab(t.key)}
          >
            {t.icon}
            {t.labelAr}
          </button>
        ))}
      </div>

      <div className="tab-content settings-tab-content">
        {activeSettingsTab === 'general' && <GeneralTab settings={settings} onSettingsSaved={setSettings} />}
        {activeSettingsTab === 'theme' && <ThemeTab settings={settings} onSettingsSaved={setSettings} />}
        {activeSettingsTab === 'pin' && <PinTab settings={settings} onSettingsSaved={setSettings} />}
        {activeSettingsTab === 'printers' && <PrintersTab settings={settings} />}
        {activeSettingsTab === 'backup' && <BackupTab settings={settings} onSettingsSaved={setSettings} />}
        {activeSettingsTab === 'shortcuts' && <ShortcutsTab />}
        {activeSettingsTab === 'network' && <NetworkTab settings={settings} onSettingsSaved={setSettings} />}
      </div>
    </div>
  )
}
