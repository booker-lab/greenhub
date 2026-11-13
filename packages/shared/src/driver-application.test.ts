import { describe, expect, it } from 'vitest';
import {
  DRIVER_APPLICATION_CONSENT_VERSION,
  driverApplicationRealNamePrefill,
  formatDriverApplicationPhone,
  isValidDriverApplicationRealName,
  normalizeDriverApplicationPhone,
  sortDriverAvailableDays,
  validateDriverApplicationForm,
} from './driver-application.js';

const valid = {
  realName: ' 김기사 ',
  phone: '010-1234-5678',
  vehicleType: 'van',
  availableDays: ['sat', 'mon', 'mon'],
  availableArea: '  이천시 전역 ',
  consent: true,
};

describe('기사 가입 신청 휴대폰 번호', () => {
  it.each([
    ['010-1234-5678', '01012345678'],
    ['010 1234 5678', '01012345678'],
    ['01012345678', '01012345678'],
    ['+82 10-1234-5678', '01012345678'],
    ['(010) 1234.5678', '01012345678'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeDriverApplicationPhone(raw)).toBe(expected);
  });

  it.each(['011-1234-5678', '010-123-4567', '010-1234-56789', '02-123-4567', '010-1234-567a', ''])(
    '%s는 받지 않는다',
    (raw) => {
      expect(normalizeDriverApplicationPhone(raw)).toBeNull();
    },
  );

  it('화면 표기는 하이픈으로 나눈다', () => {
    expect(formatDriverApplicationPhone('01012345678')).toBe('010-1234-5678');
    expect(formatDriverApplicationPhone('legacy')).toBe('legacy');
  });
});

describe('기사 가입 신청 실명', () => {
  it.each(['김기', '김기사', 'Kim Gisa', '남궁 민수', "O'Neil", '가'.repeat(20)])(
    '%s는 받는다',
    (name) => {
      expect(isValidDriverApplicationRealName(name)).toBe(true);
    },
  );

  it.each(['김', '가'.repeat(21), ' 김기사', '김기사 ', '김기사1', 'kakao-123', '김\n기사', '김@사'])(
    '%s는 받지 않는다',
    (name) => {
      expect(isValidDriverApplicationRealName(name)).toBe(false);
    },
  );

  it('카카오 이름은 자동 생성 이름이 아니고 규칙에 맞을 때만 처음 값으로 쓴다', () => {
    expect(driverApplicationRealNamePrefill('김기사')).toBe('김기사');
    expect(driverApplicationRealNamePrefill('kakao-12345')).toBe('');
    expect(driverApplicationRealNamePrefill('KAKAO-12345')).toBe('');
    expect(driverApplicationRealNamePrefill('🌸꽃님')).toBe('');
    expect(driverApplicationRealNamePrefill(null)).toBe('');
  });
});

describe('기사 가입 신청 폼 검증', () => {
  it('통과하면 정규화한 값과 현재 동의 버전을 준다', () => {
    expect(validateDriverApplicationForm(valid)).toEqual({
      ok: true,
      input: {
        realName: '김기사',
        phone: '01012345678',
        vehicleType: 'van',
        availableDays: ['mon', 'sat'],
        availableArea: '이천시 전역',
        consent: true,
        consentVersion: DRIVER_APPLICATION_CONSENT_VERSION,
      },
    });
  });

  it('선택 칸이 비면 보내지 않는다', () => {
    const result = validateDriverApplicationForm({ ...valid, availableDays: [], availableArea: ' ' });
    expect(result.ok && result.input).toEqual({
      realName: '김기사',
      phone: '01012345678',
      vehicleType: 'van',
      consent: true,
      consentVersion: DRIVER_APPLICATION_CONSENT_VERSION,
    });
  });

  it('칸마다 안내 문구를 준다', () => {
    const result = validateDriverApplicationForm({
      realName: '',
      phone: '02-123-4567',
      vehicleType: 'bike',
      availableDays: ['holiday'],
      availableArea: '가'.repeat(101),
      consent: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ['availableArea', 'availableDays', 'consent', 'phone', 'realName', 'vehicleType'].sort(),
    );
    expect(result.errors.consent).toBe('개인정보 수집·이용에 동의해야 신청할 수 있어요.');
  });

  it('지역에 줄바꿈이 있으면 받지 않는다', () => {
    const result = validateDriverApplicationForm({ ...valid, availableArea: '이천\n여주' });
    expect(result.ok).toBe(false);
  });

  it('요일은 월~일 순서로 정렬하고 모르는 값은 버린다', () => {
    expect(sortDriverAvailableDays(['sun', 'x', 'wed', 'wed'])).toEqual(['wed', 'sun']);
  });
});
