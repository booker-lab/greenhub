import { describe, expect, it, vi } from 'vitest';
import {
  buildGroupConfigKey,
  buildGroupConfigMapFromEntries,
  dedupeGroupProductIds,
  fetchGroupConfigMap,
  GROUP_CONFIGS_ERROR_MESSAGE,
  isGroupConfigStale,
  nextGroupConfigRetryKey,
  normalizeGroupDeliveryDate,
  resolveGroupConfigMapAfterFailure,
  resolveGroupConfigView,
  shouldIgnoreGroupConfigResponse,
} from './useGroupConfigs.recovery';

describe('GroupConfigs auxiliary read — disabled → empty clean state (1)', () => {
  it('disabled면 key가 비어 조회 scope가 없다', () => {
    expect(buildGroupConfigKey(['p-1', 'p-2'], false)).toBe('');
    expect(buildGroupConfigKey([], false)).toBe('');
  });

  it('disabled/no-ids는 map/error/loading clean (DISABLED)', () => {
    expect(
      resolveGroupConfigView({ enabled: false, key: '', loading: false, error: null, hasLoaded: false }),
    ).toBe('DISABLED');
    expect(
      resolveGroupConfigView({ enabled: true, key: '', loading: false, error: null, hasLoaded: false }),
    ).toBe('DISABLED');
    expect(isGroupConfigStale(null, false)).toBe(false);
  });

  it('빈 productIds(enabled여도)는 fetch하지 않는다', () => {
    expect(buildGroupConfigKey([], true)).toBe('');
  });
});

describe('GroupConfigs auxiliary read — ids success (2)', () => {
  it('authoritative fetch 성공 결과를 그대로 map으로 사용한다', async () => {
    const map = await fetchGroupConfigMap(['p-1', 'p-2'], async (id) => `${id}-date`);
    expect(map).toEqual({
      'p-1': { groupDeliveryDate: 'p-1-date' },
      'p-2': { groupDeliveryDate: 'p-2-date' },
    });
  });

  it('성공 뒤 view는 READY다', () => {
    expect(
      resolveGroupConfigView({
        enabled: true,
        key: 'p-1|p-2',
        loading: false,
        error: null,
        hasLoaded: true,
      }),
    ).toBe('READY');
  });
});

describe('GroupConfigs auxiliary read — missing config document (3)', () => {
  it('문서 없음(null)은 map에서 제외하고 실패가 아니다', () => {
    const map = buildGroupConfigMapFromEntries([
      ['p-1', null],
      ['p-2', '2026-09-05T12:00:00'],
    ]);
    expect(map).toEqual({ 'p-2': { groupDeliveryDate: '2026-09-05T12:00:00' } });
  });

  it('전부 missing이어도 빈 map 성공(READY)이지 READ_FAILED가 아니다', async () => {
    const map = await fetchGroupConfigMap(['p-missing'], async () => null);
    expect(map).toEqual({});
    expect(
      resolveGroupConfigView({
        enabled: true,
        key: 'p-missing',
        loading: false,
        error: null,
        hasLoaded: true,
      }),
    ).toBe('READY');
  });
});

