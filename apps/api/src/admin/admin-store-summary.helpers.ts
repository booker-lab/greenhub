type FirestoreDoc = {
  data: () => Record<string, unknown>;
};

export type StoreSummaryBucket = Record<string, number>;

export function countByStatus(docs: FirestoreDoc[], statusKey = 'status'): StoreSummaryBucket {
  return docs.reduce<StoreSummaryBucket>((acc, doc) => {
    const status = String(doc.data()[statusKey] ?? 'unknown');
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
}

export function sumNumberField(docs: FirestoreDoc[], field: string): number {
  return docs.reduce((sum, doc) => {
    const value = doc.data()[field];
    return sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  }, 0);
}
