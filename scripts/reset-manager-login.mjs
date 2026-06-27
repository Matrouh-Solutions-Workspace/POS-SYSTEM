#!/usr/bin/env node
/**
 * Reset only the local manager login, without wiping app data.
 *
 * Run:
 *   npm run reset:manager
 *
 * Result:
 *   username: manager
 *   password: Manager123
 */

import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scryptSync } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const appDataDir = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
const explicitDb = process.env.SHIFT_POS_DB
const dbCandidates = explicitDb
  ? [explicitDb]
  : [
      join(appDataDir, 'shift-pos', 'offline-pos.sqlite'),
      join(appDataDir, 'SHIFT POS', 'offline-pos.sqlite')
    ]
const dbFile = dbCandidates.find((file) => existsSync(file)) ?? dbCandidates[0]
const dbDir = dbFile.slice(0, dbFile.lastIndexOf('\\') > -1 ? dbFile.lastIndexOf('\\') : dbFile.lastIndexOf('/'))

if (dbDir && !existsSync(dbDir)) mkdirSync(dbDir, { recursive: true })

const PASSWORD_HASH_VERSION = 'scrypt$v1'
const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1, keyLength: 64 }
const username = 'manager'
const password = 'Manager123'
const now = Date.now()

function normalizeUsername(value) {
  return String(value ?? '').toLowerCase().trim()
}

function hashPassword(value) {
  const salt = randomBytes(16).toString('base64url')
  const derived = scryptSync(value, salt, SCRYPT_PARAMS.keyLength, {
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

const db = new DatabaseSync(dbFile)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA synchronous = NORMAL;')
db.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cached_documents (
    collection_name TEXT NOT NULL,
    document_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (collection_name, document_id)
  );

  CREATE TABLE IF NOT EXISTS seed_auth (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    user_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`)

const rows = db.prepare(`
  SELECT document_id, payload_json
  FROM cached_documents
  WHERE collection_name = 'users'
`).all()

let existing = null
for (const row of rows) {
  try {
    const user = JSON.parse(row.payload_json)
    if (user?.role !== 'manager') continue
    if (!existing) existing = { id: row.document_id, ...user }
    if (normalizeUsername(user.username) === 'manager') {
      existing = { id: row.document_id, ...user }
      break
    }
    if (normalizeUsername(user.username) === 'admin') existing = { id: row.document_id, ...user }
  } catch {
    // Ignore malformed rows.
  }
}

const user = {
  ...(existing ?? {}),
  id: existing?.id ?? 'local_manager',
  email: `${username}@abdokofta.local`,
  username,
  displayName: existing?.displayName || 'المدير',
  role: 'manager',
  permissions: existing?.permissions ?? [
    'pos', 'order_history', 'cashier_inventory',
    'view_reports', 'manage_shifts', 'manage_menu',
    'manage_purchases', 'manage_suppliers',
    'manage_accounts', 'manage_settings'
  ],
  allowCashRounding: existing?.allowCashRounding ?? true,
  maxCashRoundingDifference: existing?.maxCashRoundingDifference ?? 5,
  active: true,
  createdAt: existing?.createdAt ?? now,
  updatedAt: now
}

db.exec('BEGIN IMMEDIATE')
try {
  db.prepare(`
    INSERT INTO cached_documents (collection_name, document_id, payload_json, updated_at)
    VALUES ('users', ?, ?, ?)
    ON CONFLICT(collection_name, document_id)
    DO UPDATE SET payload_json = excluded.payload_json,
                  updated_at = excluded.updated_at
  `).run(user.id, JSON.stringify(user), now)

  db.prepare("DELETE FROM seed_auth WHERE json_extract(user_json, '$.id') = ?").run(user.id)
  db.prepare(`
    INSERT INTO seed_auth (username, password_hash, user_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(username)
    DO UPDATE SET password_hash = excluded.password_hash,
                  user_json = excluded.user_json,
                  updated_at = excluded.updated_at
  `).run(username, hashPassword(password), JSON.stringify(user), now)

  db.exec('COMMIT')
} catch (error) {
  try { db.exec('ROLLBACK') } catch { /* ignore */ }
  throw error
}

console.log('Manager login reset successfully.')
console.log(`DB: ${dbFile}`)
console.log(`username: ${username}`)
console.log(`password: ${password}`)
