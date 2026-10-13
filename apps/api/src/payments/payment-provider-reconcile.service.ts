import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { acquireJobLease, completeJobLease, seoulDailySlotKey } from '../common/job-lease';
import { FirestoreService } from '../firestore/firestore.service';
import { OperationIssueWriterService } from '../operations/operation-issue-writer.service';
import { PROVIDER_REVERSAL_ISSUE_TYPE } from '../settlements/_lib/provider-reversal-hold';
import { isPaymentReversalOwnedLocally } from './payments.service';
import { PortoneClient, PortoneError } from './portone.client';

const RECONCILE_JOB_NAME = 'payment-provider-reconcile';
const RECONCILE_LEASE_TTL_MS = 30 * 60_000;
// 결제 확정 뒤 이 기간 안의 결제만 다시 확인한다.
const RECONCILE_WINDOW_MS = 3 * 24 * 60 * 60_000;
// 한 번 실행에서 컬렉션마다 읽는 최대 문서 수.
const RECONCILE_MAX_RECORDS = 200;
// PortOne 조회는 한 건씩 순서대로, 호출 사이에 이만큼 쉰다.
const PORTONE_CALL_INTERVAL_MS = 200;
const RECONCILE_PROVIDER_EVENT = 'DAILY_RECONCILE';

export type PaymentProviderReconcileOptions = {
  now?: Date;
  callIntervalMs?: number;
};

export type PaymentProviderReconcileSummary = {
  checked: number;
  recorded: number;
  lookupFailed: number;
  failed: number;
};

type ReconcileTarget =
  | { kind: 'order'; orderId: string; portonePaymentId: string; payment: Record<string, unknown> }
  | { kind: 'charge'; chargeId: string; portonePaymentId: string; charge: Record<string, unknown> };

/**
 * 매일 새벽 최근 PAID 주문 결제·재배송비 결제를 PortOne에서 다시 읽어, 결제사 쪽 상태가 더는
 * PAID가 아닌(취소·부분 취소·실패 등) 건을 운영 확인 기록(PROVIDER_REVERSAL_DETECTED)으로 남긴다.
 * 취소 웹훅을 놓친 경우를 정산 확정(04:00 KST) 전에 잡기 위한 대사다.
 *
 * - 주문·결제·청구·정산 문서는 바꾸지 않는다. 기록만 남긴다(열린 기록은 정산 확정을 보류시킨다).
 * - 같은 주문·청구에 이미 결제사 되돌림 기록이 있으면(처리된 기록 포함) 새로 남기지 않는다.
 * - 여러 인스턴스가 떠 있어도 하루 한 번만 돌도록 job lease를 잡는다.
 * - 스케줄러 비활성화(GREENHUB_SCHEDULES_ENABLED=false)면 다른 cron과 같이 등록되지 않는다.
 */
@Injectable()
export class PaymentProviderReconcileService {
  private readonly logger = new Logger(PaymentProviderReconcileService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly portone: PortoneClient,
    private readonly issueWriter: OperationIssueWriterService,
  ) {}

  // 서울 03:30. 보관 기한 삭제(03:00) 뒤, 정산 확정(04:00) 전.
  @Cron('30 3 * * *', { timeZone: 'Asia/Seoul' })
  async runDailyReconcile(
    options: PaymentProviderReconcileOptions = {},
  ): Promise<PaymentProviderReconcileSummary | null> {
    const now = options.now ?? new Date();
    const acquired = await acquireJobLease(this.firestore, {
      jobName: RECONCILE_JOB_NAME,
      slotKey: seoulDailySlotKey(now),
      ttlMs: RECONCILE_LEASE_TTL_MS,
      logger: this.logger,
    });
    if (acquired.status !== 'ACQUIRED') return null;
    try {
      const summary = await this.reconcileRecentPayments({ ...options, now });
      await completeJobLease(this.firestore, acquired.lease, {
        succeeded: true,
        logger: this.logger,
      });
      return summary;
    } catch (error) {
      this.logger.error(`[PaymentReconcile] 결제 대사 실패: ${this.safeMessage(error)}`);
      // 실패한 회차는 완료로 남기지 않고 lease만 풀어 다른 실행이 다시 시도할 수 있게 한다.
      await completeJobLease(this.firestore, acquired.lease, {
        succeeded: false,
        logger: this.logger,
      });
      return null;
    }
  }

