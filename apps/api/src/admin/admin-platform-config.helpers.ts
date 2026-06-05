const PLATFORM_CONFIG_PATH = 'platform/config';
const DEFAULT_COMMISSION_RATE = 0;

type FirestoreLike = {
  doc: (path: string) => {
    get: () => Promise<{ exists: boolean; data?: () => Record<string, unknown> | undefined }>;
    set: (data: Record<string, unknown>, options: { merge: boolean }) => Promise<unknown>;
  };
  Timestamp: { now: () => unknown };
};

function normalizeRate(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_COMMISSION_RATE;
}

export async function getDefaultCommissionRate(firestore: FirestoreLike): Promise<number> {
  const snap = await firestore.doc(PLATFORM_CONFIG_PATH).get();
  if (!snap.exists) return DEFAULT_COMMISSION_RATE;
  return normalizeRate(snap.data?.()?.defaultCommissionRate);
}

export async function setDefaultCommissionRate(
  firestore: FirestoreLike,
  rate: number,
): Promise<{ defaultCommissionRate: number }> {
  await firestore.doc(PLATFORM_CONFIG_PATH).set(
    {
      defaultCommissionRate: rate,
      updatedAt: firestore.Timestamp.now(),
    },
    { merge: true },
  );
  return { defaultCommissionRate: rate };
}
