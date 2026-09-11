// Canonical Firestore transaction/OCC test harness.
//
// Converges the divergent transaction semantics previously spread across API
// test fakes into one contract:
//
//   A. ISOLATION ......... transaction writes are staged; invisible to live
//                          state (and to other transactions) until commit.
//   B. READ VERSION ...... every transactional read records a doc version.
//   C. CONFLICT .......... commit aborts when a read doc changed underneath.
//   D. RETRY ............. aborted attempts retry the callback with fresh
//                          reads (deterministic, bounded; default 10).
//   E. ATOMIC COMMIT ..... conflict-free writes apply as one commit.
//   F. FAILURE ........... callback/commit failure leaves no partial writes.
//   G. DETERMINISM ....... interleaving is driven by explicit hooks plus a
//                          single setImmediate yield; no wall-clock timing.
//
// Deliberately NOT a full Firestore reimplementation: queries support the
// operators production code uses (==, <, <=, >, >=, in), FieldValue supports
// the increment sentinel shapes used in tests, and transaction.get supports
// document refs (primary production shape) plus collection queries.
//
// Concurrent runTransaction calls are NOT globally serialized: that is the
// point. Serial queues hide OCC races and turn concurrency specs
// false-green. Genuine single-owner convergence must emerge from
// read-version conflict + retry, which this harness models.

export type OccData = Record<string, unknown>;

export type OccDocumentRef = {
  readonly path: string;
  readonly id: string;
  get(): Promise<OccSnapshot>;
  set(data: OccData, options?: { merge?: boolean }): Promise<void>;
  update(data: OccData): Promise<void>;
  delete(): Promise<void>;
};

export type OccSnapshot = {
  readonly exists: boolean;
  readonly id: string;
  readonly ref: OccDocumentRef;
  data(): OccData | undefined;
};

export type OccQuerySnapshot = {
  readonly docs: OccSnapshot[];
  readonly empty: boolean;
  readonly size: number;
};

export type OccTransaction = {
  get(ref: OccDocumentRef): Promise<OccSnapshot>;
  get(query: { get(): Promise<OccQuerySnapshot> }): Promise<OccQuerySnapshot>;
  get(target: unknown): Promise<OccSnapshot | OccQuerySnapshot>;
  set(ref: OccDocumentRef, data: OccData, options?: { merge?: boolean }): void;
  update(ref: OccDocumentRef, data: OccData): void;
  delete(ref: OccDocumentRef): void;
};

export type OccWrite =
  | { kind: 'set'; path: string; data: OccData; merge?: boolean }
  | { kind: 'update'; path: string; data: OccData }
  | { kind: 'delete'; path: string };

export type OccCommitContext = {
  readonly attempt: number;
  readonly readPaths: string[];
  readonly writes: OccWrite[];
};

const DELETE_SENTINEL = Symbol('occ-deleted');

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as OccData).map(([key, item]) => [key, clone(item)]),
    ) as T;
  }
  return value;
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toDate?: () => Date })?.toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return value;
}

function incrementOf(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record['__op'] === 'increment' && typeof record['value'] === 'number') {
    return record['value'] as number;
  }
  if (typeof record['__increment'] === 'number') return record['__increment'] as number;
  return null;
}

function applyPatch(current: OccData, patch: OccData): OccData {
  const next = clone(current);
  for (const [path, rawValue] of Object.entries(patch)) {
    const keys = path.split('.');
    const leaf = keys.pop()!;
    let target = next;
    for (const key of keys) {
      const child = target[key];
      target[key] = child && typeof child === 'object' ? clone(child as OccData) : {};
      target = target[key] as OccData;
    }
    const increment = incrementOf(rawValue);
    target[leaf] =
      increment !== null ? Number(target[leaf] ?? 0) + increment : clone(rawValue);
  }
  return next;
}

function matches(data: OccData, filter: { field: string; operator: string; value: unknown }) {
  const actual = comparable(
    filter.field.split('.').reduce<unknown>((current, key) => (current as OccData)?.[key], data),
  );
  const expected = comparable(filter.value);
  if (filter.operator === '==') return actual === expected;
  if (filter.operator === '<=') return (actual as number) <= (expected as number);
  if (filter.operator === '<') return (actual as number) < (expected as number);
  if (filter.operator === '>=') return (actual as number) >= (expected as number);
  if (filter.operator === '>') return (actual as number) > (expected as number);
  if (filter.operator === 'in') return (expected as unknown[]).includes(actual);
  throw new Error(`지원하지 않는 쿼리 연산자입니다: ${filter.operator}`);
}

type Filter = { field: string; operator: string; value: unknown };

