/**
 * Firestore 로컬 백업 스크립트
 * 실행: node scripts/backup-firestore.mjs
 * 출력: backups/YYYY-MM-DD_HH-mm_firestore.json
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
// apps/api 디렉토리 기준으로 실행 (firebase-admin이 apps/api/node_modules에 있음)
// 실행: cd apps/api && node ../../scripts/backup-firestore.mjs
const serviceAccount = require(join(process.cwd(), 'firebase-adminsdk.json'))

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

const COLLECTIONS = [
  'stores',
  'products',
  'orders',
  'payments',
  'settlements',
  'deliveryFeeConfig',
  'dailyCaps',
  'auditLogs',
  'refreshTokens',
]

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

  for (const col of COLLECTIONS) {
    backup.collections[col] = await backupCollection(col)
  }

  const now = new Date()
  const timestamp = now.toISOString().replace('T', '_').slice(0, 16).replace(':', '-')
  const outDir = join(__dirname, '..', 'backups')
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${timestamp}_firestore.json`)

  writeFileSync(outPath, JSON.stringify(backup, null, 2), 'utf8')
  console.log(`\n✅ 백업 완료: backups/${timestamp}_firestore.json`)
}

main().catch(err => { console.error('❌ 오류:', err); process.exit(1) })
