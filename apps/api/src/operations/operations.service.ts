import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';

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
};

type CreateIssueInput = Record<string, unknown> & {
  idempotencyKey: string;
  latestSnapshot?: Record<string, unknown>;
};

type ExecuteActionInput = {
  issueId: string;
  actorId: string;
  actionType: 'RETRY_REFUND' | 'RESEND_SMS';
};

@Injectable()
export class OperationsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

  async createOrMergeIssue(input: CreateIssueInput): Promise<OperationIssue> {
    const issueId = this.issueId(input.idempotencyKey);
    const issueRef = this.firestore.doc(`operationIssues/${issueId}`);
    let result: OperationIssue | null = null;

    await this.firestore.runTransaction(async (tx) => {
      const existing = await tx.get(issueRef);
      if (existing.exists) {
        result = existing.data() as OperationIssue;
        return;
      }

      const now = this.firestore.Timestamp.now();
      const issue = {
        ...input,
        id: issueId,
        status: 'OPEN',
        actions: [],
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      } as OperationIssue;
      tx.set(issueRef, issue);
      result = issue;
    });

    return result!;
  }

  async executeAction(input: ExecuteActionInput): Promise<OperationIssue> {
    const issueRef = this.firestore.doc(`operationIssues/${input.issueId}`);
    const issueSnap = await issueRef.get();
    if (!issueSnap.exists) {
      throw new NotFoundException('운영 예외를 찾을 수 없습니다.');
    }

    const issue = issueSnap.data() as OperationIssue;
    const order = await this.readRelatedDocument('orders', issue.orderId);

    if (input.actionType === 'RETRY_REFUND') {
      const payment = await this.readRelatedDocument('payments', issue.paymentId);
      if (issue.status !== 'OPEN') return issue;
      if (this.isRefunded(payment)) {
        return this.recordSuccess(issueRef, issue, input, true);
      }
      return this.runAction(issueRef, issue, input, async () => {
        await this.payments.processRefundByOrderId(String(issue.orderId), '운영 예외 환불 재시도');
      });
    }

    if (issue.status !== 'OPEN' || this.noLongerNeedsNotice(order)) return issue;
    return this.runAction(issueRef, issue, input, async () => {
      const notifications = this.notifications as unknown as {
        resendSms: (issue: OperationIssue) => Promise<unknown>;
      };
      await notifications.resendSms(issue);
    });
  }

  private async runAction(
    issueRef: ReturnType<FirestoreService['doc']>,
    issue: OperationIssue,
    input: ExecuteActionInput,
    action: () => Promise<void>,
  ) {
    try {
      await action();
      return await this.recordSuccess(issueRef, issue, input, true);
    } catch (error) {
      const failedAction: OperationAction = {
        actorId: input.actorId,
        actionType: input.actionType,
        performedAt: this.firestore.Timestamp.now(),
        status: 'FAILED',
        failureReason: this.safeFailureReason(error),
      };
      const saved = {
        ...issue,
        actions: [...(issue.actions ?? []), failedAction],
        updatedAt: failedAction.performedAt,
      };
      await issueRef.update(saved);
      throw error;
    }
  }

  private async recordSuccess(
    issueRef: ReturnType<FirestoreService['doc']>,
    issue: OperationIssue,
    input: ExecuteActionInput,
    resolve: boolean,
  ) {
    const performedAt = this.firestore.Timestamp.now();
    const action: OperationAction = {
      actorId: input.actorId,
      actionType: input.actionType,
      performedAt,
      status: 'SUCCEEDED',
    };
    const saved = {
      ...issue,
      actions: [...(issue.actions ?? []), action],
      status: resolve ? 'RESOLVED' : issue.status,
      resolvedAt: resolve ? performedAt : null,
      updatedAt: performedAt,
    };
    await issueRef.update(saved);
    return saved;
  }

  private async readRelatedDocument(collection: string, id: string | null | undefined) {
    if (!id) return null;
    const snap = await this.firestore.doc(`${collection}/${id}`).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
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

  private issueId(idempotencyKey: string) {
    return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
  }
}
