import { useState, useEffect } from 'react'
import type { AppSettings } from '@shared/types'
import { updateSettings } from '@renderer/features/orders/order-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { ConfirmDialog } from '@renderer/components/ui'
import { MdBackup, MdDelete, MdFolderOpen, MdRestorePage, MdSave } from 'react-icons/md'

export function BackupTab({ settings, onSettingsSaved }: { settings: AppSettings, onSettingsSaved: (s: AppSettings) => void }): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [backupDirectory, setBackupDirectory] = useState('')
  const [backupDirectories, setBackupDirectories] = useState<string[]>([])
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false)
  const [autoBackupIntervalDays, setAutoBackupIntervalDays] = useState(1)
  const [autoBackupOnClose, setAutoBackupOnClose] = useState(false)
  const [backupRetentionDays, setBackupRetentionDays] = useState(7)
  const [backupSaving, setBackupSaving] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)

  useEffect(() => {
    setBackupDirectory(settings.backupDirectory ?? '')
    setBackupDirectories(settings.backupDirectories ?? [])
    setAutoBackupEnabled(settings.autoBackupEnabled ?? false)
    setAutoBackupIntervalDays(settings.autoBackupIntervalDays ?? 1)
    setAutoBackupOnClose(settings.autoBackupOnClose ?? false)
    setBackupRetentionDays(settings.backupRetentionDays ?? 7)
  }, [settings])

  async function handleBackup(): Promise<void> {
    setBackupLoading(true)
    setBackupMsg(null)
    try {
      const result = await window.electronAPI.backupDatabase()
      setBackupMsg(result.ok ? 'تم حفظ النسخة الاحتياطية بنجاح ✓' : `فشل التصدير: ${result.error ?? ''}`)
    } catch (e) {
      setBackupMsg(`فشل: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBackupLoading(false)
    }
  }

  async function handleChooseBackupDirectory(): Promise<void> {
    setBackupMsg(null)
    const result = await window.electronAPI.chooseBackupDirectory()
    if (result.ok && result.path) {
      setBackupDirectory(result.path)
    } else if (result.error && result.error !== 'Cancelled') {
      setBackupMsg(`فشل اختيار المجلد: ${result.error}`)
    }
  }

  async function handleChooseExtraDirectory(index: number): Promise<void> {
    setBackupMsg(null)
    const result = await window.electronAPI.chooseBackupDirectory()
    if (result.ok && result.path) {
      setBackupDirectories((prev) => {
        const next = [...prev]
        next[index] = result.path!
        return next
      })
    } else if (result.error && result.error !== 'Cancelled') {
      setBackupMsg(`فشل اختيار المجلد: ${result.error}`)
    }
  }

  function removeExtraDirectory(index: number): void {
    setBackupDirectories((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleBackupDirectoryNow(): Promise<void> {
    const allDirs = [backupDirectory.trim(), ...backupDirectories.map((d) => d.trim())].filter(Boolean)
    if (allDirs.length === 0) {
      setBackupMsg('أضف مجلد نسخ احتياطي أولاً')
      return
    }
    setBackupLoading(true)
    setBackupMsg(null)
    try {
      const results = await Promise.all(
        allDirs.map((dir) => window.electronAPI.backupDatabaseToDirectory(dir))
      )
      const failed = results.filter((r) => !r.ok)
      if (failed.length === 0) {
        setBackupMsg(`✓ تم النسخ إلى ${allDirs.length} ${allDirs.length === 1 ? 'مجلد' : 'مجلدات'}`)
      } else if (failed.length < results.length) {
        setBackupMsg(`تم النسخ جزئياً — فشل ${failed.length} من ${results.length}`)
      } else {
        setBackupMsg(`فشل النسخ: ${failed[0]?.error ?? ''}`)
      }
    } catch (e) {
      setBackupMsg(`فشل: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBackupLoading(false)
    }
  }

  async function handleBackupSettingsSave(): Promise<void> {
    setBackupSaving(true)
    setBackupMsg(null)
    try {
      const patch = {
        backupDirectory: backupDirectory.trim() || undefined,
        backupDirectories: backupDirectories.filter((d) => d.trim()),
        autoBackupEnabled,
        autoBackupIntervalDays: Math.max(1, Math.min(7, autoBackupIntervalDays)) as AppSettings['autoBackupIntervalDays'],
        autoBackupOnClose,
        backupRetentionDays: backupRetentionDays as AppSettings['backupRetentionDays']
      }
      await updateSettings(patch, user)
      onSettingsSaved({ ...settings, ...patch, updatedAt: Date.now() })
      setBackupMsg('تم حفظ إعدادات النسخ الاحتياطي ✓')
    } catch (e) {
      setBackupMsg(e instanceof Error ? e.message : 'فشل حفظ إعدادات النسخ الاحتياطي')
    } finally {
      setBackupSaving(false)
    }
  }

  async function handleRestore(): Promise<void> {
    setRestoreConfirmOpen(false)
    setBackupLoading(true)
    setBackupMsg(null)
    try {
      const result = await window.electronAPI.restoreDatabase()
      if (result.ok) {
        setBackupMsg('تم استيراد قاعدة البيانات — سيتم إعادة تشغيل التطبيق الآن…')
        setTimeout(() => { void window.electronAPI.restartApp() }, 1800)
      } else {
        setBackupMsg(`فشل الاستيراد: ${result.error ?? ''}`)
      }
    } catch (e) {
      setBackupMsg(`فشل: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBackupLoading(false)
    }
  }

  return (
    <div className="backup-tab">
      {backupMsg && (
        <p className={`form-message mb-16 ${backupMsg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>
          {backupMsg}
        </p>
      )}

      {/* ── Section 1: Backup locations ── */}
      <div className="card backup-section">
        <h2 className="card__title">
          <MdFolderOpen style={{ verticalAlign: 'middle', marginLeft: 6 }} />
          مواقع النسخ الاحتياطي
        </h2>
        <p className="backup-section__desc">
          يمكنك تحديد حتى 3 مواقع — مثلاً قرص محلي + فلاشة USB + مجلد شبكة. يتم النسخ إلى جميع المواقع في نفس الوقت.
        </p>

        {/* Primary location */}
        <div className="backup-dir-row">
          <span className="backup-dir-row__badge backup-dir-row__badge--primary">رئيسي</span>
          <input
            className="backup-dir-row__input"
            value={backupDirectory}
            onChange={(e) => setBackupDirectory(e.target.value)}
            placeholder="اختر المجلد الرئيسي للنسخ الاحتياطي..."
            dir="ltr"
            readOnly
            onClick={() => void handleChooseBackupDirectory()}
          />
          <button type="button" className="btn btn--secondary btn--sm backup-dir-row__btn"
            onClick={() => void handleChooseBackupDirectory()} title="اختيار مجلد">
            <MdFolderOpen />
          </button>
          {backupDirectory && (
            <button type="button" className="btn btn--secondary btn--sm backup-dir-row__btn"
              onClick={() => setBackupDirectory('')} title="إزالة">
              <MdDelete />
            </button>
          )}
        </div>

        {/* Extra locations */}
        {backupDirectories.map((dir, idx) => (
          <div key={idx} className="backup-dir-row">
            <span className="backup-dir-row__badge">{idx + 2}</span>
            <input
              className="backup-dir-row__input"
              value={dir}
              onChange={(e) => setBackupDirectories((prev) => { const n=[...prev]; n[idx]=e.target.value; return n })}
              placeholder="مجلد إضافي..."
              dir="ltr"
              readOnly
              onClick={() => void handleChooseExtraDirectory(idx)}
            />
            <button type="button" className="btn btn--secondary btn--sm backup-dir-row__btn"
              onClick={() => void handleChooseExtraDirectory(idx)} title="اختيار مجلد">
              <MdFolderOpen />
            </button>
            <button type="button" className="btn btn--secondary btn--sm backup-dir-row__btn"
              onClick={() => removeExtraDirectory(idx)} title="حذف هذا الموقع">
              <MdDelete />
            </button>
          </div>
        ))}

        {/* Add extra location button (max 2 extras = 3 total) */}
        {backupDirectories.length < 2 && (
          <button type="button" className="btn btn--secondary btn--sm mt-8"
            onClick={() => setBackupDirectories((prev) => [...prev, ''])}>
            + إضافة موقع نسخ آخر
          </button>
        )}

        {/* Quick backup now */}
        <div className="backup-section__actions mt-16">
          <button type="button" className="btn btn--primary"
            onClick={() => void handleBackupDirectoryNow()}
            disabled={backupLoading || (!backupDirectory.trim() && backupDirectories.every((d) => !d.trim()))}>
            <MdBackup /> {backupLoading ? 'جارٍ النسخ…' : 'نسخ الآن إلى كل المواقع'}
          </button>
        </div>
      </div>

      {/* ── Section 2: Auto-backup schedule ── */}
      <div className="card backup-section">
        <h2 className="card__title">
          <MdSave style={{ verticalAlign: 'middle', marginLeft: 6 }} />
          جدولة النسخ التلقائي
        </h2>

        <div className="backup-toggles">
          <label className="backup-toggle-row">
            <div className="backup-toggle-row__info">
              <strong>تشغيل النسخ التلقائي أثناء عمل التطبيق</strong>
              <span>يعمل تلقائياً في الخلفية حسب التكرار المحدد</span>
            </div>
            <input type="checkbox" className="pin-toggle-checkbox"
              checked={autoBackupEnabled}
              onChange={(e) => setAutoBackupEnabled(e.target.checked)} />
          </label>

          <label className="backup-toggle-row">
            <div className="backup-toggle-row__info">
              <strong>نسخة عند إغلاق التطبيق</strong>
              <span>يعمل نسخة واحدة إضافية في كل مرة تغلق فيها البرنامج</span>
            </div>
            <input type="checkbox" className="pin-toggle-checkbox"
              checked={autoBackupOnClose}
              onChange={(e) => setAutoBackupOnClose(e.target.checked)} />
          </label>
        </div>

        <div className="settings-form-grid mt-16">
          <label className="field">
            <span>تكرار النسخ التلقائي</span>
            <select value={autoBackupIntervalDays}
              onChange={(e) => setAutoBackupIntervalDays(Number(e.target.value))}
              disabled={!autoBackupEnabled}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>كل {d === 1 ? 'يوم' : `${d} أيام`}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>الاحتفاظ بالنسخ لمدة</span>
            <select value={backupRetentionDays}
              onChange={(e) => setBackupRetentionDays(Number(e.target.value))}>
              <option value={0}>للأبد (لا حذف تلقائي)</option>
              <option value={7}>7 أيام</option>
              <option value={14}>14 يوم</option>
              <option value={30}>30 يوم</option>
              <option value={60}>60 يوم</option>
              <option value={90}>90 يوم</option>
            </select>
          </label>
        </div>

        <div className="form-actions mt-8">
          <button type="button" className="btn btn--primary" onClick={() => void handleBackupSettingsSave()} disabled={backupSaving}>
            <MdSave /> {backupSaving ? 'جارٍ الحفظ…' : 'حفظ إعدادات النسخ'}
          </button>
        </div>
      </div>

      {/* ── Section 3: Export & Restore ── */}
      <div className="card backup-section">
        <h2 className="card__title">
          <MdRestorePage style={{ verticalAlign: 'middle', marginLeft: 6 }} />
          تصدير واستعادة
        </h2>
        <p className="backup-section__desc">
          تصدير قاعدة البيانات كاملةً إلى ملف اختياري، أو استعادة من نسخة سابقة.
          <strong className="text-danger"> الاستعادة تستبدل جميع البيانات الحالية وتُعيد تشغيل التطبيق.</strong>
        </p>
        <div className="backup-section__actions">
          <button type="button" className="btn btn--secondary" onClick={() => void handleBackup()} disabled={backupLoading}>
            <MdBackup /> {backupLoading ? 'جارٍ…' : 'تصدير قاعدة البيانات…'}
          </button>
          <button type="button" className="btn btn--danger" onClick={() => setRestoreConfirmOpen(true)} disabled={backupLoading}>
            <MdRestorePage /> استعادة من نسخة احتياطية…
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={restoreConfirmOpen}
        onCancel={() => setRestoreConfirmOpen(false)}
        onConfirm={() => void handleRestore()}
        title="⚠️ تأكيد استعادة قاعدة البيانات"
        message={
          <div style={{ background: '#fef2f2', border: '2px solid #ef4444', borderRadius: 6, padding: '12px 16px', fontSize: '0.9rem', lineHeight: 1.7, color: 'var(--text-color)' }}>
            <strong>تحذير:</strong> سيتم استبدال جميع البيانات الحالية (الطلبات، المخزون، الإعدادات)
            بالبيانات الموجودة في ملف النسخة الاحتياطية. هذه العملية لا يمكن التراجع عنها.
          </div>
        }
        confirmLabel="نعم، استعد وأعد التشغيل"
        cancelLabel="إلغاء"
        danger
      />
    </div>
  )
}
