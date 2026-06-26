/**
 * Authentication service — SQLite primary.
 *
 * All user data and credentials are stored locally.
 */
import type { AppUser, AppUserCreate, UserRole } from '@shared/types'
import { usernameToEmail } from '@shared/types/user'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbDelete } from '@renderer/lib/db/sqlite-db'
import { actorAuditName, describePatch, type AuditActor } from '@renderer/features/audit/audit-service'

// ---------------------------------------------------------------------------
// Session persistence (localStorage)
// ---------------------------------------------------------------------------

const SESSION_KEY = 'abdokofta.session.v2'

interface StoredSession {
  userId: string
  updatedAt: number
}

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

function writeSession(userId: string): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ userId, updatedAt: Date.now() }))
}

function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

function normalizeUsername(username: string): string {
  return username.toLowerCase().trim()
}

async function enforceCashierWorkShift(user: AppUser): Promise<void> {
  if (user.role !== 'cashier') return
  const { validateUserShiftAccess } = await import('@renderer/features/shifts/work-shift-service')
  const access = await validateUserShiftAccess(user.id)
  if (!access.allowed) {
    throw new Error(access.reason ?? 'لا يمكن تسجيل الدخول خارج وقت وردية العمل')
  }
}

async function isLanSideDevice(): Promise<boolean> {
  const network = await window.electronAPI.getNetworkStatus().catch(() => null) as { mode?: string } | null
  return network?.mode === 'side'
}

async function storeLocalCredential(user: AppUser, password: string): Promise<void> {
  const username = normalizeUsername(user.username)
  await window.electronAPI.authStoreCredential(username, password, user)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function hasOfflineAuthUsers(): Promise<boolean> {
  const result = await window.electronAPI.authHasUsers().catch(() => null)
  return result?.ok === true && result.hasUsers
}

/** Restore session from localStorage → look up user in SQLite */
export async function restoreSessionFromLocal(): Promise<AppUser | null> {
  const session = readSession()
  if (!session) return null
  const user = await getCachedDoc<AppUser>(COLLECTIONS.users, session.userId)
  if (!user?.active) return null
  try {
    await enforceCashierWorkShift(user)
  } catch {
    clearSession()
    return null
  }
  return user
}

/** Login with username + password from the local credential store. */
export async function loginAndLoadUser(username: string, password: string): Promise<AppUser> {
  const normalized = normalizeUsername(username)
  const mainAuth = await window.electronAPI.authLoginLocal(normalized, password).catch(() => null)
  if (mainAuth?.ok && mainAuth.user) {
    const user = mainAuth.user as AppUser
    await enforceCashierWorkShift(user)
    writeSession(user.id)
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({ action: 'login', actorId: user.id, actorName: actorAuditName(user), detailAr: `ØªØ³Ø¬ÙŠÙ„ Ø¯Ø®ÙˆÙ„: ${user.displayName}` })
    )
    return user
  }
  if (await isLanSideDevice()) {
    throw new Error(mainAuth?.error ?? 'لا يمكن تسجيل الدخول على الجهاز الجانبي بدون اتصال صحيح بالماستر')
  }

  const userId = null
  if (!userId) {
    throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة')
  }
  const user = await getCachedDoc<AppUser>(COLLECTIONS.users, userId)
  if (!user) {
    throw new Error('لم يتم العثور على بيانات المستخدم — حاول مجددًا')
  }
  if (!user.active) {
    throw new Error('الحساب غير نشط')
  }
  await enforceCashierWorkShift(user)
  writeSession(user.id)
  // Audit: login
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({ action: 'login', actorId: user.id, actorName: actorAuditName(user), detailAr: `تسجيل دخول: ${user.displayName}` })
  )
  return user
}

/** Logout — clear local session only */
export async function logoutUser(user?: { id: string; displayName: string; username?: string }): Promise<void> {
  if (user) {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({ action: 'logout', actorId: user.id, actorName: actorAuditName(user), detailAr: `تسجيل خروج: ${user.displayName}` })
    )
  }
  clearSession()
}