  async reconcileRecentPayments(
    options: PaymentProviderReconcileOptions = {},
  ): Promise<PaymentProviderReconcileSummary> {
    const now = options.now ?? new Date();
    const callIntervalMs = options.callIntervalMs ?? PORTONE_CALL_INTERVAL_MS;
    const since = this.firestore.Timestamp.fromDate(new Date(now.getTime() - RECONCILE_WINDOW_MS));
    const targets = [
      ...(await this.loadPaidOrderPayments(since)),
      ...(await this.loadPaidCharges(since)),
    ];
    const summary: PaymentProviderReconcileSummary = {
      checked: 0,
      recorded: 0,
      lookupFailed: 0,
      failed: 0,
    };

    for (const [index, target] of targets.entries()) {
      if (index > 0 && callIntervalMs > 0) await sleep(callIntervalMs);
      try {
        const outcome = await this.reconcileTarget(target);
        if (outcome === 'skipped') continue;
        summary.checked += 1;
        if (outcome === 'recorded') summary.recorded += 1;
        if (outcome === 'lookup_failed') summary.lookupFailed += 1;
      } catch (error) {
        summary.failed += 1;
        this.logger.error(
          `[PaymentReconcile] 대사 처리 실패 ${this.targetLabel(target)}: ${this.safeMessage(error)}`,
        );
      }
    }

    this.logger.log(
      `[PaymentReconcile] 확인 ${summary.checked}건, 기록 ${summary.recorded}건, 조회 실패 ${summary.lookupFailed}건, 처리 실패 ${summary.failed}건 (대상 ${targets.length}건)`,
    );
    return summary;
  }

  private async loadPaidOrderPayments(since: unknown): Promise<ReconcileTarget[]> {
    // 결제 문서의 createdAt은 결제 확정 시각이다. 단일 필드 범위 조회라 복합 인덱스가 필요 없다.
    const snap = await this.firestore
      .collection('payments')
      .where('createdAt', '>=', since)
      .orderBy('createdAt', 'asc')
      .limit(RECONCILE_MAX_RECORDS)
      .get();
    this.warnIfTruncated('payments', snap.size);
    return snap.docs.flatMap((doc: any): ReconcileTarget[] => {
      const payment = doc.data() as Record<string, unknown>;
      if (payment['status'] !== 'PAID') return [];
      const orderId = typeof payment['orderId'] === 'string' ? payment['orderId'] : doc.id;
      const portonePaymentId =
        typeof payment['portonePaymentId'] === 'string' ? payment['portonePaymentId'] : orderId;
      return [{ kind: 'order', orderId, portonePaymentId, payment }];
    });
  }

  private async loadPaidCharges(since: unknown): Promise<ReconcileTarget[]> {
    const snap = await this.firestore
      .collection('orderCharges')
      .where('paidAt', '>=', since)
      .orderBy('paidAt', 'asc')
      .limit(RECONCILE_MAX_RECORDS)
      .get();
    this.warnIfTruncated('orderCharges', snap.size);
    return snap.docs.flatMap((doc: any): ReconcileTarget[] => {
      const charge = doc.data() as Record<string, unknown>;
      if (charge['status'] !== 'PAID') return [];
      if (typeof charge['portonePaymentId'] !== 'string') return [];
      return [
        {
          kind: 'charge',
          chargeId: doc.id,
          portonePaymentId: charge['portonePaymentId'],
          charge,
        },
      ];
    });
  }

  private async reconcileTarget(
    target: ReconcileTarget,
  ): Promise<'skipped' | 'paid' | 'recorded' | 'lookup_failed'> {
    if (target.kind === 'order') return this.reconcileOrderPayment(target);
    return this.reconcileCharge(target);
  }

  private async reconcileOrderPayment(
    target: Extract<ReconcileTarget, { kind: 'order' }>,
  ): Promise<'skipped' | 'paid' | 'recorded' | 'lookup_failed'> {
    const orderSnap = await this.firestore.doc(`orders/${target.orderId}`).get();
    if (!orderSnap.exists) return 'skipped';
    const order = orderSnap.data() as Record<string, unknown>;
    const orderStatus = typeof order['status'] === 'string' ? order['status'] : null;
    // PENDING은 결제 정리 cron이, CANCELLED는 우리 쪽 취소·환불 흐름이 맡는다(웹훅 처리와 같은 기준).
    if (!orderStatus || orderStatus === 'PENDING' || orderStatus === 'CANCELLED') return 'skipped';
    if (isPaymentReversalOwnedLocally(order, target.payment)) return 'skipped';
    if (await this.hasExistingOrderIssue(target.orderId)) return 'skipped';

    const providerStatus = await this.lookupProviderStatus(target);
    if (providerStatus === null) return 'lookup_failed';
    if (providerStatus === 'PAID') return 'paid';

    const settlementSnap = await this.firestore.doc(`settlements/${target.orderId}`).get();
    const settlementStatus = settlementSnap.exists
      ? ((settlementSnap.data() as Record<string, unknown>)['status'] ?? null)
      : null;
    await this.issueWriter.createOrMergeIssue({
      storeId: String(order['storeId'] ?? ''),
      orderId: target.orderId,
      paymentId: target.orderId,
      type: PROVIDER_REVERSAL_ISSUE_TYPE,
      severity: 'critical',
      title: '결제사 쪽 결제 상태 변경 감지',
      message:
        '결제가 확정된 주문이 PortOne에서 더는 결제 완료 상태가 아닙니다. 정산 지급 전에 PortOne 콘솔에서 확인하세요.',
      idempotencyKey: `provider-reversal-reconcile:order:${target.orderId}`,
      latestSnapshot: {
        orderStatus,
        paymentStatus: 'PAID',
        providerStatus,
        providerEvent: RECONCILE_PROVIDER_EVENT,
        settlementStatus,
        failureStage: 'provider_reconcile',
      },
    });
    this.logger.warn(
      `[PaymentReconcile] 결제사 상태 변경 감지 orderId=${target.orderId} providerStatus=${providerStatus} orderStatus=${orderStatus}`,
    );
    return 'recorded';
  }

