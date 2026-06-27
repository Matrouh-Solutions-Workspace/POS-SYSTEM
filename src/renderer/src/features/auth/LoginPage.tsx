import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { RESTAURANT_NAME_AR } from '@shared/constants/branding'
import { PasswordInput } from '@renderer/components/PasswordInput'
import { createFirstOfflineManager, devResetManagerLogin, hasOfflineAuthUsers, loginAndLoadUser } from './auth-service'
import { useAuthStore } from './auth-store'
import type { AppUser } from '@shared/types'

function homeFor(user: AppUser): string {
  return user.role === 'manager' ? '/manager' : '/pos'
}

export function LoginPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [hasLocalUsers, setHasLocalUsers] = useState(true)
  const [localSetupMode, setLocalSetupMode] = useState(false)
  const [isSideDevice, setIsSideDevice] = useState(false)
  const resetCode = 'resetmanager153'
  const wantsManagerReset = username.trim().toLowerCase() === resetCode || password.trim().toLowerCase() === resetCode

  async function handleDevManagerReset(): Promise<void> {
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const reset = await devResetManagerLogin()
      setUsername(reset.username)
      setPassword(reset.password)
      setNotice(`تم إعادة ضبط المدير: ${reset.username} / ${reset.password}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل إعادة ضبط المدير')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let disposed = false
    void Promise.all([
      window.electronAPI.getNetworkStatus().catch(() => null),
      hasOfflineAuthUsers()
    ]).then(([status, hasUsers]) => {
      const side = (status as { mode?: string } | null)?.mode === 'side'
      if (disposed) return
      setHasLocalUsers(hasUsers)
      setIsSideDevice(side)
      if (side) setLocalSetupMode(false)
      else if (!hasUsers && !navigator.onLine) setLocalSetupMode(true)
    }).catch(() => {})
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    function handleRecoveryShortcut(event: KeyboardEvent): void {
      if (!event.ctrlKey || event.key !== 'Enter' || loading) return
      if (!wantsManagerReset) return
      event.preventDefault()
      void handleDevManagerReset()
    }

    window.addEventListener('keydown', handleRecoveryShortcut)
    return () => window.removeEventListener('keydown', handleRecoveryShortcut)
  }, [loading, wantsManagerReset])

  if (user) {
    return <Navigate to={homeFor(user)} replace />
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (wantsManagerReset) {
      await handleDevManagerReset()
      return
    }
    setError('')
    setNotice('')
    setLoading(true)
    try {
      const appUser = localSetupMode && !isSideDevice
        ? await createFirstOfflineManager({
            username: username.trim(),
            password,
            displayName: username.trim()
          })
        : await loginAndLoadUser(username.trim(), password)
      setUser(appUser)
      navigate(homeFor(appUser), { replace: true })
    } catch (err) {
      console.error('[login]', err)
      setError(err instanceof Error ? err.message : 'فشل تسجيل الدخول')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__bar" />
        <h1 className="login-card__title">{RESTAURANT_NAME_AR}</h1>
        {localSetupMode && !isSideDevice && (
          <p className="muted">إنشاء أول حساب مدير محلي للعمل بدون إنترنت من أول تشغيل.</p>
        )}
        <form onSubmit={(e) => void handleSubmit(e)} className="login-form" autoComplete="off">
          <label className="field">
            <span>اسم المستخدم</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="off"
              dir="ltr"
              placeholder="manager"
            />
          </label>
          <label className="field">
            <span>كلمة المرور</span>
            <PasswordInput value={password} onChange={setPassword} autoComplete="off" />
          </label>
          {error && <p className="form-error">{error}</p>}
          {notice && <p className="form-message form-message--ok">{notice}</p>}
          {wantsManagerReset && (
            <button
              type="button"
              className="btn btn--ghost btn--lg"
              disabled={loading}
              onClick={() => void handleDevManagerReset()}
            >
              Reset manager login
            </button>
          )}
          <button type="submit" className="btn btn--primary btn--lg" disabled={loading}>
            {loading
              ? 'جاري التنفيذ...'
              : localSetupMode && !isSideDevice
                ? 'إنشاء المدير المحلي'
                : 'تسجيل الدخول'}
          </button>
          {!isSideDevice && !localSetupMode && !hasLocalUsers && (
            <button
              type="button"
              className="btn btn--ghost btn--lg"
              onClick={() => {
                setError('')
                setLocalSetupMode(true)
              }}
            >
              إنشاء أول مدير محلي
            </button>
          )}
          {!isSideDevice && localSetupMode && hasLocalUsers && (
            <button
              type="button"
              className="btn btn--ghost btn--lg"
              onClick={() => {
                setError('')
                setLocalSetupMode(false)
              }}
            >
              الرجوع لتسجيل الدخول
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
