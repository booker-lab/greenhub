import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import {
  OPERATION_ISSUE_LIST_DEFAULT_LIMIT,
  OPERATION_ISSUE_LIST_MAX_LIMIT,
  OPERATION_ISSUE_LIST_SCAN_LIMIT,
} from './dto/list-operation-issues.dto';
import type { OperationActionType } from './dto/operation-action.dto';
import {
  type CreateOperationIssueInput,
  type OperationIssueTransaction,
  OperationIssueWriterService,
} from './operation-issue-writer.service';

type OperationIssue = Record<string, unknown> & {
  id: string;
  orderId?: string | null;
  paymentId?: string | null;
  status: string;
  actions?: OperationAction[];
};

type OperationAction = {
  actorId: string;
  actionType: string;
  performedAt: unknown;
  status: 'SUCCEEDED' | 'FAILED';
  failureReason?: string;
  failureCode?: string;
};

type ExecuteActionInput = {
  issueId: string;
  actorId: string;
  actionType: OperationActionType;
};

type ActionFailure = { resolved: false; failureCode: string; failureReason: string };

// resolved는 조치 결과를 권위 있는 상태에서 확인했을 때만 true다.
type ActionOutcome = { resolved: true } | ActionFailure;

export type ListOperationIssuesOptions = {
  // 쿼리 문자열이 그대로 오는 경로도 있어 숫자·문자열을 모두 받는다.
  limit?: number | string;
  orderId?: string;
};

const REFUND_RETRY_REASON = '운영 예외 환불 재시도';

@Injectable()
export class OperationsService {
  constructor(
    @Inject(FirestoreService)
    private readonly firestore: FirestoreService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly payments: PaymentsService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications: NotificationsService,
    @Optional()
    private readonly issueWriter?: OperationIssueWriterService,
  ) {}

  async createOrMergeIssue(
    input: CreateOperationIssueInput,
    transaction?: OperationIssueTransaction,
  ): Promise<OperationIssue> {
    const writer = this.issueWriter ?? new OperationIssueWriterService(this.firestore);
    return (await writer.createOrMergeIssue(input, transaction)) as OperationIssue;
  }

  async listIssuesForStore(
    storeId: string,
    requesterId: string,
    role: string,
    options: ListOperationIssuesOptions = {},
  ): Promise<{ items: Record<string, unknown>[]; hasMore: boolean }> {
    await this.assertStoreAccess(storeId, requesterId, role);
    const limit = this.resolveListLimit(options.limit);
    const byStore = this.firestore.collection('operationIssues').where('storeId', '==', storeId);
    const scoped = options.orderId ? byStore.where('orderId', '==', options.orderId) : byStore;
    // 동등 조건만 사용해 단일 필드 인덱스 병합으로 처리한다(복합 인덱스 불필요).
    // 정렬 조건 없는 조회는 문서 ID(해시) 순서라, 응답 한도만큼만 읽으면 임의의 기록이 남는다.
    // 그래서 훑기 상한까지 읽어 메모리에서 정렬한 뒤 한도만큼 돌려준다.
    // 열린 기록은 따로 읽어, 해결된 기록이 많아져도 미해결 기록이 범위 밖으로 밀려나지 않게 한다.
    const [openSnap, scopedSnap] = await Promise.all([
      scoped
        .where('status', '==', 'OPEN')
        .limit(OPERATION_ISSUE_LIST_SCAN_LIMIT)
        .get(),
      scoped.limit(OPERATION_ISSUE_LIST_SCAN_LIMIT).get(),
    ]);
    const byId = new Map<string, OperationIssue>();
    for (const doc of [...openSnap.docs, ...scopedSnap.docs]) {
      byId.set(doc.id, doc.data() as OperationIssue);
    }
    const sorted = [...byId.values()].sort((left, right) => this.compareIssues(left, right));
    return {
      items: sorted.slice(0, limit).map((issue) => this.toSafeResponse(issue)),
      hasMore: sorted.length > limit,
    };
  }

