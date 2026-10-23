import {
  BadRequestException,
  Injectable,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { dateRangeKST, todayKST } from '@greenhub/shared';
import { FirestoreService } from '../firestore/firestore.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import {
  QuerySettlementsDto,
  QuerySummaryDto,
  SETTLEMENT_CURSOR_PATTERN,
} from './dto/query-settlements.dto';
import { calcFee, resolveFeeRate } from './_lib/fee-calculator';
import {
  type OrderPayoutHoldReason,
  readOrderPayoutHoldInTransaction,
} from './_lib/order-payout-hold';
import { hasOpenProviderReversalInTransaction } from './_lib/provider-reversal-hold';
import { aggregateSettlements } from './_lib/settlement-aggregator';

// 정산 상태 타입 SSOT = @greenhub/shared (F-1/S4). DTO 등 기존 import 경로 유지를 위해 re-export + 로컬 사용.
import type { OperationIssueType, SettlementStatus } from '@greenhub/shared';
export type { SettlementStatus } from '@greenhub/shared';

/**
 * 판매자 정산 목록 1회 응답 건수. 기본값을 상한과 같게 둔다.
 * 다음 페이지를 모르는 이전 판매자 화면도 관리자 정산 목록(500건)과 같은 범위를 그대로 받게 하기 위해서다.
 */
export const SETTLEMENT_LIST_DEFAULT_LIMIT = 500;
export const SETTLEMENT_LIST_MAX_LIMIT = 500;

/** limit 생략·비정상 값은 기본값, 범위를 벗어나면 1~상한으로 맞춘다. */
export function resolveSettlementListLimit(raw: unknown): number {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) return SETTLEMENT_LIST_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(value), 1), SETTLEMENT_LIST_MAX_LIMIT);
}

/** 지급 뒤 환불로 판매자에게 돌려받아야 할 금액을 알리는 운영 기록 유형. */
export const SETTLEMENT_RECOVERY_ISSUE_TYPE =
  'SETTLEMENT_RECOVERY_REQUIRED' satisfies OperationIssueType;

/**
 * 정산 취소 반영 결과. 이미 지급한(paid) 정산의 주문이 환불되면 정산은 paid로 두고
 * 판매자에게 돌려받을 금액(그 정산의 판매자 지급액)을 알린다.
 */
export type CancelSettlementResult = {
  recoveryRequired: boolean;
  recoveryAmount: number;
};

