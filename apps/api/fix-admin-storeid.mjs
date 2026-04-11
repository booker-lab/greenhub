/**
 * admin 유저에 storeId 설정
 * 실행: cd apps/api && node fix-admin-storeid.mjs
 */
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const serviceAccount = require(join(__dirname, 'firebase-adminsdk.json'))

const STORE_ID = '80189070-2c3d-45f2-bc11-68a870b13951'

initializeApp({ credential: cert(serviceAccount) })
const db = getFirestore()

async function main() {
  // admin 유저 찾기
  const snap = await db.collection('users').where('role', '==', 'admin').get()
  if (snap.empty) { console.log('admin 유저 없음'); return }

  for (const doc of snap.docs) {
    const data = doc.data()
    console.log(`admin 발견: ${doc.id} | ${data.email ?? '이메일없음'} | 현재 storeId: ${data.storeId ?? 'null'}`)
    await doc.ref.update({ storeId: STORE_ID })
    console.log(`✅ storeId 설정 완료: ${STORE_ID}`)
  }

  console.log('\n로그아웃 후 재로그인하면 상품이 표시됩니다.')
}

main().catch(err => { console.error('❌ 오류:', err); process.exit(1) })