  async getIssueForStore(
    storeId: string,
    issueId: string,
    requesterId: string,
    role: string,
  ): Promise<Record<string, unknown>> {
    const issue = await this.readAuthorizedIssue(storeId, issueId, requesterId, role);
    return this.toSafeResponse(issue);
  }

  async refreshIssueForStore(
    storeId: string,
    issueId: string,
    requesterId: string,
    role: string,
  ): Promise<Record<string, unknown>> {
    const issue = await this.readAuthorizedIssue(storeId, issueId, requesterId, role);
    const order = await this.readRelatedDocument('orders', issue.orderId);
    const payment = await this.readRelatedDocument('payments', issue.paymentId);
    return {
      ...this.toSafeResponse(issue),
      currentState: {
        orderStatus: this.safeStatus(order?.['status']),
        paymentStatus: this.safeStatus(payment?.['status']),
      },
    };
  }

  async executeActionForStore(
    storeId: string,
    issueId: string,
    requesterId: string,
    role: string,
    actionType: OperationActionType,
  ): Promise<Record<string, unknown>> {
    await this.readAuthorizedIssue(storeId, issueId, requesterId, role);
    const result = await this.executeAction({
      issueId,
      actorId: requesterId,
      actionType,
    });
    return this.toSafeResponse(result);
  }

  async executeAction(input: ExecuteActionInput): Promise<OperationIssue> {
    const issueRef = this.firestore.doc(`operationIssues/${input.issueId}`);
    const issueSnap = await issueRef.get();
    if (!issueSnap.exists) {
      throw new NotFoundException('운영 예외를 찾을 수 없습니다.');
    }

    const issue = issueSnap.data() as OperationIssue;
    this.assertActionAllowed(issue, input.actionType);
    const order = await this.readRelatedDocument('orders', issue.orderId);

    if (issue.status !== 'OPEN') return issue;

    if (input.actionType === 'RETRY_REFUND') {
      const payment = await this.readRelatedDocument('payments', issue.paymentId);
      if (!this.refundTargetFailure(issue, payment) && this.isRefunded(payment)) {
        return this.recordSuccess(issueRef, issue, input, true);
      }
      const claim = await this.claimAction(input);
      if (!claim) return issue;
      return this.runAction(issueRef, issue, input, () => this.retryRefund(issue, payment), claim);
    }

    if (this.noLongerNeedsNotice(order)) return issue;
    const claim = await this.claimAction(input);
    if (!claim) return issue;
    return this.runAction(
      issueRef,
      issue,
      input,
      async () => {
        const notifications = this.notifications as unknown as {
          resendSms: (issue: OperationIssue) => Promise<unknown>;
        };
        await notifications.resendSms(issue);
        return { resolved: true };
      },
      claim,
    );
  }

  /**
   * 기존 환불 경로를 부른 뒤 결제 문서를 다시 읽어 환불 완료를 확인한다.
   * 환불 경로는 아무 일도 하지 않고 정상 종료할 수 있다(결제 없음, 다른 시도가 처리 중,
   * PAID가 아닌 상태 등). 그래서 호출 성공만으로는 해결로 보지 않는다.
   */
  private async retryRefund(
    issue: OperationIssue,
    payment: Record<string, unknown> | null,
  ): Promise<ActionOutcome> {
    // 기록이 가리키는 결제가 이 주문의 결제가 아니면 주문 결제를 환불하지 않는다.
    const targetFailure = this.refundTargetFailure(issue, payment);
    if (targetFailure) return targetFailure;
    await this.payments.processRefundByOrderId(String(issue.orderId), REFUND_RETRY_REASON);
    const fresh = await this.readRelatedDocument('payments', issue.paymentId);
    const freshTargetFailure = this.refundTargetFailure(issue, fresh);
    if (freshTargetFailure) return freshTargetFailure;
    if (this.isRefunded(fresh)) return { resolved: true };
    if (fresh?.['refundClaim']) {
      return {
        resolved: false,
        failureCode: 'REFUND_PENDING',
        failureReason: '환불 처리가 아직 끝나지 않았습니다. 잠시 후 결제 상태를 다시 확인하세요.',
      };
    }
    return {
      resolved: false,
      failureCode: 'REFUND_NOT_CONFIRMED',
      failureReason: `환불 완료를 확인하지 못했습니다(결제 상태 ${this.safeStatus(fresh?.['status']) ?? '알 수 없음'}).`,
    };
  }

