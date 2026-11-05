import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// AdminUsersClient는 '@/' alias를 사용하므로 vitest에서 직접 import할 수 없다.
// 따라서 이 focused test는 화면의 read-state 분기와 기존 action 배선을 소스에서 고정한다.
const source = readFileSync(new URL('./_client.tsx', import.meta.url), 'utf8');
const listSource = readFileSync(new URL('../_components/adminList.tsx', import.meta.url), 'utf8');
const refreshSource = readFileSync(
  new URL('../_components/RefreshButton.tsx', import.meta.url),
  'utf8',
);

describe('AdminUsersClient 조회 실패/복구 배선', () => {
  it('useAdminUsers의 error/reload를 소비한다', () => {
    expect(source).toContain('useAdminUsers()');
    expect(source).toMatch(
      /const\s*\{\s*users,\s*loading,\s*error,\s*reload,\s*toggleSuspend\s*\}/,
    );
  });

  it('조회 실패 메시지와 명시적 retry를 표시한다', () => {
    // loading 분기가 먼저 early return하므로 error 분기는 loading이 아닐 때만 그려진다.
    expect(source).toContain('if (error !== null)');
    expect(source.indexOf('if (loading)')).toBeLessThan(source.indexOf('if (error !== null)'));
    expect(source).toContain('<AdminListError title="소비자 목록을 불러오지 못했습니다."');
    expect(source).toContain('error={error}');
    expect(source).toContain('onRetry={reload}');
    // 공통 AdminListError가 다시 조회 버튼을 onRetry에 연결한다.
    expect(listSource).toContain('<Button onClick={onRetry}');
    expect(listSource).toContain('다시 조회');
  });

  it('retry가 authoritative reload를 사용하고 우회하지 않는다', () => {
    expect(source).toContain('onClick={reload}');
    expect(source).not.toContain('window.location.reload');
    expect(source).not.toContain('setError');
    expect(source).not.toContain('setLoading');
  });

  it('loading/정상 목록 경로를 보존한다', () => {
    expect(source).toContain('불러오는 중...');
    expect(source).toContain('<UsersTable');
    expect(source).toContain('users={users}');
    expect(source).toMatch(/가입 \$\{users\.length\}명/);
  });

  it('정상 목록 헤더에 새로고침 버튼을 두고 hook reload를 재사용한다 (T2)', () => {
    // 새로고침 버튼은 머리(AdminPageHeader)의 action이고, 정상 목록 분기도 같은 머리를 표보다 먼저 그린다.
    expect(source).toContain('action={<RefreshButton loading={loading} onClick={reload} />}');
    expect(refreshSource).toContain('새로고침');
    const normalBranch = source.lastIndexOf('return (');
    const header = source.indexOf('{header}', normalBranch);
    expect(header).toBeGreaterThan(normalBranch);
    expect(header).toBeLessThan(source.indexOf('<UsersTable'));
  });

  it('조회 실패를 빈 목록과 구분한다', () => {
    // 실패 분기는 UsersTable(성공 0건 경로)과 분리된 early return이다.
    const errorBranch = source.indexOf('if (error !== null)');
    const tableUsage = source.indexOf('<UsersTable');
    expect(errorBranch).toBeGreaterThanOrEqual(0);
    expect(tableUsage).toBeGreaterThan(errorBranch);
  });

  it('기존 suspend 확인·처리 경로를 유지한다', () => {
    expect(source).toContain('const runPending = async () =>');
    expect(source).toMatch(
      /await toggleSuspend\(\s*pending\.userId,\s*!pending\.currentlySuspended,/,
    );
    expect(source).toContain('setPending(null)');
    expect(source).toContain('open={pending !== null}');
    expect(source).toContain('onConfirm={runPending}');
    expect(source).toContain('onToggle={handleToggle}');
  });
});
