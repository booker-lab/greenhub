/**
 * 공동구매 수량 기반 전환 — 실 검증 스크립트
 *
 * 실행: node scripts/verify-groupbuy-migration.mjs
 *
 * 검증 항목:
 *   [1] Firestore groupProductConfig — 신규 필드 존재, 구 필드 부재
 *   [2] Firestore products (saleType=group) — groupSummary 필드 일관성
 *   [3] Railway API — 공동구매 상품 응답 필드 확인
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const serviceAccount = require(join(__dirname, '../apps/api/firebase-adminsdk.json'))

const API_BASE = 'https://api-production-13e7.up.railway.app'

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// ── 헬퍼 ──────────────────────────────────────────────────────────────
let passed = 0
let failed = 0

function ok(label) {
  console.log(`  ✅ ${label}`)
  passed++
}

function fail(label, detail = '') {
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`)
  failed++
}

function section(title) {
  console.log(`\n[${title}]`)
}

// ── [1] Firestore groupProductConfig ──────────────────────────────────
async function verifyGroupProductConfig() {
  section('1. Firestore groupProductConfig 필드 검증')

  const NEW_FIELDS = ['minQuantity', 'targetQuantity', 'maxPerPerson', 'currentQuantity']
  const OLD_FIELDS = ['minParticipants', 'maxParticipants', 'currentParticipants']

  const snap = await db.collection('groupProductConfig').get()
  if (snap.empty) {
    fail('문서 존재', '0건')
    return
  }

  console.log(`  → 총 ${snap.size}건 검사`)

  for (const doc of snap.docs) {
    const data = doc.data()
    const id = doc.id.slice(0, 8) + '…'

    for (const f of NEW_FIELDS) {
      if (f in data) ok(`[${id}] ${f} 존재`)
      else fail(`[${id}] ${f} 존재`, '필드 없음')
    }

    for (const f of OLD_FIELDS) {
      if (!(f in data)) ok(`[${id}] ${f} 제거됨`)
      else fail(`[${id}] ${f} 제거됨`, '구 필드 잔존')
    }
  }
}

// ── [2] Firestore products groupSummary ───────────────────────────────
async function verifyProductsGroupSummary() {
  section('2. Firestore products.groupSummary 필드 검증')

  const snap = await db.collection('products').where('saleType', '==', 'group').get()
  if (snap.empty) {
    console.log('  → 공동구매 상품 없음 — 스킵')
    return
  }

  console.log(`  → 총 ${snap.size}건 검사`)

  for (const doc of snap.docs) {
    const gs = doc.data()['groupSummary']
    const id = doc.id.slice(0, 8) + '…'

    if (!gs) {
      console.log(`  ℹ️  [${id}] groupSummary 없음 (정상 — API 집계 방식)`)
      continue
    }

    if ('currentParticipants' in gs) fail(`[${id}] groupSummary 구 필드 잔존`, 'currentParticipants')
    else ok(`[${id}] groupSummary 구 필드 없음`)

    if ('currentQuantity' in gs) ok(`[${id}] groupSummary.currentQuantity 존재`)
    else fail(`[${id}] groupSummary.currentQuantity 없음`)
  }
}

// ── [3] Railway API 응답 검증 ─────────────────────────────────────────
async function verifyApiResponse() {
  section('3. Railway API 공동구매 상품 응답 검증')

  let res
  try {
    res = await fetch(`${API_BASE}/products?saleType=group`)
  } catch (e) {
    fail('API 호출', e.message)
    return
  }

  if (!res.ok) {
    fail(`HTTP ${res.status}`, await res.text().catch(() => ''))
    return
  }

  const body = await res.json()
  const items = Array.isArray(body) ? body : body.items ?? body.data ?? []

  if (items.length === 0) {
    console.log('  ℹ️  공동구매 상품 없음 — API 필드 검증 스킵')
    return
  }

  console.log(`  → ${items.length}건 응답 확인`)

  for (const product of items) {
    const id = (product.id ?? '').slice(0, 8) + '…'
    const gc = product.groupConfig ?? product.groupSummary

    if (!gc) {
      console.log(`  ℹ️  [${id}] groupConfig 없음`)
      continue
    }

    for (const f of ['minQuantity', 'targetQuantity', 'currentQuantity']) {
      if (f in gc) ok(`[${id}] groupConfig.${f} 존재`)
      else fail(`[${id}] groupConfig.${f} 없음`)
    }

    for (const f of ['minParticipants', 'maxParticipants', 'currentParticipants']) {
      if (!(f in gc)) ok(`[${id}] groupConfig.${f} 제거됨`)
      else fail(`[${id}] groupConfig.${f} 잔존`)
    }
  }
}

// ── 실행 ──────────────────────────────────────────────────────────────
async function run() {
  console.log('=== 공동구매 수량 기반 전환 실 검증 ===\n')
  console.log(`API: ${API_BASE}`)

  await verifyGroupProductConfig()
  await verifyProductsGroupSummary()
  await verifyApiResponse()

  console.log(`\n${'─'.repeat(40)}`)
  console.log(`결과: ✅ ${passed}건 통과 / ❌ ${failed}건 실패`)

  if (failed > 0) {
    console.log('\n❌ 실패 항목을 확인하세요.')
    process.exit(1)
  } else {
    console.log('\n✅ 모든 검증 통과.')
  }
}

run().catch((err) => {
  console.error('[ERROR]', err)
  process.exit(1)
})
