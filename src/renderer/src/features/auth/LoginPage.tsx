import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { RESTAURANT_NAME_AR } from '@shared/constants/branding'
import { PasswordInput } from '@renderer/components/PasswordInput'
import { createFirstOfflineManager, hasOfflineAuthUsers, loginAndLoadUser } from './auth-service'
import { useAuthStore } from './auth-store'
import type { AppUser } from '@shared/types'

function homeFor(user: AppUser): string {
  return user.role === 'manager' ? '/manager' : '/pos'
}

export function LoginPage(): React.ReactElement {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const navigate = useNavigate()
  const [username, setUsername] = useState('manager')
  const [password, setPassword] = useState(() =>
    !hasOfflineAuthUsers() && !navigator.onLine ? '' : 'Manager123!'
  )
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [localSetupMode, setLocalSetupMode] = useState(
    () => !hasOfflineAuthUsers() && !navigator.onLine
  )
  const [isSideDevice, setIsSideDevice] = useState(false)

  useEffect(() => {
    let disposed = false
    void window.electronAPI.getNetworkStatus().then((status) => {
      const side = (status as { mode?: string } | null)?.mode === 'side'
      if (disposed) return
      setIsSideDevice(side)
      if (side) setLocalSetupMode(false)
    }).catch(() => {})
    return () => { disposed = true }
  }, [])

  if (user) {
    return <Navigate to={homeFor(user)} replace />
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError('')
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
        <form onSubmit={(e) => void handleSubmit(e)} className="login-form">
          <label className="field">
            <span>اسم المستخدم</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              dir="ltr"
              placeholder="manager"
            />
          </label>
          <label className="field">
            <span>كلمة المرور</span>
            <PasswordInput value={password} onChange={setPassword} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button type="submit" className="btn btn--primary btn--lg" disabled={loading}>
            {loading
              ? 'جاري التنفيذ...'
              : localSetupMode && !isSideDevice
                ? 'إنشاء المدير المحلي'
                : 'تسجيل الدخول'}
          </button>
          {!isSideDevice && !localSetupMode && !hasOfflineAuthUsers() && (
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
          {!isSideDevice && localSetupMode && hasOfflineAuthUsers() && (
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
