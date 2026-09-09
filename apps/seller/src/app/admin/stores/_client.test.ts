import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAdminStoresReadState } from './_lib';

// AdminStoresClient는 '@/' alias를 사용하므로 vitest에서 직접 import할 수 없다.
// (seller vitest에는 tsconfig paths 매핑이 없어 '@/hooks/useAdmin' 해석이 실패한다.)
// 따라서 본 focused test는 _client.tsx 소스의 배선(wiring)을 고정하고,
// 실제 상태 분기는 순수 함수인 getAdminStoresReadState로 증명한다.
// READ-ONLY인 StoresTable/_lib의 기존 동작 자체는 각자의 focused test가 소유한다.

const source = readFileSync(new URL('./_client.tsx', import.meta.url), 'utf8');

const FETCH_ERROR_MESSAGE = '판매자 목록 조회 중 오류 발생';

describe('AdminStoresClient read-error recovery wiring', () => {
  it('useAdminStores의 error/reload를 소비한다', () => {
    expect(source).toContain('useAdminStores()');
    expect(source).toMatch(
      /const\s*\{\s*stores,\s*loading,\s*error,\s*reload,\s*setCommission,\s*archiveStore,\s*restoreStore\s*\}/,
    );
    expect(source).toContain('getAdminStoresReadState');
  });

  it('initial read failure → error state를 표시한다', () => {
    expect(
      getAdminStoresReadState({ loading: false, error: FETCH_ERROR_MESSAGE, stores: [], visible: [] }),
    ).toBe('FETCH_ERROR');
    expect(source).toContain('판매자 목록을 불러오지 못했습니다.');
    expect(source).toContain('{error}');
  });

  it('read failure ≠ unfiltered empty', () => {
    expect(
      getAdminStoresReadState({ loading: false, error: FETCH_ERROR_MESSAGE, stores: [], visible: [] }),
    ).toBe('FETCH_ERROR');
    expect(
      getAdminStoresReadState({ loading: false, error: null, stores: [], visible: [] }),
    ).toBe('EMPTY_UNFILTERED');
    // _client 자체가 빈 판매자 copy를 렌더하지 않는다 — 실패 표현은 error 분기가 소유한다.
    expect(source).not.toContain('등록된 판매자가 없습니다.');
    // 조회 실패에서는 0건 수로 표시하지 않는다.
    expect(source).toContain('error === null');
  });

  it('read failure ≠ filtered empty', () => {
    expect(
      getAdminStoresReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        stores: [{ id: 's1' }],
        visible: [],
      }),
    ).toBe('FETCH_ERROR');
    expect(
      getAdminStoresReadState({
        loading: false,
        error: null,
        stores: [{ id: 's1' }],
        visible: [],
      }),
    ).toBe('EMPTY_FILTERED');
    // 필터 결과 없음 copy도 _client가 중복 렌더하지 않는다(테이블이 성공 분기에서만 소유).
    expect(source).not.toContain('조건에 맞는 판매자가 없습니다.');
  });

  it('retry wiring을 보존한다(기존 reload 경로 재사용)', () => {
    // 기존 수동 reload UI 경로를 그대로 사용한다.
    expect(source).toContain('onReload={reload}');
    // 오류 상태의 명시적 재시도도 동일한 authoritative reload에 연결된다.
    expect(source).toContain('<Button onClick={reload}');
    expect(source).toContain('다시 조회');
    // 새 refresh 함수를 만들지 않는다.
    expect(source).not.toMatch(/const\s+(retry|refresh|refetch)\s*=/);
  });

  it('오류 상태에서도 filter/query state를 임의 초기화하지 않는다', () => {
    // Filters는 error 분기 밖에서 항상 유지된다.
    expect(source).toContain('<StoresFilters');
    expect(source.indexOf('<StoresFilters')).toBeLessThan(source.indexOf('isFetchError ?'));
    // 기존 query 동기화 경로를 유지한다.
    expect(source).toContain("searchParams.get('keyword')");
    expect(source).toContain('parseStatusFilter');
    expect(source).toContain('parseSort');
    expect(source).toContain('router.push');
    expect(source).toContain('onKeywordChange={(keyword) => updateView({ keyword })}');
    expect(source).toContain('onStatusChange={(status) => updateView({ status })}');
    expect(source).toContain('onSortChange={(sort) => updateView({ sort })}');
    // error 분기는 필터를 초기화하지 않는다.
    const errorBranch = source.slice(
      source.indexOf('isFetchError ?'),
      source.indexOf(': (', source.indexOf('isFetchError ?')),
    );
    expect(errorBranch).not.toContain('resetFilters');
    expect(errorBranch).not.toContain('setView');
    expect(errorBranch).not.toContain('updateView');
    // 기존 filterStores/sortStores/getEmptyKind 계약을 그대로 사용한다.
    expect(source).toContain('filterStores(stores,');
    expect(source).toContain('sortStores(filtered,');
    expect(source).toContain('getEmptyKind(stores, visible)');
    expect(source).toContain('onResetFilters={resetFilters}');
  });

  it('mutation controls 회귀가 없다', () => {
    // 수수료 변경 경로를 유지한다.
    expect(source).toContain('setCommission(storeId');
    expect(source).toContain('onSave={handleSave}');
    expect(source).toContain('onStartEdit={handleStartEdit}');
    expect(source).toContain('onCancelEdit={handleCancelEdit}');
    // archive/restore 경로와 기존 서버 오류 notification을 유지한다.
    expect(source).toContain('archiveStore(store.id)');
    expect(source).toContain('restoreStore(store.id)');
    expect(source).toContain('onArchive={handleArchive}');
    expect(source).toContain('onRestore={handleRestore}');
    expect(source).toContain('정리할 수 없습니다');
    expect(source).toContain('복구할 수 없습니다');
    // 성공 분기의 테이블 배선을 가로채지 않는다.
    expect(source).toContain('stores={visible}');
    expect(source).toContain('loading={loading}');
    expect(source).toContain('emptyKind={emptyKind}');
  });
});
