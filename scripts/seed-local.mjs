#!/usr/bin/env node
/**
 * Local SQLite seed.
 *
 * Writes all demo data directly into the app's SQLite cache file so the
 * app works fully offline without requiring cloud sync.
 *
 * Also writes offline-auth credentials into a seed_auth table so the
 * app can bootstrap localStorage on first launch.
 *
 * Run: npm run seed:local
 *
 * After running, open the app and log in with:
 *   username : manager
 *   password : 123456
 */

import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scryptSync } from 'node:crypto'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'

// ─── resolve SQLite path ─────────────────────────────────────────────────────
// Electron stores userData at %APPDATA%\<productName> on Windows
const appDataDir = process.env.APPDATA
  ?? join(homedir(), 'AppData', 'Roaming')
const dbDir = join(appDataDir, 'shift-pos')
const dbFile = join(dbDir, 'offline-pos.sqlite')

if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true })
  console.log('Created directory:', dbDir)
}

console.log('\n📦  Abdo Kofta — local SQLite seed')
console.log('   DB:', dbFile, '\n')

// ─── open db ─────────────────────────────────────────────────────────────────
const db = new DatabaseSync(dbFile)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA synchronous = NORMAL;')

// ensure tables exist (same schema as local-store.ts)
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

  CREATE TABLE IF NOT EXISTS cached_documents (
    collection_name TEXT NOT NULL,
    document_id     TEXT NOT NULL,
    payload_json    TEXT NOT NULL,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (collection_name, document_id)
  );

  CREATE TABLE IF NOT EXISTS ingredient_stock (
    ingredient_id TEXT PRIMARY KEY,
    quantity REAL NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS seed_auth (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    user_json     TEXT NOT NULL,
    updated_at    INTEGER NOT NULL
  );
`)

db.prepare(`
  INSERT INTO meta (key, value)
  VALUES ('schema_version', '2')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run()

db.prepare(`
  INSERT INTO meta (key, value)
  VALUES ('password_hash_scheme', 'scrypt$v1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`).run()

// ─── helpers ─────────────────────────────────────────────────────────────────
const upsert = db.prepare(`
  INSERT INTO cached_documents (collection_name, document_id, payload_json, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(collection_name, document_id)
  DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at
`)

function put(collection, doc) {
  upsert.run(collection, doc.id, JSON.stringify(doc), Date.now())
}

function daysAgo(n, hour = 12) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}

let _seq = 1
function uid() { return `seed-${(_seq++).toString().padStart(6, '0')}` }

const PASSWORD_HASH_VERSION = 'scrypt$v1'
const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1, keyLength: 64 }

