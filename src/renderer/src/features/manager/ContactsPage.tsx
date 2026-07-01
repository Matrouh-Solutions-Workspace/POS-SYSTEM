import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { DeliveryContact } from '@shared/types'
import { ConfirmDialog, FormModal } from '@renderer/components/ui'
import { useAuthStore } from '@renderer/features/auth/auth-store'
import {
  createDeliveryContact,
  deleteDeliveryContact,
  listDeliveryContacts,
  normalizePhone,
  updateDeliveryContact
} from '@renderer/features/contacts/delivery-contact-service'

type ContactForm = {
  name: string
  phone: string
  address: string
  notes: string
}

const EMPTY_FORM: ContactForm = { name: '', phone: '', address: '', notes: '' }

export function ContactsPage(): React.ReactElement {
  const user = useAuthStore((state) => state.user)!
  const [contacts, setContacts] = useState<DeliveryContact[]>([])
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [messageKind, setMessageKind] = useState<'ok' | 'error'>('ok')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<DeliveryContact | null>(null)
  const [details, setDetails] = useState<DeliveryContact | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeliveryContact | null>(null)
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM)

  const load = useCallback(async () => {
    setContacts(await listDeliveryContacts())
  }, [])

  useEffect(() => { void load() }, [load])

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase()
    const normalized = normalizePhone(search)
    if (!query && !normalized) return contacts
    return contacts.filter((contact) =>
      contact.name.toLowerCase().includes(query) ||
      contact.normalizedPhone.includes(normalized)
    )
  }, [contacts, search])

  function openCreate(): void {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEdit(contact: DeliveryContact): void {
    setEditing(contact)
    setForm({
      name: contact.name,
      phone: contact.phone,
      address: contact.address ?? '',
      notes: contact.notes ?? ''
    })
    setFormOpen(true)
  }

  async function submitContact(e?: FormEvent): Promise<void> {
    if (e) e.preventDefault()
    try {
      if (editing) {
        await updateDeliveryContact(editing.id, form, user)
        setMessage('تم تحديث العميل')
      } else {
        await createDeliveryContact(form, user)
        setMessage('تم إضافة العميل')
      }
      setMessageKind('ok')
      setFormOpen(false)
      setEditing(null)
      setForm(EMPTY_FORM)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'تعذر حفظ العميل')
      setMessageKind('error')
    }
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return
    await deleteDeliveryContact(deleteTarget.id, user)
    setMessage(`تم حذف العميل ${deleteTarget.name}`)
    setMessageKind('ok')
    setDeleteTarget(null)
    if (details?.id === deleteTarget.id) setDetails(null)
    await load()
  }

  return (
    <div className="settings-page contacts-page">
      {message && <p className={`form-message form-message--${messageKind}`}>{message}</p>}

      <div className="card settings-page__full">
        <div className="page-toolbar section-action-header mb-16">
          <div>
            <h2 className="card__title m-0">إدارة العملاء</h2>
            <p className="muted m-0">إدارة أرقام وعناوين العملاء لاستخدامها بسرعة في طلبات الدليفري.</p>
          </div>
          <button type="button" className="btn btn--primary" onClick={openCreate}>+ إضافة عميل</button>
        </div>

        <label className="field">
          <span>بحث بالاسم أو رقم الهاتف</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="مثال: 01012345678 أو Ahmed" />
        </label>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>الهاتف</th>
                <th>العنوان</th>
                <th>تاريخ الإضافة</th>
                <th>آخر تحديث</th>
                <th>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {filteredContacts.length === 0 ? (
                <tr><td colSpan={6}>لا توجد جهات اتصال مطابقة.</td></tr>
              ) : filteredContacts.map((contact) => (
                <tr key={contact.id}>
                  <td>{contact.name}</td>
                  <td dir="ltr">{contact.phone}</td>
                  <td>{contact.address ?? '-'}</td>
                  <td>{new Date(contact.createdAt).toLocaleString('ar-EG')}</td>
                  <td>{new Date(contact.updatedAt).toLocaleString('ar-EG')}</td>
                  <td>
                    <div className="table-actions">
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => setDetails(contact)}>تفاصيل</button>
                      <button type="button" className="btn btn--secondary btn--sm" onClick={() => openEdit(contact)}>تعديل</button>
                      <button type="button" className="btn btn--danger btn--sm" onClick={() => setDeleteTarget(contact)}>حذف</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <FormModal
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditing(null) }}
        entityName="عميل"
        isEdit={Boolean(editing)}
        onSubmit={submitContact}
      >
        <label className="field">
          <span>اسم العميل</span>
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
        </label>
        <label className="field">
          <span>رقم الهاتف</span>
          <input dir="ltr" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} required />
        </label>
        <label className="field">
          <span>العنوان</span>
          <input value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} />
        </label>
        <label className="field">
          <span>ملاحظات</span>
          <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows={3} />
        </label>
      </FormModal>

      {details && (
        <div className="modal-overlay" onClick={() => setDetails(null)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={(event) => event.stopPropagation()}>
            <div className="order-details__header">
              <h2 className="order-details__title">تفاصيل العميل</h2>
              <button type="button" className="order-details__close" onClick={() => setDetails(null)} aria-label="إغلاق">×</button>
            </div>
            <div className="checkout-modal__readonly-summary">
              <div><span>الاسم</span><strong>{details.name}</strong></div>
              <div><span>الهاتف</span><strong dir="ltr">{details.phone}</strong></div>
              <div><span>العنوان</span><strong>{details.address ?? '-'}</strong></div>
              <div><span>ملاحظات</span><strong>{details.notes ?? '-'}</strong></div>
              <div><span>آخر طلب</span><strong>{details.lastOrderAt ? new Date(details.lastOrderAt).toLocaleString('ar-EG') : '-'}</strong></div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
        title="تأكيد حذف العميل"
        message={deleteTarget ? `هل تريد حذف العميل ${deleteTarget.name}؟ الطلبات القديمة ستحتفظ بنسخة الاسم ورقم الهاتف.` : ''}
        confirmLabel="حذف"
        cancelLabel="إلغاء"
      />
    </div>
  )
}
