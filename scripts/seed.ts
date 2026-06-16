/**
 * Seeds Firestore + Firebase Auth for local/dev setup.
 *
 * Prerequisites:
 *   1. Download service account JSON from Firebase Console → Project settings → Service accounts
 *   2. Set FIREBASE_SERVICE_ACCOUNT_PATH in .env.local
 *
 * Run: npm run seed
 */
import { loadEnv } from './load-env'
import { initFirebaseAdmin } from './firebase-admin-init'
import { ensureFirebaseProjectReady } from './ensure-firebase'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { COLLECTIONS } from '../shared/constants/collections'
import { SETTINGS_DOC_ID } from '../shared/schema/firestore-schema'

loadEnv()

const MANAGER_EMAIL = process.env.SEED_MANAGER_EMAIL ?? 'manager@abdokofta.local'
const MANAGER_PASSWORD = process.env.SEED_MANAGER_PASSWORD ?? 'Manager123!'
const MANAGER_NAME = process.env.SEED_MANAGER_NAME ?? 'المدير'
const CASHIER_EMAIL = process.env.SEED_CASHIER_EMAIL ?? 'cashier@abdokofta.local'
const CASHIER_PASSWORD = process.env.SEED_CASHIER_PASSWORD ?? 'Cashier123!'
const CASHIER_NAME = process.env.SEED_CASHIER_NAME ?? 'كاشير تجريبي'

async function ensureAuthUser(
  email: string,
  password: string,
  displayName: string
): Promise<string> {
  const auth = getAuth()
  try {
    const existing = await auth.getUserByEmail(email)
    await auth.updateUser(existing.uid, { password, displayName })
    console.log(`  Auth user exists, updated: ${email}`)
    return existing.uid
  } catch (e: unknown) {
    const code = (e as { code?: string }).code
    if (code !== 'auth/user-not-found') throw e
    const created = await auth.createUser({ email, password, displayName })
    console.log(`  Created auth user: ${email}`)
    return created.uid
  }
}