  private async reconcileCharge(
    target: Extract<ReconcileTarget, { kind: 'charge' }>,
  ): Promise<'skipped' | 'paid' | 'recorded' | 'lookup_failed'> {
    const { charge } = target;
    // 환불이 진행 중이거나 끝난 청구는 우리 쪽 환불 흐름이 소유한다.
    if (charge['refundClaim'] || charge['refundedAt']) return 'skipped';
    if (await this.hasExistingChargeIssue(target.chargeId)) return 'skipped';

    const providerStatus = await this.lookupProviderStatus(target);
    if (providerStatus === null) return 'lookup_failed';
    if (providerStatus === 'PAID') return 'paid';

    const orderId = typeof charge['orderId'] === 'string' ? charge['orderId'] : null;
    await this.issueWriter.createOrMergeIssue({
      storeId: String(charge['storeId'] ?? ''),
      orderId,
      paymentId: null,
      chargeId: target.chargeId,
      type: PROVIDER_REVERSAL_ISSUE_TYPE,
      severity: 'critical',
      title: '결제사 쪽 재배송비 결제 상태 변경 감지',
      message:
        '결제가 확정된 재배송비가 PortOne에서 더는 결제 완료 상태가 아닙니다. PortOne 콘솔에서 확인하세요.',
      idempotencyKey: `provider-reversal-reconcile:charge:${target.chargeId}`,
      latestSnapshot: {
        chargeStatus: 'PAID',
        providerStatus,
        providerEvent: RECONCILE_PROVIDER_EVENT,
        failureStage: 'provider_reconcile',
      },
    });
    this.logger.warn(
      `[PaymentReconcile] 결제사 재배송비 상태 변경 감지 chargeId=${target.chargeId} providerStatus=${providerStatus}`,
    );
    return 'recorded';
  }

  /** 같은 주문의 결제사 되돌림 기록(상태 무관)이 이미 있는지. 재배송비 기록은 따로 본다. */
  private async hasExistingOrderIssue(orderId: string): Promise<boolean> {
    const snap = await this.firestore
      .collection('operationIssues')
      .where('orderId', '==', orderId)
      .where('type', '==', PROVIDER_REVERSAL_ISSUE_TYPE)
      .limit(20)
      .get();
    return snap.docs.some((doc: any) => {
      const chargeId = (doc.data() as Record<string, unknown>)['chargeId'];
      return typeof chargeId !== 'string' || chargeId.length === 0;
    });
  }

  private async hasExistingChargeIssue(chargeId: string): Promise<boolean> {
    const snap = await this.firestore
      .collection('operationIssues')
      .where('chargeId', '==', chargeId)
      .where('type', '==', PROVIDER_REVERSAL_ISSUE_TYPE)
      .limit(1)
      .get();
    return !snap.empty;
  }

  /** PortOne 결제 상태. 조회하지 못하면 null(기록하지 않고 다음 회차에 다시 본다). */
  private async lookupProviderStatus(target: ReconcileTarget): Promise<string | null> {
    try {
      const paymentData = await this.portone.getPayment(target.portonePaymentId);
      return typeof paymentData.status === 'string' ? paymentData.status.slice(0, 40) : 'UNKNOWN';
    } catch (error) {
      const label =
        error instanceof PortoneError
          ? `status=${error.status} type=${error.type}`
          : 'networkError';
      this.logger.warn(`[PaymentReconcile] 결제 조회 실패 ${this.targetLabel(target)} ${label}`);
      return null;
    }
  }

  private warnIfTruncated(collection: string, size: number) {
    if (size >= RECONCILE_MAX_RECORDS) {
      this.logger.warn(
        `[PaymentReconcile] ${collection} 대상이 ${RECONCILE_MAX_RECORDS}건 상한에 닿아 나머지는 이번 회차에서 확인하지 않습니다.`,
      );
    }
  }

  private targetLabel(target: ReconcileTarget) {
    return target.kind === 'order' ? `orderId=${target.orderId}` : `chargeId=${target.chargeId}`;
  }

  private safeMessage(error: unknown) {
    return error instanceof Error
      ? error.message.replace(/[\r\n\t]/g, ' ').slice(0, 300)
      : 'unknown';
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