describe('GroupConfigs auxiliary read — one/multiple getDoc failure (4)', () => {
  it('하나의 getDoc 실패도 전체 보조 조회를 reject한다 (개별 missing과 구분)', async () => {
    await expect(
      fetchGroupConfigMap(['p-ok', 'p-bad'], async (id) => {
        if (id === 'p-bad') throw new Error('firestore boom');
        return '2026-09-05T12:00:00';
      }),
    ).rejects.toThrow('firestore boom');
  });

  it('여러 개 실패도 reject이며 빈 map으로 승격하지 않는다', async () => {
    await expect(
      fetchGroupConfigMap(['p-1', 'p-2'], async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow();
  });

  it('첫 조회 실패 view는 READ_FAILED이며 정상 empty가 아니다', () => {
    const view = resolveGroupConfigView({
      enabled: true,
      key: 'p-1',
      loading: false,
      error: GROUP_CONFIGS_ERROR_MESSAGE,
      hasLoaded: false,
    });
    expect(view).toBe('READ_FAILED');
    expect(view).not.toBe('READY');
  });
});

describe('GroupConfigs auxiliary read — failure → retry → success (5)', () => {
  it('실패 뒤 같은 scope retry가 성공하면 READY로 회복한다', async () => {
    let attempt = 0;
    const fetchOne = async (id: string): Promise<string | null> => {
      attempt += 1;
      if (attempt === 1) throw new Error('first boom');
      return `${id}-date`;
    };

    await expect(fetchGroupConfigMap(['p-1'], fetchOne)).rejects.toThrow('first boom');
    expect(
      resolveGroupConfigView({
        enabled: true,
        key: 'p-1',
        loading: false,
        error: GROUP_CONFIGS_ERROR_MESSAGE,
        hasLoaded: false,
      }),
    ).toBe('READ_FAILED');

    const recovered = await fetchGroupConfigMap(['p-1'], fetchOne);
    expect(recovered).toEqual({ 'p-1': { groupDeliveryDate: 'p-1-date' } });
    expect(
      resolveGroupConfigView({
        enabled: true,
        key: 'p-1',
        loading: false,
        error: null,
        hasLoaded: true,
      }),
    ).toBe('READY');
  });

  it('retry 키는 단조 증가하고 scope key와 독립이다', () => {
    const k1 = nextGroupConfigRetryKey(0);
    const k2 = nextGroupConfigRetryKey(k1);
    expect(k1).toBe(1);
    expect(k2).toBe(2);
    // retry가 scope를 바꾸지 않는다 — 같은 입력이면 같은 key.
    expect(buildGroupConfigKey(['p-1'], true)).toBe(buildGroupConfigKey(['p-1'], true));
  });
});

describe('GroupConfigs auxiliary read — failure does not erase core orders (6)', () => {
  it('실패 시 이전 map을 지우지 않는다 (EMPTY collapse 금지)', () => {
    const prev = { 'p-1': { groupDeliveryDate: '2026-09-05T12:00:00' } };
    expect(resolveGroupConfigMapAfterFailure(prev, true)).toBe(prev);
    expect(resolveGroupConfigMapAfterFailure(prev, true)).toEqual(prev);
  });

  it('첫 실패도 {}를 성공 empty로 승격하지 않는다 — error와 함께 다룬다', () => {
    const prev: Record<string, { groupDeliveryDate: string }> = {};
    const kept = resolveGroupConfigMapAfterFailure(prev, false);
    expect(kept).toEqual({});
    // map이 비어도 error가 있으면 READY/EMPTY가 아니다.
    expect(
      resolveGroupConfigView({
        enabled: true,
        key: 'p-1',
        loading: false,
        error: GROUP_CONFIGS_ERROR_MESSAGE,
        hasLoaded: false,
      }),
    ).toBe('READ_FAILED');
  });
});

describe('GroupConfigs auxiliary read — stale map policy (7)', () => {
  it('이전 성공 + 재조회 실패만 stale이다', () => {
    expect(isGroupConfigStale('boom', true)).toBe(true);
    expect(isGroupConfigStale('boom', false)).toBe(false);
    expect(isGroupConfigStale(null, true)).toBe(false);
    expect(isGroupConfigStale(null, false)).toBe(false);
  });

  it('stale view는 READY가 아니며 최신 확정값처럼 쓰지 않는다', () => {
    const view = resolveGroupConfigView({
      enabled: true,
      key: 'p-1',
      loading: false,
      error: GROUP_CONFIGS_ERROR_MESSAGE,
      hasLoaded: true,
    });
    expect(view).toBe('STALE');
    expect(view).not.toBe('READY');
    expect(view).not.toBe('READ_FAILED');
  });
});

describe('GroupConfigs auxiliary read — ids scope A→B stale 차단 (8)', () => {
  it('race guard는 취소·stale 응답을 무시하고 최신 응답만 허용한다', () => {
    expect(shouldIgnoreGroupConfigResponse(false, 2, 2)).toBe(true);
    expect(shouldIgnoreGroupConfigResponse(true, 2, 1)).toBe(true);
    expect(shouldIgnoreGroupConfigResponse(true, 1, 2)).toBe(true);
    expect(shouldIgnoreGroupConfigResponse(true, 2, 2)).toBe(false);
  });

  it('scope key가 다르면 이전 scope 응답을 버린다', () => {
    const keyA = buildGroupConfigKey(['p-a'], true);
    const keyB = buildGroupConfigKey(['p-b'], true);
    expect(keyA).not.toBe(keyB);
    // A의 늦은 응답(myId=1)이 B(current=2)를 덮지 않는다.
    expect(shouldIgnoreGroupConfigResponse(true, 2, 1)).toBe(true);
  });
});

describe('GroupConfigs auxiliary read — dedupe 유지 (9)', () => {
  it('중복 productId를 제거하고 정렬한다', () => {
    expect(dedupeGroupProductIds(['p-b', 'p-a', 'p-b', 'p-a'])).toEqual(['p-a', 'p-b']);
    expect(buildGroupConfigKey(['p-b', 'p-a', 'p-b'], true)).toBe('p-a|p-b');
    expect(buildGroupConfigKey(['p-a', 'p-b'], true)).toBe(
      buildGroupConfigKey(['p-b', 'p-a', 'p-b'], true),
    );
  });

  it('fetch는 unique id당 한 번만 호출한다', async () => {
    const fetchOne = vi.fn(async (id: string) => `${id}-date`);
    await fetchGroupConfigMap(['p-1', 'p-1', 'p-2'], fetchOne);
    expect(fetchOne).toHaveBeenCalledTimes(2);
    expect(fetchOne).toHaveBeenCalledWith('p-1');
    expect(fetchOne).toHaveBeenCalledWith('p-2');
  });
});

describe('GroupConfigs auxiliary read — timestamp → ISO normalization 유지 (10)', () => {
  it('Firestore Timestamp는 ISO 문자열로 정규화한다', () => {
    const date = new Date('2026-09-05T12:00:00.000Z');
    expect(normalizeGroupDeliveryDate({ toDate: () => date })).toBe('2026-09-05T12:00:00.000Z');
  });

  it('string은 그대로 사용한다', () => {
    expect(normalizeGroupDeliveryDate('2026-09-05T12:00:00')).toBe('2026-09-05T12:00:00');
  });

  it('null/undefined/number/toDate 없는 객체는 null이다', () => {
    expect(normalizeGroupDeliveryDate(null)).toBeNull();
    expect(normalizeGroupDeliveryDate(undefined)).toBeNull();
    expect(normalizeGroupDeliveryDate(123)).toBeNull();
    expect(normalizeGroupDeliveryDate({})).toBeNull();
    expect(normalizeGroupDeliveryDate({ toDate: 'not-fn' })).toBeNull();
  });

  it('toDate throw·invalid Date는 null이다', () => {
    expect(
      normalizeGroupDeliveryDate({
        toDate: () => {
          throw new Error('bad');
        },
      }),
    ).toBeNull();
    expect(
      normalizeGroupDeliveryDate({ toDate: () => new Date('invalid') }),
    ).toBeNull();
  });
});

describe('GroupConfigs auxiliary read — saleType toggle/filter 회귀 없음 (11)', () => {
  it('일반 토글(enabled=false)은 조회하지 않고 DISABLED다', () => {
    const key = buildGroupConfigKey(['p-1'], false);
    expect(key).toBe('');
    expect(
      resolveGroupConfigView({ enabled: false, key, loading: false, error: null, hasLoaded: false }),
    ).toBe('DISABLED');
  });

  it('공구 토글로 돌아오면 같은 scope key로 재조회한다', () => {
    expect(buildGroupConfigKey(['p-1', 'p-2'], true)).toBe('p-1|p-2');
  });

  it('retry는 saleType/tab/filter scope를 바꾸지 않는다', () => {
    const before = buildGroupConfigKey(['p-1'], true);
    const retryKey = nextGroupConfigRetryKey(0);
    expect(retryKey).toBe(1);
    expect(buildGroupConfigKey(['p-1'], true)).toBe(before);
  });
});
