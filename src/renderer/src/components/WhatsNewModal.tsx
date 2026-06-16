/**
 * WhatsNewModal
 *
 * Shows automatically on first launch after an update.
 * Can also be opened manually from the sidebar.
 *
 * Trigger logic:
 *  - On mount, compare localStorage "lastSeenVersion" with current app version.
 *  - If they differ (or key is absent), open the modal and update the key.
 *  - The sidebar button can also open it at any time via `openWhatsNew()`.
 */
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { MdClose, MdNewReleases, MdBuild, MdAutoFixHigh } from 'react-icons/md'
import { CHANGELOG, type ChangeEntry, type VersionLog } from '@renderer/config/changelog'

const STORAGE_KEY = 'lastSeenVersion'

// ── Store ─────────────────────────────────────────────────────────────────────

interface WhatsNewStore {
  open: boolean
  show: () => void
  hide: () => void
}

const useWhatsNewStore = create<WhatsNewStore>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false })
}))

/** Call this from anywhere to open the modal manually */
export function openWhatsNew(): void {
  useWhatsNewStore.getState().show()
}

// ── Bootstrap hook — call once at app root ────────────────────────────────────

export function useWhatsNewBootstrap(): void {
  useEffect(() => {
    const check = async (): Promise<void> => {
      try {
        const currentVersion = await window.electronAPI?.getAppVersion()
        if (!currentVersion) return
        const lastSeen = localStorage.getItem(STORAGE_KEY)
        if (lastSeen !== currentVersion) {
          localStorage.setItem(STORAGE_KEY, currentVersion)
          // Only show if there's at least one changelog entry for this version
          const hasEntry = CHANGELOG.some((e) => e.version === currentVersion)
          if (hasEntry) {
            useWhatsNewStore.getState().show()
          }
        }
      } catch {
        // silently ignore
      }
    }
    void check()
  }, [])
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeIcon(type: ChangeEntry['type']): React.ReactElement {
  if (type === 'new')     return <MdNewReleases  className="whats-new__bullet-icon whats-new__bullet-icon--new"     aria-hidden="true" />
  if (type === 'fix')     return <MdBuild        className="whats-new__bullet-icon whats-new__bullet-icon--fix"     aria-hidden="true" />
  return                         <MdAutoFixHigh  className="whats-new__bullet-icon whats-new__bullet-icon--improve" aria-hidden="true" />
}

function typeLabel(type: ChangeEntry['type']): string {
  if (type === 'new')     return 'جديد'
  if (type === 'fix')     return 'إصلاح'
  return 'تحسين'
}

function VersionBlock({ log }: { log: VersionLog }): React.ReactElement {
  return (
    <div className="whats-new__version-block">
      <div className="whats-new__version-header">
        <span className="whats-new__version-tag">v{log.version}</span>
        <span className="whats-new__version-date">{log.date}</span>
      </div>
      <ul className="whats-new__list">
        {log.changes.map((change, i) => (
          <li key={i} className="whats-new__item">
            {typeIcon(change.type)}
            <span className={`whats-new__type-badge whats-new__type-badge--${change.type}`}>
              {typeLabel(change.type)}
            </span>
            <span className="whats-new__item-text">{change.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Modal component ───────────────────────────────────────────────────────────

export function WhatsNewModal(): React.ReactElement | null {
  const open = useWhatsNewStore((s) => s.open)
  const hide = useWhatsNewStore((s) => s.hide)
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)

  useEffect(() => {
    window.electronAPI?.getAppVersion().then(setCurrentVersion).catch(() => {})
  }, [])

  if (!open) return null

  // Show current version first, then up to 2 older versions
  const logs = CHANGELOG.slice(0, 3)

  return (
    <div className="modal-overlay whats-new__overlay" onClick={hide}>
      <div
        className="modal whats-new__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="whats-new__header">
          <div className="whats-new__header-text">
            <MdNewReleases className="whats-new__header-icon" aria-hidden="true" />
            <div>
              <h2 id="whats-new-title" className="whats-new__title">ما الجديد؟</h2>
              {currentVersion && (
                <p className="whats-new__subtitle">الإصدار الحالي: v{currentVersion}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            className="whats-new__close"
            onClick={hide}
            aria-label="إغلاق"
          >
            <MdClose />
          </button>
        </div>

        {/* Body */}
        <div className="whats-new__body">
          {logs.length === 0 ? (
            <p className="whats-new__empty">لا توجد تفاصيل للتحديثات بعد.</p>
          ) : (
            logs.map((log) => <VersionBlock key={log.version} log={log} />)
          )}
        </div>

        {/* Footer */}
        <div className="whats-new__footer">
          <button type="button" className="btn btn--primary" onClick={hide}>
            حسناً، فهمت!
          </button>
        </div>
      </div>
    </div>
  )
}
