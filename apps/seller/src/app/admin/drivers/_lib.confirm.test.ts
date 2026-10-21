import { describe, expect, it } from 'vitest';
import { ACTION_META, describeDriverConfirm } from './_lib';

describe('드라이버 확인창 대상 표시', () => {
  it('이름·이메일과 액션별 질문을 보여 준다', () => {
    expect(
      describeDriverConfirm({
        name: '김기사',
        email: 'driver@example.com',
        action: 'suspend',
      }).split('\n'),
    ).toEqual(['김기사 (driver@example.com)', '이 드라이버를 정지하시겠습니까?']);
  });

  it('이메일이 없으면 이름만, 이름도 없으면 자리표시자를 보여 준다', () => {
    expect(describeDriverConfirm({ name: '김기사', email: null, action: 'approve' })).toBe(
      '김기사\n이 드라이버를 승인하시겠습니까?',
    );
    expect(describeDriverConfirm({ name: '', email: null, action: 'unsuspend' })).toBe(
      '이름 없음\n정지를 해제하시겠습니까?',
    );
  });

  it("정지 해제 버튼 라벨은 목록 버튼과 같은 '정지 해제'다", () => {
    expect(ACTION_META.unsuspend.confirmLabel).toBe('정지 해제');
  });
});
