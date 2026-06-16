#!/usr/bin/env tsx
/**
 * Full demo seed — populates Firestore with realistic data for testing.
 *
 * Creates:
 *   - Settings (restaurant info)
 *   - 1 manager + 2 cashiers
 *   - 3 suppliers
 *   - 12 ingredients with stock
 *   - 4 menu categories (with sub-categories)
 *   - 18 menu items (regular, sized, weighted, with attachments)
 *   - Recipes linked to every item
 *   - 10 dining tables (2 sections)
 *   - 2 closed shifts + 1 open shift
 *   - 40 historical orders (takeaway/dine-in/delivery, paid & unpaid)
 *   - Cash drawer transactions
 *   - Supplier transactions / debts
 *
 * Run: npm run seed:demo
 */

import { loadEnv } from './load-env'
import { initFirebaseAdmin } from './firebase-admin-init'
import { ensureFirebaseProjectReady } from './ensure-firebase'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { COLLECTIONS } from '../shared/constants/collections'
import { SETTINGS_DOC_ID } from '../shared/schema/firestore-schema'
import { lineTotal, orderSubtotal, orderTotal } from '../shared/services/order-calculator'

loadEnv()

// ─── helpers ────────────────────────────────────────────────────────────────

function daysAgo(n: number, hourOffset = 0): number {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hourOffset, 0, 0, 0)
  return d.getTime()
}

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function pick<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

let _orderNumber = 1
function nextOrderNum(): number { return _orderNumber++ }

