import { describe, expect, it } from 'vitest';
import {
  APPLY_NOTICE,
  applyStateForFailure,
  initialApplyFormValues,
  readApplyFormValues,
} from './apply-form';

function formData(entries: Array<[string, string]>) {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
}

describe('가입 신청 폼 읽기', () => {
  it('여러 요일과 동의 체크를 읽는다', () => {
    expect(
      readApplyFormValues(
        formData([
          ['realName', '김기사'],
          ['phone', '010-1234-5678'],
          ['vehicleType', 'van'],
          ['availableDays', 'mon'],
          ['availableDays', 'sat'],
          ['availableArea', '이천시'],
          ['consent', 'agree'],
        ]),
      ),
    ).toEqual({
      realName: '김기사',
      phone: '010-1234-5678',
      vehicleType: 'van',
      availableDays: ['mon', 'sat'],
      availableArea: '이천시',
      consent: true,
    });
  });

  it('빈 폼은 빈 값과 동의 안 함으로 읽는다', () => {
    expect(readApplyFormValues(formData([]))).toEqual({
      realName: '',
      phone: '',
      vehicleType: '',
      availableDays: [],
      availableArea: '',
      consent: false,
    });
  });
});

describe('가입 신청 폼 처음 값', () => {
  it('신청 전에는 실명 처음 값만 채운다', () => {
    expect(initialApplyFormValues(null, '김기사')).toMatchObject({
      realName: '김기사',
      phone: '',
      consent: false,
    });
  });

  it('낸 신청을 고칠 때는 저장 값을 채우되 동의는 다시 체크하게 비운다', () => {
    expect(
      initialApplyFormValues(
        {
          realName: '김기사',
          phone: '01012345678',
          vehicleType: 'truck',
          availableDays: ['sun'],
          availableArea: null,
          consentVersion: 'v',
          consentedAt: '2026-11-13T00:00:00.000Z',
          status: 'submitted',
          revision: 2,
          submittedAt: '2026-11-13T00:00:00.000Z',
          updatedAt: '2026-11-13T00:00:00.000Z',
        },
        '무시',
      ),
    ).toEqual({
      realName: '김기사',
      phone: '01012345678',
      vehicleType: 'truck',
      availableDays: ['sun'],
      availableArea: '',
      consent: false,
    });
  });
});

describe('가입 신청 결과 안내', () => {
  const values = initialApplyFormValues(null, '');

  it('API 거절을 화면 상태로 바꾼다', () => {
    expect(applyStateForFailure('expired', values)).toEqual({ kind: 'expired' });
    expect(applyStateForFailure('not-allowed', values)).toEqual({ kind: 'not-allowed' });
    expect(applyStateForFailure('revision-limit', values)).toEqual({ kind: 'revision-limit' });
    expect(applyStateForFailure('failed', values)).toEqual({
      kind: 'editing',
      values,
      errors: {},
      failure: 'failed',
    });
  });

  it('접수 안내는 승인 뒤 다시 로그인과 운영팀 연락처를 알린다', () => {
    expect(APPLY_NOTICE.submitted.title).toBe('신청이 접수됐어요');
    expect(APPLY_NOTICE.submitted.body).toBe('관리자가 승인하면 다시 로그인해 주세요.');
    expect(APPLY_NOTICE.submitted.showOpsContact).toBe(true);
  });

  it('안내 문구는 해요체이고 영어 코드·내부 용어를 쓰지 않는다', () => {
    for (const notice of Object.values(APPLY_NOTICE)) {
      expect(`${notice.title}${notice.body}`).not.toMatch(/[A-Za-z]|서버|토큰|티켓/);
      expect(notice.body).toMatch(/(요|세요)\.$/);
    }
  });
});
