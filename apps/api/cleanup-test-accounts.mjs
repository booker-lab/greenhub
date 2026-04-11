/**
 * 테스트 계정 정리 + 데이터 마이그레이션 스크립트
 *
 * 목적:
 *   1. eaa96b06-... storeId 데이터 → 80189070-... (실제 카카오 판매자) 으로 이전
 *   2. 테스트 유저/스토어 문서 삭제 (Firestore)
 *   3. 테스트 Firebase Auth 계정 삭제
 *
 * 실행: cd apps/api && node cleanup-test-accounts.mjs
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getAuth } from 'firebase-admin/auth'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const serviceAccount = require(join(__dirname, 'firebase-adminsdk.json'))

// ── 대상 정의 ─────────────────────────────────────────────────────────────
const OLD_STORE_ID = 'eaa96b06-60f6-4a03-a1af-bea3ad6604c6'   // 구 테스트 스토어
const NEW_STORE_ID = '80189070-2c3d-45f2-bc11-68a870b13951'   // 실제 카카오 판매자 "난플렉스"

// 삭제할 테스트 스토어 document IDs
const TEST_STORE_IDS = [
  'eaa96b06-60f6-4a03-a1af-bea3ad6604c6',  // 테스트 꽃 농장
  'test-store-001',                          // 시드 데이터
  '72cbaaf3-a1b5-462b-9c87-4f0d83d6e9d2',  // "dd" 스토어 (실제 ID는 아래서 확인)
]

// 삭제할 테스트 유저 document IDs
const TEST_USER_DOC_IDS = [
  'test-seller-001',
  'eaa96b06-60f6-4a03-a1af-bea3ad6604c6',  // old ownerId가 storeId와 같은 경우
]

// 삭제할 Firebase Auth 이메일
const TEST_AUTH_EMAILS = [
  'seller@test.com',
  'seller2@test.com',
]

// ── 초기화 ────────────────────────────────────────────────────────────────
initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()
const auth = getAuth()

// ── 헬퍼 ──────────────────────────────────────────────────────────────────
async function batchUpdate(colName, docs, updateFn) {
  const chunks = []
  for (let i = 0; i < docs.length; i += 499) chunks.push(docs.slice(i, i + 499))
  for (const chunk of chunks) {
    const batch = db.batch()
    chunk.forEach(d => updateFn(batch, d))
    await batch.commit()
  }
}

// ── STEP 1: 컬렉션 storeId 교체 ───────────────────────────────────────────
async function migrateCollection(colName) {
  const snap = await db.collection(colName).where('storeId', '==', OLD_STORE_ID).get()
  if (snap.empty) { console.log(`  ${colName}: 0건 (스킵)`); return }
  await batchUpdate(colName, snap.docs, (batch, d) =>
    batch.update(d.ref, { storeId: NEW_STORE_ID })
  )
  console.log(`  ✅ ${colName}: ${snap.docs.length}건 변경`)
}

// ── STEP 2: dailyCaps 재생성 ──────────────────────────────────────────────
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

// ── STEP 3: deliveryFeeConfig 재생성 ─────────────────────────────────────
async function migrateDeliveryFeeConfig() {
  const oldRef = db.doc(`deliveryFeeConfig/${OLD_STORE_ID}`)
  const newRef = db.doc(`deliveryFeeConfig/${NEW_STORE_ID}`)
  const [oldSnap, newSnap] = await Promise.all([oldRef.get(), newRef.get()])

  if (!oldSnap.exists) {
    console.log(`  deliveryFeeConfig/${OLD_STORE_ID}: 없음 (스킵)`)
    return
  }
  if (!newSnap.exists) {
    await newRef.set({ ...oldSnap.data(), storeId: NEW_STORE_ID })
    console.log(`  ✅ deliveryFeeConfig: 새 문서 생성`)
  } else {
    console.log(`  deliveryFeeConfig/${NEW_STORE_ID}: 이미 존재 (유지)`)
  }
  await oldRef.delete()
  console.log(`  ✅ deliveryFeeConfig/${OLD_STORE_ID}: 삭제`)
}

// ── STEP 4: 테스트 스토어 문서 삭제 ──────────────────────────────────────
async function deleteTestStores() {
  // 먼저 실제 존재하는 테스트 스토어 목록 조회 (이름으로)
  const allStores = await db.collection('stores').get()
  const testStores = allStores.docs.filter(d => {
    const data = d.data()
    const id = d.id
    return (
      TEST_STORE_IDS.includes(id) ||
      (data.name && ['dd', '테스트 꽃 농장'].includes(data.name)) ||
      id === OLD_STORE_ID
    )
  })

  if (testStores.length === 0) {
    console.log(`  stores: 삭제 대상 없음`)
    return
  }

  const batch = db.batch()
  testStores.forEach(d => {
    console.log(`  삭제 예정: stores/${d.id} (${d.data().name ?? '이름 없음'})`)
    batch.delete(d.ref)
  })
  await batch.commit()
  console.log(`  ✅ stores: ${testStores.length}건 삭제`)
}

// ── STEP 5: 테스트 유저 문서 삭제 ────────────────────────────────────────
async function deleteTestUserDocs() {
  // email이 테스트인 것 + doc ID가 테스트인 것
  const snap = await db.collection('users').get()
  const testDocs = snap.docs.filter(d => {
    const data = d.data()
    return (
      TEST_USER_DOC_IDS.includes(d.id) ||
      (data.email && TEST_AUTH_EMAILS.includes(data.email))
    )
  })

  if (testDocs.length === 0) {
    console.log(`  users: 삭제 대상 없음`)
    return
  }

  const batch = db.batch()
  testDocs.forEach(d => {
    console.log(`  삭제 예정: users/${d.id} (${d.data().email ?? '이메일 없음'})`)
    batch.delete(d.ref)
  })
  await batch.commit()
  console.log(`  ✅ users: ${testDocs.length}건 삭제`)
}

// ── STEP 6: Firebase Auth 테스트 계정 삭제 ───────────────────────────────
async function deleteTestAuthAccounts() {
  for (const email of TEST_AUTH_EMAILS) {
    try {
      const user = await auth.getUserByEmail(email)
      await auth.deleteUser(user.uid)
      console.log(`  ✅ Auth 삭제: ${email} (uid: ${user.uid})`)
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        console.log(`  Auth: ${email} 없음 (스킵)`)
      } else {
        console.error(`  ❌ Auth 삭제 실패 (${email}):`, e.message)
      }
    }
  }
}

// ── 현황 출력 (실행 전 확인용) ────────────────────────────────────────────
async function printCurrentState() {
  console.log('\n📋 현재 Firestore 현황:')

  const stores = await db.collection('stores').get()
  console.log('\n[스토어]')
  stores.docs.forEach(d => {
    const data = d.data()
    const marker = d.id === NEW_STORE_ID ? ' ← 유지' : d.id === OLD_STORE_ID ? ' ← 삭제' : ''
    console.log(`  ${d.id.slice(0,8)}... | ${data.name ?? '(이름없음)'}${marker}`)
  })

  const users = await db.collection('users').where('role', '==', 'seller').get()
  console.log('\n[셀러 유저]')
  users.docs.forEach(d => {
    const data = d.data()
    const marker = TEST_USER_DOC_IDS.includes(d.id) || TEST_AUTH_EMAILS.includes(data.email) ? ' ← 삭제' : ' ← 유지'
    console.log(`  ${d.id.slice(0,8)}... | ${data.email ?? '(이메일없음)'} | storeId: ${(data.storeId ?? '').slice(0,8)}...${marker}`)
  })

  const products = await db.collection('products').get()
  const prodByStore = {}
  products.docs.forEach(d => {
    const sid = d.data().storeId ?? 'unknown'
    prodByStore[sid] = (prodByStore[sid] ?? 0) + 1
  })
  console.log('\n[상품 storeId별 수량]')
  Object.entries(prodByStore).forEach(([sid, cnt]) => {
    const marker = sid === NEW_STORE_ID ? ' ← 목적지' : sid === OLD_STORE_ID ? ' ← 이전 대상' : ''
    console.log(`  ${sid.slice(0,8)}...: ${cnt}건${marker}`)
  })
}

// ── 메인 ──────────────────────────────────────────────────────────────────
async function main() {
  await printCurrentState()

  console.log('\n🚀 정리 작업 시작')
  console.log(`  데이터 이전: ${OLD_STORE_ID.slice(0,8)}... → ${NEW_STORE_ID.slice(0,8)}...`)
  console.log()

  console.log('[1] 컬렉션 storeId 교체')
  for (const col of ['products', 'orders', 'payments', 'settlements']) {
    await migrateCollection(col)
  }

  console.log('\n[2] dailyCaps 재생성')
  await migrateDailyCaps()

  console.log('\n[3] deliveryFeeConfig 재생성')
  await migrateDeliveryFeeConfig()

  console.log('\n[4] 테스트 스토어 문서 삭제')
  await deleteTestStores()

  console.log('\n[5] 테스트 유저 문서 삭제')
  await deleteTestUserDocs()

  console.log('\n[6] Firebase Auth 테스트 계정 삭제')
  await deleteTestAuthAccounts()

  console.log('\n✅ 완료')
  console.log('   셀러 앱에서 카카오 로그인 후 상품이 보이면 성공')
}

main().catch(err => { console.error('❌ 오류:', err); process.exit(1) })
