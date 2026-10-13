import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { OpsAlertService } from '../ops-alerts/ops-alert.service';

export type OperationIssueRecord = Record<string, unknown> & {
  id: string;
  status: string;
  actions?: Record<string, unknown>[];
};

export type CreateOperationIssueInput = Record<string, unknown> & {
  idempotencyKey: string;
  latestSnapshot?: Record<string, unknown>;
};

export type OperationIssueTransaction = {
  get: (ref: ReturnType<FirestoreService['doc']>) => Promise<{ exists: boolean; data(): unknown }>;
  set: (ref: ReturnType<FirestoreService['doc']>, data: Record<string, unknown>) => void;
};

@Injectable()
export class OperationIssueWriterService {
  constructor(
    @Inject(FirestoreService)
    private readonly firestore: FirestoreService,
    @Optional() private readonly opsAlerts?: OpsAlertService,
  ) {}

  async createOrMergeIssue(
    input: CreateOperationIssueInput,
    transaction?: OperationIssueTransaction,
  ): Promise<OperationIssueRecord> {
    const issueId = this.issueId(input.idempotencyKey);
    const issueRef = this.firestore.doc(`operationIssues/${issueId}`);
    let result: OperationIssueRecord | null = null;
    let opened = false;

    const write = async (tx: OperationIssueTransaction) => {
      const existingSnap = await tx.get(issueRef);
      opened = !existingSnap.exists || (existingSnap.data() as OperationIssueRecord).status !== 'OPEN';
      const now = this.firestore.Timestamp.now();
      if (existingSnap.exists) {
        const existing = existingSnap.data() as OperationIssueRecord;
        const merged = {
          ...existing,
          ...input,
          id: issueId,
          status: 'OPEN',
          latestSnapshot: {
            ...this.snapshot(existing.latestSnapshot),
            ...this.snapshot(input.latestSnapshot),
          },
          actions: existing.actions ?? [],
          resolvedAt: null,
          createdAt: existing.createdAt ?? now,
          updatedAt: now,
        } as OperationIssueRecord;
        tx.set(issueRef, merged);
        result = merged;
        return;
      }

      const created = {
        ...input,
        id: issueId,
        status: 'OPEN',
        actions: [],
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      } as OperationIssueRecord;
      tx.set(issueRef, created);
      result = created;
    };

    if (transaction) await write(transaction);
    else await this.firestore.runTransaction(write);
    if (!result) throw new Error('운영 예외 저장 결과를 확인할 수 없습니다.');
    // 새로 열린(또는 해결 뒤 다시 열린) 기록만 알린다. 같은 기록이 매분 합쳐질 때는 보내지 않는다.
    // 호출자 트랜잭션 안의 기록은 커밋 여부를 여기서 알 수 없어 보내지 않는다.
    if (opened && !transaction) void this.alertOpened(result);
    return result;
  }

  private async alertOpened(issue: OperationIssueRecord) {
    if (!this.opsAlerts?.enabled) return;
    const severity = issue['severity'];
    if (severity !== 'critical' && severity !== 'warning') return;
    const title = typeof issue['title'] === 'string' ? issue['title'] : '운영 확인 필요';
    const message = typeof issue['message'] === 'string' ? issue['message'] : null;
    await this.opsAlerts.send({
      level: severity,
      title: `운영 확인: ${title}`,
      lines: [
        ...(message ? [message] : []),
        `유형 ${String(issue['type'] ?? '-')}`,
        '판매자 앱 > 홈 "운영 확인"에서 보고 주문 화면에서 처리하세요.',
      ],
      dedupeKey: `issue:${issue.id}`,
    });
  }

  private snapshot(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private issueId(idempotencyKey: string) {
    return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
  }
}