function hashPassword(password) {
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

function lineTotal(price, qty) {
  return Math.round(price * qty * 100) / 100
}

// ─── 1. Settings ─────────────────────────────────────────────────────────────
console.log('1. Settings')
const SETTINGS_ID = 'app'
put('settings', {
  id: SETTINGS_ID,
  restaurantNameAr: 'عبده كفتة',
  currencySymbol: 'ج.م',
  phoneNumber: '01000000000',
  receiptFooterAr: 'شكراً لزيارتكم',
  pinEnabled: false,
  autoLockMinutes: 0,
  nextOrderNumber: 1,
  taxRate: 0,
  serviceRate: 0,
  defaultDeliveryFee: 20,
  maxCashierDiscountPct: 15,
  shiftManagementEnabled: true,
  employeePerformanceTrackingEnabled: true,
  employeePerformanceTrackingStartedAt: daysAgo(7, 0),
  cashRoundingEnabled: true,
  maxCashRoundingDifference: 5,
  networkMode: 'standalone',
  masterServerPort: 47831,
  sideDisconnectPolicy: 'block_actions',
  receiptPrintRoute: 'side',
  receiptSectionOrder: ['restaurant', 'orderMeta', 'customer', 'items', 'totals', 'payment', 'footer'],
  receiptHiddenSections: [],
  receiptShowItemNotes: true,
  receiptCompactMode: false,
  receiptLogoEnabled: false,
  autoBackupEnabled: false,
  autoBackupIntervalDays: 1,
  autoBackupOnClose: false,
  backupRetentionDays: 7,
  updatedAt: Date.now(),
})

// ─── 2. Users ────────────────────────────────────────────────────────────────
console.log('2. Users')
const now = Date.now()

const managerUser = {
  id: 'local_manager',
  email: 'manager@abdokofta.local',
  username: 'manager',
  displayName: 'المدير',
  role: 'manager',
  permissions: [
    'pos', 'order_history', 'cashier_inventory',
    'view_reports', 'manage_shifts', 'manage_menu',
    'manage_purchases', 'manage_suppliers',
    'manage_accounts', 'manage_settings'
  ],
  allowCashRounding: true,
  maxCashRoundingDifference: 5,
  active: true,
  createdAt: now,
  updatedAt: now,
}

const cashier1User = {
  id: 'local_cashier1',
  email: 'cashier1@abdokofta.local',
  username: 'cashier1',
  displayName: 'أحمد الكاشير',
  cashierCode: 'C01',
  role: 'cashier',
  permissions: ['pos', 'order_history', 'cashier_inventory'],
  allowCashRounding: true,
  maxCashRoundingDifference: 3,
  active: true,
  createdAt: now,
  updatedAt: now,
}

const cashier2User = {
  id: 'local_cashier2',
  email: 'cashier2@abdokofta.local',
  username: 'cashier2',
  displayName: 'محمد الكاشير',
  cashierCode: 'C02',
  role: 'cashier',
  permissions: ['pos', 'order_history', 'cashier_inventory'],
  allowCashRounding: false,
  active: true,
  createdAt: now,
  updatedAt: now,
}

const supervisorUser = {
  id: 'local_supervisor',
  email: 'supervisor@abdokofta.local',
  username: 'supervisor',
  displayName: 'مشرف الوردية',
  cashierCode: 'S01',
  role: 'supervisor',
  permissions: [
    'pos', 'order_history', 'cashier_inventory',
    'view_reports', 'manage_shifts', 'manage_purchases',
    'manage_suppliers'
  ],
  allowCashRounding: true,
  maxCashRoundingDifference: 4,
  active: true,
  createdAt: now,
  updatedAt: now,
}

put('users', managerUser)
put('users', cashier1User)
put('users', cashier2User)
put('users', supervisorUser)

// ─── 3. Offline auth (seed_auth table) ───────────────────────────────────────
console.log('3. Offline auth credentials')
// The app's offline auth uses SHA-256 of "username:password"
const authUsers = [
  { user: managerUser,  password: '123456' },
  { user: cashier1User, password: 'Cashier123!' },
  { user: cashier2User, password: 'Cashier123!' },
  { user: supervisorUser, password: 'Supervisor123!' },
]

const insertAuth = db.prepare(`
  INSERT INTO seed_auth (username, password_hash, user_json, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(username)
  DO UPDATE SET password_hash = excluded.password_hash,
                user_json     = excluded.user_json,
                updated_at    = excluded.updated_at
`)

// Store the same scrypt password format used by the current app.
const authRows = authUsers.map(({ user, password }) => {
  const hash = hashPassword(password)
  return { username: user.username, hash, userJson: JSON.stringify(user) }
})

for (const row of authRows) {
  insertAuth.run(row.username, row.hash, row.userJson, Date.now())
}

// ─── 4. Suppliers ─────────────────────────────────────────────────────────────
console.log('4. Suppliers')
const suppliers = [
  { id: 'sup-1', nameAr: 'مورد اللحوم - الحاج سعيد', phone: '01011111111', noteAr: 'يورد كل أسبوع', active: true, createdAt: now, updatedAt: now },
  { id: 'sup-2', nameAr: 'مورد الخضروات والخبز',      phone: '01022222222', noteAr: 'توريد يومي',    active: true, createdAt: now, updatedAt: now },
  { id: 'sup-3', nameAr: 'مورد المشروبات',             phone: '01033333333', noteAr: '',              active: true, createdAt: now, updatedAt: now },
]
for (const s of suppliers) put('suppliers', s)

// ─── 5. Ingredients ───────────────────────────────────────────────────────────
console.log('5. Ingredients')
const ingredients = [
  { id: 'ing-kofta',    nameAr: 'كفتة (لحم مفروم)', unit: 'جرام',  lowStockThreshold: 3000, active: true, createdAt: now, updatedAt: now },
  { id: 'ing-hawawshi', nameAr: 'لحم هواوشي',        unit: 'جرام',  lowStockThreshold: 2000, active: true, createdAt: now, updatedAt: now },
  { id: 'ing-chicken',  nameAr: 'صدر فراخ',           unit: 'جرام',  lowStockThreshold: 2000, active: true, createdAt: now, updatedAt: now },
  { id: 'ing-liver',    nameAr: 'كبدة',               unit: 'جرام',  lowStockThreshold: 1000, active: true, createdAt: now, updatedAt: now },
  { id: 'ing-bread',    nameAr: 'خبز عيش بلدي',       unit: 'رغيف', lowStockThreshold: 30,   active: true, createdAt: now, updatedAt: now },
  { id: 'ing-tomato',   nameAr: 'طماطم',              unit: 'جرام',  lowStockThreshold: 500,  active: true, createdAt: now, updatedAt: now },
  { id: 'ing-onion',    nameAr: 'بصل',                unit: 'جرام',  lowStockThreshold: 500,  active: true, createdAt: now, updatedAt: now },
  { id: 'ing-tahini',   nameAr: 'طحينة',              unit: 'جرام',  lowStockThreshold: 300,  active: true, createdAt: now, updatedAt: now },
  { id: 'ing-oil',      nameAr: 'زيت',                unit: 'مل',    lowStockThreshold: 500,  active: true, createdAt: now, updatedAt: now },
  { id: 'ing-pepsi',    nameAr: 'بيبسي',              unit: 'علبة', lowStockThreshold: 24,   active: true, createdAt: now, updatedAt: now },
  { id: 'ing-water',    nameAr: 'مياه',               unit: 'زجاجة',lowStockThreshold: 24,   active: true, createdAt: now, updatedAt: now },
  { id: 'ing-sauce',    nameAr: 'صوص حار',            unit: 'جرام',  lowStockThreshold: 200,  active: true, createdAt: now, updatedAt: now },
]
for (const i of ingredients) put('ingredients', i)

// ─── 6. Opening stock ─────────────────────────────────────────────────────────
console.log('6. Opening stock')
const ingMap = Object.fromEntries(ingredients.map(i => [i.id, i]))
const openingStock = [
  { id: 'ing-kofta',    qty: 15000, unitCost: 0.22, supplierId: 'sup-1' },
  { id: 'ing-hawawshi', qty: 8000,  unitCost: 0.20, supplierId: 'sup-1' },
  { id: 'ing-chicken',  qty: 10000, unitCost: 0.16, supplierId: 'sup-1' },
  { id: 'ing-liver',    qty: 3000,  unitCost: 0.18, supplierId: 'sup-1' },
  { id: 'ing-bread',    qty: 100,   unitCost: 1.5,  supplierId: 'sup-2' },
  { id: 'ing-tomato',   qty: 5000,  unitCost: 0.02, supplierId: 'sup-2' },
  { id: 'ing-onion',    qty: 4000,  unitCost: 0.018, supplierId: 'sup-2' },
  { id: 'ing-tahini',   qty: 2000,  unitCost: 0.09, supplierId: 'sup-2' },
  { id: 'ing-oil',      qty: 3000,  unitCost: 0.07, supplierId: 'sup-2' },
  { id: 'ing-pepsi',    qty: 72,    unitCost: 10,   supplierId: 'sup-3' },
  { id: 'ing-water',    qty: 48,    unitCost: 4,    supplierId: 'sup-3' },
  { id: 'ing-sauce',    qty: 1500,  unitCost: 0.04, supplierId: 'sup-2' },
]
for (const s of openingStock) {
  const txId = uid()
  const totalCost = Math.round(s.qty * s.unitCost * 100) / 100
  put('inventory_transactions', {
    id: txId,
    ingredientId: s.id,
    ingredientNameAr: ingMap[s.id].nameAr,
    type: 'purchase',
    quantity: s.qty,
    unit: ingMap[s.id].unit,
    referenceType: 'purchase',
    supplierId: s.supplierId,
    unitCost: s.unitCost,
    totalCost,
    noteAr: 'رصيد افتتاحي',
    createdBy: managerUser.id,
    createdAt: daysAgo(30),
  })
  put('inventory_batches', {
    id: `batch-${s.id}`,
    ingredientId: s.id,
    supplierId: s.supplierId,
    purchaseTransactionId: txId,
    quantity: s.qty,
    remainingQuantity: s.qty,
    unit: ingMap[s.id].unit,
    unitCost: s.unitCost,
    receivedAt: daysAgo(30),
    createdBy: managerUser.id,
  })
}

console.log('6b. Materialized stock balances')
const stockUpsert = db.prepare(`
  INSERT INTO ingredient_stock (ingredient_id, quantity, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(ingredient_id)
  DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at
`)
for (const s of openingStock) {
  stockUpsert.run(s.id, s.qty, now)
}

// ─── 7. Menu categories ────────────────────────────────────────────────────────
console.log('7. Menu categories')
const categories = [
  { id: 'cat-sandwiches', nameAr: 'ساندويتشات', sortOrder: 0, active: true, createdAt: now, updatedAt: now },
  { id: 'cat-grills',     nameAr: 'مشويات',      sortOrder: 1, active: true, createdAt: now, updatedAt: now },
  { id: 'cat-drinks',     nameAr: 'مشروبات',     sortOrder: 2, active: true, createdAt: now, updatedAt: now },
  { id: 'cat-extras',     nameAr: 'إضافات',      sortOrder: 3, active: true, createdAt: now, updatedAt: now },
  // sub-categories
  { id: 'cat-sand-kofta',   nameAr: 'كفتة', parentId: 'cat-sandwiches', sortOrder: 0, active: true, createdAt: now, updatedAt: now },
  { id: 'cat-sand-chicken', nameAr: 'فراخ', parentId: 'cat-sandwiches', sortOrder: 1, active: true, createdAt: now, updatedAt: now },
]
for (const c of categories) put('menu_categories', c)

console.log('7b. Master sizes, add-ons, and kitchen printers')
const itemSizes = [
  { id: 'size-small', nameAr: 'صغير', sortOrder: 0, active: true, createdAt: now, updatedAt: now },
  { id: 'size-medium', nameAr: 'وسط', sortOrder: 1, active: true, createdAt: now, updatedAt: now },
  { id: 'size-large', nameAr: 'كبير', sortOrder: 2, active: true, createdAt: now, updatedAt: now },
]
for (const size of itemSizes) put('item_sizes', size)

const itemAddons = [
  { id: 'addon-extra-kofta', nameAr: 'كفتة إضافية', defaultPrice: 15, sortOrder: 0, active: true, createdAt: now, updatedAt: now },
  { id: 'addon-tahini', nameAr: 'طحينة', defaultPrice: 5, sortOrder: 1, active: true, createdAt: now, updatedAt: now },
  { id: 'addon-hot-sauce', nameAr: 'صوص حار', defaultPrice: 3, sortOrder: 2, active: true, createdAt: now, updatedAt: now },
]
for (const addon of itemAddons) put('item_addons', addon)

const kitchenPrinters = [
  {
    id: 'printer-grill',
    name: 'تجهيز المشويات',
    deviceName: 'Demo Grill Printer',
    description: 'طابعة تجريبية للمطبخ الساخن',
    copies: 1,
    active: true,
    visibility: { showOrderType: true, showTable: true, showCashier: true, showCustomer: true, showOrderNote: true, showItemNotes: true },
    createdAt: now,
    updatedAt: now
  },
  {
    id: 'printer-drinks',
    name: 'تجهيز المشروبات',
    deviceName: 'Demo Drinks Printer',
    description: 'طابعة تجريبية للمشروبات',
    copies: 1,
    active: true,
    visibility: { showOrderType: true, showTable: false, showCashier: false, showCustomer: false, showOrderNote: true, showItemNotes: false },
    createdAt: now,
    updatedAt: now
  },
]
for (const printer of kitchenPrinters) put('kitchen_printers', printer)

// ─── 8. Menu items + recipes ──────────────────────────────────────────────────
console.log('8. Menu items + recipes')
const menuItems = [
  // Sandwiches — kofta
  {
    id: 'item-kofta-1', categoryId: 'cat-sand-kofta', nameAr: 'ساندويتش كفتة',
    descriptionAr: '٢ قطعة كفتة مع طماطم وصوص', price: 45, sortOrder: 0, kitchenPrinterIds: ['printer-grill'],
    attachments: [
      { id: 'att-extra-kofta', masterAddonId: 'addon-extra-kofta', nameAr: '+ كفتة إضافية', price: 15 },
      { id: 'att-tahini',      masterAddonId: 'addon-tahini', nameAr: '+ طحينة', price: 5 },
    ],
    recipeLines: [
      { ingredientId: 'ing-kofta',  quantity: 150, unit: 'جرام' },
      { ingredientId: 'ing-bread',  quantity: 1,   unit: 'رغيف' },
      { ingredientId: 'ing-tomato', quantity: 40,  unit: 'جرام' },
      { ingredientId: 'ing-sauce',  quantity: 10,  unit: 'جرام' },
    ],
  },
  {
    id: 'item-kofta-double', categoryId: 'cat-sand-kofta', nameAr: 'ساندويتش كفتة دبل',
    descriptionAr: '٤ قطع كفتة', price: 75, sortOrder: 1, kitchenPrinterIds: ['printer-grill'],
    recipeLines: [
      { ingredientId: 'ing-kofta',  quantity: 300, unit: 'جرام' },
      { ingredientId: 'ing-bread',  quantity: 1,   unit: 'رغيف' },
      { ingredientId: 'ing-tomato', quantity: 50,  unit: 'جرام' },
    ],
  },
  {
    id: 'item-hawawshi', categoryId: 'cat-sand-kofta', nameAr: 'ساندويتش هواوشي',
    price: 55, sortOrder: 2, kitchenPrinterIds: ['printer-grill'],
    recipeLines: [
      { ingredientId: 'ing-hawawshi', quantity: 200, unit: 'جرام' },
      { ingredientId: 'ing-bread',    quantity: 1,   unit: 'رغيف' },
      { ingredientId: 'ing-onion',    quantity: 30,  unit: 'جرام' },
    ],
  },
  {
    id: 'item-liver', categoryId: 'cat-sand-kofta', nameAr: 'ساندويتش كبدة',
    price: 40, sortOrder: 3, kitchenPrinterIds: ['printer-grill'],
    recipeLines: [
      { ingredientId: 'ing-liver', quantity: 150, unit: 'جرام' },
      { ingredientId: 'ing-bread', quantity: 1,   unit: 'رغيف' },
      { ingredientId: 'ing-oil',   quantity: 20,  unit: 'مل'   },
    ],
  },
  // Sandwiches — chicken
  {
    id: 'item-chicken-sand', categoryId: 'cat-sand-chicken', nameAr: 'ساندويتش فراخ',
    price: 50, sortOrder: 0, kitchenPrinterIds: ['printer-grill'],
    sizeOptions: [
      { id: 'sz-small', masterSizeId: 'size-small', labelAr: 'صغير', price: 35 },
      { id: 'sz-medium', masterSizeId: 'size-medium', labelAr: 'وسط', price: 50 },
      { id: 'sz-large', masterSizeId: 'size-large', labelAr: 'كبير', price: 70 },
    ],
    recipeLines: [
      { ingredientId: 'ing-chicken', quantity: 180, unit: 'جرام' },
      { ingredientId: 'ing-bread',   quantity: 1,   unit: 'رغيف' },
      { ingredientId: 'ing-sauce',   quantity: 10,  unit: 'جرام' },
    ],
  },
  {
    id: 'item-chicken-crispy', categoryId: 'cat-sand-chicken', nameAr: 'ساندويتش فراخ كريسبي',
    price: 60, sortOrder: 1, kitchenPrinterIds: ['printer-grill'],
    recipeLines: [
      { ingredientId: 'ing-chicken', quantity: 200, unit: 'جرام' },
      { ingredientId: 'ing-bread',   quantity: 1,   unit: 'رغيف' },
      { ingredientId: 'ing-oil',     quantity: 50,  unit: 'مل'   },
    ],
  },
  // Grills (weighted)
  {
    id: 'item-kofta-grill', categoryId: 'cat-grills', nameAr: 'كفتة مشوية',
    price: 180, sortOrder: 0, isWeighted: true, allowCustomWeight: true, customWeightUnitPrice: 180, kitchenPrinterIds: ['printer-grill'],
    weightedPriceOptions: [
      { id: 'wt-250',  label: '250 جرام',  weightKg: 0.25, price: 45  },
      { id: 'wt-500',  label: '500 جرام',  weightKg: 0.5,  price: 90  },
      { id: 'wt-1000', label: 'كيلو كامل', weightKg: 1,    price: 180 },
    ],
    recipeLines: [{ ingredientId: 'ing-kofta', quantity: 1000, unit: 'جرام' }],
  },
  {
    id: 'item-hawawshi-grill', categoryId: 'cat-grills', nameAr: 'هواوشي مشوي',
    price: 200, sortOrder: 1, isWeighted: true, allowCustomWeight: true, customWeightUnitPrice: 200, kitchenPrinterIds: ['printer-grill'],
    weightedPriceOptions: [
      { id: 'wt-h250',  label: '250 جرام', weightKg: 0.25, price: 50  },
      { id: 'wt-h500',  label: '500 جرام', weightKg: 0.5,  price: 100 },
      { id: 'wt-h1000', label: 'كيلو',     weightKg: 1,    price: 200 },
    ],
    recipeLines: [{ ingredientId: 'ing-hawawshi', quantity: 1000, unit: 'جرام' }],
  },
  {
    id: 'item-chicken-grill', categoryId: 'cat-grills', nameAr: 'فراخ مشوية',
    price: 160, sortOrder: 2, isWeighted: true, allowCustomWeight: true, customWeightUnitPrice: 160, kitchenPrinterIds: ['printer-grill'],
    weightedPriceOptions: [
      { id: 'wt-c250',  label: '250 جرام', weightKg: 0.25, price: 40  },
      { id: 'wt-c500',  label: '500 جرام', weightKg: 0.5,  price: 80  },
      { id: 'wt-c1000', label: 'كيلو',     weightKg: 1,    price: 160 },
    ],
    recipeLines: [{ ingredientId: 'ing-chicken', quantity: 1000, unit: 'جرام' }],
  },
  // Drinks
  { id: 'item-pepsi', categoryId: 'cat-drinks', nameAr: 'بيبسي', price: 15, sortOrder: 0, productType: 'ready_made', linkedIngredientId: 'ing-pepsi', kitchenPrinterIds: ['printer-drinks'], recipeLines: [{ ingredientId: 'ing-pepsi', quantity: 1, unit: 'علبة' }] },
  { id: 'item-water', categoryId: 'cat-drinks', nameAr: 'مياه معدنية', price: 8, sortOrder: 1, productType: 'ready_made', linkedIngredientId: 'ing-water', kitchenPrinterIds: ['printer-drinks'], recipeLines: [{ ingredientId: 'ing-water', quantity: 1, unit: 'زجاجة' }] },
  // Extras
  { id: 'item-tahini',       categoryId: 'cat-extras', nameAr: 'طحينة',       price: 5,  sortOrder: 0, recipeLines: [{ ingredientId: 'ing-tahini', quantity: 30,  unit: 'جرام' }] },
  { id: 'item-tomato-salad', categoryId: 'cat-extras', nameAr: 'سلطة طماطم', price: 10, sortOrder: 1, recipeLines: [{ ingredientId: 'ing-tomato', quantity: 100, unit: 'جرام' }, { ingredientId: 'ing-onion', quantity: 30, unit: 'جرام' }] },
]

for (const item of menuItems) {
  const recipeId = `recipe-${item.id}`
  const { recipeLines, ...itemData } = item

  put('recipes', {
    id: recipeId,
    menuItemId: item.id,
    nameAr: item.nameAr,
    lines: recipeLines,
    createdAt: now,
    updatedAt: now,
  })

  put('menu_items', {
    ...itemData,
    recipeId,
    active: true,
    createdAt: now,
    updatedAt: now,
  })
}

// ─── 9. Dining tables ─────────────────────────────────────────────────────────
console.log('9. Floors and dining tables')
const floors = [
  {
    id: 'floor-main',
    nameAr: 'الصالة',
    width: 920,
    height: 560,
    bgColor: '#f8fafc',
    walls: [
      { id: 'wall-main-1', x1: 30, y1: 30, x2: 890, y2: 30, thickness: 6, color: '#1f2937' },
      { id: 'wall-main-2', x1: 30, y1: 30, x2: 30, y2: 530, thickness: 6, color: '#1f2937' },
      { id: 'wall-main-3', x1: 30, y1: 530, x2: 890, y2: 530, thickness: 6, color: '#1f2937' },
    ],
    sortOrder: 0,
    active: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'floor-terrace',
    nameAr: 'التراس',
    width: 760,
    height: 420,
    bgColor: '#eefdf7',
    walls: [
      { id: 'wall-terrace-1', x1: 20, y1: 20, x2: 740, y2: 20, thickness: 5, color: '#14532d' },
    ],
    sortOrder: 1,
    active: true,
    createdAt: now,
    updatedAt: now,
  },
]
for (const floor of floors) put('floors', floor)

function chairsForRect(tableId, x, y, w, h, seats) {
  const chairs = []
  const positions = [
    [x + w / 2, y - 22],
    [x + w / 2, y + h + 22],
    [x - 22, y + h / 2],
    [x + w + 22, y + h / 2],
    [x + w * 0.25, y - 22],
    [x + w * 0.75, y + h + 22],
  ]
  for (let i = 0; i < seats; i++) {
    const [cx, cy] = positions[i % positions.length]
    chairs.push({ id: `${tableId}-chair-${i + 1}`, x: cx, y: cy })
  }
  return chairs
}

const tables = [
  { id: 'tbl-1',  nameAr: 'ترابيزة 1',  categoryAr: 'صالة داخلية', floorId: 'floor-main', x: 120, y: 90, w: 112, h: 72, seats: 4, shape: 'rect', sortOrder: 0 },
  { id: 'tbl-2',  nameAr: 'ترابيزة 2',  categoryAr: 'صالة داخلية', floorId: 'floor-main', x: 300, y: 90, w: 112, h: 72, seats: 4, shape: 'rect', sortOrder: 1 },
  { id: 'tbl-3',  nameAr: 'ترابيزة 3',  categoryAr: 'صالة داخلية', floorId: 'floor-main', x: 480, y: 90, w: 112, h: 72, seats: 4, shape: 'rect', sortOrder: 2 },
  { id: 'tbl-4',  nameAr: 'ترابيزة 4',  categoryAr: 'صالة داخلية', floorId: 'floor-main', x: 660, y: 90, w: 112, h: 72, seats: 4, shape: 'rect', sortOrder: 3 },
  { id: 'tbl-5',  nameAr: 'ترابيزة 5',  categoryAr: 'صالة داخلية', floorId: 'floor-main', x: 190, y: 270, w: 128, h: 82, seats: 6, shape: 'rect', sortOrder: 4 },
  { id: 'tbl-6',  nameAr: 'ترابيزة 6',  categoryAr: 'صالة داخلية', floorId: 'floor-main', x: 520, y: 270, w: 128, h: 82, seats: 6, shape: 'rect', sortOrder: 5 },
  { id: 'tbl-7',  nameAr: 'ترابيزة T1', categoryAr: 'تراس خارجي', floorId: 'floor-terrace', x: 110, y: 100, w: 96, h: 96, seats: 4, shape: 'circle', sortOrder: 0 },
  { id: 'tbl-8',  nameAr: 'ترابيزة T2', categoryAr: 'تراس خارجي', floorId: 'floor-terrace', x: 285, y: 100, w: 96, h: 96, seats: 4, shape: 'circle', sortOrder: 1 },
  { id: 'tbl-9',  nameAr: 'ترابيزة T3', categoryAr: 'تراس خارجي', floorId: 'floor-terrace', x: 460, y: 100, w: 96, h: 96, seats: 4, shape: 'circle', sortOrder: 2 },
  { id: 'tbl-10', nameAr: 'ترابيزة T4', categoryAr: 'تراس خارجي', floorId: 'floor-terrace', x: 285, y: 260, w: 112, h: 72, seats: 4, shape: 'rect', sortOrder: 3 },
]
for (const t of tables) put('dining_tables', {
  ...t,
  chairPositions: chairsForRect(t.id, t.x, t.y, t.w, t.h, t.seats),
  active: true,
  createdAt: now,
  updatedAt: now
})

console.log('9b. Work shifts and assignments')
const workShifts = [
  { id: 'work-morning', name: 'وردية صباحية', startTime: '09:00', endTime: '17:00', workingDays: [0, 1, 2, 3, 4, 5, 6], overtimeEnabled: true, maxOvertimeMinutes: 60, active: true, createdAt: now, updatedAt: now },
  { id: 'work-evening', name: 'وردية مسائية', startTime: '17:00', endTime: '01:00', workingDays: [0, 1, 2, 3, 4, 5, 6], overtimeEnabled: true, maxOvertimeMinutes: 90, active: true, createdAt: now, updatedAt: now },
]
for (const shift of workShifts) put('work_shifts', shift)

const assignmentStartDate = new Date(daysAgo(14, 0)).toISOString().slice(0, 10)
const assignments = [
  { id: 'assign-cashier1', userId: cashier1User.id, workShiftId: 'work-morning', startDate: assignmentStartDate, active: true, createdAt: now, updatedAt: now },
  { id: 'assign-cashier2', userId: cashier2User.id, workShiftId: 'work-evening', startDate: assignmentStartDate, active: true, createdAt: now, updatedAt: now },
  { id: 'assign-supervisor', userId: supervisorUser.id, workShiftId: 'work-morning', startDate: assignmentStartDate, active: true, createdAt: now, updatedAt: now },
]
for (const assignment of assignments) put('user_shift_assignments', assignment)

// ─── 10. Shifts ───────────────────────────────────────────────────────────────
console.log('10. Shifts')
const shift1Id = 'shift-day-1'
const shift2Id = 'shift-day-2'
const shift3Id = 'shift-open'

put('shifts', {
  id: shift1Id,
  cashierId: cashier1User.id,
  cashierName: 'أحمد الكاشير',
  cashierCode: 'C01',
  status: 'closed',
  archived: true,
  openingCash: 500,
  closingCash: 1665,
  workShiftId: 'work-morning',
  workShiftName: 'وردية صباحية',
  assignmentId: 'assign-cashier1',
  openedAt: daysAgo(2, 9),
  closedAt: daysAgo(2, 17),
  closedBy: cashier1User.id,
  createdAt: daysAgo(2, 9),
  updatedAt: daysAgo(2, 17)
})
put('shifts', {
  id: shift2Id,
  cashierId: cashier2User.id,
  cashierName: 'محمد الكاشير',
  cashierCode: 'C02',
  status: 'closed',
  archived: false,
  openingCash: 500,
  closingCash: 2130,
  workShiftId: 'work-evening',
  workShiftName: 'وردية مسائية',
  assignmentId: 'assign-cashier2',
  openedAt: daysAgo(1, 9),
  closedAt: daysAgo(1, 17),
  closedBy: cashier2User.id,
  createdAt: daysAgo(1, 9),
  updatedAt: daysAgo(1, 17)
})
put('shifts', {
  id: shift3Id,
  cashierId: cashier1User.id,
  cashierName: 'أحمد الكاشير',
  cashierCode: 'C01',
  status: 'open',
  archived: false,
  openingCash: 500,
  workShiftId: 'work-morning',
  workShiftName: 'وردية صباحية',
  assignmentId: 'assign-cashier1',
  openedAt: daysAgo(0, 9),
  createdAt: daysAgo(0, 9),
  updatedAt: daysAgo(0, 9)
})

// ─── 11. Orders ───────────────────────────────────────────────────────────────
console.log('11. Orders')
const orderTemplates = [
  // Day -2 shift 1
  { type: 'takeaway', paid: true,  method: 'cash', shiftId: shift1Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 10), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', price: 45, qty: 2 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 2 }] },
  { type: 'takeaway', paid: true,  method: 'cash', shiftId: shift1Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 10), lines: [{ menuItemId: 'item-hawawshi', nameAr: 'ساندويتش هواوشي', price: 55, qty: 1 }] },
  { type: 'dine_in',  paid: true,  method: 'cash', shiftId: shift1Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-1', tableNameAr: 'ترابيزة 1', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(2, 11), lines: [{ menuItemId: 'item-kofta-grill', nameAr: 'كفتة مشوية', price: 90, qty: 0.5, unitLabel: 'كجم', weightGrams: 500 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 3 }] },
  { type: 'takeaway', paid: true,  method: 'card', shiftId: shift1Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 12), lines: [{ menuItemId: 'item-kofta-double', nameAr: 'ساندويتش كفتة دبل', price: 75, qty: 2 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', price: 8, qty: 2 }] },
  { type: 'delivery', paid: true,  method: 'cash', shiftId: shift1Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 13), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', price: 45, qty: 4 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 4 }], noteAr: 'توصيل لشارع الجمهورية' },
  { type: 'dine_in',  paid: true,  method: 'cash', shiftId: shift1Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-3', tableNameAr: 'ترابيزة 3', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(2, 14), lines: [{ menuItemId: 'item-liver', nameAr: 'ساندويتش كبدة', price: 40, qty: 2 }, { menuItemId: 'item-tahini', nameAr: 'طحينة', price: 5, qty: 2 }] },
  { type: 'takeaway', paid: true,  method: 'cash', shiftId: shift1Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 15), lines: [{ menuItemId: 'item-chicken-sand', nameAr: 'ساندويتش فراخ', price: 50, qty: 1, sizeLabelAr: 'كبير' }, { menuItemId: 'item-tomato-salad', nameAr: 'سلطة طماطم', price: 10, qty: 1 }] },
  { type: 'takeaway', paid: true,  method: 'card', shiftId: shift1Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 15), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', price: 45, qty: 3 }] },
  { type: 'dine_in',  paid: true,  method: 'cash', shiftId: shift1Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-7', tableNameAr: 'ترابيزة T1', tableCategoryAr: 'تراس خارجي', createdAt: daysAgo(2, 16), lines: [{ menuItemId: 'item-hawawshi-grill', nameAr: 'هواوشي مشوي', price: 100, qty: 0.5, unitLabel: 'كجم', weightGrams: 500 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', price: 8, qty: 4 }] },
  { type: 'takeaway', paid: true,  method: 'cash', shiftId: shift1Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 16), lines: [{ menuItemId: 'item-chicken-crispy', nameAr: 'ساندويتش فراخ كريسبي', price: 60, qty: 2 }] },
  // Day -1 shift 2
  { type: 'takeaway', paid: true,  method: 'cash', shiftId: shift2Id, cashierId: cashier2User.id, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 10), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', price: 45, qty: 1 }] },
  { type: 'dine_in',  paid: true,  method: 'cash', shiftId: shift2Id, cashierId: cashier2User.id, cashierName: 'محمد الكاشير', cashierCode: 'C02', tableId: 'tbl-2', tableNameAr: 'ترابيزة 2', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(1, 11), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', price: 45, qty: 4 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 4 }, { menuItemId: 'item-tahini', nameAr: 'طحينة', price: 5, qty: 4 }] },
  { type: 'delivery', paid: true,  method: 'cash', shiftId: shift2Id, cashierId: cashier2User.id, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 11), lines: [{ menuItemId: 'item-hawawshi', nameAr: 'ساندويتش هواوشي', price: 55, qty: 3 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', price: 8, qty: 3 }] },
  { type: 'takeaway', paid: true,  method: 'card', shiftId: shift2Id, cashierId: cashier2User.id, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 12), lines: [{ menuItemId: 'item-chicken-grill', nameAr: 'فراخ مشوية', price: 80, qty: 0.5, unitLabel: 'كجم', weightGrams: 500 }] },
  { type: 'dine_in',  paid: true,  method: 'cash', shiftId: shift2Id, cashierId: cashier2User.id, cashierName: 'محمد الكاشير', cashierCode: 'C02', tableId: 'tbl-5', tableNameAr: 'ترابيزة 5', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(1, 13), lines: [{ menuItemId: 'item-kofta-grill', nameAr: 'كفتة مشوية', price: 180, qty: 1, unitLabel: 'كجم', weightGrams: 1000 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 5 }] },
  { type: 'takeaway', paid: true,  method: 'cash', shiftId: shift2Id, cashierId: cashier2User.id, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 14), lines: [{ menuItemId: 'item-liver', nameAr: 'ساندويتش كبدة', price: 40, qty: 3 }] },
  { type: 'delivery', paid: true,  method: 'cash', shiftId: shift2Id, cashierId: cashier2User.id, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 14), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', price: 45, qty: 5 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 5 }] },
  { type: 'takeaway', paid: true,  method: 'card', shiftId: shift2Id, cashierId: cashier2User.id, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 15), lines: [{ menuItemId: 'item-chicken-sand', nameAr: 'ساندويتش فراخ', price: 35, qty: 2, sizeLabelAr: 'صغير' }] },
  { type: 'dine_in',  paid: true,  method: 'cash', shiftId: shift2Id, cashierId: cashier2User.id, cashierName: 'محمد الكاشير', cashierCode: 'C02', tableId: 'tbl-8', tableNameAr: 'ترابيزة T2', tableCategoryAr: 'تراس خارجي', createdAt: daysAgo(1, 15), lines: [{ menuItemId: 'item-kofta-double', nameAr: 'ساندويتش كفتة دبل', price: 75, qty: 2 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', price: 8, qty: 2 }] },
  { type: 'takeaway', paid: true,  method: 'cash', shiftId: shift2Id, cashierId: cashier2User.id, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 16), lines: [{ menuItemId: 'item-hawawshi-grill', nameAr: 'هواوشي مشوي', price: 50, qty: 0.25, unitLabel: 'كجم', weightGrams: 250 }] },
  // Today — open shift — mix paid + unpaid
  { type: 'takeaway', paid: true,  method: 'cash', shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 10), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', price: 45, qty: 2 }] },
  { type: 'takeaway', paid: true,  method: 'cash', shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 10), lines: [{ menuItemId: 'item-liver', nameAr: 'ساندويتش كبدة', price: 40, qty: 1 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 1 }] },
  { type: 'dine_in',  paid: false, shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-2', tableNameAr: 'ترابيزة 2', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(0, 10), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', price: 45, qty: 3 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 3 }] },
  { type: 'dine_in',  paid: false, shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-5', tableNameAr: 'ترابيزة 5', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(0, 11), lines: [{ menuItemId: 'item-kofta-grill', nameAr: 'كفتة مشوية', price: 90, qty: 0.5, unitLabel: 'كجم', weightGrams: 500 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', price: 8, qty: 2 }] },
  { type: 'takeaway', paid: true,  method: 'card', shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 11), lines: [{ menuItemId: 'item-chicken-sand', nameAr: 'ساندويتش فراخ', price: 50, qty: 2, sizeLabelAr: 'وسط' }] },
  { type: 'delivery', paid: true,  method: 'cash', shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 12), lines: [{ menuItemId: 'item-kofta-double', nameAr: 'ساندويتش كفتة دبل', price: 75, qty: 2 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 2 }] },
  { type: 'dine_in',  paid: false, shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-7', tableNameAr: 'ترابيزة T1', tableCategoryAr: 'تراس خارجي', createdAt: daysAgo(0, 12), lines: [{ menuItemId: 'item-hawawshi', nameAr: 'ساندويتش هواوشي', price: 55, qty: 2 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 2 }] },
  { type: 'takeaway', paid: true,  method: 'cash', shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 13), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', price: 45, qty: 5 }] },
  { type: 'dine_in',  paid: false, shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-9', tableNameAr: 'ترابيزة T3', tableCategoryAr: 'تراس خارجي', createdAt: daysAgo(0, 13), lines: [{ menuItemId: 'item-chicken-grill', nameAr: 'فراخ مشوية', price: 160, qty: 1, unitLabel: 'كجم', weightGrams: 1000 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 4 }] },
  { type: 'delivery', paid: true,  method: 'cash', shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 14), lines: [{ menuItemId: 'item-liver', nameAr: 'ساندويتش كبدة', price: 40, qty: 2 }, { menuItemId: 'item-tahini', nameAr: 'طحينة', price: 5, qty: 2 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', price: 8, qty: 2 }], noteAr: 'لا بصل' },
  { type: 'delivery', paid: false, shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 15), deliveryFee: 20, customerName: 'أحمد إسماعيل', customerPhone: '01012345678', customerAddress: 'شارع الجمهورية - بجوار المدرسة', lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', price: 45, qty: 3 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', price: 8, qty: 2 }], noteAr: 'غير مدفوع - للتحصيل عند التسليم' },
  { type: 'takeaway', paid: true, method: 'split', cashPaid: 100, cardPaid: 71, shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 15), discountType: 'percent', discountValue: 10, lines: [{ menuItemId: 'item-kofta-double', nameAr: 'ساندويتش كفتة دبل', price: 75, qty: 2 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', price: 15, qty: 2 }, { menuItemId: 'item-tomato-salad', nameAr: 'سلطة طماطم', price: 10, qty: 1 }] },
  { type: 'takeaway', paid: true, method: 'cash', cancelled: true, cancelReasonAr: 'طلب تجريبي ملغي', shiftId: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 16), lines: [{ menuItemId: 'item-chicken-crispy', nameAr: 'ساندويتش فراخ كريسبي', price: 60, qty: 1 }] },
]

let orderNum = 1
for (const tmpl of orderTemplates) {
  const subtotal = tmpl.lines.reduce((s, l) => s + lineTotal(l.price, l.qty), 0)
  const discountAmount = tmpl.discountType === 'percent'
    ? Math.round(subtotal * (tmpl.discountValue || 0)) / 100
    : (tmpl.discountValue || 0)
  const deliveryFee = tmpl.type === 'delivery' ? (tmpl.deliveryFee ?? 20) : 0
  const total = Math.round((subtotal - discountAmount + deliveryFee) * 100) / 100
  const orderId = uid()
  const isPaid = tmpl.paid
  const isCancelled = tmpl.cancelled === true

  const order = {
    id: orderId,
    orderNumber: orderNum++,
    orderCode: String(orderNum - 1).padStart(4, '0'),
    status: isCancelled ? 'cancelled' : isPaid ? 'completed' : 'draft',
    orderType: tmpl.type,
    paymentStatus: isPaid ? (tmpl.method === 'split' ? 'split' : 'paid') : 'unpaid',
    tableId: tmpl.tableId,
    tableNameAr: tmpl.tableNameAr,
    tableCategoryAr: tmpl.tableCategoryAr,
    shiftId: tmpl.shiftId,
    cashierId: tmpl.cashierId,
    cashierName: tmpl.cashierName,
    cashierCode: tmpl.cashierCode,
    subtotal,
    discountType: tmpl.discountType,
    discountValue: tmpl.discountValue,
    discountAmount: discountAmount > 0 ? discountAmount : undefined,
    deliveryFee: deliveryFee > 0 ? deliveryFee : undefined,
    total,
    noteAr: tmpl.noteAr,
    customerName: tmpl.customerName,
    customerPhone: tmpl.customerPhone,
    customerAddress: tmpl.customerAddress,
    archived: false,
    createdAt: tmpl.createdAt,
    updatedAt: tmpl.createdAt,
    completedAt: isPaid ? tmpl.createdAt : undefined,
    paidAt: isPaid ? tmpl.createdAt : undefined,
    cancelledAt: isCancelled ? tmpl.createdAt + 5 * 60_000 : undefined,
    cancelledBy: isCancelled ? tmpl.cashierId : undefined,
    cancelReasonAr: tmpl.cancelReasonAr,
    cancelInventoryMode: isCancelled ? 'return' : undefined,
  }
  put('orders', order)

  for (const line of tmpl.lines) {
    const itemId = uid()
    put('order_items', {
      id: itemId,
      orderId,
      menuItemId: line.menuItemId,
      nameAr: line.nameAr,
      unitPrice: line.price,
      quantity: line.qty,
      sizeLabelAr: line.sizeLabelAr,
      unitLabel: line.unitLabel,
      weightGrams: line.weightGrams,
      lineTotal: lineTotal(line.price, line.qty),
    })
  }

  if (isPaid && tmpl.method && !isCancelled) {
    const paymentRows = tmpl.method === 'split'
      ? [
          { method: 'cash', amount: tmpl.cashPaid ?? 0, paidAmount: tmpl.cashPaid ?? 0, changeAmount: 0 },
          { method: 'card', amount: tmpl.cardPaid ?? 0, paidAmount: tmpl.cardPaid ?? 0, changeAmount: 0 },
        ].filter((payment) => payment.amount > 0)
      : [{ method: tmpl.method, amount: total, paidAmount: tmpl.method === 'cash' ? total : undefined, changeAmount: 0 }]
    for (const payment of paymentRows) {
      put('payments', {
        id: uid(),
        orderId,
        amount: payment.amount,
        paidAmount: payment.paidAmount,
        changeAmount: payment.changeAmount,
        employeeId: tmpl.cashierId,
        shiftId: tmpl.shiftId,
        deviceId: 'Seed POS',
        method: payment.method,
        createdAt: tmpl.createdAt,
      })
      if (payment.method === 'cash') {
        put('cash_drawer_transactions', {
          id: uid(),
          type: 'sale',
          amount: payment.amount,
          shiftId: tmpl.shiftId,
          orderId,
          createdBy: tmpl.cashierId,
          createdAt: tmpl.createdAt,
        })
      }
    }
  }
}

// ─── 12. Cash drawer — opening floats & expenses ───────────────────────────────
console.log('12. Cash drawer extras')
const cdExtras = [
  { shiftId: shift1Id, type: 'cash_in', amount: 500, noteAr: 'رصيد افتتاحي الدرج', createdBy: managerUser.id, createdAt: daysAgo(2, 9) },
  { shiftId: shift2Id, type: 'cash_in', amount: 500, noteAr: 'رصيد افتتاحي الدرج', createdBy: managerUser.id, createdAt: daysAgo(1, 9) },
  { shiftId: shift3Id, type: 'cash_in', amount: 500, noteAr: 'رصيد افتتاحي الدرج', createdBy: managerUser.id, createdAt: daysAgo(0, 9) },
  { shiftId: shift1Id, type: 'expense', amount: -50,  noteAr: 'مستلزمات نظافة',  createdBy: cashier1User.id, createdAt: daysAgo(2, 14) },
  { shiftId: shift2Id, type: 'expense', amount: -120, noteAr: 'فاتورة غاز',       createdBy: cashier2User.id, createdAt: daysAgo(1, 12) },
  { shiftId: shift3Id, type: 'expense', amount: -30,  noteAr: 'مصاريف نثرية',    createdBy: cashier1User.id, createdAt: daysAgo(0, 11) },
]
for (const tx of cdExtras) put('cash_drawer_transactions', { id: uid(), ...tx })

// ─── 13. Supplier transactions ────────────────────────────────────────────────
console.log('13. Supplier transactions')
const supTxns = [
  { supplierId: 'sup-1', type: 'purchase_credit', amount: 1500, noteAr: 'توريد لحوم الأسبوع الماضي', createdAt: daysAgo(7) },
  { supplierId: 'sup-2', type: 'purchase_credit', amount: 400,  noteAr: 'توريد خبز وخضروات',         createdAt: daysAgo(5) },
  { supplierId: 'sup-1', type: 'purchase_credit', amount: 1200, noteAr: 'توريد لحوم هذا الأسبوع',   createdAt: daysAgo(2) },
  { supplierId: 'sup-3', type: 'purchase_credit', amount: 600,  noteAr: 'مشروبات وبقالة',            createdAt: daysAgo(3) },
  { supplierId: 'sup-1', type: 'payment',         amount: 1000, noteAr: 'دفعة جزئية',  createdAt: daysAgo(4) },
  { supplierId: 'sup-2', type: 'payment',         amount: 400,  noteAr: 'سداد كامل',   createdAt: daysAgo(3) },
  { supplierId: 'sup-3', type: 'payment',         amount: 300,  noteAr: 'دفعة جزئية',  createdAt: daysAgo(1) },
]
for (const tx of supTxns) put('supplier_transactions', { id: uid(), ...tx, createdBy: managerUser.id })

// ─── 14. Supplier return + performance/audit samples ─────────────────────────
console.log('14. Supplier return, closure, performance, and audit samples')
const supplierReturnId = 'supplier-return-kofta-demo'
put('supplier_returns', {
  id: supplierReturnId,
  supplierId: 'sup-1',
  userId: managerUser.id,
  totalAmount: 110,
  reason: 'مرتجع جودة من رصيد تجريبي',
  createdAt: daysAgo(1, 16)
})
put('supplier_return_items', {
  id: 'supplier-return-item-kofta-demo',
  returnId: supplierReturnId,
  ingredientId: 'ing-kofta',
  quantity: 500,
  unit: 'جرام',
  unitCost: 0.22,
  totalCost: 110,
  batchId: 'batch-ing-kofta'
})
put('inventory_transactions', {
  id: 'inventory-return-kofta-demo',
  ingredientId: 'ing-kofta',
  ingredientNameAr: 'كفتة (لحم مفروم)',
  type: 'supplier_return',
  quantity: -500,
  unit: 'جرام',
  referenceType: 'supplier',
  referenceId: supplierReturnId,
  supplierId: 'sup-1',
  batchId: 'batch-ing-kofta',
  unitCost: 0.22,
  totalCost: 110,
  noteAr: 'مرتجع مورد تجريبي',
  createdBy: managerUser.id,
  createdAt: daysAgo(1, 16)
})
put('inventory_batches', {
  id: 'batch-ing-kofta',
  ingredientId: 'ing-kofta',
  supplierId: 'sup-1',
  purchaseTransactionId: 'seed-000001',
  quantity: 15000,
  remainingQuantity: 14500,
  unit: 'جرام',
  unitCost: 0.22,
  receivedAt: daysAgo(30),
  createdBy: managerUser.id,
})
stockUpsert.run('ing-kofta', 14500, now)
put('supplier_transactions', {
  id: 'supplier-return-credit-demo',
  supplierId: 'sup-1',
  type: 'debt_decrease',
  amount: 110,
  noteAr: 'خصم قيمة مرتجع كفتة',
  createdBy: managerUser.id,
  createdAt: daysAgo(1, 16)
})

const closureRows = [
  {
    id: 'closure-shift-day-1',
    shiftSessionId: shift1Id,
    userId: cashier1User.id,
    openingCash: 500,
    cashSales: 1160,
    cardSales: 225,
    refunds: 0,
    cashAdjustments: -50,
    expectedCash: 1610,
    actualCash: 1665,
    difference: 55,
    differenceType: 'surplus',
    differenceReason: 'زيادة تجريبية لاختبار الاعتماد',
    approvedBy: managerUser.id,
    approvedAt: daysAgo(2, 17) + 15 * 60_000,
    ordersCount: 10,
    closedAt: daysAgo(2, 17),
    createdAt: daysAgo(2, 17),
    updatedAt: daysAgo(2, 17)
  },
  {
    id: 'closure-shift-day-2',
    shiftSessionId: shift2Id,
    userId: cashier2User.id,
    openingCash: 500,
    cashSales: 1690,
    cardSales: 230,
    refunds: 0,
    cashAdjustments: -120,
    expectedCash: 2070,
    actualCash: 2130,
    difference: 60,
    differenceType: 'surplus',
    ordersCount: 10,
    closedAt: daysAgo(1, 17),
    createdAt: daysAgo(1, 17),
    updatedAt: daysAgo(1, 17)
  },
]
for (const row of closureRows) put('shift_closure_records', row)

const todayKey = new Date().toISOString().slice(0, 10)
const yesterdayKey = new Date(daysAgo(1, 0)).toISOString().slice(0, 10)
const twoDaysKey = new Date(daysAgo(2, 0)).toISOString().slice(0, 10)
const performanceRows = [
  { id: `perf-${cashier1User.id}-${todayKey}`, userId: cashier1User.id, date: todayKey, totalSales: 825, ordersCount: 11, completedOrders: 6, cancelledOrders: 1, refundedOrders: 0, averageOrderValue: 137.5, averageProcessingMinutes: 6, itemsSold: 36, cashPayments: 5, cardPayments: 2, refundAmount: 0, discountAmount: 19, cashDifference: 0, workedMinutes: 360, createdAt: now, updatedAt: now },
  { id: `perf-${cashier2User.id}-${yesterdayKey}`, userId: cashier2User.id, date: yesterdayKey, totalSales: 1920, ordersCount: 10, completedOrders: 10, cancelledOrders: 0, refundedOrders: 0, averageOrderValue: 192, averageProcessingMinutes: 7, itemsSold: 42, cashPayments: 7, cardPayments: 2, refundAmount: 0, discountAmount: 0, cashDifference: 60, workedMinutes: 480, createdAt: now, updatedAt: now },
  { id: `perf-${cashier1User.id}-${twoDaysKey}`, userId: cashier1User.id, date: twoDaysKey, totalSales: 1385, ordersCount: 10, completedOrders: 10, cancelledOrders: 0, refundedOrders: 0, averageOrderValue: 138.5, averageProcessingMinutes: 8, itemsSold: 38, cashPayments: 8, cardPayments: 2, refundAmount: 0, discountAmount: 0, cashDifference: 55, workedMinutes: 480, createdAt: now, updatedAt: now },
]
for (const row of performanceRows) put('employee_performance_daily', row)

const auditRows = [
  { id: 'audit-seed-login', action: 'login', actorId: managerUser.id, actorName: managerUser.displayName, targetId: managerUser.id, targetType: 'user', detailAr: 'تسجيل دخول تجريبي للمدير', createdAt: daysAgo(0, 9) },
  { id: 'audit-seed-order', action: 'order_created', actorId: cashier1User.id, actorName: cashier1User.displayName, targetType: 'order', detailAr: 'إنشاء طلبات تجريبية متنوعة', createdAt: daysAgo(0, 10) },
  { id: 'audit-seed-return', action: 'supplier_transaction_recorded', actorId: managerUser.id, actorName: managerUser.displayName, targetId: supplierReturnId, targetType: 'supplier', detailAr: 'تسجيل مرتجع مورد تجريبي', createdAt: daysAgo(1, 16) },
  { id: 'audit-seed-close', action: 'shift_closed', actorId: cashier2User.id, actorName: cashier2User.displayName, targetId: shift2Id, targetType: 'shift', detailAr: 'إغلاق وردية تجريبية مع فرق نقدي', createdAt: daysAgo(1, 17) },
]
for (const row of auditRows) {
  put('audit_log', row)
  put('employee_activity_logs', {
    id: `activity-${row.id}`,
    userId: row.actorId,
    username: row.actorName,
    actionType: row.action,
    referenceId: row.targetId,
    deviceId: 'Seed POS',
    detailAr: row.detailAr,
    createdAt: row.createdAt
  })
}

// ─── done ─────────────────────────────────────────────────────────────────────
console.log('\n✅  Done!\n')
console.log('─────────────────────────────────────────────')
console.log('  DB file  :', dbFile)
console.log('─────────────────────────────────────────────')
console.log('  Login with:')
console.log('    username : manager')
console.log('    password : 123456')
console.log('─────────────────────────────────────────────')
console.log('  Also seeded:')
console.log('    13 menu items across 6 categories')
console.log('    10 dining tables across 2 visual floors')
console.log('    3 shifts (2 closed + 1 open)')
console.log('   ', orderTemplates.length, 'orders (takeaway / dine-in / delivery)')
console.log('    3 suppliers with debts, payments, and one return')
console.log('    Work shifts, kitchen printers, sizes/add-ons, performance and audit samples')
console.log('─────────────────────────────────────────────')
console.log()
console.log('⚠  First launch: the app will read from SQLite cache.')
console.log('   Extra logins: cashier1 / Cashier123!, cashier2 / Cashier123!, supervisor / Supervisor123!\n')
