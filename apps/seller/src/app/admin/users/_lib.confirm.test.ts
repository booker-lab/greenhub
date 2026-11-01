import { describe, expect, it } from 'vitest';
import { describeUserSuspendConfirm, EMPTY_FIELD, suspendActionLabel } from './_lib';

describe('소비자 정지 라벨', () => {
  it("⋮ 메뉴·확인창 라벨을 '정지' / '정지 풀기'로 맞춘다('복구' 없음)", () => {
    expect(suspendActionLabel(false)).toBe('정지');
    expect(suspendActionLabel(true)).toBe('정지 풀기');
  });
});

describe('소비자 정지 확인창', () => {
  it('정지 확인창은 제목 = 동작 + 대상, 대상 정보(이메일·연락처·가입일)를 보여 준다', () => {
    const confirm = describeUserSuspendConfirm({
      name: '홍길동',
      email: 'buyer@example.com',
      phone: '010-1234-5678',
      createdAt: '2026-10-01T03:00:00.000Z',
      currentlySuspended: false,
    });
    expect(confirm.title).toBe('홍길동 님 계정 정지');
    expect(confirm.facts).toEqual([
      { label: '이메일', value: 'buyer@example.com' },
      { label: '연락처', value: '010-1234-5678' },
      { label: '가입일', value: '2026-10-01' },
    ]);
    expect(confirm.confirmLabel).toBe('홍길동 님 정지');
  });

  it('정지 풀기 확인창은 같은 라벨(정지 풀기)을 쓴다', () => {
    const confirm = describeUserSuspendConfirm({
      name: '홍길동',
      email: 'buyer@example.com',
      currentlySuspended: true,
    });
    expect(confirm.title).toBe('홍길동 님 계정 정지 풀기');
    expect(confirm.confirmLabel).toBe('홍길동 님 정지 풀기');
  });

  it('이름·이메일이 비면 자리표시자를 보여 준다', () => {
    const confirm = describeUserSuspendConfirm({ name: ' ', email: '', currentlySuspended: false });
    expect(confirm.title).toBe('이름 없음 님 계정 정지');
    expect(confirm.facts).toEqual([{ label: '이메일', value: EMPTY_FIELD }]);
  });
});
