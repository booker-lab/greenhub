/**
 * 사진 업로드 대기열 저장소. 실행기·화면은 이 인터페이스만 쓰고, 브라우저는 IndexedDB,
 * 테스트는 메모리 구현을 쓴다.
 *
 * - 저장하는 값은 pending-photo-policy의 항목뿐이다(토큰·주소·받는 분 같은 개인정보는 넣지 않는다).
 * - 읽을 때 형식이 맞지 않는 항목은 버리고 지운다(fail-closed).
 * - IndexedDB가 막혀 있거나(사생활 보호 모드·저장소 차단) 실패해도 화면으로 예외를 던지지 않는다.
 *   읽기는 빈 값, 쓰기는 false로 돌려주고, 화면은 대기열 없이 예전 동작·예전 안내로 남는다.
 */

import {
  PENDING_PHOTO_DB_NAME,
  PENDING_PHOTO_DB_VERSION,
  PENDING_PHOTO_OBJECT_STORE,
  type PendingPhotoEntry,
  pendingPhotoKey,
  readPendingPhotoEntry,
} from './pending-photo-policy';

export interface PendingPhotoStore {
  /** 형식이 맞는 모든 항목(모든 사용자). 깨진 항목은 지운다. 읽지 못하면 []. */
  list(): Promise<PendingPhotoEntry[]>;
  get(key: string): Promise<PendingPhotoEntry | null>;
  /** 새 항목을 쓴다. 쓰지 못하면 false. */
  put(entry: PendingPhotoEntry): Promise<boolean>;
  /**
   * 항목이 있을 때만 한 거래(transaction) 안에서 바꾼다. mutate가 null이면 바꾸지 않는다.
   * 바꾼 항목, 없거나 바꾸지 않았거나 실패하면 null. (지운 항목을 되살리지 않는다.)
   */
  update(
    key: string,
    mutate: (current: PendingPhotoEntry) => PendingPhotoEntry | null,
  ): Promise<PendingPhotoEntry | null>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function pendingPhotoEntryKey(entry: Pick<PendingPhotoEntry, 'userId' | 'orderId'>): string {
  return pendingPhotoKey(entry.userId, entry.orderId);
}

/** 테스트용 메모리 저장소. 깨진 값도 그대로 넣어 볼 수 있게 raw로 둔다. */
export function createMemoryPendingPhotoStore(
  initial: Iterable<[string, unknown]> = [],
): PendingPhotoStore & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>(initial);
  const read = (key: string): PendingPhotoEntry | null => {
    if (!raw.has(key)) return null;
    const entry = readPendingPhotoEntry(raw.get(key), key);
    if (!entry) raw.delete(key);
    return entry;
  };
  return {
    raw,
    async list() {
      const entries: PendingPhotoEntry[] = [];
      for (const key of [...raw.keys()]) {
        const entry = read(key);
        if (entry) entries.push(entry);
      }
      return entries;
    },
    async get(key) {
      return read(key);
    },
    async put(entry) {
      const checked = readPendingPhotoEntry(entry);
      if (!checked) return false;
      raw.set(pendingPhotoEntryKey(checked), checked);
      return true;
    },
    async update(key, mutate) {
      const current = read(key);
      if (!current) return null;
      const next = mutate(current);
      if (!next) return null;
      const checked = readPendingPhotoEntry(next, key);
      if (!checked) return null;
      raw.set(key, checked);
      return checked;
    },
    async delete(key) {
      raw.delete(key);
    },
    async clear() {
      raw.clear();
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

/**
 * IndexedDB 저장소. factory를 얻지 못하면 null(대기열 없이 예전 동작).
 * 모든 동작은 예외를 삼키고 빈 값·false를 돌려준다.
 */
export function createIndexedDbPendingPhotoStore(factory: IDBFactory): PendingPhotoStore {
  let opening: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(PENDING_PHOTO_DB_NAME, PENDING_PHOTO_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PENDING_PHOTO_OBJECT_STORE)) {
          db.createObjectStore(PENDING_PHOTO_OBJECT_STORE);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // 다른 탭이 버전을 올리면 닫고 다음 동작에서 다시 연다.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        db.onclose = () => {
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB open blocked'));
    }).catch((cause: unknown) => {
      opening = null;
      throw cause;
    });
    return opening;
  };

  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> => {
    const db = await open();
    const transaction = db.transaction(PENDING_PHOTO_OBJECT_STORE, mode);
    const done = transactionDone(transaction);
    // 거래가 실패하면 run의 결과보다 실패를 먼저 알린다.
    done.catch(() => undefined);
    const result = await run(transaction.objectStore(PENDING_PHOTO_OBJECT_STORE));
    await done;
    return result;
  };

  return {
    async list() {
      try {
        const broken: IDBValidKey[] = [];
        const entries = await withStore('readonly', async (store) => {
          const [keys, values] = await Promise.all([
            requestResult(store.getAllKeys()),
            requestResult(store.getAll()),
          ]);
          const result: PendingPhotoEntry[] = [];
          keys.forEach((key, index) => {
            const entry = readPendingPhotoEntry(values[index], key);
            if (entry) result.push(entry);
            else broken.push(key);
          });
          return result;
        });
        if (broken.length > 0) {
          await withStore('readwrite', async (store) => {
            for (const key of broken) store.delete(key);
          }).catch(() => undefined);
        }
        return entries;
      } catch {
        return [];
      }
    },
    async get(key) {
      try {
        const value = await withStore('readonly', (store) => requestResult(store.get(key)));
        if (value === undefined) return null;
        const entry = readPendingPhotoEntry(value, key);
        if (!entry) {
          await withStore('readwrite', async (store) => {
            store.delete(key);
          }).catch(() => undefined);
        }
        return entry;
      } catch {
        return null;
      }
    },
    async put(entry) {
      const checked = readPendingPhotoEntry(entry);
      if (!checked) return false;
      try {
        await withStore('readwrite', async (store) => {
          store.put(checked, pendingPhotoEntryKey(checked));
        });
        return true;
      } catch {
        return false;
      }
    },
    async update(key, mutate) {
      try {
        return await withStore('readwrite', async (store) => {
          const value = await requestResult(store.get(key));
          if (value === undefined) return null;
          const current = readPendingPhotoEntry(value, key);
          if (!current) {
            store.delete(key);
            return null;
          }
          const next = mutate(current);
          if (!next) return null;
          const checked = readPendingPhotoEntry(next, key);
          if (!checked) return null;
          store.put(checked, key);
          return checked;
        });
      } catch {
        return null;
      }
    },
    async delete(key) {
      try {
        await withStore('readwrite', async (store) => {
          store.delete(key);
        });
      } catch {
        // 지우지 못하면 다음 실행·만료가 다시 정리한다.
      }
    },
    async clear() {
      try {
        await withStore('readwrite', async (store) => {
          store.clear();
        });
      } catch {
        // 지우지 못해도 로그아웃은 계속한다. 다른 사용자가 로그인하면 실행기가 다시 지운다.
      }
    },
  };
}
