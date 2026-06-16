import { useEffect } from 'react'
import { create } from 'zustand'
import { MdSystemUpdate, MdCheckCircle, MdWarning } from 'react-icons/md'

// ── State store (single source of truth) ────────────────────────────────────

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'uptodate';    latestVersion: string }
  | { phase: 'available';   version: string }
  | { phase: 'preparing';   version: string }
  | { phase: 'downloading'; percent: number; version: string }
  | { phase: 'ready';       version: string }
  | { phase: 'error';       message: string }

interface UpdateStore {
  state: UpdateState
  set: (s: UpdateState) => void
}

const useUpdateStore = create<UpdateStore>((set) => ({
  state: { phase: 'idle' },
  set: (state) => set({ state })
}))

const OFFLINE_UPDATE_MESSAGE = 'لا يوجد اتصال بالإنترنت حالياً، تعذّر التحقق من التحديثات'
const MASTER_UPDATE_MESSAGE = 'لا يوجد تحديث متاح على الماستر حالياً'
const MASTER_CONNECTION_MESSAGE = 'تعذّر الاتصال بالماستر المحلي للتحقق من التحديثات'

function normalizeUpdaterMessage(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('no update package is available on this master') || normalized.includes('latest.yml')) {
    return MASTER_UPDATE_MESSAGE
  }
  if (
    normalized.includes('err_connection_refused') ||
    normalized.includes('econnrefused') ||
    normalized.includes('side device is not paired with this master') ||
    normalized.includes('401')
  ) {
    return MASTER_CONNECTION_MESSAGE
  }

  const offlineMarkers = [
    'net::err_internet_disconnected',
    'internet disconnected',
    'net::err_network_changed',
    'net::err_name_not_resolved',
    'network is unreachable',
    'failed to fetch',
    'getaddrinfo enotfound',
    'enetunreach'
  ]

  return offlineMarkers.some((marker) => normalized.includes(marker))
    ? OFFLINE_UPDATE_MESSAGE
    : message
}

// ── Public helpers ────────────────────────────────────────────────────────────

export function useUpdateState(): UpdateState {
  return useUpdateStore((s) => s.state)
}

export function triggerCheckNow(): void {
  useUpdateStore.getState().set({ phase: 'checking' })
  window.electronAPI?.updaterCheckNow().catch((error) => {
    useUpdateStore.getState().set({
      phase: 'error',
      message: normalizeUpdaterMessage(error instanceof Error ? error.message : String(error))
    })
  })
  // Fallback timeout if updater never responds
  setTimeout(() => {
    const cur = useUpdateStore.getState().state
    if (cur.phase === 'checking') {
      useUpdateStore.getState().set({
        phase: 'error',
        message: 'تعذّر التحقق من التحديثات حالياً، تأكد من الاتصال بالإنترنت ثم حاول مرة أخرى'
      })
    }
  }, 30000)
}

export function dismissUpdate(): void {
  useUpdateStore.getState().set({ phase: 'idle' })
}

// ── Bootstrap: wire IPC events once ──────────────────────────────────────────

export function useUpdaterBootstrap(): void {
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.onUpdateAvailable) return

    const unsub1 = api.onUpdateAvailable(({ version }) => {
      useUpdateStore.getState().set({ phase: 'available', version })
    })
    const unsub2 = api.onDownloadProgress(({ percent }) => {
      const cur = useUpdateStore.getState().state
      const version =
        cur.phase === 'available' || cur.phase === 'downloading' || cur.phase === 'ready'
          ? (cur as { version: string }).version
          : ''
      useUpdateStore.getState().set({ phase: 'downloading', percent, version })
    })
    const unsub3 = api.onUpdateDownloaded(({ version }) => {
      useUpdateStore.getState().set({ phase: 'ready', version })
    })
    const unsub4 = api.onUpdaterError(({ message }) => {
      useUpdateStore.getState().set({ phase: 'error', message: normalizeUpdaterMessage(message) })
    })
    const unsub5 = api.onUpdateUpToDate(({ latestVersion }) => {
      useUpdateStore.getState().set({ phase: 'uptodate', latestVersion })
    })

    return () => { unsub1(); unsub2(); unsub3(); unsub4(); unsub5() }
  }, [])
}

// ── Banner component ──────────────────────────────────────────────────────────

export function UpdateNotification(): React.ReactElement | null {
  const state = useUpdateState()

  function handleDownload(): void {
    const cur = useUpdateStore.getState().state
    const version = cur.phase === 'available' ? cur.version : ''
    // Immediately show preparing state — no more blank button clicks
    useUpdateStore.getState().set({ phase: 'preparing', version })
    window.electronAPI.updaterStartDownload().catch((e) => {
      useUpdateStore.getState().set({
        phase: 'error',
        message: normalizeUpdaterMessage(e instanceof Error ? e.message : 'فشل بدء التحميل')
      })
    })
  }
  function handleInstall(): void {
    window.electronAPI.updaterQuitAndInstall().catch(() => {})
  }

  if (state.phase === 'idle' || state.phase === 'uptodate' || state.phase === 'checking') {
    return null
  }

  return (
    <div className="update-banner" role="status" aria-live="polite">
      {state.phase === 'available' && (
        <>
          <MdSystemUpdate className="update-banner__icon" aria-hidden="true" />
          <span className="update-banner__text">
            يتوفر إصدار جديد{' '}
            <strong className="update-banner__version">v{state.version}</strong>
          </span>
          <div className="update-banner__actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={handleDownload}>
              تحميل التحديث
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={dismissUpdate}>
              لاحقاً
            </button>
          </div>
        </>
      )}

      {state.phase === 'preparing' && (
        <>
          <MdSystemUpdate className="update-banner__icon update-banner__icon--spin" aria-hidden="true" />
          <span className="update-banner__text">
            جارٍ التحضير…{' '}
            <strong className="update-banner__version">v{state.version}</strong>
          </span>
          <div className="update-banner__progress-wrap">
            <div className="update-banner__progress-bar update-banner__progress-bar--indeterminate" />
          </div>
        </>
      )}

      {state.phase === 'downloading' && (
        <>
          <MdSystemUpdate className="update-banner__icon update-banner__icon--spin" aria-hidden="true" />
          <span className="update-banner__text">
            جارٍ التحميل…{' '}
            <strong className="update-banner__version">{state.percent}%</strong>
          </span>
          <div className="update-banner__progress-wrap">
            <div
              className="update-banner__progress-bar"
              style={{ width: `${state.percent}%` }}
              role="progressbar"
              aria-valuenow={state.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </>
      )}

      {state.phase === 'ready' && (
        <>
          <MdCheckCircle className="update-banner__icon" aria-hidden="true" />
          <span className="update-banner__text">
            التحديث <strong className="update-banner__version">v{state.version}</strong> جاهز للتثبيت
          </span>
          <div className="update-banner__actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={handleInstall}>
              إعادة التشغيل والتثبيت
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={dismissUpdate}>
              لاحقاً
            </button>
          </div>
        </>
      )}

      {state.phase === 'error' && (
        <>
          <MdWarning className="update-banner__icon" aria-hidden="true" />
          <span className="update-banner__text update-banner__text--error">
            {state.message}
          </span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={dismissUpdate}>
            إغلاق
          </button>
        </>
      )}
    </div>
  )
}
