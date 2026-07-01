import type { AppUser, DeliveryContact } from '@shared/types'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, deleteCachedDoc, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { generateId } from '@renderer/lib/utils/id'
import { actorAuditName } from '@renderer/features/audit/audit-service'

export interface DeliveryContactInput {
  name: string
  phone: string
  address?: string
  notes?: string
}

const EASTERN_DIGITS: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9'
}

export function normalizePhone(phone: string): string {
  let value = phone
    .trim()
    .replace(/[٠-٩۰-۹]/g, (digit) => EASTERN_DIGITS[digit] ?? digit)
    .replace(/[^\d+]/g, '')

  if (value.startsWith('+20')) value = `0${value.slice(3)}`
  else if (value.startsWith('0020')) value = `0${value.slice(4)}`
  else if (value.startsWith('20') && value.length === 12) value = `0${value.slice(2)}`
  else if (value.startsWith('1') && value.length === 10) value = `0${value}`

  return value.replace(/[^\d]/g, '')
}

export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone)
  return normalized.length >= 7 && normalized.length <= 15
}

function normalizeInput(input: DeliveryContactInput): DeliveryContactInput & { normalizedPhone: string } {
  const name = input.name.trim()
  const phone = input.phone.trim()
  const normalizedPhone = normalizePhone(phone)
  if (!name) throw new Error('يرجى إدخال اسم العميل')
  if (!phone || !isValidPhone(phone)) throw new Error('يرجى إدخال رقم هاتف صحيح')
  return {
    name,
    phone: normalizedPhone,
    normalizedPhone,
    address: input.address?.trim() || undefined,
    notes: input.notes?.trim() || undefined
  }
}

export async function listDeliveryContacts(): Promise<DeliveryContact[]> {
  const contacts = await getCachedDocs<DeliveryContact>(COLLECTIONS.deliveryContacts)
  return contacts.sort((a, b) =>
    (b.lastOrderAt ?? b.updatedAt) - (a.lastOrderAt ?? a.updatedAt) ||
    a.name.localeCompare(b.name, 'ar')
  )
}

export async function searchDeliveryContacts(query: string, limit = 8): Promise<DeliveryContact[]> {
  const normalizedQuery = normalizePhone(query)
  const textQuery = query.trim().toLowerCase()
  if (!normalizedQuery && !textQuery) return (await listDeliveryContacts()).slice(0, limit)
  const contacts = await listDeliveryContacts()
  return contacts
    .filter((contact) =>
      (normalizedQuery && contact.normalizedPhone.includes(normalizedQuery)) ||
      (textQuery && contact.name.toLowerCase().includes(textQuery))
    )
    .slice(0, limit)
}

async function assertUniquePhone(normalizedPhone: string, exceptId?: string): Promise<void> {
  const contacts = await getCachedDocs<DeliveryContact>(COLLECTIONS.deliveryContacts)
  const duplicate = contacts.find((contact) =>
    contact.id !== exceptId && contact.normalizedPhone === normalizedPhone
  )
  if (duplicate) throw new Error(`رقم الهاتف مسجل بالفعل للعميل ${duplicate.name}`)
}

export async function createDeliveryContact(input: DeliveryContactInput, actor?: AppUser): Promise<DeliveryContact> {
  const normalized = normalizeInput(input)
  await assertUniquePhone(normalized.normalizedPhone)
  const now = Date.now()
  const contact: DeliveryContact = {
    id: generateId(),
    name: normalized.name,
    phone: normalized.phone,
    normalizedPhone: normalized.normalizedPhone,
    address: normalized.address,
    notes: normalized.notes,
    createdAt: now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.deliveryContacts, [contact])
  if (actor) {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'contact_created',
        actorId: actor.id,
        actorName: actorAuditName(actor),
        targetId: contact.id,
        targetType: 'contact',
        detailAr: `إضافة عميل دليفري: ${contact.name} - ${contact.phone}`
      })
    )
  }
  return contact
}

export async function updateDeliveryContact(
  id: string,
  input: DeliveryContactInput,
  actor?: AppUser
): Promise<DeliveryContact> {
  const existing = await getCachedDoc<DeliveryContact>(COLLECTIONS.deliveryContacts, id)
  if (!existing) throw new Error('لم يتم العثور على العميل')
  const normalized = normalizeInput(input)
  await assertUniquePhone(normalized.normalizedPhone, id)
  const updated: DeliveryContact = {
    ...existing,
    name: normalized.name,
    phone: normalized.phone,
    normalizedPhone: normalized.normalizedPhone,
    address: normalized.address,
    notes: normalized.notes,
    updatedAt: Date.now()
  }
  await cacheDocs(COLLECTIONS.deliveryContacts, [updated])
  if (actor) {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'contact_updated',
        actorId: actor.id,
        actorName: actorAuditName(actor),
        targetId: updated.id,
        targetType: 'contact',
        detailAr: `تعديل عميل دليفري: ${updated.name} - ${updated.phone}`
      })
    )
  }
  return updated
}

export async function deleteDeliveryContact(id: string, actor?: AppUser): Promise<void> {
  const existing = await getCachedDoc<DeliveryContact>(COLLECTIONS.deliveryContacts, id)
  if (!existing) return
  await deleteCachedDoc(COLLECTIONS.deliveryContacts, id)
  if (actor) {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'contact_deleted',
        actorId: actor.id,
        actorName: actorAuditName(actor),
        targetId: id,
        targetType: 'contact',
        detailAr: `حذف عميل دليفري: ${existing.name} - ${existing.phone}`
      })
    )
  }
}

export async function markContactUsed(contactId: string | undefined, orderId: string, orderedAt: number): Promise<void> {
  if (!contactId) return
  const contact = await getCachedDoc<DeliveryContact>(COLLECTIONS.deliveryContacts, contactId)
  if (!contact) return
  await cacheDocs(COLLECTIONS.deliveryContacts, [{
    ...contact,
    lastOrderId: orderId,
    lastOrderAt: orderedAt,
    updatedAt: Date.now()
  }])
}
