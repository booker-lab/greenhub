/**
 * 기존 Product 문서에 AI 시스템 필드 추가
 * - colors[] → selection.colors
 * - description → sellerNote
 * - content.headline 초기값 = name
 * - content.isEditedByUser = true (기존 데이터는 AI 생성 아님)
 * - sellerOverride = false
 *
 * 실행: ts-node -r tsconfig-paths/register src/scripts/migrate-products-ai-fields.ts
 */
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';

const serviceAccountPath = path.resolve(__dirname, '../../service-account.json');
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function migrateProducts() {
  const snapshot = await db.collection('products').get();
  const total = snapshot.size;
  let migrated = 0;
  let skipped = 0;

  console.log(`총 ${total}개 상품 마이그레이션 시작...`);

  const batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // 이미 마이그레이션된 문서는 건너뜀
    if (data.content !== undefined) {
      skipped++;
      continue;
    }

    const update: Record<string, unknown> = {
      selection: {
        colors: data.colors ?? [],
        fragrance: 'none',
        bloomCondition: 'half',
        bundleUnit: '',
      },
      sellerNote: data.description ?? '',
      content: {
        headline: data.name ?? '',
        description: data.description ?? '',
        isEditedByUser: true,
      },
      sellerOverride: false,
    };

    batch.update(doc.ref, update);
    migrated++;
    batchCount++;

    // Firestore 배치 한도 500건
    if (batchCount === 499) {
      await batch.commit();
      console.log(`${migrated}건 처리 완료...`);
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  console.log(`✅ 완료: 마이그레이션 ${migrated}건 / 스킵 ${skipped}건`);
}

migrateProducts().catch(console.error);
