import { app } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
const require = createRequire(import.meta.url)

type DatabaseSync = {
  exec: (sql: string) => void
  prepare: (sql: string) => {
    get: (...params: unknown[]) => unknown
    all: (...params: unknown[]) => unknown[]
    run: (...params: unknown[]) => { changes?: number }
  }
  pragma?: (sql: string) => unknown
}

let db: DatabaseSync | null = null

export interface LocalStoreStatus {
  ok: boolean
  path: string
  pendingOutbox: number
  error?: string
}

export interface BackupSettings {
  backupDirectory?: string
  /** All configured directories (primary + extras). */
  allDirectories: string[]
  autoBackupEnabled: boolean
  autoBackupIntervalDays: number
  autoBackupOnClose: boolean
  backupRetentionDays: number
  lastAutoBackupAt?: number
}

const SETTINGS_COLLECTION = 'settings'
const SETTINGS_DOC_ID = 'app'
const DAY_MS = 86_400_000
const SCHEMA_VERSION = 2
const PASSWORD_HASH_VERSION = 'scrypt$v1'
const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1, keyLength: 64 }

function dbPath(): string {
  return join(app.getPath('userData'), 'offline-pos.sqlite')
}

function openDatabase(): DatabaseSync {
  if (db) return db
  const sqlite = require('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseSync }
  db = new sqlite.DatabaseSync(dbPath())
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = NORMAL;')
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_outbox (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      synced_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sync_outbox_status_created
      ON sync_outbox(status, created_at);

    CREATE TABLE IF NOT EXISTS cached_documents (
      collection_name TEXT NOT NULL,
      document_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (collection_name, document_id)
    );

    CREATE INDEX IF NOT EXISTS idx_cached_docs_collection
      ON cached_documents(collection_name, updated_at DESC);

    -- REQ-11: Materialized stock balances — O(1) reads instead of O(n) transaction scans
    CREATE TABLE IF NOT EXISTS ingredient_stock (
      ingredient_id TEXT PRIMARY KEY,
      quantity REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seed_auth (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      user_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  runMigrations(db)

  return db
}

function readSchemaVersion(database: DatabaseSync): number {
  const row = database.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value?: string } | undefined
  return Number(row?.value ?? 0) || 0
}

function writeSchemaVersion(database: DatabaseSync, version: number): void {
  database.prepare(`
    INSERT INTO meta (key, value)
    VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(version))
}

function runMigrations(database: DatabaseSync): void {
  const current = readSchemaVersion(database)
  try {
    database.exec('BEGIN IMMEDIATE')
    if (current < 1) migrateIngredientStock(database)
    if (current < 2) migratePasswordHashMetadata(database)
    writeSchemaVersion(database, SCHEMA_VERSION)
    database.exec('COMMIT')
  } catch (e) {
    try { database.exec('ROLLBACK') } catch { /* ignore */ }
    console.error('Schema migration failed:', e)
    throw e
  }
}

function migrateIngredientStock(database: DatabaseSync): void {
  const stockCountRow = database.prepare('SELECT COUNT(*) as c FROM ingredient_stock').get() as { c: number }
  if (stockCountRow.c !== 0) return
  const txRows = database.prepare(`SELECT payload_json FROM cached_documents WHERE collection_name = 'inventoryTransactions'`).all() as { payload_json: string }[]
  const stockMap = new Map<string, number>()
  for (const row of txRows) {
    try {
      const tx = JSON.parse(row.payload_json) as { ingredientId?: string; quantity?: number }
      if (tx.ingredientId && typeof tx.quantity === 'number') {
        stockMap.set(tx.ingredientId, (stockMap.get(tx.ingredientId) ?? 0) + tx.quantity)
      }
    } catch {
      // Ignore malformed legacy transaction rows.
    }
  }
  if (stockMap.size === 0) return
  const insertStmt = database.prepare('INSERT INTO ingredient_stock (ingredient_id, quantity, updated_at) VALUES (?, ?, ?)')
  const now = Date.now()
  for (const [ingredientId, quantity] of stockMap.entries()) {
    insertStmt.run(ingredientId, quantity, now)
  }
}

function migratePasswordHashMetadata(database: DatabaseSync): void {
  database.prepare(`
    INSERT INTO meta (key, value)
    VALUES ('password_hash_scheme', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(PASSWORD_HASH_VERSION)
}

function readSettingsNetworkMode(): string {
  try {
    const database = openDatabase()
    const row = database.prepare(`
      SELECT payload_json
      FROM cached_documents
      WHERE collection_name = 'settings' AND document_id = 'app'
    `).get() as { payload_json?: string } | undefined
    if (!row?.payload_json) return 'standalone'
    const settings = JSON.parse(row.payload_json) as { networkMode?: string }
    return settings.networkMode ?? 'standalone'
  } catch {
    return 'standalone'
  }
}

export function isMasterStoreMode(): boolean {
  return readSettingsNetworkMode() === 'master'
}

function shouldEnqueueOutbox(): boolean {
  return isMasterStoreMode()
}

function readSettingsDocument(): Record<string, unknown> | null {
  try {
    const database = openDatabase()
    const row = database.prepare(`
      SELECT payload_json
      FROM cached_documents
      WHERE collection_name = ? AND document_id = ?
    `).get(SETTINGS_COLLECTION, SETTINGS_DOC_ID) as { payload_json?: string } | undefined
    return row?.payload_json ? JSON.parse(row.payload_json) as Record<string, unknown> : null
  } catch {
    return null
  }
}

function clampDays(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(7, Math.round(n)))
}

function clampRetentionDays(value: unknown, fallback: number): number {
  const valid = [0, 1, 2, 3, 4, 5, 6, 7, 14, 30, 60, 90]
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return valid.includes(n) ? n : fallback
}

export function readBackupSettings(): BackupSettings {
  const settings = readSettingsDocument()
  // Merge legacy single directory into the directories array
  const primaryDir = typeof settings?.backupDirectory === 'string' ? settings.backupDirectory : undefined
  const extraDirs = Array.isArray(settings?.backupDirectories)
    ? (settings.backupDirectories as string[]).filter((d) => typeof d === 'string' && d.trim())
    : []
  return {
    backupDirectory: primaryDir,
    autoBackupEnabled: settings?.autoBackupEnabled === true,
    autoBackupIntervalDays: clampDays(settings?.autoBackupIntervalDays, 1),
    autoBackupOnClose: settings?.autoBackupOnClose === true,
    backupRetentionDays: clampRetentionDays(settings?.backupRetentionDays, 7),
    lastAutoBackupAt: typeof settings?.lastAutoBackupAt === 'number' ? settings.lastAutoBackupAt : undefined,
    // All directories (primary + extra, deduplicated, non-empty)
    allDirectories: Array.from(new Set([
      ...(primaryDir ? [primaryDir] : []),
      ...extraDirs
    ])).filter(Boolean)
  }
}

function updateSettingsPatch(patch: Record<string, unknown>): void {
  const current = readSettingsDocument() ?? {
    id: SETTINGS_DOC_ID,
    restaurantNameAr: '',
    currencySymbol: 'ج.م',
    pinEnabled: false,
    autoLockMinutes: 5,
    nextOrderNumber: 1
  }
  cacheDocuments(SETTINGS_COLLECTION, [{
    id: SETTINGS_DOC_ID,
    data: { ...current, ...patch, updatedAt: Date.now() }
  }])
}

export function initLocalStore(): LocalStoreStatus {
  try {
    const database = openDatabase()
    const row = database.prepare(
      "SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'pending' OR (status = 'failed' AND attempts < 10)"
    ).get() as { count?: number } | undefined
    return { ok: true, path: dbPath(), pendingOutbox: Number(row?.count ?? 0) }
  } catch (e) {
    return {
      ok: false,
      path: dbPath(),
      pendingOutbox: 0,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

export function getLocalStoreStatus(): LocalStoreStatus {
  return initLocalStore()
}

// ---------------------------------------------------------------------------
// Core document cache (unchanged — used by IPC local-cache:* handlers)
// ---------------------------------------------------------------------------

export function cacheDocuments(
  collectionName: string,
  documents: Array<{ id: string; data: unknown }>
): void {
  const database = openDatabase()
  const stmt = database.prepare(`
    INSERT INTO cached_documents (collection_name, document_id, payload_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(collection_name, document_id)
    DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
  `)
  const now = Date.now()
  for (const document of documents) {
    stmt.run(collectionName, document.id, JSON.stringify(document.data), now)
  }
}

export function readCachedDocuments(collectionName: string): unknown[] {
  const database = openDatabase()
  const rows = database.prepare(`
    SELECT payload_json
    FROM cached_documents
    WHERE collection_name = ?
    ORDER BY updated_at DESC
  `).all(collectionName) as Array<{ payload_json: string }>
  return rows.map((row) => JSON.parse(row.payload_json) as unknown)
}

export function readCachedDocument(collectionName: string, documentId: string): unknown | null {
  const database = openDatabase()
  const row = database.prepare(`
    SELECT payload_json
    FROM cached_documents
    WHERE collection_name = ? AND document_id = ?
  `).get(collectionName, documentId) as { payload_json: string } | undefined
  return row ? JSON.parse(row.payload_json) as unknown : null
}

export function deleteCachedDocument(collectionName: string, documentId: string): boolean {
  const database = openDatabase()
  const result = database.prepare(`
    DELETE FROM cached_documents
    WHERE collection_name = ? AND document_id = ?
  `).run(collectionName, documentId)
  return (result.changes ?? 0) > 0
}

// ---------------------------------------------------------------------------
// Sync outbox — queue master-device writes for the configured HTTP API
// ---------------------------------------------------------------------------

export interface OutboxEntry {
  id: string
  entity_type: string
  entity_id: string
  operation: 'set' | 'delete'
  payload_json: string
  status: 'pending' | 'synced' | 'failed'
  attempts: number
  created_at: number
  updated_at: number
  synced_at: number | null
}

/** Enqueue a document write for master-device API sync */
export function enqueueOutbox(
  entityType: string,
  entityId: string,
  operation: 'set' | 'delete',
  payload: unknown
): void {
  if (!shouldEnqueueOutbox()) return
  const database = openDatabase()
  const now = Date.now()
  const id = `${entityType}:${entityId}:${now}`
  database.prepare(`
    INSERT INTO sync_outbox (id, entity_type, entity_id, operation, payload_json, status, attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      operation = excluded.operation,
      payload_json = excluded.payload_json,
      status = 'pending',
      updated_at = excluded.updated_at
  `).run(id, entityType, entityId, operation, JSON.stringify(payload), now, now)
}

/** Read all pending outbox entries */
export function readPendingOutbox(): OutboxEntry[] {
  const database = openDatabase()
  return database.prepare(`
    SELECT * FROM sync_outbox
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 200
  `).all() as OutboxEntry[]
}

/** Mark outbox entries as synced */
export function markOutboxSynced(ids: string[]): void {
  if (!ids.length) return
  const database = openDatabase()
  const now = Date.now()
  const placeholders = ids.map(() => '?').join(',')
  database.prepare(`
    UPDATE sync_outbox
    SET status = 'synced', synced_at = ?, updated_at = ?
    WHERE id IN (${placeholders})
  `).run(now, now, ...ids)
}

/** Mark outbox entries as failed and increment attempts */
export function markOutboxFailed(ids: string[]): void {
  if (!ids.length) return
  const database = openDatabase()
  const now = Date.now()
  const placeholders = ids.map(() => '?').join(',')
  database.prepare(`
    UPDATE sync_outbox
    SET status = 'failed', attempts = attempts + 1, updated_at = ?
    WHERE id IN (${placeholders})
  `).run(now, ...ids)
}

/** Reset failed entries back to pending for retry */
export function resetFailedOutbox(): void {
  const database = openDatabase()
  const now = Date.now()
  database.prepare(`
    UPDATE sync_outbox
    SET status = 'pending', updated_at = ?
    WHERE status = 'failed' AND attempts < 10
  `).run(now)
}

/** Count pending outbox entries */
export function countPendingOutbox(): number {
  const database = openDatabase()
  const row = database.prepare(
    "SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'pending' OR (status = 'failed' AND attempts < 10)"
  ).get() as { count?: number } | undefined
  return Number(row?.count ?? 0)
}

// ---------------------------------------------------------------------------
// Materialized stock reads — REQ-11
// ---------------------------------------------------------------------------

export interface StockRow {
  ingredient_id: string
  quantity: number
}

/**
 * Read materialized stock balances directly from ingredient_stock table.
 * O(1) per ingredient — does not scan inventory_transactions.
 */
export function readIngredientStocks(): StockRow[] {
  const database = openDatabase()
  return database.prepare('SELECT ingredient_id, quantity FROM ingredient_stock').all() as StockRow[]
}

/**
 * Read the materialized stock for a single ingredient.
 */
export function readIngredientStock(ingredientId: string): number {
  const database = openDatabase()
  const row = database.prepare(
    'SELECT quantity FROM ingredient_stock WHERE ingredient_id = ?'
  ).get(ingredientId) as { quantity?: number } | undefined
  return Number(row?.quantity ?? 0)
}

// ---------------------------------------------------------------------------
// Atomic batch write — executes multiple document upserts in a single
// SQLite transaction so partial failures are impossible.
// ---------------------------------------------------------------------------

export interface BatchOperation {
  collection: string
  id: string
  data: unknown
  op: 'set' | 'delete'
}

/**
 * Execute an array of document operations atomically.
 * All writes succeed together or all are rolled back.
 * Also enqueues every operation in the outbox for API sync on the master device.
 */
export function executeBatch(operations: BatchOperation[]): { ok: boolean; error?: string } {
  if (!operations.length) return { ok: true }
  const database = openDatabase()
  const now = Date.now()

  const upsertStmt = database.prepare(`
    INSERT INTO cached_documents (collection_name, document_id, payload_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(collection_name, document_id)
    DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
  `)

  const deleteStmt = database.prepare(`
    DELETE FROM cached_documents
    WHERE collection_name = ? AND document_id = ?
  `)

  const outboxStmt = database.prepare(`
    INSERT INTO sync_outbox (id, entity_type, entity_id, operation, payload_json, status, attempts, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      operation = excluded.operation,
      payload_json = excluded.payload_json,
      status = 'pending',
      updated_at = excluded.updated_at
  `)

  // REQ-11: materialized stock upsert — keeps ingredient_stock in sync atomically
  const stockUpsertStmt = database.prepare(`
    INSERT INTO ingredient_stock (ingredient_id, quantity, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(ingredient_id)
    DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at
  `)

  try {
    database.exec('BEGIN IMMEDIATE')
    for (const op of operations) {
      if (op.op === 'delete') {
        deleteStmt.run(op.collection, op.id)
      } else {
        upsertStmt.run(op.collection, op.id, JSON.stringify(op.data), now)

        // REQ-11: update materialized stock when an inventory transaction is saved
        if (op.collection === 'inventory_transactions') {
          const tx = op.data as { ingredientId?: string; quantity?: number }
          if (tx.ingredientId && typeof tx.quantity === 'number') {
            stockUpsertStmt.run(tx.ingredientId, tx.quantity, now)
          }
        }
      }
      const outboxId = `${op.collection}:${op.id}:${now}`
      const payload = op.op === 'delete' ? JSON.stringify({ id: op.id }) : JSON.stringify(op.data)
      if (shouldEnqueueOutbox()) {
        outboxStmt.run(outboxId, op.collection, op.id, op.op, payload, now, now)
      }
    }
    database.exec('COMMIT')
    return { ok: true }
  } catch (e) {
    try { database.exec('ROLLBACK') } catch { /* ignore rollback error */ }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function normalizeUsername(username: string): string {
  return username.toLowerCase().trim()
}

function legacyPasswordHash(username: string, password: string): string {
  return createHash('sha256').update(`${normalizeUsername(username)}:${password}`).digest('hex')
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('base64url')
  const derived = scryptSync(password, salt, SCRYPT_PARAMS.keyLength, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: 64 * 1024 * 1024
  }).toString('base64url')
  return [
    PASSWORD_HASH_VERSION,
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt,
    derived
  ].join('$')
}

function verifyPassword(storedHash: string, username: string, password: string): { ok: boolean; legacy: boolean } {
  if (storedHash.startsWith(`${PASSWORD_HASH_VERSION}$`)) {
    const [, , nRaw, rRaw, pRaw, salt, expectedRaw] = storedHash.split('$')
    if (!salt || !expectedRaw) return { ok: false, legacy: false }
    const expected = Buffer.from(expectedRaw, 'base64url')
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(nRaw) || SCRYPT_PARAMS.N,
      r: Number(rRaw) || SCRYPT_PARAMS.r,
      p: Number(pRaw) || SCRYPT_PARAMS.p,
      maxmem: 64 * 1024 * 1024
    })
    if (actual.length !== expected.length) return { ok: false, legacy: false }
    return { ok: timingSafeEqual(actual, expected), legacy: false }
  }

  const stored = Buffer.from(storedHash)
  const actual = Buffer.from(legacyPasswordHash(username, password))
  return {
    ok: stored.length === actual.length && timingSafeEqual(stored, actual),
    legacy: true
  }
}

export function hasAuthCredentials(): boolean {
  const database = openDatabase()
  const row = database.prepare('SELECT COUNT(*) AS count FROM seed_auth').get() as { count?: number } | undefined
  return Number(row?.count ?? 0) > 0
}

export function storeAuthCredential(
  username: string,
  password: string,
  user: unknown
): { ok: boolean; error?: string } {
  try {
    const normalized = normalizeUsername(username)
    if (!normalized || !password) return { ok: false, error: 'Username and password are required' }
    const database = openDatabase()
    database.prepare(`
      INSERT INTO seed_auth (username, password_hash, user_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(username)
      DO UPDATE SET password_hash = excluded.password_hash,
                    user_json = excluded.user_json,
                    updated_at = excluded.updated_at
    `).run(normalized, hashPassword(password), JSON.stringify(user), Date.now())
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function verifyAuthCredential(
  username: string,
  password: string
): { ok: boolean; user?: unknown; error?: string } {
  try {
    const normalized = normalizeUsername(username)
    const database = openDatabase()
    const row = database.prepare(`
      SELECT password_hash, user_json
      FROM seed_auth
      WHERE username = ?
    `).get(normalized) as { password_hash?: string; user_json?: string } | undefined
    if (!row?.user_json) return { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }
    if (!row.password_hash) return { ok: false, error: 'Invalid credential record' }
    const passwordResult = verifyPassword(row.password_hash, normalized, password)
    if (!passwordResult.ok) return { ok: false, error: 'Ø§Ø³Ù… Ø§Ù„Ù…Ø³ØªØ®Ø¯Ù… Ø£Ùˆ ÙƒÙ„Ù…Ø© Ø§Ù„Ù…Ø±ÙˆØ± ØºÙŠØ± ØµØ­ÙŠØ­Ø©' }
    const storedUser = JSON.parse(row.user_json) as { id?: string; active?: boolean }
    const current = storedUser.id
      ? readCachedDocument('users', storedUser.id) as ({ active?: boolean } | null)
      : null
    const user = current ?? storedUser
    if (user && user.active === false) return { ok: false, error: 'الحساب غير نشط' }
    if (passwordResult.legacy) {
      database.prepare(`
        UPDATE seed_auth
        SET password_hash = ?, user_json = ?, updated_at = ?
        WHERE username = ?
      `).run(hashPassword(password), JSON.stringify(user), Date.now(), normalized)
    }
    return { ok: true, user }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function deleteAuthCredentialForUser(userId: string): void {
  const database = openDatabase()
  const rows = database.prepare('SELECT username, user_json FROM seed_auth').all() as Array<{
    username: string
    user_json: string
  }>
  for (const row of rows) {
    try {
      const user = JSON.parse(row.user_json) as { id?: string }
      if (user.id === userId) {
        database.prepare('DELETE FROM seed_auth WHERE username = ?').run(row.username)
      }
    } catch {
      // ignore malformed credential rows
    }
  }
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Backup & Restore — REQ-8
// ---------------------------------------------------------------------------

/**
 * Copy the live SQLite file to a destination path chosen by the user.
 * We WAL-checkpoint first so the copy is consistent.
 */
export function backupDatabase(destinationPath: string): { ok: boolean; error?: string } {
  try {
    const database = openDatabase()
    // Flush WAL to main DB file so the copy is consistent
    try { database.exec('PRAGMA wal_checkpoint(TRUNCATE);') } catch { /* ignore */ }
    copyFileSync(dbPath(), destinationPath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function backupFileName(label: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '')
  const safeLabel = label.replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'backup'
  return `shift-pos-backup-${stamp}-${safeLabel}.sqlite`
}

export function backupDatabaseToDirectory(
  destinationDirectory: string,
  label = 'manual'
): { ok: boolean; path?: string; error?: string } {
  try {
    if (!destinationDirectory.trim()) return { ok: false, error: 'Backup directory is not set' }
    mkdirSync(destinationDirectory, { recursive: true })
    const destinationPath = join(destinationDirectory, backupFileName(label))
    const result = backupDatabase(destinationPath)
    return result.ok ? { ok: true, path: destinationPath } : result
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function pruneBackupDirectory(
  destinationDirectory: string,
  retentionDays: number
): { ok: boolean; deleted: number; error?: string } {
  try {
    if (retentionDays <= 0) return { ok: true, deleted: 0 } // 0 = keep forever
    if (!destinationDirectory.trim() || !existsSync(destinationDirectory)) {
      return { ok: true, deleted: 0 }
    }
    const cutoff = Date.now() - retentionDays * DAY_MS
    let deleted = 0
    for (const file of readdirSync(destinationDirectory)) {
      if (!/^shift-pos-backup-.+\.sqlite$/i.test(file)) continue
      const path = join(destinationDirectory, file)
      const stats = statSync(path)
      if (stats.isFile() && stats.mtimeMs < cutoff) {
        unlinkSync(path)
        deleted += 1
      }
    }
    return { ok: true, deleted }
  } catch (e) {
    return { ok: false, deleted: 0, error: e instanceof Error ? e.message : String(e) }
  }
}

export function runConfiguredBackup(
  reason: 'scheduled' | 'close' | 'manual',
  options: { force?: boolean } = {}
): { ok: boolean; skipped?: boolean; path?: string; error?: string } {
  const settings = readBackupSettings()
  const dirs = settings.allDirectories

  if (dirs.length === 0) return { ok: false, skipped: true, error: 'Backup directory is not set' }
  if (reason === 'scheduled' && !settings.autoBackupEnabled) return { ok: true, skipped: true }
  if (reason === 'close' && !settings.autoBackupOnClose) return { ok: true, skipped: true }

  const intervalMs = clampDays(settings.autoBackupIntervalDays, 1) * DAY_MS
  if (
    reason === 'scheduled' &&
    !options.force &&
    settings.lastAutoBackupAt &&
    Date.now() - settings.lastAutoBackupAt < intervalMs
  ) {
    return { ok: true, skipped: true }
  }

  let lastResult: { ok: boolean; path?: string; error?: string } = { ok: false, error: 'No directories' }

  for (const dir of dirs) {
    const result = backupDatabaseToDirectory(dir, reason)
    if (result.ok) {
      // Prune old backups in this directory only if retention > 0
      if (settings.backupRetentionDays > 0) {
        pruneBackupDirectory(dir, settings.backupRetentionDays)
      }
      lastResult = result
    } else {
      // Log failure but continue with other directories
      console.warn(`[backup] Failed to backup to ${dir}:`, result.error)
      if (!lastResult.ok) lastResult = result
    }
  }

  if (lastResult.ok) {
    updateSettingsPatch({ lastAutoBackupAt: Date.now() })
  }
  return lastResult
}

/**
 * Replace the live SQLite file with a backup copy.
 * The current DB connection is closed first so the file can be replaced.
 * The app MUST restart after this call.
 */
export function restoreDatabase(sourcePath: string): { ok: boolean; error?: string } {
  if (!existsSync(sourcePath)) {
    return { ok: false, error: 'ملف النسخ الاحتياطي غير موجود' }
  }
  
  const targetPath = dbPath()
  const tempPath = targetPath + '.temp_restore'
  const bakPath = targetPath + '.bak'

  try {
    // 1. Copy to temp and verify integrity
    copyFileSync(sourcePath, tempPath)
    const sqlite = require('node:sqlite') as { DatabaseSync: new (path: string) => { exec: (s: string) => void; prepare: (s: string) => { get: () => unknown } } }
    let tempDb: any
    try {
      tempDb = new sqlite.DatabaseSync(tempPath)
      const integrity = tempDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
      if (integrity?.integrity_check !== 'ok') {
        throw new Error('فشل فحص سلامة الملف (Corrupted database)')
      }
    } finally {
      if (tempDb) tempDb = null // node:sqlite closes when GC'd or explicit close not available in this simplified wrapper
    }

    // 2. Backup current production DB just in case
    if (existsSync(targetPath)) {
      db = null // close current connection
      copyFileSync(targetPath, bakPath)
    }

    // 3. Move temp to target
    copyFileSync(tempPath, targetPath)
    unlinkSync(tempPath)

    return { ok: true }
  } catch (e) {
    // Rollback if something failed
    try {
      if (existsSync(bakPath)) copyFileSync(bakPath, targetPath)
      if (existsSync(tempPath)) unlinkSync(tempPath)
    } catch (rollbackErr) {
      // ignore rollback errors
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------------------------------------------------------------------

/**
 * DEV ONLY — wipe all cached_documents and sync_outbox rows.
 * Leaves the schema intact so the app can restart cleanly.
 * Also closes the DB connection so the renderer sees a fresh state.
 */
export function resetDatabase(): { ok: boolean; error?: string } {
  try {
    const database = openDatabase()
    database.exec('DELETE FROM cached_documents;')
    database.exec('DELETE FROM sync_outbox;')
    database.exec('DELETE FROM meta;')
    // Close the connection so next open re-initialises cleanly
    db = null
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
