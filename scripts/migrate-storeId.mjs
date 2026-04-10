/**
 * storeId 마이그레이션 스크립트
 * 목적: Firestore의 'dear-orchid' → UUID 전환
 * 실행: node scripts/migrate-storeId.mjs
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const serviceAccount = require(join(__dirname, '../apps/api/firebase-adminsdk.json'))

const OLD_STORE_ID = 'dear-orchid'
const NEW_STORE_ID = 'eaa96b06-60f6-4a03-a1af-bea3ad6604c6'

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// 컬렉션별 storeId 필드 일괄 변경 (500건 제한 대응)
async function migrateCollection(colName) {
  const snap = await db.collection(colName).where('storeId', '==', OLD_STORE_ID).get()
  if (snap.empty) { console.log(`  ${colName}: 0건 (스킵)`); return }

  // 500건 초과 시 배치 분할
  const chunks = []
  for (let i = 0; i < snap.docs.length; i += 499) {
    chunks.push(snap.docs.slice(i, i + 499))
  }
  for (const chunk of chunks) {
    const batch = db.batch()
    chunk.forEach(d => batch.update(d.ref, { storeId: NEW_STORE_ID }))
    await batch.commit()
  }
  console.log(`  ✅ ${colName}: ${snap.docs.length}건 변경`)
}

// dailyCaps — 문서 ID가 `dear-orchid_YYYY-MM-DD` 형식 → 문서 재생성
async function migrateDailyCaps() {
  const snap = await db.collection('dailyCaps').where('storeId', '==', OLD_STORE_ID).get()
  if (snap.empty) { console.log(`  dailyCaps: 0건 (스킵)`); return }

  const batch = db.batch()
  snap.docs.forEach(d => {
    const newId = d.id.replace(OLD_STORE_ID, NEW_STORE_ID)
    batch.set(db.doc(`dailyCaps/${newId}`), { ...d.data(), storeId: NEW_STORE_ID })
    batch.delete(d.ref)
  })
  await batch.commit()
  console.log(`  ✅ dailyCaps: ${snap.docs.length}건 재생성`)
}

// deliveryFeeConfig — 문서 ID 자체가 storeId → 문서 재생성
async function migrateDeliveryFeeConfig() {
  const snap = await db.doc(`deliveryFeeConfig/${OLD_STORE_ID}`).get()
  if (!snap.exists) { console.log(`  deliveryFeeConfig/${OLD_STORE_ID}: 없음 (스킵)`); return }
  await db.doc(`deliveryFeeConfig/${NEW_STORE_ID}`).set({ ...snap.data(), storeId: NEW_STORE_ID })
  await db.doc(`deliveryFeeConfig/${OLD_STORE_ID}`).delete()
  console.log(`  ✅ deliveryFeeConfig: ${OLD_STORE_ID} → ${NEW_STORE_ID}`)
}

// stores/dear-orchid 문서 → stores/{UUID}
async function migrateStoreDoc() {
  const newSnap = await db.doc(`stores/${NEW_STORE_ID}`).get()
  if (newSnap.exists) {
    console.log(`  stores/${NEW_STORE_ID}: 이미 존재 — 구 문서만 삭제`)
    const oldSnap = await db.doc(`stores/${OLD_STORE_ID}`).get()
    if (oldSnap.exists) await db.doc(`stores/${OLD_STORE_ID}`).delete()
    return
  }

  const oldSnap = await db.doc(`stores/${OLD_STORE_ID}`).get()
  if (!oldSnap.exists) { console.log(`  stores/${OLD_STORE_ID}: 없음 (스킵)`); return }

  await db.doc(`stores/${NEW_STORE_ID}`).set({ ...oldSnap.data(), id: NEW_STORE_ID })
  await db.doc(`stores/${OLD_STORE_ID}`).delete()
  console.log(`  ✅ stores: ${OLD_STORE_ID} → ${NEW_STORE_ID}`)
}

async function main() {
  console.log('🚀 storeId 마이그레이션 시작')
  console.log(`  ${OLD_STORE_ID} → ${NEW_STORE_ID}\n`)

  for (const col of ['products', 'orders', 'payments', 'settlements']) {
    await migrateCollection(col)
  }
  await migrateDailyCaps()
  await migrateDeliveryFeeConfig()
  await migrateStoreDoc()

  console.log('\n✅ 마이그레이션 완료')
  console.log('   재실행 시 모든 항목이 0건이면 성공')
}

main().catch(err => { console.error('❌ 오류:', err); process.exit(1) })
