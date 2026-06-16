/**
 * Authentication service — SQLite primary, Firebase background.
 *
 * All user data is stored in SQLite. Firebase Auth is only used
 * in the background to keep the cloud in sync.
 */
import type { AppUser, AppUserCreate, UserRole } from '@shared/types'
import { usernameToEmail } from '@shared/types/user'
import { COLLECTIONS } from '@shared/constants/collections'
import { cacheDocs, getCachedDoc, getCachedDocs } from '@renderer/lib/offline/sqlite-cache'
import { dbDelete } from '@renderer/lib/db/sqlite-db'

// ---------------------------------------------------------------------------
// Session persistence (localStorage)
// ---------------------------------------------------------------------------

const SESSION_KEY = 'abdokofta.session.v2'
const OFFLINE_AUTH_KEY = 'abdokofta.offlineAuth.v1'

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

// ---------------------------------------------------------------------------
// Offline auth cache (hashed passwords in localStorage)
// ---------------------------------------------------------------------------

interface CachedAuthUser {
  username: string
  passwordHash: string
  userId: string
  updatedAt: number
}

function readAuthCache(): CachedAuthUser[] {
  try {
    return JSON.parse(localStorage.getItem(OFFLINE_AUTH_KEY) ?? '[]') as CachedAuthUser[]
  } catch {
    return []
  }
}

function writeAuthCache(entries: CachedAuthUser[]): void {
  localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify(entries))
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function normalizeUsername(username: string): string {
  return username.toLowerCase().trim()
}

async function storeLocalCredential(user: AppUser, password: string): Promise<void> {
  const username = normalizeUsername(user.username)
  const passwordHash = await sha256(`${username}:${password}`)
  const existing = readAuthCache().filter((e) => e.username !== username)
  existing.push({ username, passwordHash, userId: user.id, updatedAt: Date.now() })
  writeAuthCache(existing)
  await window.electronAPI.authStoreCredential(username, passwordHash, user)
}

async function verifyLocalCredential(username: string, password: string): Promise<string | null> {
  const norm = normalizeUsername(username)
  const hash = await sha256(`${norm}:${password}`)
  const match = readAuthCache().find((e) => e.username === norm && e.passwordHash === hash)
  return match?.userId ?? null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function hasOfflineAuthUsers(): boolean {
  return readAuthCache().length > 0
}

/** Restore session from localStorage → look up user in SQLite */
export async function restoreSessionFromLocal(): Promise<AppUser | null> {
  const session = readSession()
  if (!session) return null
  const user = await getCachedDoc<AppUser>(COLLECTIONS.users, session.userId)
  if (!user?.active) return null
  return user
}

/** Login with username + password — reads from SQLite, no Firebase required */
export async function loginAndLoadUser(username: string, password: string): Promise<AppUser> {
  const normalized = normalizeUsername(username)
  const passwordHash = await sha256(`${normalized}:${password}`)
  const mainAuth = await window.electronAPI.authLoginLocal(normalized, passwordHash).catch(() => null)
  if (mainAuth?.ok && mainAuth.user) {
    const user = mainAuth.user as AppUser
    writeSession(user.id)
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({ action: 'login', actorId: user.id, actorName: user.displayName, detailAr: `ØªØ³Ø¬ÙŠÙ„ Ø¯Ø®ÙˆÙ„: ${user.displayName}` })
    )
    return user
  }

  const userId = await verifyLocalCredential(username, password)
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
  writeSession(user.id)
  // Audit: login
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({ action: 'login', actorId: user.id, actorName: user.displayName, detailAr: `تسجيل دخول: ${user.displayName}` })
  )
  return user
}

/** Logout — clear local session only */
export async function logoutUser(user?: { id: string; displayName: string }): Promise<void> {
  if (user) {
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({ action: 'logout', actorId: user.id, actorName: user.displayName, detailAr: `تسجيل خروج: ${user.displayName}` })
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
  if (hasOfflineAuthUsers()) {
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
    active: true,
    createdAt: now,
    updatedAt: now
  }

  await cacheDocs(COLLECTIONS.users, [user])
  await storeLocalCredential(user, data.password)

  // Audit: account created
  void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
    logAudit({
      action: 'account_created',
      actorId: _createdByManagerId,
      actorName: 'مدير',
      targetId: user.id,
      targetType: 'user',
      detailAr: `إنشاء حساب جديد: ${user.displayName} (${user.role})`
    })
  )

  // Background: create in Firebase Auth (fire-and-forget)
  void (async () => {
    try {
      await window.electronAPI.ensureAuthUser({
        uid: user.id,
        email: user.email,
        password: data.password,
        displayName: user.displayName
      })
    } catch {
      // Best-effort — user already saved locally
    }
  })()

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
  patch: Partial<Pick<AppUser, 'displayName' | 'username' | 'pinHash' | 'cashierCode' | 'role' | 'permissions'>>
): Promise<void> {
  const cached = await getCachedDoc<AppUser>(COLLECTIONS.users, userId)
  if (!cached) return
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
}

export async function resetCashierPassword(userId: string, newPassword: string): Promise<void> {
  const cached = await getCachedDoc<AppUser>(COLLECTIONS.users, userId)
  if (!cached) throw new Error('المستخدم غير موجود')

  await storeLocalCredential(cached, newPassword)
  await cacheDocs(COLLECTIONS.users, [{ ...cached, updatedAt: Date.now() }])

  // Background: update Firebase Auth password (fire-and-forget)
  void window.electronAPI.resetAuthUserPassword(userId, newPassword).catch(() => {
    // Best-effort
  })
}

export async function deleteAccount(userId: string, currentUserId: string): Promise<void> {
  if (userId === currentUserId) {
    throw new Error('لا يمكنك حذف حسابك الخاص')
  }

  const cached = await getCachedDoc<AppUser>(COLLECTIONS.users, userId)
  if (cached) {
    await cacheDocs(COLLECTIONS.users, [{ ...cached, active: false, updatedAt: Date.now() }])
    void import('@renderer/features/audit/audit-service').then(({ logAudit }) =>
      logAudit({
        action: 'account_deleted',
        actorId: currentUserId,
        actorName: 'مدير',
        targetId: userId,
        targetType: 'user',
        detailAr: `حذف حساب: ${cached.displayName}`
      })
    )
  }

  writeAuthCache(readAuthCache().filter((e) => e.userId !== userId))
  void window.electronAPI.deleteAuthUser(userId).catch(() => {})
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
