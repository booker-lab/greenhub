/**
 * M-PATH M4 정산 탭 육안 검증용 — 상태별 정산 시드 (세션83)
 *
 * 셀러 정산 화면(/settlements 주문별 상세 탭)은 API `GET /stores/{storeId}/settlements`로
 * settlements 컬렉션을 storeId 필터·settledAt desc 정렬해 조회한다
 * (apps/api/src/settlements/settlements.service.ts:66-95).
 * 라벨·색·desc 정렬·"지급처리" 버튼을 전부 육안 확인하려면 pending/confirmed/paid/cancelled
 * 각 상태의 정산이 화면에 남아 있어야 한다. 이 스크립트가 그 4건을 시드한다.
 *
 * verify-settlement-transition.mjs와 달리 cleanup을 하지 않는다(화면 잔존이 목적).
 * 멱등성: ID 'visual-settle-{status}' 고정 — 재실행 시 set으로 덮어쓴다.
 * 정리: 검증 종료 후 `node scripts/seed-settlements-visual.mjs --clean`으로 4건 삭제.
 *
 * 라벨/색 SSOT(packages/shared/settlement.types.ts):
 *   pending=정산 대기/yellow · confirmed=확정/blue · paid=지급 완료/green · cancelled=취소/red
 *
 * 실행:
 *   node scripts/seed-settlements-visual.mjs          # 4건 시드
 *   node scripts/seed-settlements-visual.mjs --clean  # 4건 삭제
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

// M-PATH 육안 검증 대상 store. 세션83: 현재 카카오 로그인 계정 = 난플렉스(80189070).
// (검증 계정이 바뀌면 이 값만 교체하면 됨. 9b2cb652 = 테스트 꽃농장/seller@test.com)
const SELLER_STORE_ID = '80189070-2c3d-45f2-bc11-68a870b13951';

// settledAt을 일자별로 다르게 줘 desc 정렬(최신순)을 화면에서 눈으로 확인 가능하게 한다.
// 가장 최신(0일 전) = pending → 위쪽, 가장 과거(3일 전) = cancelled → 아래쪽 기대.
const SEEDS = [
  { status: 'pending', daysAgo: 0, total: 50000 },
  { status: 'confirmed', daysAgo: 1, total: 40000 },
  { status: 'paid', daysAgo: 2, total: 30000 },
  { status: 'cancelled', daysAgo: 3, total: 20000 },
];

const FEE_RATE = 0.05;

function docId(status) {
  return `visual-settle-${status}`;
}

async function clean() {
  console.log('=== 정산 육안 시드 정리 (--clean) ===\n');
  for (const { status } of SEEDS) {
    const id = docId(status);
    await db.doc(`settlements/${id}`).delete();
    console.log(`  🗑  settlements/${id} 삭제`);
  }
  console.log('\n✅ 4건 삭제 완료. M4 정산 화면은 다시 비어 있습니다(다른 실데이터 제외).');
}

async function seed() {
  console.log('=== M4 정산 탭 육안 검증용 상태별 시드 ===\n');
  console.log(`storeId = ${SELLER_STORE_ID} (난플렉스 — 현재 카카오 로그인 계정)`);
  console.log('정렬 기대: settledAt desc → pending(최신) 위 → cancelled(과거) 아래\n');

  const now = Timestamp.now();
  for (const { status, daysAgo, total } of SEEDS) {
    const id = docId(status);
    const settledAt = Timestamp.fromDate(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
    const platformFee = Math.round(total * FEE_RATE);
    const netAmount = total - platformFee;
    await db.doc(`settlements/${id}`).set({
      id,
      orderId: id,
      storeId: SELLER_STORE_ID,
      totalAmount: total,
      platformFeeRate: FEE_RATE,
      platformFee,
      netAmount,
      status,
      completedStatus: 'REVIEWED',
      settledAt,
      confirmedAt: status === 'confirmed' || status === 'paid' ? now : null,
      paidAt: status === 'paid' ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    console.log(
      `  ✅ ${id} — status=${status}, settledAt=${daysAgo}일 전, ` +
        `총 ${total.toLocaleString()}원 / 수수료 ${platformFee.toLocaleString()} / 정산액 ${netAmount.toLocaleString()}`,
    );
  }

  console.log('\n✅ 4건 시드 완료. 셀러 /settlements [주문별 상세] 탭에서 확인하세요.');
  console.log('   기대 화면(위→아래): 정산 대기(노랑) → 확정(파랑) → 지급 완료(초록) → 취소(빨강)');
  console.log('   어드민 정산 화면: "확정(blue)" 행에만 "지급처리" 버튼 노출(E-T3 #221).');
  console.log('\n검증 종료 후 정리: node scripts/seed-settlements-visual.mjs --clean');
}

const isClean = process.argv.includes('--clean');
(isClean ? clean() : seed())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('스크립트 실행 오류:', e);
    process.exit(1);
  });