export function createOccFirestore(options: { maxAttempts?: number } = {}) {
  const maxAttempts = options.maxAttempts ?? 10;
  const documents = new Map<string, OccData>();
  const versions = new Map<string, number>();
  const references = new Map<string, OccDocumentRef>();
  let sequence = 0;
  let beforeAttempt: (() => Promise<void> | void) | undefined;
  let beforeCommit: ((context: OccCommitContext) => Promise<void> | void) | undefined;

  const readVersion = (path: string): number => versions.get(path) ?? 0;

  const snapshotFor = (path: string, source: Map<string, OccData>): OccSnapshot => {
    const ref = doc(path);
    const data = source.get(path);
    return {
      exists: data !== undefined,
      id: ref.id,
      ref,
      data: () => (data === undefined ? undefined : clone(data)),
    };
  };

  function doc(path: string): OccDocumentRef {
    const normalized = path.replace(/^\/|\/$/g, '');
    const existing = references.get(normalized);
    if (existing) return existing;
    const ref: OccDocumentRef = {
      path: normalized,
      id: normalized.split('/').at(-1)!,
      get: async () => snapshotFor(normalized, documents),
      set: async (data, setOptions) => {
        const current = documents.get(normalized);
        documents.set(
          normalized,
          setOptions?.merge && current ? applyPatch(current, data) : applyPatch({}, data),
        );
        versions.set(normalized, readVersion(normalized) + 1);
      },
      update: async (data) => {
        const current = documents.get(normalized);
        if (!current) throw new Error(`존재하지 않는 문서입니다: ${normalized}`);
        documents.set(normalized, applyPatch(current, data));
        versions.set(normalized, readVersion(normalized) + 1);
      },
      delete: async () => {
        documents.delete(normalized);
        versions.set(normalized, readVersion(normalized) + 1);
      },
    };
    references.set(normalized, ref);
    return ref;
  }

  const runQuery = (
    collectionPath: string,
    filters: Filter[],
    order?: { field: string; direction: 'asc' | 'desc' },
    maximum?: number,
  ): OccQuerySnapshot => {
    const prefix = `${collectionPath}/`;
    let entries = [...documents.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .filter(([, data]) => filters.every((filter) => matches(data, filter)));
    if (order) {
      entries.sort(([, left], [, right]) => {
        const a = comparable(
          order.field.split('.').reduce<unknown>((current, key) => (current as OccData)?.[key], left),
        );
        const b = comparable(
          order.field.split('.').reduce<unknown>((current, key) => (current as OccData)?.[key], right),
        );
        const result = a === b ? 0 : (a as number) < (b as number) ? -1 : 1;
        return order.direction === 'desc' ? -result : result;
      });
    }
    if (maximum !== undefined) entries = entries.slice(0, maximum);
    const docs = entries.map(([path]) => snapshotFor(path, documents));
    return { docs, empty: docs.length === 0, size: docs.length };
  };

  const query = (
    collectionPath: string,
    filters: Filter[] = [],
    order?: { field: string; direction: 'asc' | 'desc' },
    maximum?: number,
  ): any => ({
    where: (field: string, operator: string, value: unknown) =>
      query(collectionPath, [...filters, { field, operator, value }], order, maximum),
    orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') =>
      query(collectionPath, filters, { field, direction }, maximum),
    limit: (value: number) => query(collectionPath, filters, order, value),
    get: async () => runQuery(collectionPath, filters, order, maximum),
  });

  async function runTransaction<T>(callback: (transaction: OccTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (beforeAttempt) {
        const hook = beforeAttempt;
        beforeAttempt = undefined;
        await hook();
      }

      const readVersions = new Map<string, number>();
      const writes: OccWrite[] = [];
      // Read-your-writes within one attempt: staged overlay on top of live.
      const staged = new Map<string, OccData | typeof DELETE_SENTINEL>();

      const readLive = (path: string): OccData | undefined => {
        if (staged.has(path)) {
          const pending = staged.get(path);
          return pending === DELETE_SENTINEL ? undefined : clone(pending as OccData);
        }
        const data = documents.get(path);
        return data ? clone(data) : undefined;
      };

      const transaction: OccTransaction = {
        get: (async (target: unknown) => {
          // Collection query inside a transaction: record a version for
          // every document observed so later writes to them conflict.
          if (target && typeof target === 'object' && !('path' in (target as object))) {
            const snapshot = await (target as { get(): Promise<OccQuerySnapshot> }).get();
            for (const item of snapshot.docs) {
              if (!readVersions.has(item.ref.path)) {
                readVersions.set(item.ref.path, readVersion(item.ref.path));
              }
            }
            return snapshot;
          }
          const ref = target as OccDocumentRef;
          if (!readVersions.has(ref.path)) readVersions.set(ref.path, readVersion(ref.path));
          const data = readLive(ref.path);
          return {
            exists: data !== undefined,
            id: ref.path.split('/').at(-1)!,
            ref: doc(ref.path),
            data: () => (data === undefined ? undefined : clone(data)),
          } satisfies OccSnapshot;
        }) as OccTransaction['get'],
        set: (ref, data, setOptions) => {
          const base = setOptions?.merge ? (readLive(ref.path) ?? {}) : {};
          staged.set(ref.path, applyPatch(base, clone(data)));
          writes.push({ kind: 'set', path: ref.path, data: clone(data), merge: setOptions?.merge });
        },
        update: (ref, data) => {
          const base = readLive(ref.path);
          if (!base) throw new Error(`존재하지 않는 문서입니다: ${ref.path}`);
          staged.set(ref.path, applyPatch(base, clone(data)));
          writes.push({ kind: 'update', path: ref.path, data: clone(data) });
        },
        delete: (ref) => {
          staged.set(ref.path, DELETE_SENTINEL);
          writes.push({ kind: 'delete', path: ref.path });
        },
      };

      const result = await callback(transaction);

      // Deterministic interleaving point: lets a concurrent transaction's
      // callback run before this attempt validates and commits. No timers.
      await new Promise<void>((resolve) => setImmediate(resolve));

      if (beforeCommit) {
        const hook = beforeCommit;
        beforeCommit = undefined;
        await hook({ attempt, readPaths: [...readVersions.keys()], writes: writes.map(clone) });
      }

      const conflicted = [...readVersions.entries()].some(
        ([path, version]) => readVersion(path) !== version,
      );
      if (conflicted) continue;

      // Atomic commit: validate against a scratch copy first so a failing
      // write (e.g. update of a missing doc) commits nothing.
      const scratch = new Map(documents);
      for (const write of writes) {
        if (write.kind === 'set') {
          const base = write.merge ? (scratch.get(write.path) ?? {}) : {};
          scratch.set(write.path, applyPatch(base, write.data));
          continue;
        }
        if (write.kind === 'update') {
          const current = scratch.get(write.path);
          if (!current) throw new Error(`존재하지 않는 문서입니다: ${write.path}`);
          scratch.set(write.path, applyPatch(current, write.data));
          continue;
        }
        scratch.delete(write.path);
      }
      documents.clear();
      for (const [path, data] of scratch) documents.set(path, data);
      for (const write of writes) versions.set(write.path, readVersion(write.path) + 1);
      return result;
    }
    throw new Error('transaction retry limit exceeded');
  }

  const firestore = {
    doc,
    collection: (path: string) => ({
      ...query(path),
      doc: (id = `auto-${(sequence += 1)}`) => doc(`${path}/${id}`),
      add: async (data: OccData) => {
        const ref = doc(`${path}/auto-${(sequence += 1)}`);
        documents.set(ref.path, applyPatch({}, data));
        versions.set(ref.path, readVersion(ref.path) + 1);
        return ref;
      },
    }),
    runTransaction,
    Timestamp: {
      now: () => new Date(),
      fromDate: (value: Date) => new Date(value.getTime()),
    },
    FieldValue: {
      increment: (value: number) => ({ __op: 'increment', value }),
    },
  };

  return {
    firestore,
    seed: (path: string, data: OccData) => {
      const normalized = path.replace(/^\/|\/$/g, '');
      documents.set(normalized, clone(data));
      if (!versions.has(normalized)) versions.set(normalized, 0);
    },
    updateOutsideTransaction: (path: string, data: OccData) => {
      const normalized = path.replace(/^\/|\/$/g, '');
      const current = documents.get(normalized);
      if (!current) throw new Error(`존재하지 않는 문서입니다: ${normalized}`);
      documents.set(normalized, applyPatch(current, data));
      versions.set(normalized, readVersion(normalized) + 1);
    },
    deleteOutsideTransaction: (path: string) => {
      const normalized = path.replace(/^\/|\/$/g, '');
      documents.delete(normalized);
      versions.set(normalized, readVersion(normalized) + 1);
    },
    setBeforeAttempt: (hook: (() => Promise<void> | void) | undefined) => {
      beforeAttempt = hook;
    },
    setBeforeCommit: (
      hook: ((context: OccCommitContext) => Promise<void> | void) | undefined,
    ) => {
      beforeCommit = hook;
    },
    clearHooks: () => {
      beforeAttempt = undefined;
      beforeCommit = undefined;
    },
    getData: (path: string): OccData | undefined => {
      const data = documents.get(path.replace(/^\/|\/$/g, ''));
      return data ? clone(data) : undefined;
    },
    getVersion: (path: string): number => readVersion(path.replace(/^\/|\/$/g, '')),
    listData: (prefix: string): OccData[] =>
      [...documents.entries()]
        .filter(([path]) => path.startsWith(prefix))
        .map(([, data]) => clone(data)),
  };
}

export type OccFirestore = ReturnType<typeof createOccFirestore>;
