import { useState, useEffect, type FormEvent } from 'react'
import type { AppSettings, KitchenPrinter, KitchenPrinterVisibility, SystemPrinter } from '@shared/types'
import {
  createKitchenPrinter,
  DEFAULT_KITCHEN_VISIBILITY,
  deleteKitchenPrinter,
  listKitchenPrinters,
  listSystemPrinters,
  updateKitchenPrinter
} from '@renderer/features/printers/printer-service'
import { buildKitchenTicketHtml } from '@renderer/features/printers/kitchen-printing'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { MdDelete, MdPrint, MdRefresh, MdSave, MdVisibility } from 'react-icons/md'

export function PrintersTab({ settings }: { settings: AppSettings }): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [systemPrinters, setSystemPrinters] = useState<SystemPrinter[]>([])
  const [kitchenPrinters, setKitchenPrinters] = useState<KitchenPrinter[]>([])
  const [selectedDeviceName, setSelectedDeviceName] = useState('')
  const [printerName, setPrinterName] = useState('')
  const [description, setDescription] = useState('')
  const [copies, setCopies] = useState(1)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [defaultReceiptDeviceName, setDefaultReceiptDeviceName] = useState('')
  const [defaultReceiptSaving, setDefaultReceiptSaving] = useState(false)
  const [defaultReportDeviceName, setDefaultReportDeviceName] = useState('')
  const [reportPageSize, setReportPageSize] = useState<'A4' | 'Letter'>('A4')
  const [reportOrientation, setReportOrientation] = useState<'portrait' | 'landscape'>('portrait')
  const [reportCopies, setReportCopies] = useState(1)
  const [defaultReportSaving, setDefaultReportSaving] = useState(false)

  async function load(): Promise<void> {
    const [system, saved, defaultReceiptPrinter, defaultReportPrinter] = await Promise.all([
      listSystemPrinters().catch(() => []),
      listKitchenPrinters(),
      window.electronAPI.getDefaultReceiptPrinter().catch(() => null),
      window.electronAPI.getDefaultReportPrinter().catch(() => null)
    ])
    setSystemPrinters(system)
    setKitchenPrinters(saved)
    setDefaultReceiptDeviceName(defaultReceiptPrinter?.deviceName ?? '')
    setDefaultReportDeviceName(defaultReportPrinter?.deviceName ?? '')
    setReportPageSize(defaultReportPrinter?.options?.pageSize ?? 'A4')
    setReportOrientation(defaultReportPrinter?.options?.orientation ?? 'portrait')
    setReportCopies(defaultReportPrinter?.options?.copies ?? 1)
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
        visibility: DEFAULT_KITCHEN_VISIBILITY,
        actor: user
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
    }, user).then(load)
  }

  async function saveDefaultReceiptPrinter(): Promise<void> {
    setDefaultReceiptSaving(true)
    setMessage(null)
    try {
      const printer = systemPrinters.find((p) => p.name === defaultReceiptDeviceName)
      await window.electronAPI.setDefaultReceiptPrinter(printer ? {
        deviceName: printer.name,
        displayName: printer.displayName || printer.name
      } : null)
      setMessage(printer ? 'تم حفظ طابعة فواتير هذا الجهاز' : 'تم الرجوع لاختيار الطابعة')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'فشل حفظ طابعة الفواتير')
    } finally {
      setDefaultReceiptSaving(false)
    }
  }

  async function testDefaultPrinter(kind: 'receipt' | 'report'): Promise<void> {
    setMessage(null)
    const result = await window.electronAPI.testDefaultPrinter(kind)
    if (result.ok) {
      setMessage(kind === 'receipt' ? 'تم إرسال اختبار طباعة الفواتير' : 'تم إرسال اختبار طباعة التقارير')
    } else {
      setMessage(result.error ?? 'فشل اختبار الطباعة')
    }
  }

  async function saveDefaultReportPrinter(): Promise<void> {
    setDefaultReportSaving(true)
    setMessage(null)
    try {
      const printer = systemPrinters.find((p) => p.name === defaultReportDeviceName)
      await window.electronAPI.setDefaultReportPrinter(printer ? {
        deviceName: printer.name,
        displayName: printer.displayName || printer.name,
        options: {
          pageSize: reportPageSize,
          orientation: reportOrientation,
          copies: reportCopies
        }
      } : null)
      setMessage(printer ? 'تم حفظ طابعة التقارير لهذا الجهاز' : 'تم مسح طابعة التقارير لهذا الجهاز')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'فشل حفظ طابعة التقارير')
    } finally {
      setDefaultReportSaving(false)
    }
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
    <>
    <div className="card">
      <h2 className="card__title"><MdPrint style={{ verticalAlign: 'middle', marginLeft: 6 }} />طابعات هذا الجهاز</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: 16 }}>
        اختر الطابعة الافتراضية لفواتير العملاء والتقارير على هذا الجهاز. طابعات التجهيز لها قسم مستقل بالأسفل.
      </p>
      {message && <p className={`form-message ${message.includes('فشل') || message.includes('اختر') ? 'form-message--error' : 'form-message--ok'}`}>{message}</p>}

      <div className="receipt-designer-panel" style={{ marginBottom: 18 }}>
        <h3 className="card__title">طابعة فواتير هذا الجهاز</h3>
        <div className="settings-form-grid">
          <label className="field">
            <span>الطابعة الافتراضية لفواتير العملاء</span>
            <select value={defaultReceiptDeviceName} onChange={(e) => setDefaultReceiptDeviceName(e.target.value)}>
              <option value="">اختيار الطابعة</option>
              {systemPrinters.map((printer) => (
                <option key={printer.name} value={printer.name}>
                  {printer.displayName || printer.name}{printer.isDefault ? ' (افتراضية في النظام)' : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions" style={{ alignSelf: 'end' }}>
            <button type="button" className="btn btn--primary" disabled={defaultReceiptSaving} onClick={() => void saveDefaultReceiptPrinter()}>
              <MdSave /> {defaultReceiptSaving ? 'جار الحفظ...' : 'حفظ طابعة الفواتير'}
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => void load()}>
              <MdRefresh /> تحديث
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => void testDefaultPrinter('receipt')}>
              <MdPrint /> اختبار طباعة
            </button>
          </div>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', margin: '8px 0 0' }}>
          في وضع الجهاز الجانبي: إذا كانت طباعة الفاتورة على الجهاز الجانبي فسيستخدم هذه الطابعة. إذا كانت على الماستر فسيستخدم طابعة الفواتير الافتراضية المحفوظة على الماستر.
        </p>
      </div>

      <div className="receipt-designer-panel" style={{ marginBottom: 18 }}>
        <h3 className="card__title">طابعة تقارير هذا الجهاز</h3>
        <div className="settings-form-grid">
          <label className="field">
            <span>الطابعة الافتراضية للتقارير</span>
            <select value={defaultReportDeviceName} onChange={(e) => setDefaultReportDeviceName(e.target.value)}>
              <option value="">اختيار الطابعة</option>
              {systemPrinters.map((printer) => (
                <option key={printer.name} value={printer.name}>
                  {printer.displayName || printer.name}{printer.isDefault ? ' (افتراضية في النظام)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>مقاس الورق</span>
            <select value={reportPageSize} onChange={(e) => setReportPageSize(e.target.value as typeof reportPageSize)}>
              <option value="A4">A4</option>
              <option value="Letter">Letter</option>
            </select>
          </label>
          <label className="field">
            <span>الاتجاه</span>
            <select value={reportOrientation} onChange={(e) => setReportOrientation(e.target.value as typeof reportOrientation)}>
              <option value="portrait">رأسي</option>
              <option value="landscape">أفقي</option>
            </select>
          </label>
          <label className="field">
            <span>عدد النسخ</span>
            <input type="number" min="1" max="5" value={reportCopies} onChange={(e) => setReportCopies(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} />
          </label>
          <div className="form-actions settings-form-grid__full">
            <button type="button" className="btn btn--primary" disabled={defaultReportSaving} onClick={() => void saveDefaultReportPrinter()}>
              <MdSave /> {defaultReportSaving ? 'جار الحفظ...' : 'حفظ طابعة التقارير'}
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => void testDefaultPrinter('report')}>
              <MdPrint /> اختبار طباعة
            </button>
          </div>
        </div>
        <p style={{ fontSize: '0.82rem', color: 'var(--color-muted)', margin: '8px 0 0' }}>
          التقارير تستخدم هذه الطابعة والخيارات عند الضغط على طباعة من صفحة التقارير.
        </p>
      </div>
    </div>

    <div className="card">
      <h2 className="card__title"><MdPrint style={{ verticalAlign: 'middle', marginLeft: 6 }} />طابعات التجهيز</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: 16 }}>
        أضف طابعات المطبخ أو الجريل أو التجهيز، ثم اربط كل صنف بطابعة أو أكثر من صفحة الأصناف. عند الطلب يتم تجميع كل أصناف الطابعة في إيصال تجهيز واحد.
      </p>

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
          <span>اسم الطابعة داخل النظام</span>
          <input value={printerName} onChange={(e) => setPrinterName(e.target.value)} placeholder="مثال: جريل خارجي" />
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
                  onChange={(e) => void updateKitchenPrinter(printer.id, { name: e.target.value }, user).then(load)}
                />
                <input
                  className="inline-edit-input mt-4"
                  value={printer.description ?? ''}
                  onChange={(e) => void updateKitchenPrinter(printer.id, { description: e.target.value }, user).then(load)}
                  placeholder="ملاحظة"
                />
              </td>
              <td>
                <select
                  className="inline-edit-input"
                  value={printer.deviceName}
                  onChange={(e) => void updateKitchenPrinter(printer.id, { deviceName: e.target.value }, user).then(load)}
                >
                  {systemPrinters.some((p) => p.name === printer.deviceName) || <option value={printer.deviceName}>{printer.deviceName} (غير مكتشفة الآن)</option>}
                  {systemPrinters.map((systemPrinter) => (
                    <option key={systemPrinter.name} value={systemPrinter.name}>
                      {systemPrinter.displayName || systemPrinter.name}{systemPrinter.isDefault ? ' (افتراضية)' : ''}
                    </option>
                  ))}
                </select>
                <label className="field mt-6">
                  <span>نسخ</span>
                  <input type="number" min="1" max="5" value={printer.copies} onChange={(e) => void updateKitchenPrinter(printer.id, { copies: Number(e.target.value) || 1 }, user).then(load)} />
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
                <select className="inline-edit-input" value={printer.active ? 'active' : 'inactive'} onChange={(e) => void updateKitchenPrinter(printer.id, { active: e.target.value === 'active' }, user).then(load)}>
                  <option value="active">مفعلة</option>
                  <option value="inactive">معطلة</option>
                </select>
              </td>
              <td>
                <div className="table-actions">
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => openPreview(printer)}>
                    <MdVisibility /> معاينة
                  </button>
                  <button type="button" className="btn btn--danger btn--sm" onClick={() => void deleteKitchenPrinter(printer.id, user).then(load)}>
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
    </>
  )
}
