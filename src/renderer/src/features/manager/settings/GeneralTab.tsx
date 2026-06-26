import { useState, useEffect, type FormEvent } from 'react'
import type { AppSettings } from '@shared/types'
import { updateSettings } from '@renderer/features/orders/order-service'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import { ReceiptDesigner } from './ReceiptDesigner'
import { MdSave } from 'react-icons/md'

export function GeneralTab({ settings, onSettingsSaved }: { settings: AppSettings, onSettingsSaved: (s: AppSettings) => void }): React.ReactElement {
  const user = useAuthStore((s) => s.user)!
  const [receiptForm, setReceiptForm] = useState({ restaurantNameAr: '', currencySymbol: '', phoneNumber: '', receiptFooterAr: '', taxRate: '', serviceRate: '', defaultDeliveryFee: '', maxCashierDiscountPct: '', cashRoundingEnabled: false, maxCashRoundingDifference: '5' })
  const [receiptSaving, setReceiptSaving] = useState(false)
  const [receiptMsg, setReceiptMsg] = useState<string | null>(null)

  useEffect(() => {
    setReceiptForm({
      restaurantNameAr: settings.restaurantNameAr,
      currencySymbol: settings.currencySymbol,
      phoneNumber: settings.phoneNumber ?? '',
      receiptFooterAr: settings.receiptFooterAr ?? '',
      taxRate: settings.taxRate != null && settings.taxRate > 0 ? String(settings.taxRate) : '',
      serviceRate: settings.serviceRate != null && settings.serviceRate > 0 ? String(settings.serviceRate) : '',
      defaultDeliveryFee: settings.defaultDeliveryFee != null && settings.defaultDeliveryFee > 0 ? String(settings.defaultDeliveryFee) : '',
      maxCashierDiscountPct: settings.maxCashierDiscountPct != null && settings.maxCashierDiscountPct < 100 ? String(settings.maxCashierDiscountPct) : '',
      cashRoundingEnabled: settings.cashRoundingEnabled === true,
      maxCashRoundingDifference: String(settings.maxCashRoundingDifference ?? 5)
    })
  }, [settings])

  async function handleReceiptSave(e: FormEvent): Promise<void> {
    e.preventDefault()
    setReceiptSaving(true)
    setReceiptMsg(null)
    try {
      const patch: Partial<AppSettings> = {
        restaurantNameAr: receiptForm.restaurantNameAr.trim(),
        currencySymbol: receiptForm.currencySymbol.trim(),
        phoneNumber: receiptForm.phoneNumber.trim() || undefined,
        receiptFooterAr: receiptForm.receiptFooterAr.trim() || undefined,
        taxRate: receiptForm.taxRate ? Number(receiptForm.taxRate) : 0,
        serviceRate: receiptForm.serviceRate ? Number(receiptForm.serviceRate) : 0,
        defaultDeliveryFee: receiptForm.defaultDeliveryFee ? Number(receiptForm.defaultDeliveryFee) : 0,
        maxCashierDiscountPct: receiptForm.maxCashierDiscountPct ? Number(receiptForm.maxCashierDiscountPct) : undefined,
        cashRoundingEnabled: receiptForm.cashRoundingEnabled,
        maxCashRoundingDifference: Math.max(0, Number(receiptForm.maxCashRoundingDifference) || 0)
      }
      await updateSettings(patch, user)
      onSettingsSaved({ ...settings, ...patch, updatedAt: Date.now() })
      setReceiptMsg('تم حفظ إعدادات الإيصال')
    } catch { setReceiptMsg('فشل الحفظ') }
    finally { setReceiptSaving(false) }
  }

  return (
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
            <span>نسبة الخدمة % (0 = بدون خدمة)</span>
            <input type="number" min="0" max="100" step="0.1" value={receiptForm.serviceRate} onChange={(e) => setReceiptForm((f) => ({ ...f, serviceRate: e.target.value }))} placeholder="0" />
          </label>
          <label className="field">
            <span>رسوم التوصيل الافتراضية</span>
            <input type="number" min="0" step="0.01" value={receiptForm.defaultDeliveryFee} onChange={(e) => setReceiptForm((f) => ({ ...f, defaultDeliveryFee: e.target.value }))} placeholder="0.00" />
          </label>
          <label className="field">
            <span>الحد الأقصى لخصم الكاشير % (فارغ = بدون حد)</span>
            <input type="number" min="0" max="100" step="1" value={receiptForm.maxCashierDiscountPct} onChange={(e) => setReceiptForm((f) => ({ ...f, maxCashierDiscountPct: e.target.value }))} placeholder="مثال: 20" />
          </label>
          <label className="field field--checkbox">
            <input type="checkbox" checked={receiptForm.cashRoundingEnabled} onChange={(event) => setReceiptForm((form) => ({ ...form, cashRoundingEnabled: event.target.checked }))} />
            <span>تفعيل تقريب الدفع النقدي</span>
          </label>
          <label className="field">
            <span>أقصى فرق تقريب مسموح</span>
            <input type="number" min="0" step="0.01" disabled={!receiptForm.cashRoundingEnabled} value={receiptForm.maxCashRoundingDifference} onChange={(event) => setReceiptForm((form) => ({ ...form, maxCashRoundingDifference: event.target.value }))} placeholder="5.00" />
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={receiptSaving}>
            <MdSave /> {receiptSaving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
          </button>
        </div>
      </form>
      <div style={{ marginTop: 18 }}>
        <ReceiptDesigner settings={settings} onSettingsSaved={onSettingsSaved} />
      </div>
    </div>
  )
}
