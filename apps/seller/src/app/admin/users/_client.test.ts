import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// AdminUsersClient는 '@/' alias를 사용하므로 vitest에서 직접 import할 수 없다.
// 따라서 이 focused test는 화면의 read-state 분기와 기존 action 배선을 소스에서 고정한다.
const source = readFileSync(new URL('./_client.tsx', import.meta.url), 'utf8');

describe('AdminUsersClient 조회 실패/복구 배선', () => {
  it('useAdminUsers의 error/reload를 소비한다', () => {
    expect(source).toContain('useAdminUsers()');
    expect(source).toMatch(
      /const\s*\{\s*users,\s*loading,\s*error,\s*reload,\s*toggleSuspend\s*\}/,
    );
  });

  it('조회 실패 메시지와 명시적 retry를 표시한다', () => {
    expect(source).toContain('error !== null && !loading');
    expect(source).toContain('소비자 목록을 불러오지 못했습니다.');
    expect(source).toContain('{error}');
    expect(source).toContain('<Button onClick={reload}');
    expect(source).toContain('다시 조회');
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
    expect(source).toContain('({users.length})');
  });

  it('조회 실패를 빈 목록과 구분한다', () => {
    // 실패 분기는 UsersTable(성공 0건 경로)과 분리된 early return이다.
    const errorBranch = source.indexOf('error !== null && !loading');
    const tableUsage = source.indexOf('<UsersTable');
    expect(errorBranch).toBeGreaterThanOrEqual(0);
    expect(tableUsage).toBeGreaterThan(errorBranch);
  });

  it('기존 suspend 확인·처리 경로를 유지한다', () => {
    expect(source).toContain('const runPending = async () =>');
    expect(source).toContain('await toggleSuspend(pending.userId, !pending.currentlySuspended)');
    expect(source).toContain('setPending(null)');
    expect(source).toContain('opened={pending !== null}');
    expect(source).toContain('onConfirm={runPending}');
    expect(source).toContain("onToggle={handleToggle}");
  });
});
