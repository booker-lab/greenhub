import { BadRequestException } from '@nestjs/common';
import { dateRangeKST } from '@greenhub/shared';
import type { FirestoreService } from '../../firestore/firestore.service';
import { type PayoutAccount, readPayoutAccounts } from '../../payout-accounts/payout-account.fields';
import { PROVIDER_REVERSAL_ISSUE_TYPE } from '../../settlements/_lib/provider-reversal-hold';
import { aggregateSettlements } from '../../settlements/_lib/settlement-aggregator';
import { SETTLEMENT_CURSOR_PATTERN } from '../../settlements/dto/query-settlements.dto';
import type { AdminSettlementFilterDto, QueryAdminSettlementsDto } from '../dto/admin.dto';

/**
 * 관리자 정산 목록·합계(결정 ⑦). 목록은 "더 보기"로 이어 받고, 합계는 같은 조건의 전체를 서버가 계산한다.
 * 정렬은 settledAt 최신순(판매자 정산과 같은 인덱스).
 */
export const ADMIN_SETTLEMENT_LIST_DEFAULT_LIMIT = 100;
export const ADMIN_SETTLEMENT_LIST_MAX_LIMIT = 500;
/** 합계 계산 때 한 번에 읽는 최대 건수. 넘으면 truncated로 알린다(파일럿 규모에서는 닿지 않는다). */
export const ADMIN_SETTLEMENT_SUMMARY_SCAN_LIMIT = 20_000;
/** 지급 보류 사유를 찾을 때 읽는 열린 결제사 취소·분쟁 기록 상한. */
const OPEN_REVERSAL_SCAN_LIMIT = 1_000;

export type SettlementHoldReason = 'PROVIDER_REVERSAL';

type Firestore = Pick<FirestoreService, 'collection' | 'doc' | 'Timestamp'>;
type Row = Record<string, unknown>;

export function resolveAdminSettlementListLimit(raw: unknown): number {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ADMIN_SETTLEMENT_LIST_DEFAULT_LIMIT;
  }
  return Math.min(Math.max(Math.floor(value), 1), ADMIN_SETTLEMENT_LIST_MAX_LIMIT);
}

function filteredQuery(firestore: Firestore, filter: AdminSettlementFilterDto) {
  let query = firestore.collection('settlements') as any;
  if (filter.storeId) query = query.where('storeId', '==', filter.storeId);
  if (filter.status) query = query.where('status', '==', filter.status);
  if (filter.from) {
    const { start } = dateRangeKST(filter.from);
    query = query.where('settledAt', '>=', firestore.Timestamp.fromDate(start));
  }
  if (filter.to) {
    const { endExclusive } = dateRangeKST(filter.to);
    query = query.where('settledAt', '<', firestore.Timestamp.fromDate(endExclusive));
  }
  // 기존 (storeId, [status,] settledAt DESC) 인덱스를 목록·합계가 함께 쓴다.
  return query.orderBy('settledAt', 'desc');
}

async function readCursor(firestore: Firestore, cursor: unknown, storeId: string | undefined) {
  if (typeof cursor !== 'string' || !SETTLEMENT_CURSOR_PATTERN.test(cursor)) {
    throw new BadRequestException('cursor 값이 올바르지 않습니다');
  }
  const snap = await firestore.doc(`settlements/${cursor}`).get();
  if (!snap.exists || (storeId && snap.data()?.['storeId'] !== storeId)) {
    throw new BadRequestException('cursor 값이 올바르지 않습니다');
  }
  return snap;
}

const asString = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);

async function readStoreNames(firestore: Firestore, storeIds: string[]) {
  const snaps = await Promise.all(storeIds.map((id) => firestore.doc(`stores/${id}`).get()));
  const names = new Map<string, string | null>();
  snaps.forEach((snap, index) => {
    names.set(storeIds[index], snap.exists ? asString(snap.data()?.['name']) : null);
  });
  return names;
}

/** 주문번호 필드가 생기기 전 정산만 주문 문서에서 주문번호를 읽는다. */
async function readOrderNumbers(firestore: Firestore, orderIds: string[]) {
  const snaps = await Promise.all(orderIds.map((id) => firestore.doc(`orders/${id}`).get()));
  const numbers = new Map<string, string | null>();
  snaps.forEach((snap, index) => {
    numbers.set(orderIds[index], snap.exists ? asString(snap.data()?.['orderNumber']) : null);
  });
  return numbers;
}

/** 열린 결제사 취소·분쟁 기록이 있는 주문 — 확정·지급이 막힌 이유(provider-reversal-hold와 같은 조건). */
async function readOpenReversalOrderIds(firestore: Firestore) {
  const snap = await (
    firestore
      .collection('operationIssues')
      .where('type', '==', PROVIDER_REVERSAL_ISSUE_TYPE)
      .where('status', '==', 'OPEN')
      .limit(OPEN_REVERSAL_SCAN_LIMIT) as any
  ).get();
  return new Set<string>(
    snap.docs.map((doc: any) => doc.data()?.['orderId']).filter((id: unknown) => asString(id)),
  );
}

const unique = (values: Array<string | null>) =>
  [...new Set(values.filter((value): value is string => value !== null))];

