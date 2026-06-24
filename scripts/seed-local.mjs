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
import { createHash, subtle } from 'node:crypto'
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
  CREATE TABLE IF NOT EXISTS cached_documents (
    collection_name TEXT NOT NULL,
    document_id     TEXT NOT NULL,
    payload_json    TEXT NOT NULL,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (collection_name, document_id)
  );

  CREATE TABLE IF NOT EXISTS seed_auth (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    user_json     TEXT NOT NULL,
    updated_at    INTEGER NOT NULL
  );
`)

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

async function sha256(str) {
  const buf = new TextEncoder().encode(str)
  const hash = await subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
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
  active: true,
  createdAt: now,
  updatedAt: now,
}

put('users', managerUser)
put('users', cashier1User)
put('users', cashier2User)

// ─── 3. Offline auth (seed_auth table) ───────────────────────────────────────
console.log('3. Offline auth credentials')
// The app's offline auth uses SHA-256 of "username:password"
const authUsers = [
  { user: managerUser,  password: '123456' },
  { user: cashier1User, password: 'Cashier123!' },
  { user: cashier2User, password: 'Cashier123!' },
]

const insertAuth = db.prepare(`
  INSERT INTO seed_auth (username, password_hash, user_json, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(username)
  DO UPDATE SET password_hash = excluded.password_hash,
                user_json     = excluded.user_json,
                updated_at    = excluded.updated_at
`)

// We need async for sha256 — collect promises and run after
const authRows = await Promise.all(authUsers.map(async ({ user, password }) => {
  const hash = await sha256(`${user.username}:${password}`)
  return { username: user.username, hash, userJson: JSON.stringify(user) }
}))

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
  { id: 'ing-kofta',    qty: 15000 },
  { id: 'ing-hawawshi', qty: 8000  },
  { id: 'ing-chicken',  qty: 10000 },
  { id: 'ing-liver',    qty: 3000  },
  { id: 'ing-bread',    qty: 100   },
  { id: 'ing-tomato',   qty: 5000  },
  { id: 'ing-onion',    qty: 4000  },
  { id: 'ing-tahini',   qty: 2000  },
  { id: 'ing-oil',      qty: 3000  },
  { id: 'ing-pepsi',    qty: 72    },
  { id: 'ing-water',    qty: 48    },
  { id: 'ing-sauce',    qty: 1500  },
]
for (const s of openingStock) {
  const txId = uid()
  put('inventory_transactions', {
    id: txId,
    ingredientId: s.id,
    ingredientNameAr: ingMap[s.id].nameAr,
    type: 'purchase',
    quantity: s.qty,
    unit: ingMap[s.id].unit,
    referenceType: 'manual',
    noteAr: 'رصيد افتتاحي',
    createdBy: managerUser.id,
    createdAt: daysAgo(30),
  })
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

// ─── 8. Menu items + recipes ──────────────────────────────────────────────────
console.log('8. Menu items + recipes')
const menuItems = [
  // Sandwiches — kofta
  {
    id: 'item-kofta-1', categoryId: 'cat-sand-kofta', nameAr: 'ساندويتش كفتة',
    descriptionAr: '٢ قطعة كفتة مع طماطم وصوص', price: 45, sortOrder: 0,
    attachments: [
      { id: 'att-extra-kofta', nameAr: '+ كفتة إضافية', price: 15 },
      { id: 'att-tahini',      nameAr: '+ طحينة',        price: 5  },
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
    descriptionAr: '٤ قطع كفتة', price: 75, sortOrder: 1,
    recipeLines: [
      { ingredientId: 'ing-kofta',  quantity: 300, unit: 'جرام' },
      { ingredientId: 'ing-bread',  quantity: 1,   unit: 'رغيف' },
      { ingredientId: 'ing-tomato', quantity: 50,  unit: 'جرام' },
    ],
  },
  {
    id: 'item-hawawshi', categoryId: 'cat-sand-kofta', nameAr: 'ساندويتش هواوشي',
    price: 55, sortOrder: 2,
    recipeLines: [
      { ingredientId: 'ing-hawawshi', quantity: 200, unit: 'جرام' },
      { ingredientId: 'ing-bread',    quantity: 1,   unit: 'رغيف' },
      { ingredientId: 'ing-onion',    quantity: 30,  unit: 'جرام' },
    ],
  },
  {
    id: 'item-liver', categoryId: 'cat-sand-kofta', nameAr: 'ساندويتش كبدة',
    price: 40, sortOrder: 3,
    recipeLines: [
      { ingredientId: 'ing-liver', quantity: 150, unit: 'جرام' },
      { ingredientId: 'ing-bread', quantity: 1,   unit: 'رغيف' },
      { ingredientId: 'ing-oil',   quantity: 20,  unit: 'مل'   },
    ],
  },
  // Sandwiches — chicken
  {
    id: 'item-chicken-sand', categoryId: 'cat-sand-chicken', nameAr: 'ساندويتش فراخ',
    price: 50, sortOrder: 0,
    sizeOptions: [
      { id: 'sz-small',  labelAr: 'صغير', price: 35 },
      { id: 'sz-medium', labelAr: 'وسط',  price: 50 },
      { id: 'sz-large',  labelAr: 'كبير', price: 70 },
    ],
    recipeLines: [
      { ingredientId: 'ing-chicken', quantity: 180, unit: 'جرام' },
      { ingredientId: 'ing-bread',   quantity: 1,   unit: 'رغيف' },
      { ingredientId: 'ing-sauce',   quantity: 10,  unit: 'جرام' },
    ],
  },
  {
    id: 'item-chicken-crispy', categoryId: 'cat-sand-chicken', nameAr: 'ساندويتش فراخ كريسبي',
    price: 60, sortOrder: 1,
    recipeLines: [
      { ingredientId: 'ing-chicken', quantity: 200, unit: 'جرام' },
      { ingredientId: 'ing-bread',   quantity: 1,   unit: 'رغيف' },
      { ingredientId: 'ing-oil',     quantity: 50,  unit: 'مل'   },
    ],
  },
  // Grills (weighted)
  {
    id: 'item-kofta-grill', categoryId: 'cat-grills', nameAr: 'كفتة مشوية',
    price: 180, sortOrder: 0, isWeighted: true, allowCustomWeight: true, customWeightUnitPrice: 180,
    weightedPriceOptions: [
      { id: 'wt-250',  label: '250 جرام',  weightKg: 0.25, price: 45  },
      { id: 'wt-500',  label: '500 جرام',  weightKg: 0.5,  price: 90  },
      { id: 'wt-1000', label: 'كيلو كامل', weightKg: 1,    price: 180 },
    ],
    recipeLines: [{ ingredientId: 'ing-kofta', quantity: 1000, unit: 'جرام' }],
  },
  {
    id: 'item-hawawshi-grill', categoryId: 'cat-grills', nameAr: 'هواوشي مشوي',
    price: 200, sortOrder: 1, isWeighted: true, allowCustomWeight: true, customWeightUnitPrice: 200,
    weightedPriceOptions: [
      { id: 'wt-h250',  label: '250 جرام', weightKg: 0.25, price: 50  },
      { id: 'wt-h500',  label: '500 جرام', weightKg: 0.5,  price: 100 },
      { id: 'wt-h1000', label: 'كيلو',     weightKg: 1,    price: 200 },
    ],
    recipeLines: [{ ingredientId: 'ing-hawawshi', quantity: 1000, unit: 'جرام' }],
  },
  {
    id: 'item-chicken-grill', categoryId: 'cat-grills', nameAr: 'فراخ مشوية',
    price: 160, sortOrder: 2, isWeighted: true, allowCustomWeight: true, customWeightUnitPrice: 160,
    weightedPriceOptions: [
      { id: 'wt-c250',  label: '250 جرام', weightKg: 0.25, price: 40  },
      { id: 'wt-c500',  label: '500 جرام', weightKg: 0.5,  price: 80  },
      { id: 'wt-c1000', label: 'كيلو',     weightKg: 1,    price: 160 },
    ],
    recipeLines: [{ ingredientId: 'ing-chicken', quantity: 1000, unit: 'جرام' }],
  },
  // Drinks
  { id: 'item-pepsi', categoryId: 'cat-drinks', nameAr: 'بيبسي', price: 15, sortOrder: 0, recipeLines: [{ ingredientId: 'ing-pepsi', quantity: 1, unit: 'علبة' }] },
  { id: 'item-water', categoryId: 'cat-drinks', nameAr: 'مياه معدنية', price: 8, sortOrder: 1, recipeLines: [{ ingredientId: 'ing-water', quantity: 1, unit: 'زجاجة' }] },
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
console.log('9. Dining tables')
const tables = [
  { id: 'tbl-1',  nameAr: 'ترابيزة 1',  categoryAr: 'صالة داخلية', sortOrder: 0 },
  { id: 'tbl-2',  nameAr: 'ترابيزة 2',  categoryAr: 'صالة داخلية', sortOrder: 1 },
  { id: 'tbl-3',  nameAr: 'ترابيزة 3',  categoryAr: 'صالة داخلية', sortOrder: 2 },
  { id: 'tbl-4',  nameAr: 'ترابيزة 4',  categoryAr: 'صالة داخلية', sortOrder: 3 },
  { id: 'tbl-5',  nameAr: 'ترابيزة 5',  categoryAr: 'صالة داخلية', sortOrder: 4 },
  { id: 'tbl-6',  nameAr: 'ترابيزة 6',  categoryAر: 'صالة داخلية', sortOrder: 5 },
  { id: 'tbl-7',  nameAr: 'ترابيزة T1', categoryAr: 'تراس خارجي',  sortOrder: 0 },
  { id: 'tbl-8',  nameAr: 'ترابيزة T2', categoryAr: 'تراس خارجي',  sortOrder: 1 },
  { id: 'tbl-9',  nameAr: 'ترابيزة T3', categoryAr: 'تراس خارجي',  sortOrder: 2 },
  { id: 'tbl-10', nameAr: 'ترابيزة T4', categoryAr: 'تراس خارجي',  sortOrder: 3 },
]
for (const t of tables) put('dining_tables', { ...t, active: true, createdAt: now, updatedAt: now })

// ─── 10. Shifts ───────────────────────────────────────────────────────────────
console.log('10. Shifts')
const shift1Id = 'shift-day-1'
const shift2Id = 'shift-day-2'
const shift3Id = 'shift-open'

put('shifts', { id: shift1Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', status: 'closed', archived: true,  openedAt: daysAgo(2, 9), closedAt: daysAgo(2, 17), closedBy: cashier1User.id, createdAt: daysAgo(2, 9), updatedAt: daysAgo(2, 17) })
put('shifts', { id: shift2Id, cashierId: cashier2User.id, cashierName: 'محمد الكاشير', cashierCode: 'C02', status: 'closed', archived: false, openedAt: daysAgo(1, 9), closedAt: daysAgo(1, 17), closedBy: cashier2User.id, createdAt: daysAgo(1, 9), updatedAt: daysAgo(1, 17) })
put('shifts', { id: shift3Id, cashierId: cashier1User.id, cashierName: 'أحمد الكاشير', cashierCode: 'C01', status: 'open',   archived: false, openedAt: daysAgo(0, 9), createdAt: daysAgo(0, 9), updatedAt: daysAgo(0, 9) })

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
]

let orderNum = 1
for (const tmpl of orderTemplates) {
  const subtotal = tmpl.lines.reduce((s, l) => s + lineTotal(l.price, l.qty), 0)
  const total = Math.round(subtotal * 100) / 100
  const orderId = uid()
  const isPaid = tmpl.paid

  const order = {
    id: orderId,
    orderNumber: orderNum++,
    orderCode: String(orderNum - 1).padStart(4, '0'),
    status: isPaid ? 'completed' : 'draft',
    orderType: tmpl.type,
    paymentStatus: isPaid ? 'paid' : 'unpaid',
    tableId: tmpl.tableId,
    tableNameAr: tmpl.tableNameAr,
    tableCategoryAr: tmpl.tableCategoryAr,
    shiftId: tmpl.shiftId,
    cashierId: tmpl.cashierId,
    cashierName: tmpl.cashierName,
    cashierCode: tmpl.cashierCode,
    subtotal,
    total,
    noteAr: tmpl.noteAr,
    archived: false,
    createdAt: tmpl.createdAt,
    updatedAt: tmpl.createdAt,
    completedAt: isPaid ? tmpl.createdAt : undefined,
    paidAt: isPaid ? tmpl.createdAt : undefined,
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

  if (isPaid && tmpl.method) {
    put('payments', {
      id: uid(),
      orderId,
      amount: total,
      method: tmpl.method,
      createdAt: tmpl.createdAt,
    })
    put('cash_drawer_transactions', {
      id: uid(),
      type: 'sale',
      amount: total,
      shiftId: tmpl.shiftId,
      orderId,
      createdBy: tmpl.cashierId,
      createdAt: tmpl.createdAt,
    })
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
console.log('    10 dining tables (2 sections)')
console.log('    3 shifts (2 closed + 1 open)')
console.log('   ', orderTemplates.length, 'orders (takeaway / dine-in / delivery)')
console.log('    3 suppliers with debts + payments')
console.log('─────────────────────────────────────────────')
console.log()
console.log('⚠  First launch: the app will read from SQLite cache.')
console.log('   If you see a login error, check the note below.\n')
