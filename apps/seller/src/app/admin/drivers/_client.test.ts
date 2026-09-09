import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filterByTab, getAdminDriversReadState } from './_lib';

// DriversClient는 '@/' alias를 사용하므로 vitest에서 직접 import할 수 없다.
// (seller vitest에는 tsconfig paths 매핑이 없어 '@/hooks/useAdmin' 해석이 실패한다.)
// 따라서 본 focused test는 _client.tsx 소스의 배선(wiring)을 고정하고,
// 실제 상태 분기는 순수 함수인 getAdminDriversReadState로 증명한다.
// READ-ONLY인 DriverList/_lib의 동작 자체는 각자의 focused test가 소유한다.

const source = readFileSync(new URL('./_client.tsx', import.meta.url), 'utf8');

const FETCH_ERROR_MESSAGE = '드라이버 목록 조회 중 오류 발생';

describe('DriversClient read recovery wiring', () => {
  it('useAdminDrivers의 error/reload를 소비한다', () => {
    expect(source).toContain('useAdminDrivers()');
    expect(source).toMatch(
      /const\s*\{\s*drivers:\s*allDrivers,\s*loading,\s*error,\s*reload,\s*approve,\s*toggleSuspend\s*\}/,
    );
  });

  it('error가 존재할 때 empty-only UI로 collapse되지 않는다', () => {
    // _client가 error를 list로 전달한다.
    expect(source).toContain('error={error}');
    // _client 자체가 빈 드라이버 copy로 collapse하지 않는다 — 실패 표현은 list가 소유한다.
    expect(source).not.toContain('드라이버가 없습니다.');
    // 전달된 error는 list 분기에서 EMPTY가 아닌 FETCH_ERROR가 된다.
    expect(
      getAdminDriversReadState({ loading: false, error: FETCH_ERROR_MESSAGE, drivers: [] }),
    ).toBe('FETCH_ERROR');
  });

  it('retry가 reload 경로를 사용하고 전체 페이지 reload를 사용하지 않는다', () => {
    expect(source).toContain('onRetry={reload}');
    expect(source).not.toContain('window.location');
    expect(source).not.toContain('다시 조회');
    expect(source).not.toContain('불러오지 못했습니다');
  });

  it('retry 시 현재 탭을 유지한다(reload가 tab 상태를 건드리지 않는다)', () => {
    // 탭 상태는 _client가 소유하고 retry(reload)는 tab setter를 호출하지 않는다.
    expect(source).toContain('useState<DriverStatus>');
    expect(source).toContain('setTab');
    expect(source).not.toMatch(/reload\(\);\s*\n?\s*setTab/);
    expect(source).not.toMatch(/onRetry=\{[^}]*setTab/);
    // 필터는 현재 탭 기준으로 그대로 유지된다.
    expect(source).toContain('filterByTab(allDrivers, tab)');
  });

  it('정상 목록 filter를 유지한다', () => {
    expect(source).toContain('STATUS_TABS');
    expect(source).toContain('filterByTab');
    expect(source).toContain('drivers={drivers}');
    expect(source).toContain('loading={loading}');
    // 성공+0건은 EMPTY로 유지되어야 한다.
    expect(getAdminDriversReadState({ loading: false, error: null, drivers: [] })).toBe('EMPTY');
    // 탭별 필터 semantics를 변경하지 않는다.
    const all = [
      { id: 'p', name: 'p', email: 'p@example.com', driverApproved: false, suspended: false, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'a', name: 'a', email: 'a@example.com', driverApproved: true, suspended: false, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 's', name: 's', email: 's@example.com', driverApproved: true, suspended: true, createdAt: '2026-09-01T00:00:00.000Z' },
    ];
    expect(filterByTab(all, 'pending').map((d) => d.id)).toEqual(['p']);
    expect(filterByTab(all, 'approved').map((d) => d.id)).toEqual(['a']);
    expect(filterByTab(all, 'suspended').map((d) => d.id)).toEqual(['s']);
    expect(filterByTab(all, 'all').map((d) => d.id)).toEqual(['p', 'a', 's']);
  });

  it('approve/suspend wiring을 유지한다', () => {
    expect(source).toContain('approve(pending.userId)');
    expect(source).toContain('toggleSuspend(pending.userId');
    expect(source).toContain('onAction={handleAction}');
    expect(source).toContain('processingId={processingId}');
    expect(source).toContain('<ConfirmModal');
    expect(source).toContain('ACTION_META');
  });
});
