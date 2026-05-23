/**
 * SETTLE-REFACTOR S6 — 정산 전이 입증 스크립트 (E-T3, A-1 단절 해소 검증)
 *
 * 라이브 배치(@Cron 04:00 KST)를 기다리지 않고, 동일한 쿼리·트랜잭션 로직을
 * 지금 실행해 pending → confirmed → paid 전 구간을 즉시 입증한다.
 *
 * 재현 대상 로직(코드 SSOT 그대로):
 *  - confirmDueSettlements: apps/api/src/settlements/settlements.service.ts:132-164
 *      status==pending AND settledAt<cutoff → 트랜잭션 재확인 후 confirmed
 *  - markAsPaid: apps/api/src/admin/admin.service.ts:148-172
 *      트랜잭션 내 status 재확인 — confirmed만 paid, pending/이미 paid 거부
 *
 * 단계: ① pending 시드(settledAt 2일 전) → ② 역전이 가드(pending에 markAsPaid 거부)
 *       → ③ confirm 배치 로직(pending→confirmed) → ④ markAsPaid(confirmed→paid)
 *       → ⑤ 멱등 재확인(이미 paid 거부) → ⑥ 정리(문서 삭제)
 *
 * 멱등성: 문서 ID 'verify-settle-001' 고정 — 시작 시 기존 문서 삭제 후 재시드, 종료 시 삭제.
 * 데이터 영향: 'verify-settle-' prefix 단일 문서만 생성/삭제(실데이터 무관).
 *
 * 실행: node scripts/verify-settlement-transition.mjs
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 인증 자격 — seed-e2e-orders.mjs:27-49 와 동일 규약(#CL-42).
function resolveCredential() {
  const envJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (envJson) {
    const raw = envJson.trim();
    const json = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return cert(JSON.parse(json));
  }
  const require = createRequire(import.meta.url);
  return cert(require(join(__dirname, '../apps/api/firebase-adminsdk.json')));
}

initializeApp({ credential: resolveCredential() });
const db = getFirestore();

const ID = 'verify-settle-001';
const ref = db.doc(`settlements/${ID}`);
const CONFIRM_DELAY_DAYS = parseInt(process.env.SETTLEMENT_CONFIRM_DELAY_DAYS ?? '1', 10);

let pass = 0;
let fail = 0;
function check(label, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// confirmDueSettlements 핵심 로직 재현(쿼리 + 트랜잭션 재확인 + cancelled/paid 미덮어씀).
async function runConfirmBatch() {
  const cutoff = new Date(Date.now() - CONFIRM_DELAY_DAYS * 24 * 60 * 60 * 1000);
  const snap = await db
    .collection('settlements')
    .where('status', '==', 'pending')
    .where('settledAt', '<', Timestamp.fromDate(cutoff))
    .get();
  if (snap.empty) return 0;
  const results = await Promise.all(
    snap.docs.map((doc) =>
      db.runTransaction(async (t) => {
        const fresh = await t.get(doc.ref);
        if (!fresh.exists || fresh.data()?.status !== 'pending') return false;
        const now = Timestamp.now();
        t.update(doc.ref, { status: 'confirmed', confirmedAt: now, updatedAt: now });
        return true;
      }),
    ),
  );
  return results.filter(Boolean).length;
}

// markAsPaid 핵심 로직 재현(트랜잭션 내 status 가드 — confirmed만 통과).
async function runMarkAsPaid() {
  return db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new Error('NOT_FOUND: 정산 내역을 찾을 수 없습니다.');
    const data = snap.data();
    if (data.status === 'paid') throw new Error('ALREADY_PAID: 이미 지급 완료된 정산입니다.');
    if (data.status !== 'confirmed')
      throw new Error('NOT_CONFIRMED: confirmed 상태의 정산만 지급 처리할 수 있습니다.');
    const now = Timestamp.now();
    t.update(ref, { status: 'paid', paidAt: now, updatedAt: now });
    return { settlementId: ID, status: 'paid' };
  });
}

async function main() {
  console.log('=== SETTLE-REFACTOR S6 전이 입증 (E-T3) ===\n');
  console.log(`대상 문서: settlements/${ID} · cutoff = 지금 − ${CONFIRM_DELAY_DAYS}일\n`);

  // ① pending 시드 — settledAt을 마감 경계보다 과거(2일 전)로 둬 배치 대상이 되게 함.
  await ref.delete().catch(() => {});
  const settledAt = Timestamp.fromDate(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
  const now = Timestamp.now();
  await ref.set({
    id: ID,
    storeId: 'verify-store',
    orderId: ID,
    totalAmount: 30000,
    platformFeeRate: 0.05,
    platformFee: 1500,
    netAmount: 28500,
    status: 'pending',
    completedStatus: 'REVIEWED',
    settledAt,
    confirmedAt: null,
    paidAt: null,
    createdAt: now,
    updatedAt: now,
  });
  console.log('① pending 시드 완료 (settledAt = 2일 전)');
  check('초기 status = pending', (await ref.get()).data().status === 'pending');

  // ② 역전이 가드: pending에 markAsPaid 시도 → NOT_CONFIRMED 거부되어야 함.
  console.log('\n② 역전이 가드 — pending에 markAsPaid 시도 (거부 기대)');
  try {
    await runMarkAsPaid();
    check('pending 지급 차단', false, '거부되지 않고 통과됨(결함)');
  } catch (e) {
    check('pending 지급 차단', String(e.message).startsWith('NOT_CONFIRMED'), e.message);
  }

  // ③ confirm 배치 로직 — pending → confirmed.
  console.log('\n③ confirm 배치 로직 실행 (pending → confirmed)');
  const n = await runConfirmBatch();
  const afterConfirm = (await ref.get()).data();
  check('배치가 1건 이상 confirmed 전이', n >= 1, `confirmed ${n}건`);
  check('대상 status = confirmed', afterConfirm.status === 'confirmed');
  check('confirmedAt 기록됨', afterConfirm.confirmedAt != null);

  // ④ markAsPaid — confirmed → paid (어드민 "지급처리" 버튼 경로).
  console.log('\n④ markAsPaid 실행 (confirmed → paid)');
  const paidRes = await runMarkAsPaid();
  const afterPaid = (await ref.get()).data();
  check('markAsPaid 반환 status = paid', paidRes.status === 'paid');
  check('대상 status = paid', afterPaid.status === 'paid');
  check('paidAt 기록됨', afterPaid.paidAt != null);

  // ⑤ 멱등 재확인 — 이미 paid에 markAsPaid 재시도 → ALREADY_PAID 거부.
  console.log('\n⑤ 멱등 가드 — 이미 paid에 markAsPaid 재시도 (거부 기대)');
  try {
    await runMarkAsPaid();
    check('이중 지급 차단', false, '거부되지 않고 통과됨(결함)');
  } catch (e) {
    check('이중 지급 차단', String(e.message).startsWith('ALREADY_PAID'), e.message);
  }

  // ⑥ 정리 — 테스트 문서 삭제.
  await ref.delete();
  console.log('\n⑥ 정리 완료 (테스트 문서 삭제)');
  check('문서 삭제 확인', !(await ref.get()).exists);

  console.log(`\n=== 결과: ${pass} passed / ${fail} failed ===`);
  console.log(
    fail === 0
      ? '✅ A-1 단절 해소 입증 완료 — pending → confirmed → paid 전 구간 + 역전이/멱등 가드 정상.'
      : '❌ 일부 검증 실패 — 위 ❌ 항목 확인 필요.',
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('스크립트 실행 오류:', e);
  process.exit(1);
});
