// 단위 테스트용 메모리 Firestore. 문서 경로 → 데이터 Map 하나로 doc/collection/트랜잭션을 흉내 낸다.
// 실제 Firestore처럼 트랜잭션 안에서 쓰기를 시작한 뒤의 읽기를 거부한다.
// where는 == 조건만 지원한다. 하위 컬렉션(a/b/c)은 정확한 경로로만 읽는다.

type RecordData = Record<string, any>;

function snap(id: string, data: RecordData | undefined) {
  return { id, exists: data !== undefined, data: () => data };
}

export function createMemoryFirestore(initial: Record<string, RecordData> = {}) {
  const records = new Map<string, RecordData>(Object.entries(initial));
  const lastSegment = (path: string) => path.split('/').pop() ?? path;

  const doc = (path: string) => ({
    path,
    id: lastSegment(path),
    get: async () => snap(lastSegment(path), records.get(path)),
    set: async (data: RecordData, options?: { merge?: boolean }) => {
      records.set(path, options?.merge ? { ...(records.get(path) ?? {}), ...data } : data);
    },
    update: async (data: RecordData) => {
      if (!records.has(path)) throw new Error(`update: 문서 없음 ${path}`);
      records.set(path, { ...records.get(path)!, ...data });
    },
    delete: async () => {
      records.delete(path);
    },
  });

  const collection = (name: string) => {
    const depth = name.split('/').length + 1;
    const filters: Array<[string, unknown]> = [];
    const query = {
      where(field: string, _op: string, value: unknown) {
        filters.push([field, value]);
        return query;
      },
      limit() {
        return query;
      },
      async get() {
        const docs = Array.from(records.entries())
          .filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === depth)
          .filter(([, data]) => filters.every(([field, value]) => data[field] === value))
          .map(([path, data]) => snap(lastSegment(path), data));
        return { docs, empty: docs.length === 0, size: docs.length };
      },
    };
    return query;
  };

  const runTransaction = async <T>(callback: (tx: any) => Promise<T>): Promise<T> => {
    const pending = new Map<string, RecordData | undefined>();
    let wrote = false;
    const read = (path: string) => (pending.has(path) ? pending.get(path) : records.get(path));
    const tx = {
      get: async (ref: { path?: string; get: () => Promise<unknown> }) => {
        if (wrote) throw new Error('Firestore transactions require all reads before all writes');
        return typeof ref.path === 'string'
          ? snap(lastSegment(ref.path), read(ref.path))
          : ref.get();
      },
      set: (ref: { path: string }, data: RecordData, options?: { merge?: boolean }) => {
        wrote = true;
        pending.set(ref.path, options?.merge ? { ...(read(ref.path) ?? {}), ...data } : data);
      },
      create: (ref: { path: string }, data: RecordData) => {
        wrote = true;
        if (read(ref.path) !== undefined) throw new Error(`create: 이미 있음 ${ref.path}`);
        pending.set(ref.path, data);
      },
      update: (ref: { path: string }, data: RecordData) => {
        wrote = true;
        if (read(ref.path) === undefined) throw new Error(`update: 문서 없음 ${ref.path}`);
        pending.set(ref.path, { ...(read(ref.path) ?? {}), ...data });
      },
      delete: (ref: { path: string }) => {
        wrote = true;
        pending.set(ref.path, undefined);
      },
    };
    const value = await callback(tx);
    for (const [path, data] of pending) {
      if (data === undefined) records.delete(path);
      else records.set(path, data);
    }
    return value;
  };

  let clock = Date.parse('2026-10-15T01:00:00.000Z');
  const firestore = {
    doc,
    collection,
    runTransaction,
    Timestamp: {
      now: () => {
        clock += 1000;
        const date = new Date(clock);
        return { toDate: () => date, toMillis: () => date.getTime() };
      },
    },
    FieldValue: { serverTimestamp: () => new Date(clock) },
  };
  return { firestore, records };
}