const NO_RECOVERY: CancelSettlementResult = { recoveryRequired: false, recoveryAmount: 0 };

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);
  private readonly feeRate: number;
  private readonly confirmDelayDays: number;
  private readonly issueWriter: OperationIssueWriterService;

  constructor(
    private readonly firestore: FirestoreService,
    private readonly config: ConfigService,
    // 모듈은 OperationIssuesModule에서 주입한다. 직접 만든 서비스(테스트 등)도 같은 Firestore에
    // 회수 기록을 남기도록, 주입이 없으면 같은 작성기를 만들어 쓴다(트랜잭션 안 기록은 알림을 보내지 않는다).
    @Optional() issueWriter?: OperationIssueWriterService,
  ) {
    this.issueWriter = issueWriter ?? new OperationIssueWriterService(firestore);
    this.feeRate = parseFloat(this.config.get<string>('PLATFORM_FEE_RATE') ?? '0.05');
    // 기본 7일: 판매자 배송 후 환불 기간(배송 완료 7일)이 끝나기 전에는 지급되지 않게 한다.
    this.confirmDelayDays = parseInt(
      this.config.get<string>('SETTLEMENT_CONFIRM_DELAY_DAYS') ?? '7',
      10,
    );
  }

  // **자동 생성**: 주문이 완료 상태(REVIEWED/DELIVERED/PICKED_UP)에 도달 시 호출
  // N6: 중복 확인(read)→생성(set)을 트랜잭션으로 묶어 동시 전이 경합 차단.
  // 같은 주문이 짧은 간격으로 두 전이(DELIVERED→REVIEWED 등)를 타거나 동시 호출 시
  // 비트랜잭션이면 둘 다 exists=false를 읽고 둘 다 set → 후자가 전자를 덮어써 settledAt 갱신.
  // 수수료율: 같은 트랜잭션에서 가게 문서의 commissionRate(0~1)를 읽어 쓰고, 없으면 서버 기본값.
  // 쓴 요율은 platformFeeRate로 정산에 남는다. 이미 만든 정산은 다시 계산하지 않는다.
  async createSettlement(order: Record<string, unknown>, completedStatus: string): Promise<void> {
    const orderId = order['id'] as string;
    const ref = this.firestore.doc(`settlements/${orderId}`);
    const storeId = order['storeId'];
    const storeRef =
      typeof storeId === 'string' && storeId.length > 0
        ? this.firestore.doc(`stores/${storeId}`)
        : null;

    const totalAmount = (order['totalAmount'] as number) ?? 0;

    await this.firestore.runTransaction(async (t) => {
      // 트랜잭션 내 중복 재확인 — 동시 호출 중 한쪽만 set 통과
      const existing = await t.get(ref);
      if (existing.exists) return;

      const storeSnap = storeRef ? await t.get(storeRef) : null;
      const feeRate = resolveFeeRate(
        storeSnap?.exists ? storeSnap.data()?.['commissionRate'] : undefined,
        this.feeRate,
      );
      const { platformFee, netAmount } = calcFee(totalAmount, feeRate);

      const now = this.firestore.Timestamp.now();
      t.set(ref, {
        id: orderId,
        storeId: order['storeId'],
        orderId,
        // 판매자 CSV·회차별 집계용 식별자(개인정보 아님). 옛 주문은 null.
        orderNumber: typeof order['orderNumber'] === 'string' ? order['orderNumber'] : null,
        roundId: typeof order['roundId'] === 'string' ? order['roundId'] : null,
        totalAmount,
        platformFeeRate: feeRate,
        platformFee,
        netAmount,
        status: 'pending' as SettlementStatus,
        completedStatus,
        settledAt: now,
        confirmedAt: null,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  async getSettlements(
    storeId: string,
    requesterId: string,
    role: string,
    dto: QuerySettlementsDto,
  ) {
    await this.verifyOwnership(storeId, requesterId, role);

    let ref = this.firestore.collection('settlements').where('storeId', '==', storeId) as any;

    if (dto.status) {
      ref = ref.where('status', '==', dto.status);
    }
    if (dto.from) {
      const { start } = dateRangeKST(dto.from);
      ref = ref.where('settledAt', '>=', this.firestore.Timestamp.fromDate(start));
    }
    if (dto.to) {
      const { endExclusive } = dateRangeKST(dto.to);
      ref = ref.where('settledAt', '<', this.firestore.Timestamp.fromDate(endExclusive));
    }

    // N10(F-2): 어드민(desc)과 정렬 방향 통일 — 양 화면 settledAt 최신순.
    ref = ref.orderBy('settledAt', 'desc');

    // 이어받기: 앞 응답의 마지막 정산 문서 다음부터. 문서 스냅샷 기준이라 settledAt이 같은 건도
    // 문서 id 순으로 이어져 빠지거나 겹치지 않고, 기존 (storeId, [status,] settledAt DESC) 인덱스를 그대로 쓴다.
    if (dto.cursor !== undefined) {
      ref = ref.startAfter(await this.readListCursor(storeId, dto.cursor));
    }

    const limit = resolveSettlementListLimit(dto.limit);
    const snap = await ref.limit(limit + 1).get();
    const docs = snap.docs.slice(0, limit);
    const settlements = docs.map((d: any) => d.data());
    const hasMore = snap.docs.length > limit;

    // total = 이번 응답에 담긴 건수. hasMore/nextCursor는 추가 필드라 이전 화면은 무시해도 된다.
    return {
      settlements,
      total: settlements.length,
      hasMore,
      nextCursor: hasMore ? (docs[docs.length - 1].id as string) : null,
    };
  }

  async getSummary(storeId: string, requesterId: string, role: string, dto: QuerySummaryDto) {
    await this.verifyOwnership(storeId, requesterId, role);

    const targetDate = dto.date ?? todayKST();
    const { start, endExclusive } = dateRangeKST(targetDate);

    const snap = await (
      this.firestore
        .collection('settlements')
        .where('storeId', '==', storeId)
        .where('settledAt', '>=', this.firestore.Timestamp.fromDate(start))
        .where('settledAt', '<', this.firestore.Timestamp.fromDate(endExclusive)) as any
    ).get();

    const settlements: Record<string, unknown>[] = snap.docs.map((d: any) => d.data());

    const agg = aggregateSettlements(settlements);

    return {
      date: targetDate,
      count: agg.count,
      totalAmount: agg.totalAmount,
      totalPlatformFee: agg.totalPlatformFee,
      totalNetAmount: agg.totalNetAmount,
      byStatus: agg.byStatus,
    };
  }

  // **confirm 마감 배치 (A-1 해소)**: settledAt이 마감 경계를 지난 pending 정산을 confirmed로 자동 전이.
  // 스펙(settlements.md §2)은 pending→confirmed→paid를 명시하나 confirm 전이 코드가 부재해
  // 전 정산이 pending 고착 → 어드민 "지급처리" 버튼(confirmed에서만 노출) 영구 미표시였음.
  // payments cleanupPendingOrders(쿼리→개별처리) 패턴 동형. 서버 TZ 미설정이라 KST 보정 필수.
  @Cron('0 4 * * *', { timeZone: 'Asia/Seoul' })
  async confirmDueSettlements(): Promise<void> {
    const cutoff = new Date(Date.now() - this.confirmDelayDays * 24 * 60 * 60 * 1000);
    const snap = await this.firestore
      .collection('settlements')
      .where('status', '==', 'pending')
      .where('settledAt', '<', this.firestore.Timestamp.fromDate(cutoff))
      .get();

    if (snap.empty) return;

    // 트랜잭션 내 재확인으로 멱등성 확보 + 취소 경합 차단(GAP-1):
    // 배치 도중 cancelSettlement가 cancelled로 바꿨다면 status가 더는 pending이 아니므로 skip → cancelled 미덮어씀.
    // 한 건의 실패가 나머지 결과·로그를 가리지 않도록 건별로 격리한다. 실패 건은 pending으로 남아 다음 날 다시 시도된다.
    // 결제사 취소·분쟁 운영 기록이 OPEN인 주문은 확정하지 않고 pending으로 둔다. 같은 트랜잭션에서 읽어
    // 확정 직전에 기록이 열리는 경합도 막는다. 기록이 처리(RESOLVED·DISMISSED)되면 다음 배치에서 확정된다.
    // 주문이 취소됐거나 취소·환불이 진행 중이거나 주문 문서가 없어도 확정하지 않고 pending으로 둔다.
    // 환불이 멈춘 주문의 정산이 7일 뒤 그대로 확정·지급되는 것을 막는다. 정산 취소는 이 배치가 하지 않는다.
    type ConfirmOutcome = 'confirmed' | 'held' | 'skipped' | OrderPayoutHoldReason;
    const results = await Promise.allSettled(
      snap.docs.map((doc) =>
        this.firestore.runTransaction(async (t): Promise<ConfirmOutcome> => {
          const fresh = await t.get(doc.ref);
          const data = fresh.data();
          if (!fresh.exists || data?.['status'] !== 'pending') return 'skipped';
          const orderId = typeof data['orderId'] === 'string' ? data['orderId'] : doc.id;
          if (await hasOpenProviderReversalInTransaction(this.firestore, t, orderId)) {
            return 'held';
          }
          const orderHold = await readOrderPayoutHoldInTransaction(this.firestore, t, orderId);
          if (orderHold) return orderHold;
          const now = this.firestore.Timestamp.now();
          t.update(doc.ref, {
            status: 'confirmed',
            confirmedAt: now,
            updatedAt: now,
          });
          return 'confirmed';
        }),
      ),
    );

    const confirmed = results.filter(
      (r) => r.status === 'fulfilled' && r.value === 'confirmed',
    ).length;
    const idsWith = (outcome: ConfirmOutcome) =>
      snap.docs
        .filter((_, index) => {
          const result = results[index];
          return result.status === 'fulfilled' && result.value === outcome;
        })
        .map((doc) => doc.id);
    const heldIds = idsWith('held');
    const cancellingIds = idsWith('ORDER_CANCELLED_OR_CANCELLING');
    const missingOrderIds = idsWith('ORDER_MISSING');
    const failedIds = snap.docs
      .filter((_, index) => results[index].status === 'rejected')
      .map((doc) => doc.id);
    const heldTotal = heldIds.length + cancellingIds.length + missingOrderIds.length;
    this.logger.log(
      `[SettlementScheduler] confirmed ${confirmed}건, 보류 ${heldTotal}건, 실패 ${failedIds.length}건 (대상 ${snap.size}건)`,
    );
    if (heldIds.length > 0) {
      this.logger.warn(
        `[SettlementScheduler] 결제사 취소·분쟁 확인 대기로 확정 보류한 정산: ${heldIds.join(', ')}`,
      );
    }
    if (cancellingIds.length > 0) {
      this.logger.warn(
        `[SettlementScheduler] 주문이 취소됐거나 취소·환불이 진행 중이라 확정 보류한 정산: ${cancellingIds.join(', ')}`,
      );
    }
    if (missingOrderIds.length > 0) {
      this.logger.warn(
        `[SettlementScheduler] 주문 문서가 없어 확정 보류한 정산: ${missingOrderIds.join(', ')}`,
      );
    }
    if (failedIds.length > 0) {
      this.logger.error(`[SettlementScheduler] confirm 실패 정산: ${failedIds.join(', ')}`);
    }
  }

  // **취소 반영**: 주문 CANCELLED 시 해당 settlement status → 'cancelled'
  // B-5(N6): 트랜잭션으로 read→update 묶어 경합 차단.
  // B-6(N7): 이미 paid(지급 완료)된 정산은 cancelled로 덮어쓰지 않음(역전이 가드).
  //   비트랜잭션·무조건 update 시 지급 후 주문 취소 경로를 타면 paid→cancelled로 덮여 회계 손실.
  //   confirmDueSettlements의 "cancelled 미덮어씀"(GAP-1)과 대칭(paid 미덮어씀).
  // 지급 후 환불(결정 ④): paid는 그대로 두고, 같은 트랜잭션에서 정산에 회수 필요(recoveryRequired·
  //   recoveryAmount=판매자 지급액·recoveryRequiredAt)를 남기고 관리자만 닫는 운영 기록을 연다.
  //   이미 회수 표시가 된 정산은 다시 쓰지 않는다(관리자가 닫은 기록을 다시 열지 않음).
  async cancelSettlement(orderId: string): Promise<CancelSettlementResult> {
    const ref = this.firestore.doc(`settlements/${orderId}`);
    return this.firestore.runTransaction(async (t): Promise<CancelSettlementResult> => {
      const snap = await t.get(ref);
      if (!snap.exists) return NO_RECOVERY;
      const data = snap.data() ?? {};
      const status = data['status'] as SettlementStatus;
      if (status === 'paid') {
        const paidNet = typeof data['netAmount'] === 'number' ? data['netAmount'] : 0;
        if (data['recoveryRequired'] === true) {
          const recorded = data['recoveryAmount'];
          return {
            recoveryRequired: true,
            recoveryAmount: typeof recorded === 'number' ? recorded : paidNet,
          };
        }
        await this.issueWriter.createOrMergeIssue(
          {
            storeId: String(data['storeId'] ?? ''),
            orderId,
            paymentId: null,
            type: SETTLEMENT_RECOVERY_ISSUE_TYPE,
            severity: 'critical',
            title: '지급 후 환불 — 판매자 회수 필요',
            message:
              '이미 판매자에게 지급한 정산의 주문이 환불됐습니다. 지급한 금액(정산 화면의 회수 필요 금액)을 판매자에게서 돌려받아야 합니다. 관리자가 회수를 확인한 뒤 닫습니다.',
            idempotencyKey: `settlement-recovery:${orderId}`,
            latestSnapshot: {
              settlementStatus: 'paid',
              failureStage: 'settlement_recovery',
            },
          },
          t,
        );
        const now = this.firestore.Timestamp.now();
        t.update(ref, {
          recoveryRequired: true,
          recoveryAmount: paidNet,
          recoveryRequiredAt: now,
          updatedAt: now,
        });
        this.logger.warn(
          `[cancelSettlement] paid 정산 ${orderId} 환불 — paid 유지, 판매자 회수 필요 ${paidNet}원 기록`,
        );
        return { recoveryRequired: true, recoveryAmount: paidNet };
      }
      if (status === 'cancelled') return NO_RECOVERY; // 멱등
      t.update(ref, {
        status: 'cancelled',
        updatedAt: this.firestore.Timestamp.now(),
      });
      return NO_RECOVERY;
    });
  }

  private async readListCursor(storeId: string, cursor: unknown) {
    if (typeof cursor !== 'string' || !SETTLEMENT_CURSOR_PATTERN.test(cursor)) {
      throw new BadRequestException('cursor 값이 올바르지 않습니다');
    }
    const cursorSnap = await this.firestore.doc(`settlements/${cursor}`).get();
    // 다른 매장 정산이나 없는 문서는 같은 응답으로 거절한다(존재 여부를 드러내지 않음).
    if (!cursorSnap.exists || cursorSnap.data()?.['storeId'] !== storeId) {
      throw new BadRequestException('cursor 값이 올바르지 않습니다');
    }
    return cursorSnap;
  }

  private async verifyOwnership(storeId: string, requesterId: string, role: string) {
    if (role === 'admin') return;
    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!storeSnap.exists || storeSnap.data()?.['ownerId'] !== requesterId) {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    }
  }
}