/** Create a new manager account (first-time setup) */
export async function createFirstOfflineManager(params: {
  username: string
  password: string
  displayName?: string
}): Promise<AppUser> {
  if (await isLanSideDevice()) {
    throw new Error('لا يمكن إنشاء مدير محلي على جهاز جانبي. سجّل الدخول بحساب موجود على الماستر.')
  }
  if (await hasOfflineAuthUsers()) {
    throw new Error('يوجد حساب محلي بالفعل')
  }
  const username = normalizeUsername(params.username)
  if (!username) throw new Error('اسم المستخدم مطلوب')
  if (params.password.length < 6) throw new Error('كلمة المرور يجب أن تكون 6 أحرف على الأقل')

  const now = Date.now()
  const user: AppUser = {
    id: `local_${username}`,
    email: usernameToEmail(username),
    username,
    displayName: params.displayName?.trim() || username,
    role: 'manager',
    active: true,
    createdAt: now,
    updatedAt: now
  }
  await cacheDocs(COLLECTIONS.users, [user])
  await storeLocalCredential(user, params.password)
  writeSession(user.id)
  return user
}

/** Fetch a user by ID from SQLite */
export async function fetchAppUser(uid: string): Promise<AppUser | null> {
  return getCachedDoc<AppUser>(COLLECTIONS.users, uid)
}

/** List all non-manager users from SQLite */
export async function listUsersByRole(role: UserRole): Promise<AppUser[]> {
  const users = await getCachedDocs<AppUser>(COLLECTIONS.users)
  return users.filter((u) => u.role === role)
}

/** List all accounts except the current manager's own account */
export async function listAllAccounts(excludeId?: string): Promise<AppUser[]> {
  const users = await getCachedDocs<AppUser>(COLLECTIONS.users)
  return users
    .filter((u) => !excludeId || u.id !== excludeId)
    .sort((a, b) => {
      const roleOrder: Record<UserRole, number> = { manager: 0, supervisor: 1, cashier: 2 }
      const ro = (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3)
      if (ro !== 0) return ro
      return a.displayName.localeCompare(b.displayName, 'ar')
    })
}

/** Create any account (cashier, supervisor, or additional manager) */
export async function createAccount(
  data: AppUserCreate,
  _createdByManagerId: string
): Promise<AppUser> {
  const username = normalizeUsername(data.username)
  if (
    data.maxCashRoundingDifference != null &&
    (!Number.isFinite(data.maxCashRoundingDifference) || data.maxCashRoundingDifference < 0)
  ) {
    throw new Error('حد تقريب النقدي غير صالح')
  }
  const existing = await getCachedDocs<AppUser>(COLLECTIONS.users)

  // Check cashier code uniqueness locally
  if (data.cashierCode) {
    const code = data.cashierCode.trim().toUpperCase()
    if (!/^[A-Z0-9]{2}$/.test(code)) {
      throw new Error('كود الإيصال يجب أن يكون حرفين أو رقمين فقط')
    }
    const taken = existing.some((u) => u.cashierCode?.toUpperCase() === code)
    if (taken) throw new Error('كود الإيصال مستخدم بالفعل')
  }

  const now = Date.now()
  const user: AppUser = {
    id: `local_${username}_${now}`,
    email: usernameToEmail(username),
    username,
    displayName: data.displayName,
    cashierCode: data.cashierCode?.toUpperCase(),
    role: data.role,
    permissions: data.permissions,
    allowCashRounding: data.allowCashRounding ?? false,
    maxCashRoundingDifference: data.maxCashRoundingDifference,
    active: true,
    createdAt: now,
    updatedAt: now
  }

  await cacheDocs(COLLECTIONS.users, [user])
  await storeLocalCredential(user, data.password)
  const actor = existing.find((u) => u.id === _createdByManagerId)

  // Audit: account created
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({
      action: 'account_created',
      actorId: _createdByManagerId,
      actorName: actor?.username ?? _createdByManagerId,
      targetId: user.id,
      targetType: 'user',
      detailAr: `إنشاء حساب جديد: ${user.displayName} (${user.role})`
    })
  )

  return user
}

/** Backwards-compat alias */
export const createCashierAccount = createAccount

