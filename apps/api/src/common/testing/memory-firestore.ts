// 단위 테스트용 메모리 Firestore. 문서 경로 → 데이터 Map 하나로 doc/collection/트랜잭션을 흉내 낸다.
// 실제 Firestore처럼 트랜잭션 안에서 쓰기를 시작한 뒤의 읽기를 거부한다.
// where는 == 조건만 지원한다. 하위 컬렉션(a/b/c)은 정확한 경로로만 읽는다.
// 실제 firebase-admin(ignoreUndefinedProperties 기본 false)처럼 set/update/create에 들어온
// undefined 값(최상위·중첩 객체·배열 원소)을 필드 경로와 함께 거부한다.

type RecordData = Record<string, any>;

// 실제 SDK의 필드 경로 표기: 식별자 모양이 아닌 키(배열 인덱스 포함)는 백틱으로 감싼다.
const SIMPLE_FIELD_NAME = /^[_a-zA-Z][_a-zA-Z0-9]*$/;

function formatFieldName(key: string): string {
  if (SIMPLE_FIELD_NAME.test(key)) return key;
  return `\`${key.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 일반 객체와 배열만 따라 들어간다. Timestamp·Date·FieldValue(sentinel) 같은 클래스 인스턴스는 값 하나로 본다.
function assertNoUndefined(value: unknown, path: string[]): void {
  if (value === undefined) {
    throw new Error(
      `Cannot use "undefined" as a Firestore value (found in field "${path.join('.')}").`,
    );
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      assertNoUndefined(item, [...path, formatFieldName(String(index))]);
    }
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, field] of Object.entries(value)) {
    assertNoUndefined(field, [...path, formatFieldName(key)]);
  }
}

function validateWriteData(data: RecordData): void {
  for (const [key, field] of Object.entries(data)) assertNoUndefined(field, [formatFieldName(key)]);
}

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
      validateWriteData(data);
      records.set(path, options?.merge ? { ...(records.get(path) ?? {}), ...data } : data);
    },
    update: async (data: RecordData) => {
      validateWriteData(data);
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
        validateWriteData(data);
        wrote = true;
        pending.set(ref.path, options?.merge ? { ...(read(ref.path) ?? {}), ...data } : data);
      },
      create: (ref: { path: string }, data: RecordData) => {
        validateWriteData(data);
        wrote = true;
        if (read(ref.path) !== undefined) throw new Error(`create: 이미 있음 ${ref.path}`);
        pending.set(ref.path, data);
      },
      update: (ref: { path: string }, data: RecordData) => {
        validateWriteData(data);
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
