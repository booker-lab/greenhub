import * as admin from 'firebase-admin';

async function main() {
  const app =
    admin.apps[0] ??
    admin.initializeApp({
      credential: process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ? admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
        : admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  const db = app.firestore();
  const ref = db.doc('banners/main_hero');
  const snap = await ref.get();

  if (!snap.exists) {
    console.log('banners/main_hero 문서가 없어 마이그레이션을 건너뜁니다.');
    return;
  }

  if (snap.data()?.kind === 'default') {
    console.log('banners/main_hero 문서는 이미 kind=default 상태입니다.');
    return;
  }

  await ref.set({ id: 'main_hero', kind: 'default', updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  console.log('banners/main_hero 문서에 kind=default를 반영했습니다.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });
