import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';

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
  ) {}

  async createOrMergeIssue(
    input: CreateOperationIssueInput,
    transaction?: OperationIssueTransaction,
  ): Promise<OperationIssueRecord> {
    const issueId = this.issueId(input.idempotencyKey);
    const issueRef = this.firestore.doc(`operationIssues/${issueId}`);
    let result: OperationIssueRecord | null = null;

    const write = async (tx: OperationIssueTransaction) => {
      const existingSnap = await tx.get(issueRef);
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
    return result;
  }

  private snapshot(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private issueId(idempotencyKey: string) {
    return createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 32);
  }
}
