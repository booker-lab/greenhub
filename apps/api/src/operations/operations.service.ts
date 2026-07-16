import { createHash } from 'node:crypto';
import {
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import type { OperationActionType } from './dto/operation-action.dto';

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

type FirestoreTransaction = {
  get: (ref: ReturnType<FirestoreService['doc']>) => Promise<{ exists: boolean; data(): unknown }>;
  set: (ref: ReturnType<FirestoreService['doc']>, data: Record<string, unknown>) => void;
};

type ExecuteActionInput = {
  issueId: string;
  actorId: string;
  actionType: OperationActionType;
};

@Injectable()
export class OperationsService {
  constructor(
    @Inject(FirestoreService)
    private readonly firestore: FirestoreService,
    @Inject(forwardRef(() => PaymentsService))
    private readonly payments: PaymentsService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notifications: NotificationsService,
  ) {}

  async createOrMergeIssue(
    input: CreateIssueInput,
    transaction?: FirestoreTransaction,
  ): Promise<OperationIssue> {
    const issueId = this.issueId(input.idempotencyKey);
    const issueRef = this.firestore.doc(`operationIssues/${issueId}`);
    let result: OperationIssue | null = null;

    const createOrRead = async (tx: FirestoreTransaction) => {
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
    };

    if (transaction) {
      await createOrRead(transaction);
    } else {
      await this.firestore.runTransaction(createOrRead);
    }

    return result!;
  }

  async listIssuesForStore(
    storeId: string,
    requesterId: string,
    role: string,
  ): Promise<{ items: Record<string, unknown>[] }> {
    await this.assertStoreAccess(storeId, requesterId, role);
    const snap = await this.firestore
      .collection('operationIssues')
      .where('storeId', '==', storeId)
      .get();
    return { items: snap.docs.map((doc) => this.toSafeResponse(doc.data() as OperationIssue)) };
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
      })),
    };
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

  private issueId(idempotencyKey: string) {
    return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
  }
}