  private refundTargetFailure(
    issue: OperationIssue,
    payment: Record<string, unknown> | null,
  ): ActionFailure | null {
    if (!payment) {
      return {
        resolved: false,
        failureCode: 'PAYMENT_NOT_FOUND',
        failureReason: '이 기록의 결제를 찾을 수 없어 환불을 진행하지 않았습니다.',
      };
    }
    if (!issue.orderId || payment['orderId'] !== issue.orderId) {
      return {
        resolved: false,
        failureCode: 'PAYMENT_ORDER_MISMATCH',
        failureReason: '이 기록의 결제가 주문 결제와 일치하지 않아 환불을 진행하지 않았습니다.',
      };
    }
    return null;
  }

  private async runAction(
    issueRef: ReturnType<FirestoreService['doc']>,
    issue: OperationIssue,
    input: ExecuteActionInput,
    action: () => Promise<ActionOutcome>,
    claimToken: string,
  ) {
    const confirmed = await this.confirmActionClaim(issueRef, claimToken);
    if (!confirmed) return issue;
    let failure: ActionFailure;
    try {
      const outcome = await action();
      if (outcome.resolved) {
        return await this.recordSuccess(issueRef, issue, input, true, claimToken);
      }
      failure = outcome;
    } catch (error) {
      await this.recordFailure(issueRef, input, claimToken, {
        failureCode: this.failureCode(error),
        failureReason: this.safeFailureReason(error),
      });
      throw error;
    }
    // 조치는 끝났지만 결과를 확인하지 못했다. 기록은 OPEN으로 두고 시도와 원인만 남긴다.
    await this.recordFailure(issueRef, input, claimToken, failure);
    throw new ConflictException(failure.failureReason);
  }

