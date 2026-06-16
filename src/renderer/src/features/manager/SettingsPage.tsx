import { useEffect, useState, type FormEvent } from 'react'
import type { AppSettings, KitchenPrinter, KitchenPrinterVisibility, SystemPrinter } from '@shared/types'
import { getSettings, updateSettings } from '@renderer/features/orders/order-service'
import { applyThemeColor, DEFAULT_PRIMARY } from '@renderer/features/theme/theme-store'
import { listUsersByRole, updateUserProfile } from '@renderer/features/auth/auth-service'
import { hashPin } from '@renderer/features/auth/pin-store'
import { MdSave, MdPalette, MdLock, MdPerson, MdBackup, MdRestorePage, MdKeyboard, MdDevices, MdFolderOpen, MdPrint, MdRefresh, MdDelete, MdVisibility } from 'react-icons/md'
import type { AppUser } from '@shared/types'
import {
  createKitchenPrinter,
  DEFAULT_KITCHEN_VISIBILITY,
  deleteKitchenPrinter,
  listKitchenPrinters,
  listSystemPrinters,
  updateKitchenPrinter
} from '@renderer/features/printers/printer-service'
import { buildKitchenTicketHtml } from '@renderer/features/printers/kitchen-printing'
import {
  SHORTCUT_ACTIONS,
  chordToDisplay,
  eventToChord,
  resolveChords,
  useKeyboardStore
} from '@renderer/features/keyboard/keyboard-store'

const COLOR_PRESETS = [
  { label: 'فيروزي (افتراضي)', value: '#0e7490' },
  { label: 'برتقالي',          value: '#b8430a' },
  { label: 'أزرق',             value: '#1d4ed8' },
  { label: 'أخضر',             value: '#15803d' },
  { label: 'بنفسجي',           value: '#7c3aed' },
  { label: 'وردي',             value: '#be185d' },
  { label: 'رمادي',            value: '#374151' },
  { label: 'أحمر',             value: '#b91c1c' }
]

const LOCK_OPTIONS = [
  { value: 0,   label: 'لا يُقفل تلقائياً' },
  { value: 1,   label: 'دقيقة واحدة' },
  { value: 5,   label: '٥ دقائق' },
  { value: 10,  label: '١٠ دقائق' },
  { value: 15,  label: '١٥ دقيقة' },
  { value: 30,  label: '٣٠ دقيقة' },
  { value: 60,  label: 'ساعة' }
]

// ── ShortcutsTab ─────────────────────────────────────────────────────────

