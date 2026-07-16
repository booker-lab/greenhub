import { Inject, Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { StorageService } from '../firestore/storage.service';

type RetentionPurpose = 'DELIVERY_PHOTO' | 'MARKETING_CONSENT' | 'LEGAL_ORDER' | 'LEGAL_DISPUTE';

type RetentionMetadata = Record<string, unknown>;

interface StorageDeletionAdapter {
  deleteObject(path: string): Promise<void>;
}

interface RetentionPolicy {
  collection: string;
  expiresAt: (basisAt: Date) => Date;
}

interface RetentionDocumentSnapshot {
  data(): RetentionMetadata;
  ref: unknown;
}

interface RetentionQuerySnapshot {
  docs: RetentionDocumentSnapshot[];
  empty: boolean;
}

interface RetentionBatch {
  delete(ref: unknown): RetentionBatch;
  commit(): Promise<unknown>;
}

const RETENTION_POLICIES: Record<RetentionPurpose, RetentionPolicy> = {
  DELIVERY_PHOTO: {
    collection: 'deliveryPhotoRecords',
    expiresAt: (basisAt) => addUtcDays(basisAt, 90),
  },
  MARKETING_CONSENT: {
    collection: 'marketingConsentLogs',
    expiresAt: (basisAt) => addUtcYears(basisAt, 3),
  },
  LEGAL_ORDER: {
    collection: 'legalOrderRecords',
    expiresAt: (basisAt) => addUtcYears(basisAt, 5),
  },
  LEGAL_DISPUTE: {
    collection: 'legalDisputeRecords',
    expiresAt: (basisAt) => addUtcYears(basisAt, 3),
  },
};

const RETENTION_COLLECTIONS = Object.values(RETENTION_POLICIES).map(({ collection }) => collection);

function addUtcDays(value: Date, days: number): Date {
  const result = new Date(value.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function addUtcYears(value: Date, years: number): Date {
  const result = new Date(value.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

@Injectable()
export class RetentionService {
  constructor(
    private readonly firestore: FirestoreService,
    @Inject(StorageService)
    private readonly storage: StorageDeletionAdapter,
  ) {}

  async saveRecord(input: {
    id: string;
    purpose: RetentionPurpose;
    basisAt: Date;
    storagePath?: string;
    metadata?: RetentionMetadata;
  }): Promise<RetentionMetadata> {
    const policy = RETENTION_POLICIES[input.purpose];
    const expiresAt = this.firestore.Timestamp.fromDate(policy.expiresAt(input.basisAt));
    const data = {
      ...(input.metadata ?? {}),
      purpose: input.purpose,
      basisAt: this.firestore.Timestamp.fromDate(input.basisAt),
      expiresAt,
      ...(input.storagePath ? { storagePath: input.storagePath } : {}),
    };

    await this.firestore.doc(`${policy.collection}/${input.id}`).set(data);

    return {
      id: input.id,
      purpose: input.purpose,
      collection: policy.collection,
      expiresAt,
    };
  }

  async purgeExpiredRecords(input: { now: Date }): Promise<RetentionMetadata> {
    const now = this.firestore.Timestamp.fromDate(input.now);
    const expiredSnapshots = await Promise.all(
      RETENTION_COLLECTIONS.map(async (collection) => {
        const snapshot = (await this.firestore
          .collection(collection)
          .where('expiresAt', '<=', now)
          .get()) as RetentionQuerySnapshot;
        return { collection, snapshot };
      }),
    );
    const candidates = expiredSnapshots.flatMap(({ collection, snapshot }) =>
      snapshot.docs
        .filter((document) => this.canPurge(document.data()))
        .map((document) => ({ collection, document })),
    );

    if (candidates.length === 0) {
      return { deletedCount: 0, deletedByPurpose: {} };
    }

    for (const { document } of candidates) {
      const storagePath = document.data()['storagePath'];
      if (typeof storagePath === 'string' && storagePath.length > 0) {
        await this.storage.deleteObject(storagePath);
      }
    }

    const batch = this.createBatch();
    const deletedByPurpose: Record<string, number> = {};
    for (const { collection, document } of candidates) {
      batch.delete(document.ref);
      deletedByPurpose[collection] = (deletedByPurpose[collection] ?? 0) + 1;
    }
    await batch.commit();

    return {
      deletedCount: candidates.length,
      deletedByPurpose,
    };
  }

  private canPurge(data: RetentionMetadata): boolean {
    return data['disputeStatus'] !== 'OPEN' && data['legalHold'] !== true;
  }

  private createBatch(): RetentionBatch {
    const firestore = this.firestore as FirestoreService & {
      batch?: () => RetentionBatch;
    };
    if (typeof firestore.batch === 'function') {
      return firestore.batch();
    }
    return firestore.db.batch() as unknown as RetentionBatch;
  }
}