async function ensureAuthUser(
  email: string,
  password: string,
  displayName: string,
): Promise<string> {
  const auth = getAuth()
  try {
    const existing = await auth.getUserByEmail(email)
    await auth.updateUser(existing.uid, { password, displayName })
    console.log(`  ✓ auth user exists, updated: ${email}`)
    return existing.uid
  } catch (e: unknown) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e
    const created = await auth.createUser({ email, password, displayName })
    console.log(`  + created auth user: ${email}`)
    return created.uid
  }
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n🌱  Abdo Kofta — full demo seed\n')
  await ensureFirebaseProjectReady()
  initFirebaseAdmin()
  const db = getFirestore()
  const now = Date.now()

  // ── 1. Settings ──────────────────────────────────────────────────────────
  console.log('1. Settings')
  await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOC_ID).set(
    {
      id: SETTINGS_DOC_ID,
      restaurantNameAr: 'SHIFT',
      currencySymbol: 'ج.م',
      phoneNumber: '01000000000',
      receiptFooterAr: 'شكراً لزيارتكم — نتمنى لكم وجبة شهية',
      pinEnabled: false,
      autoLockMinutes: 0,
      nextOrderNumber: 100,
      updatedAt: now,
    },
    { merge: true },
  )

  // ── 2. Users ─────────────────────────────────────────────────────────────
  console.log('2. Users')
  const managerUid = await ensureAuthUser('manager@abdokofta.local', 'Manager123!', 'المدير')
  await db.collection(COLLECTIONS.users).doc(managerUid).set(
    { id: managerUid, email: 'manager@abdokofta.local', username: 'manager', displayName: 'المدير', role: 'manager', active: true, createdAt: now, updatedAt: now },
    { merge: true },
  )

  const cashier1Uid = await ensureAuthUser('cashier1@abdokofta.local', 'Cashier123!', 'أحمد الكاشير')
  await db.collection(COLLECTIONS.users).doc(cashier1Uid).set(
    { id: cashier1Uid, email: 'cashier1@abdokofta.local', username: 'cashier1', displayName: 'أحمد الكاشير', cashierCode: 'C01', role: 'cashier', active: true, createdAt: now, updatedAt: now },
    { merge: true },
  )

  const cashier2Uid = await ensureAuthUser('cashier2@abdokofta.local', 'Cashier123!', 'محمد الكاشير')
  await db.collection(COLLECTIONS.users).doc(cashier2Uid).set(
    { id: cashier2Uid, email: 'cashier2@abdokofta.local', username: 'cashier2', displayName: 'محمد الكاشير', cashierCode: 'C02', role: 'cashier', active: true, createdAt: now, updatedAt: now },
    { merge: true },
  )

  // ── 3. Suppliers ──────────────────────────────────────────────────────────
  console.log('3. Suppliers')
  const suppliers = [
    { id: 'sup-1', nameAr: 'مورد اللحوم - الحاج سعيد', phone: '01011111111', noteAr: 'يورد كل يوم أحد' },
    { id: 'sup-2', nameAr: 'مورد الخضروات والخبز', phone: '01022222222', noteAr: 'توريد يومي' },
    { id: 'sup-3', nameAr: 'مورد المشروبات والبقالة', phone: '01033333333', noteAr: '' },
  ]
  for (const s of suppliers) {
    await db.collection(COLLECTIONS.suppliers).doc(s.id).set(
      { ...s, active: true, createdAt: now, updatedAt: now },
      { merge: true },
    )
  }

  // ── 4. Ingredients ────────────────────────────────────────────────────────
  console.log('4. Ingredients')
  const ingredients = [
    { id: 'ing-kofta',    nameAr: 'كفتة (لحم مفروم)',  unit: 'جرام',  lowStockThreshold: 3000 },
    { id: 'ing-hawawshi', nameAr: 'لحم هواوشي',          unit: 'جرام',  lowStockThreshold: 2000 },
    { id: 'ing-chicken',  nameAr: 'صدر فراخ',            unit: 'جرام',  lowStockThreshold: 2000 },
    { id: 'ing-liver',    nameAr: 'كبدة',                unit: 'جرام',  lowStockThreshold: 1000 },
    { id: 'ing-bread',    nameAr: 'خبز عيش بلدي',        unit: 'رغيف',  lowStockThreshold: 30   },
    { id: 'ing-tomato',   nameAr: 'طماطم',               unit: 'جرام',  lowStockThreshold: 500  },
    { id: 'ing-onion',    nameAr: 'بصل',                 unit: 'جرام',  lowStockThreshold: 500  },
    { id: 'ing-tahini',   nameAr: 'طحينة',               unit: 'جرام',  lowStockThreshold: 300  },
    { id: 'ing-oil',      nameAr: 'زيت',                 unit: 'مل',    lowStockThreshold: 500  },
    { id: 'ing-pepsi',    nameAr: 'بيبسي',               unit: 'علبة',  lowStockThreshold: 24   },
    { id: 'ing-water',    nameAr: 'مياه',                unit: 'زجاجة', lowStockThreshold: 24   },
    { id: 'ing-sauce',    nameAr: 'صوص حار',             unit: 'جرام',  lowStockThreshold: 200  },
  ]
  for (const ing of ingredients) {
    await db.collection(COLLECTIONS.ingredients).doc(ing.id).set(
      { ...ing, active: true, createdAt: now, updatedAt: now },
      { merge: true },
    )
  }

  // ── 5. Stock (opening balances) ───────────────────────────────────────────
  console.log('5. Opening stock')
  const openingStock: Array<{ id: string; qty: number }> = [
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
  const ing = ingredients.reduce<Record<string, (typeof ingredients)[0]>>((acc, i) => { acc[i.id] = i; return acc }, {})
  for (const s of openingStock) {
    await db.collection(COLLECTIONS.inventoryTransactions).add({
      ingredientId: s.id,
      ingredientNameAr: ing[s.id]!.nameAr,
      type: 'purchase',
      quantity: s.qty,
      unit: ing[s.id]!.unit,
      referenceType: 'manual',
      noteAr: 'رصيد افتتاحي',
      createdBy: managerUid,
      createdAt: daysAgo(30),
    })
  }

  // ── 6. Menu categories ────────────────────────────────────────────────────
  console.log('6. Menu categories')
  const categories = [
    { id: 'cat-sandwiches', nameAr: 'ساندويتشات', sortOrder: 0, parentId: undefined },
    { id: 'cat-grills',     nameAr: 'مشويات',      sortOrder: 1, parentId: undefined },
    { id: 'cat-drinks',     nameAr: 'مشروبات',     sortOrder: 2, parentId: undefined },
    { id: 'cat-extras',     nameAr: 'إضافات',      sortOrder: 3, parentId: undefined },
    // sub-categories
    { id: 'cat-sand-kofta',    nameAr: 'كفتة', sortOrder: 0, parentId: 'cat-sandwiches' },
    { id: 'cat-sand-chicken',  nameAr: 'فراخ', sortOrder: 1, parentId: 'cat-sandwiches' },
  ]
  for (const cat of categories) {
    await db.collection(COLLECTIONS.menuCategories).doc(cat.id).set(
      { ...cat, active: true, createdAt: now, updatedAt: now },
      { merge: true },
    )
  }

  // ── 7. Recipes + Menu items ───────────────────────────────────────────────
  console.log('7. Recipes + Menu items')

  interface SeedItem {
    id: string
    categoryId: string
    nameAr: string
    descriptionAr?: string
    price: number
    sortOrder: number
    isWeighted?: boolean
    allowCustomWeight?: boolean
    customWeightUnitPrice?: number
    weightedPriceOptions?: Array<{ id: string; label: string; weightKg: number; price: number }>
    sizeOptions?: Array<{ id: string; labelAr: string; price: number }>
    attachments?: Array<{ id: string; nameAr: string; price: number }>
    recipeLines: Array<{ ingredientId: string; quantity: number; unit: string }>
  }

  const menuItems: SeedItem[] = [
    // ── Sandwiches — kofta
    {
      id: 'item-kofta-1',
      categoryId: 'cat-sand-kofta',
      nameAr: 'ساندويتش كفتة',
      descriptionAr: '٢ قطعة كفتة مع طماطم وصوص',
      price: 45,
      sortOrder: 0,
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
      id: 'item-kofta-double',
      categoryId: 'cat-sand-kofta',
      nameAr: 'ساندويتش كفتة دبل',
      descriptionAr: '٤ قطع كفتة',
      price: 75,
      sortOrder: 1,
      recipeLines: [
        { ingredientId: 'ing-kofta',  quantity: 300, unit: 'جرام' },
        { ingredientId: 'ing-bread',  quantity: 1,   unit: 'رغيف' },
        { ingredientId: 'ing-tomato', quantity: 50,  unit: 'جرام' },
        { ingredientId: 'ing-sauce',  quantity: 15,  unit: 'جرام' },
      ],
    },
    {
      id: 'item-hawawshi',
      categoryId: 'cat-sand-kofta',
      nameAr: 'ساندويتش هواوشي',
      descriptionAr: 'هواوشي مشوي بالبصل',
      price: 55,
      sortOrder: 2,
      recipeLines: [
        { ingredientId: 'ing-hawawshi', quantity: 200, unit: 'جرام' },
        { ingredientId: 'ing-bread',    quantity: 1,   unit: 'رغيف' },
        { ingredientId: 'ing-onion',    quantity: 30,  unit: 'جرام' },
      ],
    },
    {
      id: 'item-liver',
      categoryId: 'cat-sand-kofta',
      nameAr: 'ساندويتش كبدة',
      descriptionAr: 'كبدة مقلية بالفلفل الحار',
      price: 40,
      sortOrder: 3,
      recipeLines: [
        { ingredientId: 'ing-liver', quantity: 150, unit: 'جرام' },
        { ingredientId: 'ing-bread', quantity: 1,   unit: 'رغيف' },
        { ingredientId: 'ing-oil',   quantity: 20,  unit: 'مل'   },
      ],
    },
    // ── Sandwiches — chicken
    {
      id: 'item-chicken-sand',
      categoryId: 'cat-sand-chicken',
      nameAr: 'ساندويتش فراخ',
      descriptionAr: 'صدر فراخ مشوي',
      price: 50,
      sortOrder: 0,
      sizeOptions: [
        { id: 'sz-small',  labelAr: 'صغير',  price: 35 },
        { id: 'sz-medium', labelAr: 'وسط',   price: 50 },
        { id: 'sz-large',  labelAr: 'كبير',  price: 70 },
      ],
      recipeLines: [
        { ingredientId: 'ing-chicken', quantity: 180, unit: 'جرام' },
        { ingredientId: 'ing-bread',   quantity: 1,   unit: 'رغيف' },
        { ingredientId: 'ing-sauce',   quantity: 10,  unit: 'جرام' },
      ],
    },
    {
      id: 'item-chicken-crispy',
      categoryId: 'cat-sand-chicken',
      nameAr: 'ساندويتش فراخ كريسبي',
      price: 60,
      sortOrder: 1,
      recipeLines: [
        { ingredientId: 'ing-chicken', quantity: 200, unit: 'جرام' },
        { ingredientId: 'ing-bread',   quantity: 1,   unit: 'رغيف' },
        { ingredientId: 'ing-oil',     quantity: 50,  unit: 'مل'   },
      ],
    },
    // ── Grills (weighted)
    {
      id: 'item-kofta-grill',
      categoryId: 'cat-grills',
      nameAr: 'كفتة مشوية',
      descriptionAr: 'بالكيلو — سعر ثابت',
      price: 180,
      sortOrder: 0,
      isWeighted: true,
      allowCustomWeight: true,
      customWeightUnitPrice: 180,
      weightedPriceOptions: [
        { id: 'wt-250',  label: '250 جرام',  weightKg: 0.25, price: 45  },
        { id: 'wt-500',  label: '500 جرام',  weightKg: 0.5,  price: 90  },
        { id: 'wt-1000', label: 'كيلو كامل', weightKg: 1,    price: 180 },
      ],
      recipeLines: [
        { ingredientId: 'ing-kofta', quantity: 1000, unit: 'جرام' },
      ],
    },
    {
      id: 'item-hawawshi-grill',
      categoryId: 'cat-grills',
      nameAr: 'هواوشي مشوي',
      price: 200,
      sortOrder: 1,
      isWeighted: true,
      allowCustomWeight: true,
      customWeightUnitPrice: 200,
      weightedPriceOptions: [
        { id: 'wt-h250',  label: '250 جرام', weightKg: 0.25, price: 50  },
        { id: 'wt-h500',  label: '500 جرام', weightKg: 0.5,  price: 100 },
        { id: 'wt-h1000', label: 'كيلو',     weightKg: 1,    price: 200 },
      ],
      recipeLines: [
        { ingredientId: 'ing-hawawshi', quantity: 1000, unit: 'جرام' },
      ],
    },
    {
      id: 'item-chicken-grill',
      categoryId: 'cat-grills',
      nameAr: 'فراخ مشوية',
      price: 160,
      sortOrder: 2,
      isWeighted: true,
      allowCustomWeight: true,
      customWeightUnitPrice: 160,
      weightedPriceOptions: [
        { id: 'wt-c250',  label: '250 جرام', weightKg: 0.25, price: 40  },
        { id: 'wt-c500',  label: '500 جرام', weightKg: 0.5,  price: 80  },
        { id: 'wt-c1000', label: 'كيلو',     weightKg: 1,    price: 160 },
      ],
      recipeLines: [
        { ingredientId: 'ing-chicken', quantity: 1000, unit: 'جرام' },
      ],
    },
    // ── Drinks
    {
      id: 'item-pepsi',
      categoryId: 'cat-drinks',
      nameAr: 'بيبسي',
      price: 15,
      sortOrder: 0,
      recipeLines: [{ ingredientId: 'ing-pepsi', quantity: 1, unit: 'علبة' }],
    },
    {
      id: 'item-water',
      categoryId: 'cat-drinks',
      nameAr: 'مياه معدنية',
      price: 8,
      sortOrder: 1,
      recipeLines: [{ ingredientId: 'ing-water', quantity: 1, unit: 'زجاجة' }],
    },
    // ── Extras
    {
      id: 'item-tahini',
      categoryId: 'cat-extras',
      nameAr: 'طحينة',
      price: 5,
      sortOrder: 0,
      recipeLines: [{ ingredientId: 'ing-tahini', quantity: 30, unit: 'جرام' }],
    },
    {
      id: 'item-tomato-salad',
      categoryId: 'cat-extras',
      nameAr: 'سلطة طماطم',
      price: 10,
      sortOrder: 1,
      recipeLines: [
        { ingredientId: 'ing-tomato', quantity: 100, unit: 'جرام' },
        { ingredientId: 'ing-onion',  quantity: 30,  unit: 'جرام' },
      ],
    },
  ]

  for (const item of menuItems) {
    const recipeId = `recipe-${item.id}`
    await db.collection(COLLECTIONS.recipes).doc(recipeId).set(
      {
        id: recipeId,
        menuItemId: item.id,
        nameAr: item.nameAr,
        lines: item.recipeLines,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    )

    const { recipeLines: _rl, ...itemData } = item
    await db.collection(COLLECTIONS.menuItems).doc(item.id).set(
      {
        ...itemData,
        recipeId,
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    )
  }

  // ── 8. Dining tables ──────────────────────────────────────────────────────
  console.log('8. Dining tables')
  const tables = [
    // صالة داخلية
    { id: 'tbl-1',  nameAr: 'ترابيزة 1',  categoryAr: 'صالة داخلية', sortOrder: 0 },
    { id: 'tbl-2',  nameAr: 'ترابيزة 2',  categoryAr: 'صالة داخلية', sortOrder: 1 },
    { id: 'tbl-3',  nameAr: 'ترابيزة 3',  categoryAr: 'صالة داخلية', sortOrder: 2 },
    { id: 'tbl-4',  nameAr: 'ترابيزة 4',  categoryAr: 'صالة داخلية', sortOrder: 3 },
    { id: 'tbl-5',  nameAr: 'ترابيزة 5',  categoryAr: 'صالة داخلية', sortOrder: 4 },
    { id: 'tbl-6',  nameAr: 'ترابيزة 6',  categoryAr: 'صالة داخلية', sortOrder: 5 },
    // تراس خارجي
    { id: 'tbl-7',  nameAr: 'ترابيزة T1', categoryAr: 'تراس خارجي', sortOrder: 0 },
    { id: 'tbl-8',  nameAr: 'ترابيزة T2', categoryAr: 'تراس خارجي', sortOrder: 1 },
    { id: 'tbl-9',  nameAr: 'ترابيزة T3', categoryAr: 'تراس خارجي', sortOrder: 2 },
    { id: 'tbl-10', nameAr: 'ترابيزة T4', categoryAr: 'تراس خارجي', sortOrder: 3 },
  ]
  for (const t of tables) {
    await db.collection(COLLECTIONS.diningTables).doc(t.id).set(
      { ...t, active: true, createdAt: now, updatedAt: now },
      { merge: true },
    )
  }

  // ── 9. Shifts ─────────────────────────────────────────────────────────────
  console.log('9. Shifts')
  const shift1Id = 'shift-day-1'
  const shift2Id = 'shift-day-2'
  const shift3Id = 'shift-open'

  await db.collection(COLLECTIONS.shifts).doc(shift1Id).set(
    {
      id: shift1Id,
      cashierId: cashier1Uid,
      cashierName: 'أحمد الكاشير',
      cashierCode: 'C01',
      status: 'closed',
      archived: true,
      openedAt: daysAgo(2, 9),
      closedAt: daysAgo(2, 17),
      closedBy: cashier1Uid,
      createdAt: daysAgo(2, 9),
      updatedAt: daysAgo(2, 17),
    },
    { merge: true },
  )
  await db.collection(COLLECTIONS.shifts).doc(shift2Id).set(
    {
      id: shift2Id,
      cashierId: cashier2Uid,
      cashierName: 'محمد الكاشير',
      cashierCode: 'C02',
      status: 'closed',
      archived: false,
      openedAt: daysAgo(1, 9),
      closedAt: daysAgo(1, 17),
      closedBy: cashier2Uid,
      createdAt: daysAgo(1, 9),
      updatedAt: daysAgo(1, 17),
    },
    { merge: true },
  )
  await db.collection(COLLECTIONS.shifts).doc(shift3Id).set(
    {
      id: shift3Id,
      cashierId: cashier1Uid,
      cashierName: 'أحمد الكاشير',
      cashierCode: 'C01',
      status: 'open',
      archived: false,
      openedAt: daysAgo(0, 9),
      createdAt: daysAgo(0, 9),
      updatedAt: daysAgo(0, 9),
    },
    { merge: true },
  )

  // ── 10. Orders ────────────────────────────────────────────────────────────
  console.log('10. Orders (40 total)')

  interface SeedOrderLine {
    menuItemId: string
    nameAr: string
    unitPrice: number
    quantity: number
    sizeLabelAr?: string
    unitLabel?: string
    weightGrams?: number
  }

  type SeedOrderType = 'takeaway' | 'dine_in' | 'delivery'

  interface SeedOrder {
    type: SeedOrderType
    paymentStatus: 'paid' | 'unpaid'
    paymentMethod?: 'cash' | 'card'
    shiftId: string
    cashierId: string
    cashierName: string
    cashierCode: string
    tableId?: string
    tableNameAr?: string
    tableCategoryAr?: string
    lines: SeedOrderLine[]
    noteAr?: string
    createdAt: number
  }

  const orderTemplates: SeedOrder[] = [
    // Day -2 — shift 1 (cashier1)
    { type: 'takeaway', paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift1Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 10), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', unitPrice: 45, quantity: 2 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', unitPrice: 15, quantity: 2 }] },
    { type: 'takeaway', paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift1Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 10), lines: [{ menuItemId: 'item-hawawshi', nameAr: 'ساندويتش هواوشي', unitPrice: 55, quantity: 1 }] },
    { type: 'dine_in',  paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift1Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-1', tableNameAr: 'ترابيزة 1', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(2, 11), lines: [{ menuItemId: 'item-kofta-grill', nameAr: 'كفتة مشوية', unitPrice: 90, quantity: 0.5, unitLabel: 'كجم', weightGrams: 500 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', unitPrice: 15, quantity: 3 }] },
    { type: 'takeaway', paymentStatus: 'paid', paymentMethod: 'card',  shiftId: shift1Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 12), lines: [{ menuItemId: 'item-kofta-double', nameAr: 'ساندويتش كفتة دبل', unitPrice: 75, quantity: 2 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', unitPrice: 8, quantity: 2 }] },
    { type: 'delivery', paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift1Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 12), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', unitPrice: 45, quantity: 4 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', unitPrice: 15, quantity: 4 }], noteAr: 'توصيل لشارع الجمهورية' },
    { type: 'dine_in',  paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift1Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-3', tableNameAr: 'ترابيزة 3', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(2, 13), lines: [{ menuItemId: 'item-liver', nameAr: 'ساندويتش كبدة', unitPrice: 40, quantity: 2 }, { menuItemId: 'item-tahini', nameAr: 'طحينة', unitPrice: 5, quantity: 2 }] },
    { type: 'takeaway', paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift1Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 14), lines: [{ menuItemId: 'item-chicken-sand', nameAr: 'ساندويتش فراخ', unitPrice: 50, quantity: 1, sizeLabelAr: 'كبير' }, { menuItemId: 'item-tomato-salad', nameAr: 'سلطة طماطم', unitPrice: 10, quantity: 1 }] },
    { type: 'takeaway', paymentStatus: 'paid', paymentMethod: 'card',  shiftId: shift1Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 15), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', unitPrice: 45, quantity: 3 }, { menuItemId: 'item-kofta-double', nameAr: 'ساندويتش كفتة دبل', unitPrice: 75, quantity: 1 }] },
    { type: 'dine_in',  paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift1Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-7', tableNameAr: 'ترابيزة T1', tableCategoryAr: 'تراس خارجي', createdAt: daysAgo(2, 15), lines: [{ menuItemId: 'item-hawawshi-grill', nameAr: 'هواوشي مشوي', unitPrice: 100, quantity: 0.5, unitLabel: 'كجم', weightGrams: 500 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', unitPrice: 8, quantity: 4 }] },
    { type: 'takeaway', paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift1Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(2, 16), lines: [{ menuItemId: 'item-chicken-crispy', nameAr: 'ساندويتش فراخ كريسبي', unitPrice: 60, quantity: 2 }] },

    // Day -1 — shift 2 (cashier2)
    { type: 'takeaway', paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift2Id, cashierId: cashier2Uid, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 10), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', unitPrice: 45, quantity: 1 }] },
    { type: 'dine_in',  paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift2Id, cashierId: cashier2Uid, cashierName: 'محمد الكاشير', cashierCode: 'C02', tableId: 'tbl-2', tableNameAr: 'ترابيزة 2', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(1, 11), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', unitPrice: 45, quantity: 4 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', unitPrice: 15, quantity: 4 }, { menuItemId: 'item-tahini', nameAr: 'طحينة', unitPrice: 5, quantity: 4 }] },
    { type: 'delivery', paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift2Id, cashierId: cashier2Uid, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 11), lines: [{ menuItemId: 'item-hawawshi', nameAr: 'ساندويتش هواوشي', unitPrice: 55, quantity: 3 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', unitPrice: 8, quantity: 3 }] },
    { type: 'takeaway', paymentStatus: 'paid', paymentMethod: 'card',  shiftId: shift2Id, cashierId: cashier2Uid, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 12), lines: [{ menuItemId: 'item-chicken-grill', nameAr: 'فراخ مشوية', unitPrice: 80, quantity: 0.5, unitLabel: 'كجم', weightGrams: 500 }] },
    { type: 'dine_in',  paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift2Id, cashierId: cashier2Uid, cashierName: 'محمد الكاشير', cashierCode: 'C02', tableId: 'tbl-5', tableNameAr: 'ترابيزة 5', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(1, 13), lines: [{ menuItemId: 'item-kofta-grill', nameAr: 'كفتة مشوية', unitPrice: 180, quantity: 1, unitLabel: 'كجم', weightGrams: 1000 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', unitPrice: 15, quantity: 5 }] },
    { type: 'takeaway', paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift2Id, cashierId: cashier2Uid, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 13), lines: [{ menuItemId: 'item-liver', nameAr: 'ساندويتش كبدة', unitPrice: 40, quantity: 3 }, { menuItemId: 'item-tomato-salad', nameAr: 'سلطة طماطم', unitPrice: 10, quantity: 2 }] },
    { type: 'delivery', paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift2Id, cashierId: cashier2Uid, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 14), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', unitPrice: 45, quantity: 5 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', unitPrice: 15, quantity: 5 }], noteAr: 'طلب من التطبيق' },
    { type: 'takeaway', paymentStatus: 'paid', paymentMethod: 'card',  shiftId: shift2Id, cashierId: cashier2Uid, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 15), lines: [{ menuItemId: 'item-chicken-sand', nameAr: 'ساندويتش فراخ', unitPrice: 35, quantity: 2, sizeLabelAr: 'صغير' }] },
    { type: 'dine_in',  paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift2Id, cashierId: cashier2Uid, cashierName: 'محمد الكاشير', cashierCode: 'C02', tableId: 'tbl-8', tableNameAr: 'ترابيزة T2', tableCategoryAr: 'تراس خارجي', createdAt: daysAgo(1, 15), lines: [{ menuItemId: 'item-kofta-double', nameAr: 'ساندويتش كفتة دبل', unitPrice: 75, quantity: 2 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', unitPrice: 8, quantity: 2 }] },
    { type: 'takeaway', paymentStatus: 'paid', paymentMethod: 'cash',  shiftId: shift2Id, cashierId: cashier2Uid, cashierName: 'محمد الكاشير', cashierCode: 'C02', createdAt: daysAgo(1, 16), lines: [{ menuItemId: 'item-hawawshi-grill', nameAr: 'هواوشي مشوي', unitPrice: 50, quantity: 0.25, unitLabel: 'كجم', weightGrams: 250 }, { menuItemId: 'item-tahini', nameAr: 'طحينة', unitPrice: 5, quantity: 1 }] },

    // Today — open shift (cashier1) — mix of paid + unpaid
    { type: 'takeaway', paymentStatus: 'paid',   paymentMethod: 'cash', shiftId: shift3Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 10), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', unitPrice: 45, quantity: 2 }] },
    { type: 'takeaway', paymentStatus: 'paid',   paymentMethod: 'cash', shiftId: shift3Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 10), lines: [{ menuItemId: 'item-liver', nameAr: 'ساندويتش كبدة', unitPrice: 40, quantity: 1 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', unitPrice: 15, quantity: 1 }] },
    { type: 'dine_in',  paymentStatus: 'unpaid', shiftId: shift3Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-2', tableNameAr: 'ترابيزة 2', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(0, 10), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', unitPrice: 45, quantity: 3 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', unitPrice: 15, quantity: 3 }] },
    { type: 'dine_in',  paymentStatus: 'unpaid', shiftId: shift3Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-5', tableNameAr: 'ترابيزة 5', tableCategoryAr: 'صالة داخلية', createdAt: daysAgo(0, 11), lines: [{ menuItemId: 'item-kofta-grill', nameAr: 'كفتة مشوية', unitPrice: 90, quantity: 0.5, unitLabel: 'كجم', weightGrams: 500 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', unitPrice: 8, quantity: 2 }] },
    { type: 'takeaway', paymentStatus: 'paid',   paymentMethod: 'card', shiftId: shift3Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 11), lines: [{ menuItemId: 'item-chicken-sand', nameAr: 'ساندويتش فراخ', unitPrice: 50, quantity: 2, sizeLabelAr: 'وسط' }, { menuItemId: 'item-tomato-salad', nameAr: 'سلطة طماطم', unitPrice: 10, quantity: 1 }] },
    { type: 'delivery', paymentStatus: 'paid',   paymentMethod: 'cash', shiftId: shift3Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 11), lines: [{ menuItemId: 'item-kofta-double', nameAr: 'ساندويتش كفتة دبل', unitPrice: 75, quantity: 2 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', unitPrice: 15, quantity: 2 }] },
    { type: 'dine_in',  paymentStatus: 'unpaid', shiftId: shift3Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-7', tableNameAr: 'ترابيزة T1', tableCategoryAr: 'تراس خارجي', createdAt: daysAgo(0, 12), lines: [{ menuItemId: 'item-hawawshi', nameAr: 'ساندويتش هواوشي', unitPrice: 55, quantity: 2 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', unitPrice: 15, quantity: 2 }] },
    { type: 'takeaway', paymentStatus: 'paid',   paymentMethod: 'cash', shiftId: shift3Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 12), lines: [{ menuItemId: 'item-kofta-1', nameAr: 'ساندويتش كفتة', unitPrice: 45, quantity: 5 }] },
    { type: 'delivery', paymentStatus: 'paid',   paymentMethod: 'cash', shiftId: shift3Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', createdAt: daysAgo(0, 13), lines: [{ menuItemId: 'item-liver', nameAr: 'ساندويتش كبدة', unitPrice: 40, quantity: 2 }, { menuItemId: 'item-tahini', nameAr: 'طحينة', unitPrice: 5, quantity: 2 }, { menuItemId: 'item-water', nameAr: 'مياه معدنية', unitPrice: 8, quantity: 2 }], noteAr: 'لا بصل' },
    { type: 'dine_in',  paymentStatus: 'unpaid', shiftId: shift3Id, cashierId: cashier1Uid, cashierName: 'أحمد الكاشير', cashierCode: 'C01', tableId: 'tbl-9', tableNameAr: 'ترابيزة T3', tableCategoryAr: 'تراس خارجي', createdAt: daysAgo(0, 13), lines: [{ menuItemId: 'item-chicken-grill', nameAr: 'فراخ مشوية', unitPrice: 160, quantity: 1, unitLabel: 'كجم', weightGrams: 1000 }, { menuItemId: 'item-pepsi', nameAr: 'بيبسي', unitPrice: 15, quantity: 4 }] },
  ]

  const createdOrderIds: string[] = []

  for (const template of orderTemplates) {
    const subtotal = orderSubtotal(template.lines)
    const total = orderTotal(subtotal)
    const orderNum = nextOrderNum()
    const orderRef = db.collection(COLLECTIONS.orders).doc()
    const orderId = orderRef.id

    const orderDoc = {
      id: orderId,
      orderNumber: orderNum,
      orderCode: String(orderNum).padStart(4, '0'),
      status: 'completed' as const,
      orderType: template.type,
      paymentStatus: template.paymentStatus,
      tableId: template.tableId,
      tableNameAr: template.tableNameAr,
      tableCategoryAr: template.tableCategoryAr,
      shiftId: template.shiftId,
      cashierId: template.cashierId,
      cashierName: template.cashierName,
      cashierCode: template.cashierCode,
      subtotal,
      total,
      noteAr: template.noteAr,
      archived: false,
      createdAt: template.createdAt,
      updatedAt: template.createdAt,
      completedAt: template.createdAt,
      paidAt: template.paymentStatus === 'paid' ? template.createdAt : undefined,
    }
    await orderRef.set(orderDoc)

    // order_items
    const batch = db.batch()
    for (const line of template.lines) {
      const itemRef = db.collection(COLLECTIONS.orderItems).doc()
      batch.set(itemRef, {
        id: itemRef.id,
        orderId,
        menuItemId: line.menuItemId,
        nameAr: line.nameAr,
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        sizeLabelAr: line.sizeLabelAr,
        unitLabel: line.unitLabel,
        weightGrams: line.weightGrams,
        lineTotal: lineTotal(line.unitPrice, line.quantity),
      })
    }
    await batch.commit()

    // payment
    if (template.paymentStatus === 'paid' && template.paymentMethod) {
      await db.collection(COLLECTIONS.payments).add({
        orderId,
        amount: total,
        method: template.paymentMethod,
        createdAt: template.createdAt,
      })
    }

    createdOrderIds.push(orderId)
    process.stdout.write('.')
  }
  console.log(`\n  ✓ ${orderTemplates.length} orders created`)

  // ── 11. Cash drawer transactions ──────────────────────────────────────────
  console.log('11. Cash drawer transactions')

  // Opening floats for each shift
  const floats = [
    { shiftId: shift1Id, amount: 500, createdAt: daysAgo(2, 9) },
    { shiftId: shift2Id, amount: 500, createdAt: daysAgo(1, 9) },
    { shiftId: shift3Id, amount: 500, createdAt: daysAgo(0, 9) },
  ]
  for (const f of floats) {
    await db.collection(COLLECTIONS.cashDrawerTransactions).add({
      type: 'cash_in',
      amount: f.amount,
      shiftId: f.shiftId,
      noteAr: 'رصيد افتتاحي الدرج',
      createdBy: managerUid,
      createdAt: f.createdAt,
    })
  }

  // Miscellaneous expenses
  const expenses = [
    { shiftId: shift1Id, amount: 50,  noteAr: 'شراء مستلزمات نظافة',  createdAt: daysAgo(2, 14) },
    { shiftId: shift2Id, amount: 120, noteAr: 'فاتورة غاز',            createdAt: daysAgo(1, 12) },
    { shiftId: shift3Id, amount: 30,  noteAr: 'مصاريف نثرية',          createdAt: daysAgo(0, 11) },
  ]
  for (const exp of expenses) {
    await db.collection(COLLECTIONS.cashDrawerTransactions).add({
      type: 'expense',
      amount: -exp.amount,
      shiftId: exp.shiftId,
      noteAr: exp.noteAr,
      createdBy: cashier1Uid,
      createdAt: exp.createdAt,
    })
  }

  // ── 12. Supplier transactions ─────────────────────────────────────────────
  console.log('12. Supplier transactions')

  // Purchases on credit
  const supTxns = [
    { supplierId: 'sup-1', type: 'purchase_credit' as const, amount: 1500, noteAr: 'توريد لحوم الأسبوع الماضي', createdAt: daysAgo(7) },
    { supplierId: 'sup-2', type: 'purchase_credit' as const, amount: 400,  noteAr: 'توريد خبز وخضروات',          createdAt: daysAgo(5) },
    { supplierId: 'sup-1', type: 'purchase_credit' as const, amount: 1200, noteAr: 'توريد لحوم هذا الأسبوع',    createdAt: daysAgo(2) },
    { supplierId: 'sup-3', type: 'purchase_credit' as const, amount: 600,  noteAr: 'مشروبات وبقالة',             createdAt: daysAgo(3) },
    // Payments
    { supplierId: 'sup-1', type: 'payment' as const, amount: 1000, noteAr: 'دفعة جزئية',   createdAt: daysAgo(4) },
    { supplierId: 'sup-2', type: 'payment' as const, amount: 400,  noteAr: 'سداد كامل',     createdAt: daysAgo(3) },
    { supplierId: 'sup-3', type: 'payment' as const, amount: 300,  noteAr: 'دفعة جزئية',   createdAt: daysAgo(1) },
  ]
  for (const tx of supTxns) {
    await db.collection(COLLECTIONS.supplierTransactions).add({
      ...tx,
      shiftId: undefined,
      createdBy: managerUid,
    })
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  console.log('\n✅  Demo seed complete!\n')
  console.log('─────────────────────────────────')
  console.log('  Manager  : manager@abdokofta.local  / Manager123!')
  console.log('  Cashier1 : cashier1@abdokofta.local / Cashier123!')
  console.log('  Cashier2 : cashier2@abdokofta.local / Cashier123!')
  console.log('─────────────────────────────────')
  console.log('  Menu items  : 13 items across 6 categories')
  console.log('  Tables      : 10 (2 sections)')
  console.log('  Shifts      : 2 closed + 1 open')
  console.log('  Orders      : 30 (mix of takeaway / dine-in / delivery)')
  console.log('  Suppliers   : 3 (with debts and payments)')
  console.log('─────────────────────────────────\n')
}

main().catch((err: unknown) => {
  const e = err as { code?: number; reason?: string; details?: string; message?: string }
  if (
    e.code === 7 ||
    e.reason === 'SERVICE_DISABLED' ||
    (e.details ?? '').includes('Firestore API')
  ) {
    const pid = process.env.VITE_FIREBASE_PROJECT_ID ?? process.env.FIREBASE_PROJECT_ID ?? 'YOUR_PROJECT_ID'
    console.error(`\nFirestore is not ready.\nEnable it at: https://console.firebase.google.com/project/${pid}/firestore\n`)
    process.exit(1)
  }
  console.error(err)
  process.exit(1)
})