async function main(): Promise<void> {
  console.log('Abdo Kofta — Firebase seed\n')
  await ensureFirebaseProjectReady()
  // Re-init after wait (probe may have initialized app)
  initFirebaseAdmin()
  const db = getFirestore()
  const now = Date.now()

  console.log('1. Settings')
  await db.collection(COLLECTIONS.settings).doc(SETTINGS_DOC_ID).set(
    {
      id: SETTINGS_DOC_ID,
      restaurantNameAr: 'SHIFT',
      currencySymbol: 'ج.م',
      receiptFooterAr: 'شكراً لزيارتكم',
      nextOrderNumber: 1,
      updatedAt: now
    },
    { merge: true }
  )

  console.log('2. Manager account')
  const managerUid = await ensureAuthUser(
    MANAGER_EMAIL,
    MANAGER_PASSWORD,
    MANAGER_NAME
  )
  await db.collection(COLLECTIONS.users).doc(managerUid).set(
    {
      id: managerUid,
      email: MANAGER_EMAIL,
      displayName: MANAGER_NAME,
      role: 'manager',
      active: true,
      createdAt: now,
      updatedAt: now
    },
    { merge: true }
  )

  console.log('3. Demo cashier account')
  const cashierUid = await ensureAuthUser(
    CASHIER_EMAIL,
    CASHIER_PASSWORD,
    CASHIER_NAME
  )
  await db.collection(COLLECTIONS.users).doc(cashierUid).set(
    {
      id: cashierUid,
      email: CASHIER_EMAIL,
      displayName: CASHIER_NAME,
      role: 'cashier',
      active: true,
      createdAt: now,
      updatedAt: now
    },
    { merge: true }
  )

  console.log('4. Ingredients')
  const ingredients = [
    { id: 'ing-kofta', nameAr: 'كفتة', unit: 'جرام', lowStockThreshold: 5000 },
    { id: 'ing-bread', nameAr: 'خبز', unit: 'قطعة', lowStockThreshold: 20 },
    { id: 'ing-sauce', nameAr: 'صوص', unit: 'جرام', lowStockThreshold: 500 }
  ] as const

  for (const ing of ingredients) {
    await db
      .collection(COLLECTIONS.ingredients)
      .doc(ing.id)
      .set(
        {
          ...ing,
          active: true,
          createdAt: now,
          updatedAt: now
        },
        { merge: true }
      )
  }

  console.log('5. Initial stock (purchase transactions)')
  const purchases = [
    { ingredientId: 'ing-kofta', quantity: 10000, unit: 'جرام', noteAr: 'رصيد افتتاحي' },
    { ingredientId: 'ing-bread', quantity: 50, unit: 'قطعة', noteAr: 'رصيد افتتاحي' },
    { ingredientId: 'ing-sauce', quantity: 3000, unit: 'جرام', noteAr: 'رصيد افتتاحي' }
  ]
  for (const p of purchases) {
    await db.collection(COLLECTIONS.inventoryTransactions).add({
      ingredientId: p.ingredientId,
      type: 'purchase',
      quantity: p.quantity,
      unit: p.unit,
      referenceType: 'purchase',
      noteAr: p.noteAr,
      createdBy: managerUid,
      createdAt: now
    })
  }

  console.log('6. Menu category')
  const categoryId = 'cat-sandwiches'
  await db.collection(COLLECTIONS.menuCategories).doc(categoryId).set(
    {
      id: categoryId,
      nameAr: 'ساندويتشات',
      sortOrder: 0,
      active: true,
      createdAt: now,
      updatedAt: now
    },
    { merge: true }
  )

  console.log('7. Menu item + recipe (ساندويتش كفتة)')
  const itemId = 'item-kofta-sandwich'
  const recipeId = 'recipe-kofta-sandwich'
  await db.collection(COLLECTIONS.recipes).doc(recipeId).set(
    {
      id: recipeId,
      menuItemId: itemId,
      nameAr: 'ساندويتش كفتة',
      lines: [
        { ingredientId: 'ing-kofta', quantity: 150, unit: 'جرام' },
        { ingredientId: 'ing-bread', quantity: 1, unit: 'قطعة' },
        { ingredientId: 'ing-sauce', quantity: 20, unit: 'جرام' }
      ],
      createdAt: now,
      updatedAt: now
    },
    { merge: true }
  )
  await db.collection(COLLECTIONS.menuItems).doc(itemId).set(
    {
      id: itemId,
      categoryId,
      nameAr: 'ساندويتش كفتة',
      descriptionAr: '١٥٠ جرام كفتة مع خبز وصوص',
      price: 45,
      active: true,
      recipeId,
      createdAt: now,
      updatedAt: now
    },
    { merge: true }
  )

  console.log('\nSeed complete.\n')
  console.log('Manager login:', MANAGER_EMAIL, '/', MANAGER_PASSWORD)
  console.log('Cashier login:', CASHIER_EMAIL, '/', CASHIER_PASSWORD)
  console.log('\nDeploying Firestore rules...')
  const { execSync } = await import('node:child_process')
  try {
    execSync('npm run deploy:rules', { stdio: 'inherit', cwd: process.cwd() })
  } catch {
    console.log('\n⚠ Deploy rules manually: npm run deploy:rules')
  }
}

main().catch((err: unknown) => {
  const e = err as { code?: number; reason?: string; details?: string; message?: string }
  if (
    e.code === 7 ||
    e.reason === 'SERVICE_DISABLED' ||
    e.details?.includes('Firestore API')
  ) {
    const pid =
      process.env.VITE_FIREBASE_PROJECT_ID ??
      process.env.FIREBASE_PROJECT_ID ??
      'YOUR_PROJECT_ID'
    console.error(`
Firestore is not ready yet.

Enable Firestore and create a database:
  https://console.firebase.google.com/project/${pid}/firestore

Then run: npm run seed
`)
    process.exit(1)
  }
  console.error(err)
  process.exit(1)
})
