import { describe, expect, it } from 'vitest';
import { DRIVER_ACTION_LABEL, describeDriverApplication, describeDriverConfirm } from './_lib';

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

const APPLICATION = {
  realName: '김신청',
  phone: '01012345678',
  vehicleType: 'motorcycle',
  availableDays: ['sun', 'wed'],
  availableArea: ' 이천시 ',
  consentVersion: 'driver-application-2026-11-13',
  consentedAt: '2026-11-13T01:00:00.000Z',
  status: 'submitted' as const,
  revision: 1,
  submittedAt: '2026-11-13T01:00:00.000Z',
  updatedAt: '2026-11-13T01:00:00.000Z',
};

describe('기사 가입 신청 요약', () => {
  it('휴대폰은 하이픈으로, 차량·요일은 한국어로, 시각은 한국 시간으로 보인다', () => {
    expect(describeDriverApplication(APPLICATION)).toEqual({
      realName: '김신청',
      phone: '010-1234-5678',
      vehicle: '오토바이',
      days: '수·일',
      area: '이천시',
      submittedAt: '2026-11-13 10:00',
      updatedAt: null,
    });
  });

  it('고친 신청은 마지막 수정 시각을 함께 보인다', () => {
    expect(
      describeDriverApplication({
        ...APPLICATION,
        revision: 3,
        updatedAt: '2026-11-14T02:30:00.000Z',
      })?.updatedAt,
    ).toBe('2026-11-14 11:30');
  });

  it('신청이 없으면 null', () => {
    expect(describeDriverApplication(null)).toBeNull();
    expect(describeDriverApplication(undefined)).toBeNull();
  });
});

describe('기사 승인 확인창의 가입 신청', () => {
  it('신청이 있으면 실명·휴대폰·차량·요일·지역을 대상 정보에 더한다', () => {
    const confirm = describeDriverConfirm({
      name: 'kakao-42',
      email: null,
      action: 'approve',
      application: APPLICATION,
    });
    expect(confirm.facts).toEqual([
      { label: '실명', value: '김신청' },
      { label: '휴대폰', value: '010-1234-5678' },
      { label: '차량 종류', value: '오토바이' },
      { label: '활동 요일', value: '수·일' },
      { label: '활동 지역', value: '이천시' },
    ]);
  });

  it('신청 정보가 없는 기존 대기 계정은 "신청 정보 없음"을 보이고 승인할 수 있다', () => {
    const confirm = describeDriverConfirm({
      name: '이대기',
      email: null,
      action: 'approve',
      application: null,
    });
    expect(confirm.facts).toEqual([{ label: '가입 신청', value: '신청 정보 없음' }]);
    expect(confirm.confirmLabel).toBe('이대기 님 승인');
  });
});
