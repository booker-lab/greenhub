/**
 * 기존 products에 varietyId 매핑 스크립트
 *
 * 동작:
 *   1. Firestore의 varieties 전체 로드
 *   2. varietyId 없는 products를 대상으로 상품명 → 품종명 매칭
 *   3. 기본값: dry-run (실제 변경 없음)
 *      --apply 플래그 사용 시 Firestore 업데이트
 *
 * 실행:
 *   node scripts/map-variety-id.mjs           # dry-run
 *   node scripts/map-variety-id.mjs --apply   # 실제 적용
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const serviceAccount = require(join(__dirname, '../apps/api/firebase-adminsdk.json'))

const APPLY = process.argv.includes('--apply')

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

/** 품종명 정규화 — 공백·대소문자 통일 */
function normalize(str) {
  return str?.trim().toLowerCase().replace(/\s+/g, '') ?? ''
}

/** 매칭 우선순위:
 *  1. 정확히 일치
 *  2. 상품명이 품종명을 포함
 *  3. 품종명이 상품명을 포함
 */
function findVariety(productName, varieties) {
  const key = normalize(productName)
  const exact = varieties.find(v => normalize(v.name) === key)
  if (exact) return { variety: exact, confidence: 'exact' }

  const contains = varieties.find(v => key.includes(normalize(v.name)))
  if (contains) return { variety: contains, confidence: 'contains' }

  const included = varieties.find(v => normalize(v.name).includes(key))
  if (included) return { variety: included, confidence: 'included' }

  return null
}

async function main() {
  console.log(`\n🌿 varietyId 매핑 스크립트 (${APPLY ? '⚡ APPLY 모드' : '🔍 DRY-RUN 모드'})\n`)

  // 1. varieties 전체 로드
  const varietySnap = await db.collection('varieties').get()
  const varieties = varietySnap.docs.map(d => ({ id: d.id, ...d.data() }))
  console.log(`📦 varieties: ${varieties.length}종 로드\n`)

  // 2. varietyId 없는 products 로드
  const productSnap = await db.collection('products').where('varietyId', '==', null).get()
  const noIdProducts = productSnap.docs

  // varietyId 필드 자체가 없는 경우도 포함
  const allProductSnap = await db.collection('products').get()
  const missingProducts = allProductSnap.docs.filter(d => {
    const data = d.data()
    return !data.varietyId
  })

  console.log(`🔎 varietyId 없는 상품: ${missingProducts.length}건\n`)

  const matched = []
  const unmatched = []

  for (const doc of missingProducts) {
    const data = doc.data()
    const result = findVariety(data.name, varieties)

    if (result) {
      matched.push({ doc, data, ...result })
    } else {
      unmatched.push({ doc, data })
    }
  }

  // 3. 결과 출력
  console.log(`✅ 매칭 성공: ${matched.length}건`)
  for (const { data, variety, confidence } of matched) {
    const tag = confidence === 'exact' ? '  ' : confidence === 'contains' ? '~' : '≈'
    console.log(`  ${tag} "${data.name}" → ${variety.id} (${variety.name}) [${confidence}]`)
  }

  if (unmatched.length > 0) {
    console.log(`\n❌ 매칭 실패: ${unmatched.length}건 (수동 지정 필요)`)
    for (const { data } of unmatched) {
      console.log(`     "${data.name}"`)
    }
  }

  if (!APPLY) {
    console.log('\n⚠️  dry-run 완료. 실제 적용하려면 --apply 플래그를 사용하세요.')
    console.log('   node scripts/map-variety-id.mjs --apply\n')
    return
  }

  // 4. Firestore 업데이트 (499건 단위 배치)
  if (matched.length === 0) {
    console.log('\n업데이트할 항목 없음.')
    return
  }

  const chunks = []
  for (let i = 0; i < matched.length; i += 499) {
    chunks.push(matched.slice(i, i + 499))
  }

  for (const chunk of chunks) {
    const batch = db.batch()
    for (const { doc, variety } of chunk) {
      batch.update(doc.ref, { varietyId: variety.id })
    }
    await batch.commit()
  }

  console.log(`\n✅ ${matched.length}건 varietyId 업데이트 완료`)
  if (unmatched.length > 0) {
    console.log(`⚠️  ${unmatched.length}건은 수동으로 varietyId를 지정해 주세요.`)
  }
}

main().catch(err => { console.error('❌ 오류:', err); process.exit(1) })
