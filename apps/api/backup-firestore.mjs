/**
 * Firestore 로컬 백업 스크립트
 * 실행: cd apps/api && node backup-firestore.mjs
 * 출력: ../../backups/YYYY-MM-DD_HH-mm_firestore.json
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const serviceAccount = require(join(__dirname, 'firebase-adminsdk.json'))

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

// 고정 목록은 회차·청구·운영 이슈처럼 나중에 생긴 컬렉션을 빠뜨렸다. 최상위 컬렉션을
// 모두 내보내되, 그대로 재사용 가능한 로그인 갱신 토큰은 백업 파일에 남기지 않는다.
// (하위 컬렉션은 포함하지 않는다.)
const EXCLUDED_COLLECTIONS = new Set(['refreshTokens'])

async function backupCollection(colName) {
  const snap = await db.collection(colName).get()
  const docs = {}
  snap.docs.forEach(d => { docs[d.id] = d.data() })
  console.log(`  ${colName}: ${snap.docs.length}건`)
  return docs
}

async function main() {
  console.log('📦 Firestore 백업 시작\n')
  const backup = { exportedAt: new Date().toISOString(), collections: {} }
  const collections = (await db.listCollections())
    .map((ref) => ref.id)
    .filter((id) => !EXCLUDED_COLLECTIONS.has(id))
    .sort()
  for (const col of collections) {
    backup.collections[col] = await backupCollection(col)
  }
  console.log(`\n제외: ${[...EXCLUDED_COLLECTIONS].join(', ')}`)

  const timestamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')
  const outDir = join(__dirname, '..', '..', 'backups')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${timestamp}_firestore.json`)
  writeFileSync(outPath, JSON.stringify(backup, null, 2), 'utf8')
  console.log(`\n✅ 백업 완료: backups/${timestamp}_firestore.json`)
}

main().catch(err => { console.error('❌ 오류:', err); process.exit(1) })