export async function updateUserActive(userId: string, active: boolean, actorId = 'system', actorName = 'النظام'): Promise<void> {
  const cached = await getCachedDoc<AppUser>(COLLECTIONS.users, userId)
  if (!cached) return
  await cacheDocs(COLLECTIONS.users, [{ ...cached, active, updatedAt: Date.now() }])
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({
      action: 'account_deactivated',
      actorId,
      actorName,
      targetId: userId,
      targetType: 'user',
      detailAr: `${active ? 'تفعيل' : 'تعطيل'} حساب: ${cached.displayName}`
    })
  )
}

export async function updateUserProfile(
  userId: string,
  patch: Partial<Pick<AppUser, 'displayName' | 'username' | 'pinHash' | 'cashierCode' | 'role' | 'permissions' | 'allowCashRounding' | 'maxCashRoundingDifference'>>,
  actor?: AuditActor
): Promise<void> {
  const cached = await getCachedDoc<AppUser>(COLLECTIONS.users, userId)
  if (!cached) return
  if (
    patch.maxCashRoundingDifference != null &&
    (!Number.isFinite(patch.maxCashRoundingDifference) || patch.maxCashRoundingDifference < 0)
  ) {
    throw new Error('حد تقريب النقدي غير صالح')
  }
  const normalizedPatch = {
    ...patch,
    cashierCode: patch.cashierCode?.toUpperCase()
  }

  // Check cashier code uniqueness
  if (normalizedPatch.cashierCode) {
    const all = await getCachedDocs<AppUser>(COLLECTIONS.users)
    const taken = all.some(
      (u) => u.id !== userId && u.cashierCode?.toUpperCase() === normalizedPatch.cashierCode
    )
    if (taken) throw new Error('كود الكاشير مستخدم بالفعل')
  }

  await cacheDocs(COLLECTIONS.users, [{ ...cached, ...normalizedPatch, updatedAt: Date.now() }])
  if (actor) {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'account_updated',
        actorId: actor.id,
        actorName: actorAuditName(actor),
        targetId: userId,
        targetType: 'user',
        detailAr: `تعديل حساب: ${cached.username} — ${describePatch({ ...normalizedPatch, pinHash: normalizedPatch.pinHash ? 'تم التعيين' : normalizedPatch.pinHash })}`
      })
    )
  }
}

export async function resetCashierPassword(userId: string, newPassword: string, actor?: AuditActor): Promise<void> {
  const cached = await getCachedDoc<AppUser>(COLLECTIONS.users, userId)
  if (!cached) throw new Error('المستخدم غير موجود')

  await storeLocalCredential(cached, newPassword)
  await cacheDocs(COLLECTIONS.users, [{ ...cached, updatedAt: Date.now() }])
  if (actor) {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'account_updated',
        actorId: actor.id,
        actorName: actorAuditName(actor),
        targetId: userId,
        targetType: 'user',
        detailAr: `تغيير كلمة مرور حساب: ${cached.username}`
      })
    )
  }

}

export async function deleteAccount(userId: string, currentUserId: string): Promise<void> {
  if (userId === currentUserId) {
    throw new Error('لا يمكنك حذف حسابك الخاص')
  }

  const cached = await getCachedDoc<AppUser>(COLLECTIONS.users, userId)
  const actor = await getCachedDoc<AppUser>(COLLECTIONS.users, currentUserId)
  if (cached) {
    await dbDelete(COLLECTIONS.users, userId)
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'account_deleted',
        actorId: currentUserId,
        actorName: actor?.username ?? currentUserId,
        targetId: userId,
        targetType: 'user',
        detailAr: `حذف حساب: ${cached.displayName}`
      })
    )
  }

}

// ---------------------------------------------------------------------------
// Backwards-compat exports (used in reconcile-service and pin-bootstrap)
// ---------------------------------------------------------------------------

export interface PendingLocalAuthUser {
  uid: string
  email: string
  username: string
  password: string
  displayName: string
  updatedAt: number
}

/** No longer needed with SQLite-primary approach — returns empty array */
export function getPendingLocalAuthUsers(): PendingLocalAuthUser[] {
  return []
}

/** No-op — kept for backwards compat */
export function clearPendingLocalAuthUser(_uid: string): void {
  // no-op
}

/** Delete a document directly from SQLite (used by admin operations) */
export async function removeUserDoc(userId: string): Promise<void> {
  await dbDelete(COLLECTIONS.users, userId)
}
