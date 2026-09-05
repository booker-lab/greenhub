import fs from 'node:fs';
import path from 'node:path';

const PROJECTS = new Set(['chromium', 'mobile', 'generic']);

async function firebaseAdapter(environment) {
  const rawCredential = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!rawCredential) throw new Error('비운영 FIREBASE_SERVICE_ACCOUNT_JSON이 필요합니다.');
  const withoutBom = rawCredential.charCodeAt(0) === 0xfeff ? rawCredential.slice(1) : rawCredential;
  const serviceAccount = JSON.parse(withoutBom);
  const { cert, initializeApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const { getStorage } = await import('firebase-admin/storage');
  const app = initializeApp(
    {
      credential: cert(serviceAccount),
      projectId: environment.projectId,
      storageBucket: environment.storageBucket,
    },
    `round-direct-${environment.runId}-${Date.now()}`,
  );
  const db = getFirestore(app);
  const bucket = getStorage(app).bucket(environment.storageBucket);
  return {
    async getDoc(docPath) {
      const snapshot = await db.doc(docPath).get();
      return snapshot.exists ? snapshot.data() : null;
    },
    async setDoc(docPath, data) {
      await db.doc(docPath).set(data);
    },
    async setObject(objectName, content) {
      await bucket.file(objectName).save(content, {
        contentType: 'image/jpeg',
        resumable: false,
      });
    },
    async deleteDoc(docPath) {
      await db.doc(docPath).delete();
    },
    async getObject(objectName) {
      const [exists] = await bucket.file(objectName).exists();
      return exists ? { exists: true } : null;
    },
    async deleteObject(objectName) {
      await bucket.file(objectName).delete({ ignoreNotFound: true });
    },
  };
}

function argument(name) {
  return process.argv
    .slice(2)
    .find((value) => value.startsWith(`--${name}=`))
    ?.split('=')
    .slice(1)
    .join('=');
}

export function redactPersistedManifest(manifest) {
  const persisted = structuredClone(manifest);
  for (const entry of persisted.documents ?? []) {
    if (entry.path.startsWith('users/') && entry.data && 'passwordHash' in entry.data) {
      delete entry.data.passwordHash;
    }
  }
  return persisted;
}

export async function runFixtureCli(core) {
  const action = process.argv[2];
  if (!['seed', 'verify', 'cleanup'].includes(action)) {
    throw new Error(
      '사용법: node scripts/round-direct-e2e-fixtures.mjs seed|verify|cleanup --project=chromium|mobile|generic --manifest=<경로>',
    );
  }
  const environment = core.validateFixtureEnvironment(process.env, { requireServiceAccount: true });
  const project = argument('project');
  const manifestPath = path.resolve(argument('manifest') ?? '');
  if (
    !PROJECTS.has(project) ||
    !manifestPath.replaceAll('\\', '/').includes(`/${environment.runId}/`)
  ) {
    throw new Error('project 또는 manifest 경로가 실행 범위와 다릅니다.');
  }
  let manifest;
  if (action === 'seed') {
    const suffix = project.toUpperCase();
    const bcrypt = await import('bcrypt');
    const accounts = {};
    const roles = project === 'generic' ? ['CONSUMER', 'SELLER'] : ['CONSUMER', 'SELLER', 'DRIVER'];
    for (const role of roles) {
      const suffixPart = project === 'generic' ? '' : `_${suffix}`;
      const email = process.env[`TEST_${role}_EMAIL${suffixPart}`];
      const password = process.env[`TEST_${role}_PASSWORD${suffixPart}`];
      if (!email || !password) throw new Error(`${project} ${role} 계정 자격이 필요합니다.`);
      accounts[role.toLowerCase()] = { email, passwordHash: await bcrypt.hash(password, 12) };
    }
    const buildManifest =
      project === 'generic' ? core.buildGenericPreviewFixtureManifest : core.buildFixtureManifest;
    manifest = buildManifest({ runId: environment.runId, project, accounts });
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(redactPersistedManifest(manifest), null, 2)}\n`,
      { flag: 'wx' },
    );
  } else {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
  if (manifest.project !== project || manifest.runId !== environment.runId) {
    throw new Error('fixture manifest의 project 또는 run ID가 현재 실행 범위와 다릅니다.');
  }
  const adapter = await firebaseAdapter(environment);
  if (action === 'seed') await core.seedFixture(adapter, manifest);
  const result =
    action === 'cleanup'
      ? (await core.cleanupFixture(adapter, manifest),
        await core.verifyFixture(adapter, manifest, { expectAbsent: true }))
      : await core.verifyFixture(adapter, manifest);
  process.stdout.write(
    `${JSON.stringify({ action, runId: manifest.runId, project, ...result }, null, 2)}\n`,
  );
  if (!result.ready) process.exitCode = 1;
}