function ShortcutsTab(): React.ReactElement {
  const storeChords = useKeyboardStore((s) => s.chords)
  const setChord    = useKeyboardStore((s) => s.setChord)

  // Local draft so the user can edit without immediately affecting behaviour
  const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...storeChords }))
  // Which action is currently being recorded
  const [recording, setRecording] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  // Keep draft in sync if the store changes externally (e.g. load on mount)
  useEffect(() => {
    setDraft({ ...storeChords })
  }, [storeChords])

  // Capture a keydown while in recording mode
  useEffect(() => {
    if (!recording) return
    function capture(e: KeyboardEvent): void {
      e.preventDefault()
      e.stopPropagation()
      // Escape cancels recording without changing the chord
      if (e.key === 'Escape') { setRecording(null); return }
      const chord = eventToChord(e)
      // Ignore bare modifiers alone
      if (['ctrl', 'alt', 'shift', 'meta'].includes(chord)) return
      setDraft((d) => ({ ...d, [recording!]: chord }))
      setRecording(null)
    }
    window.addEventListener('keydown', capture, { capture: true })
    return () => window.removeEventListener('keydown', capture, { capture: true })
  }, [recording])

  // Detect conflicts in draft
  function conflictFor(actionId: string): string | null {
    const chord = draft[actionId]
    if (!chord) return null
    for (const [otherId, otherChord] of Object.entries(draft)) {
      if (otherId !== actionId && otherChord === chord) {
        const other = SHORTCUT_ACTIONS.find((a) => a.id === otherId)
        return other?.labelAr ?? otherId
      }
    }
    return null
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setMsg(null)
    try {
      // Apply to store immediately
      for (const [id, chord] of Object.entries(draft)) {
        setChord(id, chord)
      }
      await updateSettings({ keyboardShortcuts: draft })
      setMsg('تم حفظ الاختصارات ✓')
    } catch { setMsg('فشل الحفظ') }
    finally { setSaving(false) }
  }

  function handleReset(): void {
    const defaults = resolveChords({})
    setDraft({ ...defaults })
  }

  // Group actions by groupAr
  const groups = SHORTCUT_ACTIONS.reduce<Record<string, typeof SHORTCUT_ACTIONS>>((acc, a) => {
    ;(acc[a.groupAr] ??= []).push(a)
    return acc
  }, {})

  return (
    <div className="shortcuts-tab">
      <p className="shortcuts-tab__hint">
        اضغط على زر الاختصار ثم اضغط المفاتيح الجديدة. اضغط Escape للإلغاء.
      </p>

      {msg && (
        <p className={`form-message ${msg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>
          {msg}
        </p>
      )}

      {Object.entries(groups).map(([group, actions]) => (
        <div key={group} className="card">
          <h2 className="card__title">{group}</h2>
          <table className="data-table shortcuts-table">
            <thead>
              <tr>
                <th>الإجراء</th>
                <th>الاختصار</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => {
                const chord = draft[action.id] ?? ''
                const isRecording = recording === action.id
                const conflict = conflictFor(action.id)
                return (
                  <tr key={action.id} className={conflict ? 'shortcut-row--conflict' : ''}>
                    <td>{action.labelAr}</td>
                    <td>
                      <button
                        type="button"
                        className={`shortcut-chord-btn${isRecording ? ' shortcut-chord-btn--recording' : ''}`}
                        onClick={() => setRecording(isRecording ? null : action.id)}
                        title={isRecording ? 'اضغط المفاتيح أو Escape للإلغاء' : 'انقر لتغيير الاختصار'}
                      >
                        {isRecording ? (
                          <span className="shortcut-chord-btn__recording-label">اضغط المفاتيح…</span>
                        ) : chord ? (
                          chordToDisplay(chord)
                        ) : (
                          <span style={{ color: 'var(--color-muted)', fontStyle: 'italic' }}>غير مُعيَّن</span>
                        )}
                      </button>
                      {conflict && (
                        <div className="shortcut-conflict-msg">
                          ⚠️ تعارض مع: {conflict}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => {
                            const def = SHORTCUT_ACTIONS.find((a) => a.id === action.id)?.defaultChord ?? ''
                            setDraft((d) => ({ ...d, [action.id]: def }))
                          }}
                          title="استعادة الاختصار الافتراضي"
                        >
                          افتراضي
                        </button>
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => setDraft((d) => ({ ...d, [action.id]: '' }))}
                          title="إزالة الاختصار"
                        >
                          مسح
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      <div className="form-actions">
        <button type="button" className="btn btn--primary" onClick={() => void handleSave()} disabled={saving}>
          <MdSave /> {saving ? 'جارٍ الحفظ…' : 'حفظ الاختصارات'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={handleReset}>
          استعادة الافتراضي للكل
        </button>
      </div>
    </div>
  )
}

function PrintersTab({ settings }: { settings: AppSettings }): React.ReactElement {
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([])
  const [kitchenPrinters, setKitchenPrinters] = useState<KitchenPrinter[]>([])
  const [selectedDeviceName, setSelectedDeviceName] = useState('')
  const [printerName, setPrinterName] = useState('')
  const [description, setDescription] = useState('')
  const [copies, setCopies] = useState(1)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  async function load(): Promise<void> {
    const [system, saved] = await Promise.all([
      listSystemPrinters().catch(() => []),
      listKitchenPrinters()
    ])
    setSystemPrinters(system)
    setKitchenPrinters(saved)
    if (!selectedDeviceName && system[0]) {
      setSelectedDeviceName(system.find((printer) => printer.isDefault)?.name ?? system[0].name)
    }
  }

  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAddPrinter(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!selectedDeviceName) {
      setMessage('اختر طابعة من الطابعات المتاحة أولا')
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const selected = systemPrinters.find((printer) => printer.name === selectedDeviceName)
      await createKitchenPrinter({
        name: printerName.trim() || selected?.displayName || selectedDeviceName,
        deviceName: selectedDeviceName,
        description,
        copies,
        visibility: DEFAULT_KITCHEN_VISIBILITY
      })
      setPrinterName('')
      setDescription('')
      setCopies(1)
      setMessage('تمت إضافة الطابعة')
      await load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'فشل إضافة الطابعة')
    } finally {
      setLoading(false)
    }
  }

  function patchVisibility(printer: KitchenPrinter, key: keyof KitchenPrinterVisibility, checked: boolean): void {
    void updateKitchenPrinter(printer.id, {
      visibility: { ...printer.visibility, [key]: checked }
    }).then(load)
  }

  function openPreview(printer: KitchenPrinter): void {
    setPreviewHtml(buildKitchenTicketHtml({
      settings,
      printer,
      title: `معاينة ${printer.name}`,
      order: {
        id: 'preview',
        orderNumber: 128,
        orderCode: 'A-128',
        status: 'completed',
        orderType: 'dine_in',
        paymentStatus: 'unpaid',
        tableNameAr: 'ترابيزة 5',
        tableCategoryAr: 'الدور الأرضي',
        cashierId: 'preview',
        cashierName: 'كاشير تجريبي',
        subtotal: 0,
        total: 0,
        noteAr: 'بدون بصل، تجهيز سريع',
        customerName: 'عميل تجريبي',
        customerPhone: '01000000000',
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      items: [
        {
          id: 'preview-item-1',
          orderId: 'preview',
          menuItemId: 'sample',
          sourceMenuItemId: 'sample',
          nameAr: 'وجبة كفتة',
          quantity: 2,
          unitPrice: 0,
          lineTotal: 0,
          sizeLabelAr: 'كبير',
          noteAr: 'زيادة صوص'
        },
        {
          id: 'preview-item-2',
          orderId: 'preview',
          menuItemId: 'sample-2',
          sourceMenuItemId: 'sample-2',
          nameAr: 'بطاطس',
          quantity: 1,
          unitPrice: 0,
          lineTotal: 0
        }
      ]
    }))
  }

  return (
    <div className="card">
      <h2 className="card__title"><MdPrint style={{ verticalAlign: 'middle', marginLeft: 6 }} />طابعات التجهيز</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: 16 }}>
        أضف الطابعات المتاحة من النظام، ثم اربط كل صنف بطابعة أو أكثر من صفحة الأصناف. عند الطلب يتم تجميع كل أصناف الطابعة في إيصال تجهيز واحد.
      </p>
      {message && <p className={`form-message ${message.includes('فشل') || message.includes('اختر') ? 'form-message--error' : 'form-message--ok'}`}>{message}</p>}

      <form onSubmit={(e) => void handleAddPrinter(e)} className="settings-form-grid" style={{ marginBottom: 18 }}>
        <label className="field">
          <span>الطابعة الفعلية</span>
          <select value={selectedDeviceName} onChange={(e) => setSelectedDeviceName(e.target.value)} required>
            <option value="">اختر طابعة...</option>
            {systemPrinters.map((printer) => (
              <option key={printer.name} value={printer.name}>
                {printer.displayName || printer.name}{printer.isDefault ? ' (افتراضية)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>اسم يظهر للمدير</span>
          <input value={printerName} onChange={(e) => setPrinterName(e.target.value)} placeholder="مثال: مطبخ ساخن" />
        </label>
        <label className="field">
          <span>عدد النسخ</span>
          <input type="number" min="1" max="5" value={copies} onChange={(e) => setCopies(Number(e.target.value) || 1)} />
        </label>
        <label className="field settings-form-grid__full">
          <span>ملاحظات داخلية</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مكان الطابعة أو استخدامها" />
        </label>
        <div className="form-actions settings-form-grid__full">
          <button type="submit" className="btn btn--primary" disabled={loading || systemPrinters.length === 0}>
            <MdSave /> {loading ? 'جارٍ الحفظ...' : 'إضافة الطابعة'}
          </button>
          <button type="button" className="btn btn--secondary" onClick={() => void load()}>
            <MdRefresh /> اكتشاف الطابعات
          </button>
        </div>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            <th>الاسم</th>
            <th>الطابعة</th>
            <th>إعدادات الإيصال</th>
            <th>الحالة</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          {kitchenPrinters.map((printer) => (
            <tr key={printer.id}>
              <td>
                <input
                  className="inline-edit-input"
                  value={printer.name}
                  onChange={(e) => void updateKitchenPrinter(printer.id, { name: e.target.value }).then(load)}
                />
                <input
                  className="inline-edit-input"
                  value={printer.description ?? ''}
                  onChange={(e) => void updateKitchenPrinter(printer.id, { description: e.target.value }).then(load)}
                  placeholder="ملاحظة"
                  style={{ marginTop: 4 }}
                />
              </td>
              <td>
                <select
                  className="inline-edit-input"
                  value={printer.deviceName}
                  onChange={(e) => void updateKitchenPrinter(printer.id, { deviceName: e.target.value }).then(load)}
                >
                  {systemPrinters.some((p) => p.name === printer.deviceName) || <option value={printer.deviceName}>{printer.deviceName} (غير مكتشفة الآن)</option>}
                  {systemPrinters.map((systemPrinter) => (
                    <option key={systemPrinter.name} value={systemPrinter.name}>
                      {systemPrinter.displayName || systemPrinter.name}{systemPrinter.isDefault ? ' (افتراضية)' : ''}
                    </option>
                  ))}
                </select>
                <label className="field" style={{ marginTop: 6 }}>
                  <span>نسخ</span>
                  <input type="number" min="1" max="5" value={printer.copies} onChange={(e) => void updateKitchenPrinter(printer.id, { copies: Number(e.target.value) || 1 }).then(load)} />
                </label>
              </td>
              <td>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(120px, 1fr))', gap: 6 }}>
                  {([
                    ['showOrderType', 'نوع الطلب'],
                    ['showTable', 'الترابيزة'],
                    ['showCashier', 'الكاشير'],
                    ['showCustomer', 'العميل'],
                    ['showOrderNote', 'ملاحظة الطلب'],
                    ['showItemNotes', 'ملاحظات الأصناف']
                  ] as Array<[keyof KitchenPrinterVisibility, string]>).map(([key, label]) => (
                    <label key={key} className="field--checkbox" style={{ fontSize: '0.78rem' }}>
                      <input
                        type="checkbox"
                        checked={printer.visibility[key]}
                        onChange={(e) => patchVisibility(printer, key, e.target.checked)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </td>
              <td>
                <select className="inline-edit-input" value={printer.active ? 'active' : 'inactive'} onChange={(e) => void updateKitchenPrinter(printer.id, { active: e.target.value === 'active' }).then(load)}>
                  <option value="active">مفعلة</option>
                  <option value="inactive">معطلة</option>
                </select>
              </td>
              <td>
                <div className="table-actions">
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => openPreview(printer)}>
                    <MdVisibility /> معاينة
                  </button>
                  <button type="button" className="btn btn--danger btn--sm" onClick={() => void deleteKitchenPrinter(printer.id).then(load)}>
                    <MdDelete /> حذف
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {kitchenPrinters.length === 0 && (
            <tr><td colSpan={5}>لا توجد طابعات تجهيز بعد</td></tr>
          )}
        </tbody>
      </table>

      {previewHtml && (
        <div className="modal-overlay" onClick={() => setPreviewHtml(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">معاينة إيصال التجهيز</h2>
              <button type="button" className="order-details__close" onClick={() => setPreviewHtml(null)} aria-label="إغلاق">×</button>
            </div>
            <iframe title="Kitchen ticket preview" srcDoc={previewHtml} style={{ width: '100%', height: 520, border: '2px solid var(--color-border)', background: '#fff' }} />
          </div>
        </div>
      )}
    </div>
  )
}

export function SettingsPage(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [cashiers, setCashiers] = useState<AppUser[]>([])

  // ── Receipt ─────────────────────────────────────────────────────────────
  const [receiptForm, setReceiptForm] = useState({ restaurantNameAr: '', currencySymbol: '', phoneNumber: '', receiptFooterAr: '', taxRate: '', defaultDeliveryFee: '', maxCashierDiscountPct: '' })
  const [receiptSaving, setReceiptSaving] = useState(false)
  const [receiptMsg, setReceiptMsg] = useState<string | null>(null)

  // ── Theme ────────────────────────────────────────────────────────────────
  const [selectedColor, setSelectedColor] = useState(DEFAULT_PRIMARY)
  const [customColor, setCustomColor] = useState(DEFAULT_PRIMARY)
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeMsg, setThemeMsg] = useState<string | null>(null)

  // ── PIN ──────────────────────────────────────────────────────────────────
  const [pinEnabled, setPinEnabled] = useState(false)
  const [autoLockMinutes, setAutoLockMinutes] = useState(5)
  const [pinSaving, setPinSaving] = useState(false)
  const [pinMsg, setPinMsg] = useState<string | null>(null)
  // Per-cashier PIN setting
  const [cashierPins, setCashierPins] = useState<Record<string, string>>({})
  const [pinSavingFor, setPinSavingFor] = useState<string | null>(null)
  const [networkMode, setNetworkMode] = useState<'standalone' | 'master' | 'side'>('standalone')
  const [masterServerPort, setMasterServerPort] = useState(47831)
  const [receiptPrintRoute, setReceiptPrintRoute] = useState<'side' | 'master'>('side')
  const [networkMsg, setNetworkMsg] = useState<string | null>(null)
  const [networkSaving, setNetworkSaving] = useState(false)
  const [masterStatus, setMasterStatus] = useState<{
    running?: boolean
    port?: number
    addresses?: string[]
    pairingCode?: string
    pairedDevices?: Array<{ id: string; name: string; pairedAt: number; lastSeenAt?: number }>
    lastError?: string
  } | null>(null)
  const [backupDirectory, setBackupDirectory] = useState('')
  const [backupDirectories, setBackupDirectories] = useState<string[]>([])   // extra locations
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false)
  const [autoBackupIntervalDays, setAutoBackupIntervalDays] = useState(1)
  const [autoBackupOnClose, setAutoBackupOnClose] = useState(false)
  const [backupRetentionDays, setBackupRetentionDays] = useState(7)
  const [backupSaving, setBackupSaving] = useState(false)

  useEffect(() => {
    void Promise.all([getSettings(), listUsersByRole('cashier')]).then(([s, c]) => {
      setSettings(s)
      setReceiptForm({
        restaurantNameAr: s.restaurantNameAr,
        currencySymbol: s.currencySymbol,
        phoneNumber: s.phoneNumber ?? '',
        receiptFooterAr: s.receiptFooterAr ?? '',
        taxRate: s.taxRate != null && s.taxRate > 0 ? String(s.taxRate) : '',
        defaultDeliveryFee: s.defaultDeliveryFee != null && s.defaultDeliveryFee > 0 ? String(s.defaultDeliveryFee) : '',
        maxCashierDiscountPct: s.maxCashierDiscountPct != null && s.maxCashierDiscountPct < 100 ? String(s.maxCashierDiscountPct) : ''
      })
      const color = s.primaryColor ?? DEFAULT_PRIMARY
      setSelectedColor(color)
      setCustomColor(color)
      setPinEnabled(s.pinEnabled ?? false)
      setAutoLockMinutes(s.autoLockMinutes ?? 5)
      setNetworkMode(s.networkMode ?? 'standalone')
      setMasterServerPort(s.masterServerPort ?? 47831)
      setReceiptPrintRoute(s.receiptPrintRoute === 'master' ? 'master' : 'side')
      setBackupDirectory(s.backupDirectory ?? '')
      setBackupDirectories(s.backupDirectories ?? [])
      setAutoBackupEnabled(s.autoBackupEnabled ?? false)
      setAutoBackupIntervalDays(s.autoBackupIntervalDays ?? 1)
      setAutoBackupOnClose(s.autoBackupOnClose ?? false)
      setBackupRetentionDays(s.backupRetentionDays ?? 7)
      setCashiers(c)
    })
  }, [])

  useEffect(() => {
    let disposed = false
    async function refresh(): Promise<void> {
      const status = await window.electronAPI.getMasterNetworkStatus().catch(() => null)
      if (!disposed) setMasterStatus(status as typeof masterStatus)
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 5000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [])

  // ── Receipt save ──────────────────────────────────────────────────────────
  async function handleReceiptSave(e: FormEvent): Promise<void> {
    e.preventDefault()
    setReceiptSaving(true)
    setReceiptMsg(null)
    try {
      await updateSettings({
        restaurantNameAr: receiptForm.restaurantNameAr.trim(),
        currencySymbol: receiptForm.currencySymbol.trim(),
        phoneNumber: receiptForm.phoneNumber.trim() || undefined,
        receiptFooterAr: receiptForm.receiptFooterAr.trim() || undefined,
        taxRate: receiptForm.taxRate ? Number(receiptForm.taxRate) : 0,
        defaultDeliveryFee: receiptForm.defaultDeliveryFee ? Number(receiptForm.defaultDeliveryFee) : 0,
        maxCashierDiscountPct: receiptForm.maxCashierDiscountPct ? Number(receiptForm.maxCashierDiscountPct) : undefined
      })
      setReceiptMsg('تم حفظ إعدادات الإيصال')
    } catch { setReceiptMsg('فشل الحفظ') }
    finally { setReceiptSaving(false) }
  }

  // ── Theme save ────────────────────────────────────────────────────────────
  async function handleThemeSave(): Promise<void> {
    setThemeSaving(true)
    setThemeMsg(null)
    try {
      await updateSettings({ primaryColor: selectedColor })
      applyThemeColor(selectedColor)
      setThemeMsg('تم حفظ اللون')
    } catch { setThemeMsg('فشل الحفظ') }
    finally { setThemeSaving(false) }
  }

  function pickColor(hex: string): void {
    setSelectedColor(hex); setCustomColor(hex); applyThemeColor(hex)
  }

  // ── PIN global save ───────────────────────────────────────────────────────
  async function handlePinSettingsSave(): Promise<void> {
    setPinSaving(true)
    setPinMsg(null)
    try {
      await updateSettings({ pinEnabled, autoLockMinutes })
      setPinMsg('تم حفظ إعدادات القفل')
    } catch { setPinMsg('فشل الحفظ') }
    finally { setPinSaving(false) }
  }

  // ── Per-cashier PIN save ──────────────────────────────────────────────────
  async function saveCashierPin(cashier: AppUser): Promise<void> {
    const pin = cashierPins[cashier.id] ?? ''
    if (pin && (pin.length !== 4 || !/^\d{4}$/.test(pin))) {
      setPinMsg('رمز PIN يجب أن يكون 4 أرقام')
      return
    }
    setPinSavingFor(cashier.id)
    try {
      const pinHash = pin ? await hashPin(pin) : undefined
      await updateUserProfile(cashier.id, { pinHash })
      setCashierPins((prev) => ({ ...prev, [cashier.id]: '' }))
      setPinMsg(`تم ${pin ? 'تعيين' : 'حذف'} PIN للكاشير ${cashier.displayName}`)
    } catch (e) { setPinMsg(e instanceof Error ? e.message : 'فشل') }
    finally { setPinSavingFor(null) }
  }

  // ── Settings tab ─────────────────────────────────────────────────────────
  async function handleNetworkSave(): Promise<void> {
    setNetworkSaving(true)
    setNetworkMsg(null)
    try {
      await updateSettings({
        networkMode,
        masterServerPort,
        sideDisconnectPolicy: 'block_actions',
        receiptPrintRoute
      })
      const status = await window.electronAPI.refreshMasterServer()
      setMasterStatus(status as typeof masterStatus)
      setNetworkMsg('تم حفظ إعدادات الشبكة')
    } catch (e) {
      setNetworkMsg(e instanceof Error ? e.message : 'فشل حفظ إعدادات الشبكة')
    } finally {
      setNetworkSaving(false)
    }
  }

  type SettingsTab = 'general' | 'theme' | 'pin' | 'printers' | 'network' | 'backup' | 'shortcuts'
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('general')

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
      await updateSettings({
        backupDirectory: backupDirectory.trim() || undefined,
        backupDirectories: backupDirectories.filter((d) => d.trim()),
        autoBackupEnabled,
        autoBackupIntervalDays: Math.max(1, Math.min(7, autoBackupIntervalDays)) as AppSettings['autoBackupIntervalDays'],
        autoBackupOnClose,
        backupRetentionDays: backupRetentionDays as AppSettings['backupRetentionDays']
      })
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

  // ── Backup/Restore — REQ-8 ───────────────────────────────────────────────

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
      {/* ── Inner tab strip ── */}
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

        {/* ── General / Receipt ── */}
        {activeSettingsTab === 'general' && (
          <div className="card">
            <h2 className="card__title">إعدادات الإيصال والمطعم</h2>
            {receiptMsg && <p className={`form-message ${receiptMsg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>{receiptMsg}</p>}
            <form onSubmit={(e) => void handleReceiptSave(e)}>
              <div className="settings-form-grid">
                <label className="field">
                  <span>اسم المطعم</span>
                  <input value={receiptForm.restaurantNameAr} onChange={(e) => setReceiptForm((f) => ({ ...f, restaurantNameAr: e.target.value }))} required />
                </label>
                <label className="field">
                  <span>رمز العملة</span>
                  <input value={receiptForm.currencySymbol} onChange={(e) => setReceiptForm((f) => ({ ...f, currencySymbol: e.target.value }))} placeholder="ج.م" required />
                </label>
                <label className="field">
                  <span>رقم الهاتف</span>
                  <input value={receiptForm.phoneNumber} onChange={(e) => setReceiptForm((f) => ({ ...f, phoneNumber: e.target.value }))} placeholder="01xxxxxxxxx" dir="ltr" />
                </label>
                <label className="field settings-form-grid__full">
                  <span>تذييل الإيصال</span>
                  <textarea value={receiptForm.receiptFooterAr} onChange={(e) => setReceiptForm((f) => ({ ...f, receiptFooterAr: e.target.value }))} placeholder="شكراً لزيارتكم…" rows={2} />
                </label>
                <label className="field">
                  <span>ضريبة القيمة المضافة % (0 = بدون ضريبة)</span>
                  <input type="number" min="0" max="100" step="0.1" value={receiptForm.taxRate} onChange={(e) => setReceiptForm((f) => ({ ...f, taxRate: e.target.value }))} placeholder="0" />
                </label>
                <label className="field">
                  <span>رسوم التوصيل الافتراضية</span>
                  <input type="number" min="0" step="0.01" value={receiptForm.defaultDeliveryFee} onChange={(e) => setReceiptForm((f) => ({ ...f, defaultDeliveryFee: e.target.value }))} placeholder="0.00" />
                </label>
                <label className="field">
                  <span>الحد الأقصى لخصم الكاشير % (فارغ = بدون حد)</span>
                  <input type="number" min="0" max="100" step="1" value={receiptForm.maxCashierDiscountPct} onChange={(e) => setReceiptForm((f) => ({ ...f, maxCashierDiscountPct: e.target.value }))} placeholder="مثال: 20" />
                </label>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn--primary" disabled={receiptSaving}>
                  <MdSave /> {receiptSaving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Theme ── */}
        {activeSettingsTab === 'theme' && (
          <div className="card">
            <h2 className="card__title"><MdPalette style={{ verticalAlign: 'middle', marginLeft: 6 }} />ألوان التطبيق</h2>
            {themeMsg && <p className={`form-message ${themeMsg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>{themeMsg}</p>}
            <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: 16 }}>اختر اللون الرئيسي للتطبيق</p>
            <div className="color-presets">
              {COLOR_PRESETS.map((p) => (
                <button key={p.value} type="button"
                  className={`color-swatch${selectedColor === p.value ? ' color-swatch--active' : ''}`}
                  style={{ '--swatch-color': p.value } as React.CSSProperties}
                  onClick={() => pickColor(p.value)} title={p.label} aria-label={p.label} />
              ))}
            </div>
            <div className="field" style={{ marginTop: 16 }}>
              <span>لون مخصص</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input type="color" value={customColor}
                  onChange={(e) => { setCustomColor(e.target.value); pickColor(e.target.value) }}
                  style={{ width: 48, height: 40, padding: 2, border: '2px solid var(--color-border)', cursor: 'pointer' }} />
                <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)', fontFamily: 'monospace' }}>{selectedColor}</span>
              </div>
            </div>
            <div className="theme-preview">
              <div className="theme-preview__label">معاينة</div>
              <div className="theme-preview__bar" style={{ background: selectedColor }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button type="button" className="btn btn--primary btn--sm" style={{ pointerEvents: 'none' }}>زر رئيسي</button>
                <button type="button" className="btn btn--secondary btn--sm" style={{ pointerEvents: 'none' }}>ثانوي</button>
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="button" className="btn btn--primary" onClick={() => void handleThemeSave()} disabled={themeSaving}>
                <MdSave /> {themeSaving ? 'جارٍ الحفظ…' : 'حفظ اللون'}
              </button>
              <button type="button" className="btn btn--secondary" onClick={() => pickColor(DEFAULT_PRIMARY)}>إعادة الافتراضي</button>
            </div>
          </div>
        )}

        {/* ── PIN ── */}
        {activeSettingsTab === 'pin' && (
          <div className="card">
            <h2 className="card__title"><MdLock style={{ verticalAlign: 'middle', marginLeft: 6 }} />قفل الشاشة بـ PIN</h2>
            {pinMsg && <p className={`form-message ${pinMsg.includes('فشل') || pinMsg.includes('يجب') ? 'form-message--error' : 'form-message--ok'}`}>{pinMsg}</p>}
            <div className="pin-settings-row">
              <label className="pin-toggle-label">
                <input type="checkbox" className="pin-toggle-checkbox" checked={pinEnabled} onChange={(e) => setPinEnabled(e.target.checked)} />
                <span className="pin-toggle-text">تفعيل قفل PIN للكاشيرات</span>
              </label>
              <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', margin: '4px 0 0' }}>
                عند التفعيل يحتاج الكاشير إلى PIN شخصي للدخول بعد فترة الخمول
              </p>
            </div>
            <label className="field" style={{ maxWidth: 260, marginTop: 12 }}>
              <span>قفل تلقائي بعد</span>
              <select value={autoLockMinutes} onChange={(e) => setAutoLockMinutes(Number(e.target.value))}>
                {LOCK_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => void handlePinSettingsSave()} disabled={pinSaving}>
                <MdSave /> {pinSaving ? 'جارٍ الحفظ…' : 'حفظ إعدادات القفل'}
              </button>
            </div>
            {cashiers.length > 0 && (
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '2px solid var(--color-border)' }}>
                <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  تعيين PIN لكل كاشير
                </h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', margin: '0 0 16px' }}>
                  اترك الحقل فارغاً لحذف PIN الكاشير. رمز PIN يجب أن يكون 4 أرقام.
                </p>
                <div className="pin-cashier-list">
                  {cashiers.map((c) => (
                    <div key={c.id} className="pin-cashier-row">
                      <div className="pin-cashier-info">
                        <MdPerson aria-hidden="true" />
                        <span className="pin-cashier-name">{c.displayName}</span>
                        <span className="pin-cashier-username">@{c.username || c.email.split('@')[0]}</span>
                        {c.pinHash && <span className="pin-cashier-badge">PIN مُعيَّن ✓</span>}
                      </div>
                      <div className="pin-cashier-input-row">
                        <input
                          type="password" inputMode="numeric" maxLength={4} placeholder="----" dir="ltr"
                          value={cashierPins[c.id] ?? ''}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, '').slice(0, 4)
                            setCashierPins((prev) => ({ ...prev, [c.id]: v }))
                          }}
                          className="inline-edit-input"
                          style={{ width: 80, textAlign: 'center', letterSpacing: '0.3em' }}
                        />
                        <button type="button" className="btn btn--primary btn--sm"
                          onClick={() => void saveCashierPin(c)} disabled={pinSavingFor === c.id}>
                          {pinSavingFor === c.id ? '...' : 'حفظ PIN'}
                        </button>
                        {c.pinHash && (
                          <button type="button" className="btn btn--danger btn--sm"
                            onClick={async () => {
                              await updateUserProfile(c.id, { pinHash: undefined })
                              setPinMsg(`تم حذف PIN للكاشير ${c.displayName}`)
                              setCashiers(await listUsersByRole('cashier'))
                            }}>
                            حذف PIN
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeSettingsTab === 'printers' && <PrintersTab settings={settings} />}

        {/* ── Backup ── */}
        {activeSettingsTab === 'network' && (
          <div className="card">
            <h2 className="card__title"><MdDevices style={{ verticalAlign: 'middle', marginLeft: 6 }} />Network terminals</h2>
            {networkMsg && <p className={`form-message ${networkMsg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}>{networkMsg}</p>}
            <div className="settings-form-grid">
              <label className="field">
                <span>وضع الجهاز</span>
                <select value={networkMode} onChange={(e) => setNetworkMode(e.target.value as typeof networkMode)}>
                  <option value="standalone">Standalone</option>
                  <option value="master">Master</option>
                </select>
              </label>
              <label className="field">
                <span>Master port</span>
                <input type="number" min="1024" max="65535" value={masterServerPort} onChange={(e) => setMasterServerPort(Number(e.target.value) || 47831)} />
              </label>
              <label className="field">
                <span>طباعة الفاتورة</span>
                <select value={receiptPrintRoute} onChange={(e) => setReceiptPrintRoute(e.target.value as typeof receiptPrintRoute)}>
                  <option value="side">على الجهاز الجانبي</option>
                  <option value="master">على الماستر</option>
                </select>
              </label>
            </div>
            <div className="form-actions">
              <button type="button" className="btn btn--primary" onClick={() => void handleNetworkSave()} disabled={networkSaving}>
                <MdSave /> {networkSaving ? 'جارٍ...' : 'حفظ الشبكة'}
              </button>
              <button type="button" className="btn btn--secondary" onClick={async () => setMasterStatus(await window.electronAPI.getMasterNetworkStatus() as typeof masterStatus)}>
                تحديث الحالة
              </button>
              <button type="button" className="btn btn--secondary" onClick={async () => { await window.electronAPI.resetMasterPairingCode(); setMasterStatus(await window.electronAPI.getMasterNetworkStatus() as typeof masterStatus) }}>
                كود ربط جديد
              </button>
            </div>
            <div className="license-panel__meta" style={{ marginTop: 16 }}>
              <span>الحالة</span>
              <code dir="ltr">{masterStatus?.running ? `Running on ${masterStatus.port}` : 'Stopped'}</code>
            </div>
            <div className="license-panel__meta">
              <span>IPs</span>
              <code dir="ltr">{masterStatus?.addresses?.join(', ') || '-'}</code>
            </div>
            <div className="license-panel__meta">
              <span>Pairing code</span>
              <code dir="ltr">{masterStatus?.pairingCode ?? '-'}</code>
            </div>
            {masterStatus?.lastError && <p className="form-message form-message--error">{masterStatus.lastError}</p>}
            <table className="data-table" style={{ marginTop: 16 }}>
              <thead>
                <tr><th>الجهاز</th><th>آخر اتصال</th><th>إجراءات</th></tr>
              </thead>
              <tbody>
                {(masterStatus?.pairedDevices ?? []).map((device) => (
                  <tr key={device.id}>
                    <td>{device.name}</td>
                    <td>{device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('ar-EG') : '-'}</td>
                    <td>
                      <button type="button" className="btn btn--danger btn--sm" onClick={async () => { await window.electronAPI.revokeMasterDevice(device.id); setMasterStatus(await window.electronAPI.getMasterNetworkStatus() as typeof masterStatus) }}>
                        إلغاء
                      </button>
                    </td>
                  </tr>
                ))}
                {(masterStatus?.pairedDevices ?? []).length === 0 && (
                  <tr><td colSpan={3}>لا توجد أجهزة مرتبطة</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeSettingsTab === 'backup' && (
          <div className="backup-tab">

            {backupMsg && (
              <p className={`form-message ${backupMsg.includes('فشل') ? 'form-message--error' : 'form-message--ok'}`}
                style={{ marginBottom: 16 }}>
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
                <button type="button" className="btn btn--secondary btn--sm" style={{ marginTop: 8 }}
                  onClick={() => setBackupDirectories((prev) => [...prev, ''])}>
                  + إضافة موقع نسخ آخر
                </button>
              )}

              {/* Quick backup now */}
              <div className="backup-section__actions" style={{ marginTop: 16 }}>
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

              <div className="settings-form-grid" style={{ marginTop: 16 }}>
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

              <div className="form-actions" style={{ marginTop: 8 }}>
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
                <strong style={{ color: 'var(--color-danger)' }}> الاستعادة تستبدل جميع البيانات الحالية وتُعيد تشغيل التطبيق.</strong>
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

          </div>
        )}

        {/* ── Keyboard shortcuts ── */}
        {activeSettingsTab === 'shortcuts' && <ShortcutsTab />}

      </div>{/* end .tab-content */}

      {/* ── Restore confirmation modal ── */}
      {restoreConfirmOpen && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">⚠️ تأكيد استعادة قاعدة البيانات</h2>
            </div>
            <div style={{ background: '#fef2f2', border: '2px solid #ef4444', borderRadius: 6, padding: '12px 16px', marginBottom: 20, fontSize: '0.9rem', lineHeight: 1.7 }}>
              <strong>تحذير:</strong> سيتم استبدال جميع البيانات الحالية (الطلبات، المخزون، الإعدادات)
              بالبيانات الموجودة في ملف النسخة الاحتياطية. هذه العملية لا يمكن التراجع عنها.
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn--danger" onClick={() => void handleRestore()}>نعم، استعد وأعد التشغيل</button>
              <button type="button" className="btn btn--secondary" onClick={() => setRestoreConfirmOpen(false)}>إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
