import { describe, expect, it } from 'vitest';
import { describeUserSuspendConfirm, EMPTY_FIELD, suspendActionLabel } from './_lib';

describe('소비자 정지 라벨', () => {
  it("버튼·확인창 라벨을 '정지' / '정지 해제'로 맞춘다('복구' 없음)", () => {
    expect(suspendActionLabel(false)).toBe('정지');
    expect(suspendActionLabel(true)).toBe('정지 해제');
  });
});

describe('소비자 정지 확인창', () => {
  it('정지 확인창은 이름·이메일과 정지 문구를 보여 준다', () => {
    const confirm = describeUserSuspendConfirm({
      name: '홍길동',
      email: 'buyer@example.com',
      currentlySuspended: false,
    });
    expect(confirm.title).toBe('계정 정지');
    expect(confirm.message.split('\n')).toEqual([
      '홍길동 (buyer@example.com)',
      '이 계정을 정지하시겠습니까?',
    ]);
    expect(confirm.confirmLabel).toBe('정지');
    expect(confirm.confirmColor).toBe('red');
  });

  it('정지 해제 확인창은 같은 라벨(정지 해제)을 쓴다', () => {
    const confirm = describeUserSuspendConfirm({
      name: '홍길동',
      email: 'buyer@example.com',
      currentlySuspended: true,
    });
    expect(confirm.title).toBe('계정 정지 해제');
    expect(confirm.message).toContain('홍길동 (buyer@example.com)');
    expect(confirm.confirmLabel).toBe('정지 해제');
  });

  it('이름·이메일이 비면 자리표시자를 보여 준다', () => {
    const confirm = describeUserSuspendConfirm({ name: ' ', email: '', currentlySuspended: false });
    expect(confirm.message.split('\n')[0]).toBe(`${EMPTY_FIELD} (${EMPTY_FIELD})`);
  });
});
