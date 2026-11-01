import { describe, expect, it } from 'vitest';
import { DRIVER_ACTION_LABEL, describeDriverConfirm } from './_lib';

describe('기사 확인창 내용', () => {
  it('제목은 동작 + 대상이고, 대상 정보에 이메일·연락처·신청일을 쓴다', () => {
    const confirm = describeDriverConfirm({
      name: '이대기',
      email: 'driver@example.com',
      phone: '010-1111-2222',
      createdAt: '2026-10-28T01:00:00.000Z',
      action: 'approve',
    });
    expect(confirm.title).toBe('이대기 님을 기사로 승인');
    expect(confirm.confirmLabel).toBe('이대기 님 승인');
    expect(confirm.lead).toContain('배송 목록');
    expect(confirm.facts).toEqual([
      { label: '이메일', value: 'driver@example.com' },
      { label: '연락처', value: '010-1111-2222' },
      { label: '신청일', value: '2026-10-28' },
    ]);
  });

  it('정지·정지 풀기는 같은 틀에 가입일을 쓰고, 값이 없는 줄은 뺀다', () => {
    const suspend = describeDriverConfirm({ name: '김기사', email: null, action: 'suspend' });
    expect(suspend.title).toBe('김기사 님 기사 정지');
    expect(suspend.confirmLabel).toBe('김기사 님 정지');
    expect(suspend.facts).toEqual([]);
    const unsuspend = describeDriverConfirm({ name: '', email: null, action: 'unsuspend' });
    expect(unsuspend.title).toBe('이름 없음 님 기사 정지 풀기');
  });

  it("⋮ 메뉴 '정지 풀기…'와 확인창·결과 알림이 같은 말을 쓴다", () => {
    expect(DRIVER_ACTION_LABEL.unsuspend).toBe('정지 풀기');
    expect(
      describeDriverConfirm({ name: '김기사', email: null, action: 'unsuspend' }).confirmLabel,
    ).toContain(DRIVER_ACTION_LABEL.unsuspend);
  });
});