  private async recordFailure(
    issueRef: ReturnType<FirestoreService['doc']>,
    input: ExecuteActionInput,
    claimToken: string,
    failure: Pick<ActionFailure, 'failureCode' | 'failureReason'>,
  ) {
    await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(issueRef);
      if (!snap.exists) return null;
      const fresh = snap.data() as OperationIssue;
      const current = fresh['actionClaim'] as { token?: unknown } | null | undefined;
      if (current?.token !== claimToken) return null;
      const performedAt = this.firestore.Timestamp.now();
      const failedAction: OperationAction = {
        actorId: input.actorId,
        actionType: input.actionType,
        performedAt,
        status: 'FAILED',
        failureReason: failure.failureReason,
        failureCode: failure.failureCode,
      };
      tx.update(issueRef, {
        actions: [...(fresh.actions ?? []), failedAction],
        actionClaim: null,
        updatedAt: performedAt,
      });
      return null;
    });
  }

  private async confirmActionClaim(
    issueRef: ReturnType<FirestoreService['doc']>,
    claimToken: string,
  ): Promise<boolean> {
    return this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(issueRef);
      if (!snap.exists) return false;
      const fresh = snap.data() as OperationIssue;
      const current = fresh['actionClaim'] as { token?: unknown } | null | undefined;
      return current?.token === claimToken;
    });
  }

  private async recordSuccess(
    issueRef: ReturnType<FirestoreService['doc']>,
    issue: OperationIssue,
    input: ExecuteActionInput,
    resolve: boolean,
    claimToken?: string,
  ) {
    void issue;
    const committed = await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(issueRef);
      if (!snap.exists) {
        throw new NotFoundException('운영 예외를 찾을 수 없습니다.');
      }
      const fresh = snap.data() as OperationIssue;
      if (claimToken !== undefined) {
        const current = fresh['actionClaim'] as { token?: unknown } | null | undefined;
        if (current?.token !== claimToken) {
          return fresh;
        }
      }
      const performedAt = this.firestore.Timestamp.now();
      const action: OperationAction = {
        actorId: input.actorId,
        actionType: input.actionType,
        performedAt,
        status: 'SUCCEEDED',
      };
      const nextActions = [...(fresh.actions ?? []), action];
      const nextStatus = resolve ? 'RESOLVED' : fresh.status;
      const nextResolvedAt = resolve
        ? performedAt
        : ((fresh as Record<string, unknown>)['resolvedAt'] ?? null);
      const patch: Record<string, unknown> = {
        actions: nextActions,
        status: nextStatus,
        resolvedAt: nextResolvedAt,
        updatedAt: performedAt,
      };
      if (claimToken !== undefined) {
        patch['actionClaim'] = null;
      }
      tx.update(issueRef, patch);
      return {
        ...fresh,
        actions: nextActions,
        status: nextStatus,
        resolvedAt: nextResolvedAt,
        ...(claimToken !== undefined ? { actionClaim: null } : {}),
        updatedAt: performedAt,
      } as OperationIssue;
    });
    return committed;
  }

  private async readRelatedDocument(collection: string, id: string | null | undefined) {
    if (!id) return null;
    const snap = await this.firestore.doc(`${collection}/${id}`).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  }

  private async readAuthorizedIssue(
    storeId: string,
    issueId: string,
    requesterId: string,
    role: string,
  ): Promise<OperationIssue> {
    await this.assertStoreAccess(storeId, requesterId, role);
    const snap = await this.firestore.doc(`operationIssues/${issueId}`).get();
    const issue = snap.exists ? (snap.data() as OperationIssue) : null;
    if (!issue || issue['storeId'] !== storeId) {
      throw new NotFoundException('운영 예외를 찾을 수 없습니다.');
    }
    return issue;
  }

  private async assertStoreAccess(storeId: string, requesterId: string, role: string) {
    if (role === 'admin') return;
    const snap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!snap.exists || snap.data()?.['ownerId'] !== requesterId) {
      throw new ForbiddenException('권한이 없습니다.');
    }
  }

  private toSafeResponse(issue: OperationIssue): Record<string, unknown> {
    return {
      id: issue.id,
      storeId: issue['storeId'],
      orderId: issue.orderId ?? null,
      paymentId: issue.paymentId ?? null,
      type: issue['type'],
      severity: issue['severity'],
      status: issue.status,
      createdAt: issue['createdAt'],
      updatedAt: issue['updatedAt'],
      resolvedAt: issue['resolvedAt'] ?? null,
      latestSnapshot: this.safeSnapshot(issue['latestSnapshot']),
      actions: (issue.actions ?? []).map((action) => ({
        actorId: action.actorId,
        actionType: action.actionType,
        performedAt: action.performedAt,
        status: action.status,
        ...(action.failureReason ? { failureReason: action.failureReason } : {}),
        ...(action.failureCode ? { failureCode: action.failureCode } : {}),
      })),
    };
  }

  private resolveListLimit(value: unknown) {
    const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 1) {
      return OPERATION_ISSUE_LIST_DEFAULT_LIMIT;
    }
    return Math.min(parsed, OPERATION_ISSUE_LIST_MAX_LIMIT);
  }

  /** 열린 기록 → 열린 기록 중 critical → 최근 갱신 순. */
  private compareIssues(left: OperationIssue, right: OperationIssue) {
    const leftOpen = left.status === 'OPEN';
    const rightOpen = right.status === 'OPEN';
    if (leftOpen !== rightOpen) return leftOpen ? -1 : 1;
    if (leftOpen) {
      const leftCritical = left['severity'] === 'critical';
      const rightCritical = right['severity'] === 'critical';
      if (leftCritical !== rightCritical) return leftCritical ? -1 : 1;
    }
    const byUpdatedAt = this.timeValue(right['updatedAt']) - this.timeValue(left['updatedAt']);
    if (byUpdatedAt !== 0) return byUpdatedAt;
    return String(left.id).localeCompare(String(right.id));
  }

  private timeValue(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    if (value && typeof value === 'object') {
      const timestamp = value as { toMillis?: unknown; seconds?: unknown; _seconds?: unknown };
      if (typeof timestamp.toMillis === 'function') return Number(timestamp.toMillis());
      const seconds = timestamp.seconds ?? timestamp._seconds;
      if (typeof seconds === 'number') return seconds * 1000;
    }
    return 0;
  }

  private safeSnapshot(value: unknown) {
    const snapshot =
      value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
    if (!snapshot) return {};
    return {
      orderStatus: this.safeStatus(snapshot['orderStatus']),
      paymentStatus: this.safeStatus(snapshot['paymentStatus']),
      failureStage: this.safeStatus(snapshot['failureStage']),
      templateCode: this.safeStatus(snapshot['templateCode']),
    };
  }

  private safeStatus(value: unknown) {
    return typeof value === 'string' ? value.slice(0, 80) : null;
  }

  private isRefunded(payment: Record<string, unknown> | null) {
    return payment?.['status'] === 'REFUNDED' || payment?.['status'] === 'CANCELLED';
  }

  private noLongerNeedsNotice(order: Record<string, unknown> | null) {
    return order?.['status'] === 'DELIVERED' || order?.['status'] === 'CANCELLED';
  }

  private safeFailureReason(error: unknown) {
    const message = error instanceof Error ? error.message : '운영 조치 실패';
    if (/authorization|bearer|token|secret|phone|address|messageBody/i.test(message)) {
      return '외부 연동 오류';
    }
    return message.replace(/[\r\n\t]/g, ' ').slice(0, 300);
  }

  /** 오류 클래스와(있으면) 제공자 오류 유형·코드만 남긴다. 메시지는 넣지 않는다. */
  private failureCode(error: unknown) {
    if (!(error instanceof Error)) return 'UNKNOWN_ERROR';
    const detail = error as { type?: unknown; code?: unknown };
    const kind =
      typeof detail.type === 'string'
        ? detail.type
        : typeof detail.code === 'string' || typeof detail.code === 'number'
          ? String(detail.code)
          : null;
    const name = error.name || 'Error';
    return (kind ? `${name}:${kind}` : name).replace(/[^A-Za-z0-9_:.-]/g, '_').slice(0, 80);
  }

  private assertActionAllowed(issue: OperationIssue, actionType: OperationActionType) {
    const allowed: Record<string, OperationActionType | undefined> = {
      AUTO_REFUND_FAILED: 'RETRY_REFUND',
      CUSTOMER_NOTICE_FAILED: 'RESEND_SMS',
    };
    if (allowed[String(issue['type'])] !== actionType) {
      throw new ForbiddenException('허용되지 않은 운영 조치입니다.');
    }
  }

  private async claimAction(input: ExecuteActionInput): Promise<string | null> {
    const issueRef = this.firestore.doc(`operationIssues/${input.issueId}`);
    const token = randomUUID();
    const committed = await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(issueRef);
      if (!snap.exists) return null;
      const fresh = snap.data() as OperationIssue;
      const current = fresh['actionClaim'] as { expiresAt?: number } | null | undefined;
      if (fresh.status !== 'OPEN' || (current?.expiresAt ?? 0) > Date.now()) return null;
      tx.update(issueRef, {
        actionClaim: { token, actionType: input.actionType, expiresAt: Date.now() + 300_000 },
        updatedAt: this.firestore.Timestamp.now(),
      });
      return token;
    });
    return committed ?? null;
  }
}