/**
 * 목록 행에 화면이 쓰는 값을 붙인다.
 * - storeName: 가게 이름(없으면 null)
 * - orderNumber: 정산에 없으면 주문 문서에서
 * - holdReason: 확정·지급 전(pending·confirmed) 정산이 결제사 취소·분쟁으로 막혀 있으면 'PROVIDER_REVERSAL'
 * - payoutAccount: 지급 대상(confirmed) 행에만 가게 정산 계좌(없으면 null)
 */
async function enrichRows(firestore: Firestore, rows: Row[]) {
  const storeIds = unique(rows.map((row) => asString(row['storeId'])));
  const missingOrderNumberIds = unique(
    rows
      .filter((row) => !asString(row['orderNumber']))
      .map((row) => asString(row['orderId'])),
  );
  const holdable = rows.filter((row) => row['status'] === 'pending' || row['status'] === 'confirmed');
  const payableStoreIds = unique(
    rows.filter((row) => row['status'] === 'confirmed').map((row) => asString(row['storeId'])),
  );

  const [storeNames, orderNumbers, reversalOrderIds, accounts] = await Promise.all([
    readStoreNames(firestore, storeIds),
    readOrderNumbers(firestore, missingOrderNumberIds),
    holdable.length > 0 ? readOpenReversalOrderIds(firestore) : Promise.resolve(new Set<string>()),
    readPayoutAccounts(firestore, payableStoreIds),
  ]);

  return rows.map((row) => {
    const storeId = asString(row['storeId']);
    const orderId = asString(row['orderId']) ?? asString(row['id']);
    const orderNumber =
      asString(row['orderNumber']) ?? (orderId ? (orderNumbers.get(orderId) ?? null) : null);
    const held =
      (row['status'] === 'pending' || row['status'] === 'confirmed') &&
      orderId !== null &&
      reversalOrderIds.has(orderId);
    const payoutAccount: PayoutAccount | null =
      row['status'] === 'confirmed' && storeId ? (accounts.get(storeId) ?? null) : null;
    return {
      ...row,
      orderNumber,
      storeName: storeId ? (storeNames.get(storeId) ?? null) : null,
      recoveryRequired: row['recoveryRequired'] === true,
      recoveryAmount: typeof row['recoveryAmount'] === 'number' ? row['recoveryAmount'] : null,
      holdReason: held ? ('PROVIDER_REVERSAL' satisfies SettlementHoldReason) : null,
      payoutAccount,
    };
  });
}

export async function listAdminSettlements(firestore: Firestore, dto: QueryAdminSettlementsDto) {
  let query = filteredQuery(firestore, dto);
  if (dto.cursor !== undefined) {
    // 이어받기: 앞 응답의 마지막 정산 문서 다음부터(문서 스냅샷 기준이라 settledAt이 같아도 겹치지 않는다).
    query = query.startAfter(await readCursor(firestore, dto.cursor, dto.storeId));
  }
  const limit = resolveAdminSettlementListLimit(dto.limit);
  const snap = await query.limit(limit + 1).get();
  const docs = snap.docs.slice(0, limit);
  const settlements = await enrichRows(
    firestore,
    docs.map((doc: any) => doc.data() as Row),
  );
  const hasMore = snap.docs.length > limit;
  return {
    settlements,
    // total = 이번 응답에 담긴 건수. 조건 전체 건수·금액은 합계 엔드포인트가 준다.
    total: settlements.length,
    hasMore,
    nextCursor: hasMore ? (docs[docs.length - 1].id as string) : null,
  };
}

/**
 * 같은 조건의 정산 전체 합계. 지급 대기 = confirmed, 지급 완료 = paid, 수수료 = confirmed+paid
 * (pending·cancelled는 아직·더는 지급 대상이 아니다). 회수 필요는 paid 중 지급 뒤 환불된 건.
 */
export async function summarizeAdminSettlements(
  firestore: Firestore,
  filter: AdminSettlementFilterDto,
) {
  const snap = await filteredQuery(firestore, filter)
    .limit(ADMIN_SETTLEMENT_SUMMARY_SCAN_LIMIT + 1)
    .get();
  const truncated = snap.docs.length > ADMIN_SETTLEMENT_SUMMARY_SCAN_LIMIT;
  const rows: Row[] = snap.docs
    .slice(0, ADMIN_SETTLEMENT_SUMMARY_SCAN_LIMIT)
    .map((doc: any) => doc.data() as Row);
  const agg = aggregateSettlements(rows);
  let recoveryCount = 0;
  let recoveryAmount = 0;
  for (const row of rows) {
    if (row['recoveryRequired'] !== true) continue;
    recoveryCount += 1;
    recoveryAmount += typeof row['recoveryAmount'] === 'number' ? row['recoveryAmount'] : 0;
  }
  return {
    count: agg.count,
    byStatus: agg.byStatus,
    payable: { count: agg.byStatus.confirmed, netAmount: agg.netByStatus.confirmed },
    paid: { count: agg.byStatus.paid, netAmount: agg.netByStatus.paid },
    platformFee: agg.feeByStatus.confirmed + agg.feeByStatus.paid,
    recovery: { count: recoveryCount, amount: recoveryAmount },
    truncated,
  };
}
