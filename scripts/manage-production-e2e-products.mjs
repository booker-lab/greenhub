/**
 * 운영 Firestore의 고정 E2E 상품 두 건만 점검하거나 비활성화한다.
 *
 * 기본 실행은 읽기 전용이다.
 *   node scripts/manage-production-e2e-products.mjs
 *   node scripts/manage-production-e2e-products.mjs --apply
 *   node scripts/manage-production-e2e-products.mjs --restore
 *
 * 복구는 상품을 다시 활성화하되 testOnly=true를 유지한다. 공개 API 방어가 배포된 뒤에만
 * 복구해야 소비자 화면에 시험용 상품이 다시 노출되지 않는다.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const targets = ['e2e-normal-product-001', 'e2e-group-product-001'];

function resolveCredential() {
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envJson) {
    const raw = envJson.trim();
    const json = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return cert(JSON.parse(json));
  }

  const require = createRequire(import.meta.url);
  const credentialPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (credentialPath) return cert(require(credentialPath));
  return cert(require(join(scriptDirectory, '../apps/api/firebase-adminsdk.json')));
}

const apply = process.argv.includes('--apply');
const restore = process.argv.includes('--restore');
if (apply && restore) {
  throw new Error('--apply와 --restore는 함께 사용할 수 없습니다.');
}

initializeApp({ credential: resolveCredential() });
const db = getFirestore();

async function main() {
  const snapshots = await Promise.all(targets.map((id) => db.doc(`products/${id}`).get()));

  for (const [index, snapshot] of snapshots.entries()) {
    const id = targets[index];
    if (!snapshot.exists || snapshot.id !== id || !id.startsWith('e2e-')) {
      throw new Error(`안전 조건 불충족: products/${id}`);
    }
    const data = snapshot.data();
    console.log(
      `[현재 상태] ${id} · isActive=${String(data.isActive)} · testOnly=${String(data.testOnly)}`,
    );
  }

  if (!apply && !restore) {
    console.log('[읽기 전용] 변경하려면 --apply, 복구하려면 --restore를 지정하세요.');
    return;
  }

  const batch = db.batch();
  for (const snapshot of snapshots) {
    batch.update(snapshot.ref, {
      isActive: restore,
      testOnly: true,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();

  console.log(
    restore
      ? '[완료] E2E 상품 두 건을 testOnly 상태로 다시 활성화했습니다.'
      : '[완료] E2E 상품 두 건을 testOnly 상태로 비활성화했습니다.',
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
