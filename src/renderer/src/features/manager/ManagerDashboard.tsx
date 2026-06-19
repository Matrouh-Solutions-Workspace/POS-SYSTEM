import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildManagerNavForUser } from '@renderer/config/navigation'
import { getSummaryStats } from '@renderer/features/reports/reports-service'
import { MdRestartAlt } from 'react-icons/md'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { hasPermission } from '@shared/types/user'

export function ManagerDashboard(): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const navigate = useNavigate()
  const canViewReports = hasPermission(user, 'view_reports')
  const canManageSettings = hasPermission(user, 'manage_settings')
  const [stats, setStats] = useState({ todayOrders: 0, todayRevenue: 0, weekRevenue: 0 })
  const [restarting, setRestarting] = useState(false)

  useEffect(() => {
    if (!canViewReports) return
    void getSummaryStats().then(setStats)
  }, [canViewReports])

  function handleRestart(): void {
    if (!window.confirm('إعادة تشغيل التطبيق؟')) return
    setRestarting(true)
    window.electronAPI?.restartApp().catch(() => setRestarting(false))
  }

  return (
    <>
      <header className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-header__title">لوحة التحكم</h1>
          <p className="page-header__subtitle">ملخص سريع ثم اختر القسم للإدارة</p>
        </div>
        {canManageSettings && (
          <button type="button" className="btn btn--secondary btn--sm" onClick={handleRestart} disabled={restarting} title="إعادة تشغيل التطبيق">
            <MdRestartAlt aria-hidden="true" />
            {restarting ? 'جارٍ إعادة التشغيل…' : 'إعادة التشغيل'}
          </button>
        )}
      </header>

      {canViewReports && (
        <div className="stats-grid">
          <div className="stat-card"><div className="stat-card__label">طلبات اليوم</div><div className="stat-card__value">{stats.todayOrders}</div></div>
          <div className="stat-card"><div className="stat-card__label">إيرادات اليوم</div><div className="stat-card__value">{stats.todayRevenue.toFixed(2)}</div></div>
          <div className="stat-card"><div className="stat-card__label">إيرادات الأسبوع</div><div className="stat-card__value">{stats.weekRevenue.toFixed(2)}</div></div>
        </div>
      )}

      <section className="dashboard-tiles" aria-label="أقسام الإدارة">
        {buildManagerNavForUser(user).filter((item) => item.to !== '/manager').map((item) => (
          <button key={item.to} type="button" className="dashboard-tile" onClick={() => navigate(item.to)}>
            <span className="dashboard-tile__label">{item.label}</span>
            {item.hint && <span className="dashboard-tile__hint">{item.hint}</span>}
          </button>
        ))}
      </section>
    </>
  )
}
