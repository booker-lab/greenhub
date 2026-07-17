type Data = Record<string, any>;

type Increment = {
  readonly __op: 'increment';
  readonly value: number;
};

type DocumentRef = {
  readonly path: string;
  readonly id: string;
  get(): Promise<DocumentSnapshot>;
  set(data: Data, options?: { merge?: boolean }): Promise<void>;
  update(data: Data): Promise<void>;
  delete(): Promise<void>;
};

type DocumentSnapshot = {
  readonly exists: boolean;
  readonly id: string;
  readonly ref: DocumentRef;
  data(): Data | undefined;
};

type Filter = { field: string; operator: string; value: unknown };

function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(clone) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Data).map(([key, item]) => [key, clone(item)]),
    ) as T;
  }
  return value;
}

function fieldValue(data: Data, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((current, key) => (current as Data | undefined)?.[key], data);
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toDate?: () => Date })?.toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().getTime();
  }
  return value;
}

function matches(data: Data, filter: Filter): boolean {
  const actual = comparable(fieldValue(data, filter.field));
  const expected = comparable(filter.value);
  if (filter.operator === '==') return actual === expected;
  if (filter.operator === '<=') return (actual as number) <= (expected as number);
  if (filter.operator === '<') return (actual as number) < (expected as number);
  if (filter.operator === '>=') return (actual as number) >= (expected as number);
  if (filter.operator === '>') return (actual as number) > (expected as number);
  if (filter.operator === 'in') return (expected as unknown[]).includes(actual);
  throw new Error(`지원하지 않는 쿼리 연산자입니다: ${filter.operator}`);
}

function applyPatch(current: Data, patch: Data): Data {
  const next = clone(current);
  for (const [path, rawValue] of Object.entries(patch)) {
    const keys = path.split('.');
    const leaf = keys.pop()!;
    let target = next;
    for (const key of keys) {
      target[key] = clone(target[key] ?? {});
      target = target[key];
    }
    const value = rawValue as Increment;
    target[leaf] =
      value?.__op === 'increment' ? Number(target[leaf] ?? 0) + value.value : clone(rawValue);
  }
  return next;
}

export function createInMemoryFirestore(initial: Record<string, Data> = {}) {
  const records = new Map<string, Data>(
    Object.entries(initial).map(([path, data]) => [path, clone(data)]),
  );
  let sequence = 0;
  let transactionQueue = Promise.resolve();

  const snapshot = (ref: DocumentRef): DocumentSnapshot => ({
    exists: records.has(ref.path),
    id: ref.id,
    ref,
    data: () => {
      const data = records.get(ref.path);
      return data ? clone(data) : undefined;
    },
  });

  const writeSet = (ref: DocumentRef, data: Data, options?: { merge?: boolean }) => {
    const current = records.get(ref.path);
    records.set(
      ref.path,
      options?.merge && current ? applyPatch(current, data) : applyPatch({}, data),
    );
  };

  const writeUpdate = (ref: DocumentRef, data: Data) => {
    const current = records.get(ref.path);
    if (!current) throw new Error(`존재하지 않는 문서입니다: ${ref.path}`);
    records.set(ref.path, applyPatch(current, data));
  };

  const doc = (path: string): DocumentRef => {
    const normalized = path.replace(/^\/|\/$/g, '');
    const ref: DocumentRef = {
      path: normalized,
      id: normalized.split('/').at(-1)!,
      get: async () => snapshot(ref),
      set: async (data, options) => writeSet(ref, data, options),
      update: async (data) => writeUpdate(ref, data),
      delete: async () => {
        records.delete(normalized);
      },
    };
    return ref;
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
    get: async () => {
      const prefix = `${collectionPath}/`;
      let docs = [...records.entries()]
        .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
        .map(([path, data]) => ({ ref: doc(path), data }))
        .filter(({ data }) => filters.every((filter) => matches(data, filter)));
      if (order) {
        docs.sort((left, right) => {
          const a = comparable(fieldValue(left.data, order.field));
          const b = comparable(fieldValue(right.data, order.field));
          const result = a === b ? 0 : (a as number) < (b as number) ? -1 : 1;
          return order.direction === 'desc' ? -result : result;
        });
      }
      if (maximum !== undefined) docs = docs.slice(0, maximum);
      const snapshots = docs.map(({ ref }) => snapshot(ref));
      return { docs: snapshots, empty: snapshots.length === 0, size: snapshots.length };
    },
  });

  const firestore = {
    doc,
    collection: (path: string) => ({
      ...query(path),
      doc: (id = `auto-${++sequence}`) => doc(`${path}/${id}`),
      add: async (data: Data) => {
        const ref = doc(`${path}/auto-${++sequence}`);
        writeSet(ref, data);
        return ref;
      },
    }),
    runTransaction: async <T>(callback: (transaction: any) => Promise<T>): Promise<T> => {
      const previous = transactionQueue;
      let release!: () => void;
      transactionQueue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const staged = new Map(records);
      const transaction = {
        get: async (target: any) => {
          if (typeof target?.path === 'string') return snapshot(target);
          return target.get();
        },
        set: (ref: DocumentRef, data: Data, options?: { merge?: boolean }) =>
          writeSet(ref, data, options),
        update: (ref: DocumentRef, data: Data) => writeUpdate(ref, data),
        delete: (ref: DocumentRef) => records.delete(ref.path),
      };
      try {
        return await callback(transaction);
      } catch (error) {
        records.clear();
        for (const [path, data] of staged) records.set(path, data);
        throw error;
      } finally {
        release();
      }
    },
    batch: () => {
      const deletes: DocumentRef[] = [];
      return {
        delete(ref: DocumentRef) {
          deletes.push(ref);
          return this;
        },
        async commit() {
          deletes.forEach((ref) => {
            records.delete(ref.path);
          });
        },
      };
    },
    Timestamp: {
      now: () => new Date(),
      fromDate: (value: Date) => new Date(value.getTime()),
    },
    FieldValue: {
      increment: (value: number): Increment => ({ __op: 'increment', value }),
    },
  };

  return {
    firestore,
    records,
    read: (path: string) => clone(records.get(path)),
  };
}
