/**
 * 공동구매 수량 기반 전환 마이그레이션
 * 목적: groupProductConfig 문서의 participants 필드 → quantity 필드 전환
 *
 * dry-run (기본): node scripts/migrate-groupbuy-quantity.mjs
 * 실제 적용:      node scripts/migrate-groupbuy-quantity.mjs --apply
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const serviceAccount = require(join(__dirname, '../apps/api/firebase-adminsdk.json'))

const APPLY = process.argv.includes('--apply')

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

async function run() {
  console.log(`\n[migrate-groupbuy-quantity] mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`)

  const snap = await db.collection('groupProductConfig').get()
  if (snap.empty) {
    console.log('groupProductConfig 문서 없음 — 종료')
    return
  }

  let migrated = 0
  let skipped = 0

  for (const doc of snap.docs) {
    const data = doc.data()
    const productId = doc.id

    // 이미 전환된 문서 스킵
    if ('currentQuantity' in data && !('currentParticipants' in data)) {
      console.log(`  [SKIP] ${productId} — 이미 수량 기반`)
      skipped++
      continue
    }

    const minParticipants = data['minParticipants'] ?? 0
    const maxParticipants = data['maxParticipants'] ?? 0
    const currentParticipants = data['currentParticipants'] ?? 0

    const update = {
      minQuantity: minParticipants,
      targetQuantity: maxParticipants,
      maxPerPerson: maxParticipants, // 기존 최대 인원값을 1인 최대 수량 초기값으로 사용
      currentQuantity: currentParticipants,
      // 구 필드 제거
      minParticipants: FieldValue.delete(),
      maxParticipants: FieldValue.delete(),
      currentParticipants: FieldValue.delete(),
    }

    console.log(`  [${APPLY ? 'APPLY' : 'DRY-RUN'}] ${productId}`)
    console.log(`    minParticipants(${minParticipants}) → minQuantity`)
    console.log(`    maxParticipants(${maxParticipants}) → targetQuantity + maxPerPerson`)
    console.log(`    currentParticipants(${currentParticipants}) → currentQuantity`)

    if (APPLY) {
      await doc.ref.update(update)
    }
    migrated++
  }

  // products 컬렉션의 groupSummary 필드 마이그레이션
  console.log('\n[products.groupSummary 마이그레이션]')
  const productsSnap = await db.collection('products').where('saleType', '==', 'group').get()

  let productsMigrated = 0
  let productsSkipped = 0

  for (const doc of productsSnap.docs) {
    const data = doc.data()
    const gs = data['groupSummary']
    if (!gs) { productsSkipped++; continue }

    if ('currentQuantity' in gs && !('currentParticipants' in gs)) {
      console.log(`  [SKIP] ${doc.id} — groupSummary 이미 전환됨`)
      productsSkipped++
      continue
    }

    const gsUpdate = {
      'groupSummary.currentQuantity': gs['currentParticipants'] ?? 0,
      'groupSummary.minQuantity': gs['minParticipants'] ?? 0,
      'groupSummary.targetQuantity': gs['maxParticipants'] ?? 0,
      'groupSummary.currentParticipants': FieldValue.delete(),
      'groupSummary.minParticipants': FieldValue.delete(),
      'groupSummary.maxParticipants': FieldValue.delete(),
    }

    console.log(`  [${APPLY ? 'APPLY' : 'DRY-RUN'}] ${doc.id} groupSummary 전환`)

    if (APPLY) {
      await doc.ref.update(gsUpdate)
    }
    productsMigrated++
  }

  console.log('\n=== 결과 ===')
  console.log(`groupProductConfig: ${migrated}건 전환, ${skipped}건 스킵`)
  console.log(`products.groupSummary: ${productsMigrated}건 전환, ${productsSkipped}건 스킵`)
  if (!APPLY) console.log('\n실제 적용하려면 --apply 플래그를 추가하세요.')
}

run().catch((err) => {
  console.error('[ERROR]', err)
  process.exit(1)
})
