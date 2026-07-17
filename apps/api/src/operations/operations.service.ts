import { randomUUID } from 'node:crypto';
import {
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
    this.assertActionAllowed(issue, input.actionType);
    const order = await this.readRelatedDocument('orders', issue.orderId);

    if (issue.status !== 'OPEN') return issue;

    if (input.actionType === 'RETRY_REFUND') {
      const payment = await this.readRelatedDocument('payments', issue.paymentId);
      if (this.isRefunded(payment)) {
        return this.recordSuccess(issueRef, issue, input, true);
      }
      const claim = await this.claimAction(input);
      if (!claim) return issue;
      return this.runAction(
        issueRef,
        issue,
        input,
        async () => {
          await this.payments.processRefundByOrderId(
            String(issue.orderId),
            '운영 예외 환불 재시도',
          );
        },
        claim,
      );
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
      },
      claim,
    );
  }

  private async runAction(
    issueRef: ReturnType<FirestoreService['doc']>,
    issue: OperationIssue,
    input: ExecuteActionInput,
    action: () => Promise<void>,
    claimToken: string,
  ) {
    try {
      await action();
      return await this.recordSuccess(issueRef, issue, input, true, claimToken);
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
        actionClaim: null,
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
    claimToken?: string,
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
      ...(claimToken ? { actionClaim: null } : {}),
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
    let claimed = false;
    await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(issueRef);
      if (!snap.exists) return;
      const fresh = snap.data() as OperationIssue;
      const current = fresh['actionClaim'] as { expiresAt?: number } | null | undefined;
      if (fresh.status !== 'OPEN' || (current?.expiresAt ?? 0) > Date.now()) return;
      tx.update(issueRef, {
        actionClaim: { token, actionType: input.actionType, expiresAt: Date.now() + 300_000 },
        updatedAt: this.firestore.Timestamp.now(),
      });
      claimed = true;
    });
    return claimed ? token : null;
  }
}
