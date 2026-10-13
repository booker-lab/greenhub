import { describe, expect, it } from 'vitest';
import type { InviteToken } from '@/hooks/useAdmin';
import {
  describeInviteRevokeOutcome,
  getAdminInviteReadState,
  inviteStatus,
  parseInviteRecipientEmail,
} from './_lib';

const FETCH_ERROR_MESSAGE = '초대 토큰 조회 중 오류 발생';

function invite(id: string) {
  return { id };
}

describe('getAdminInviteReadState', () => {
  it('조회 중에는 LOADING을 반환한다', () => {
    expect(getAdminInviteReadState({ loading: true, error: null, invites: [] })).toBe('LOADING');
  });

  it('조회 실패 + 0건은 FETCH_ERROR를 반환한다(EMPTY collapse 방지)', () => {
    expect(
      getAdminInviteReadState({ loading: false, error: FETCH_ERROR_MESSAGE, invites: [] }),
    ).toBe('FETCH_ERROR');
  });

  it('성공 + 0건만 EMPTY를 반환한다', () => {
    expect(getAdminInviteReadState({ loading: false, error: null, invites: [] })).toBe('EMPTY');
  });

  it('성공 + 1건 이상은 HAS_RESULTS를 반환한다', () => {
    expect(getAdminInviteReadState({ loading: false, error: null, invites: [invite('i1')] })).toBe(
      'HAS_RESULTS',
    );
  });

  it('loading + error는 LOADING이 우선한다', () => {
    expect(
      getAdminInviteReadState({ loading: true, error: FETCH_ERROR_MESSAGE, invites: [] }),
    ).toBe('LOADING');
  });

  it('error는 결과 유무보다 우선한다', () => {
    expect(
      getAdminInviteReadState({
        loading: false,
        error: FETCH_ERROR_MESSAGE,
        invites: [invite('i1')],
      }),
    ).toBe('FETCH_ERROR');
  });
});

// 보안: 실제 토큰 원문이 아닌 구조 검증용 더미 식별자만 사용한다.
const NOW = new Date('2026-10-01T00:00:00.000Z');

function token(overrides: Partial<InviteToken> = {}): InviteToken {
  return {
    token: 'test-invite-aaa',
    createdBy: 'admin-test',
    usedAt: null,
    usedBy: null,
    expiresAt: '2026-10-08T00:00:00.000Z',
    createdAt: '2026-09-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('inviteStatus', () => {
  it('미사용·미만료·미취소 토큰은 유효이고 취소할 수 있다', () => {
    expect(inviteStatus(token(), NOW)).toMatchObject({
      label: '유효',
      color: 'brand',
      revocable: true,
    });
  });

  it('revokedAt 필드가 없는 기존 문서도 유효로 판정한다', () => {
    const legacy = token();
    expect('revokedAt' in legacy).toBe(false);
    expect(inviteStatus(legacy, NOW).label).toBe('유효');
  });

  it('revokedAt이 null이면 취소되지 않은 것으로 본다', () => {
    expect(inviteStatus(token({ revokedAt: null, revokedBy: null }), NOW).label).toBe('유효');
  });

  it('취소된 토큰은 취소됨으로 표시하고 취소 버튼 대상이 아니다', () => {
    expect(
      inviteStatus(token({ revokedAt: '2026-09-30T12:00:00.000Z', revokedBy: 'admin-test' }), NOW),
    ).toMatchObject({ label: '취소됨', color: 'orange', revocable: false });
  });

  it('취소가 만료보다 우선한다(서버 판정 순서와 동일)', () => {
    expect(
      inviteStatus(
        token({ revokedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-02T00:00:00.000Z' }),
        NOW,
      ).label,
    ).toBe('취소됨');
  });

  it('사용된 토큰은 사용됨이고 취소할 수 없다', () => {
    expect(
      inviteStatus(token({ usedAt: '2026-09-30T12:00:00.000Z', usedBy: 'seller-test' }), NOW),
    ).toMatchObject({ label: '사용됨', color: 'gray', revocable: false });
  });

  it('만료된 토큰은 만료이고 취소할 수 없다', () => {
    expect(inviteStatus(token({ expiresAt: '2026-09-30T00:00:00.000Z' }), NOW)).toMatchObject({
      label: '만료',
      color: 'red',
      revocable: false,
    });
  });

  it('만료일을 Date로 돌려준다', () => {
    expect(inviteStatus(token(), NOW).expDate?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(inviteStatus(token({ expiresAt: null }), NOW).expDate).toBeNull();
  });
});

describe('describeInviteRevokeOutcome', () => {
  it('취소 성공 + 목록 갱신 성공은 별도 안내가 없다', () => {
    expect(describeInviteRevokeOutcome({ kind: 'confirmed', reconciled: true })).toBeNull();
  });

  it('취소 성공 + 목록 갱신 실패는 실패로 되돌리지 않고 다시 조회를 안내한다', () => {
    const notice = describeInviteRevokeOutcome({
      kind: 'confirmed',
      reconciled: false,
      readError: '초대 토큰 조회 중 오류 발생',
    });
    expect(notice?.color).toBe('yellow');
    expect(notice?.title).toContain('취소됐지만');
    expect(notice?.message).toContain('초대 토큰 조회 중 오류 발생');
  });

  it.each([
    ['already_revoked', '이미 취소된 초대예요.'],
    ['already_used', '이미 사용된 초대라 취소할 수 없어요.'],
    ['expired', '만료된 초대라 취소할 수 없어요.'],
  ])('409 %s 사유를 사용자 문구로 옮기고 목록을 다시 조회한다', (reason, message) => {
    expect(
      describeInviteRevokeOutcome({
        kind: 'rejected',
        status: 409,
        reason,
        message: '서버 메시지',
      }),
    ).toEqual({ color: 'red', title: '초대를 취소하지 못했어요', message, needsReload: true });
  });

  it.each([
    [null],
    ['constructor'],
  ])('알 수 없는 409 사유(%s)는 일반 상태 변경 문구로 안내한다', (reason) => {
    const notice = describeInviteRevokeOutcome({
      kind: 'rejected',
      status: 409,
      reason,
      message: '서버 메시지',
    });
    expect(notice?.message).toBe('초대 상태가 바뀌어 취소할 수 없어요. 목록을 다시 확인해 주세요.');
    expect(notice?.needsReload).toBe(true);
  });

  it('404는 초대를 찾을 수 없다고 안내한다', () => {
    expect(
      describeInviteRevokeOutcome({
        kind: 'rejected',
        status: 404,
        reason: null,
        message: '초대 토큰을 찾을 수 없습니다.',
      }),
    ).toEqual({
      color: 'red',
      title: '초대를 취소하지 못했어요',
      message: '초대를 찾을 수 없어요. 목록을 다시 확인해 주세요.',
      needsReload: true,
    });
  });

  it('그 밖의 거부(권한·로그인 만료 등)는 서버 메시지를 보존한다', () => {
    const notice = describeInviteRevokeOutcome({
      kind: 'rejected',
      status: null,
      reason: null,
      message: '인증 토큰이 없습니다. 다시 로그인해 주세요.',
    });
    expect(notice?.message).toBe('인증 토큰이 없습니다. 다시 로그인해 주세요.');
    expect(notice?.needsReload).toBe(false);
  });

  it('결과 불확정(5xx·네트워크)은 다시 누르게 하지 않고 상태 확인을 안내한다', () => {
    const notice = describeInviteRevokeOutcome({ kind: 'unknown', message: 'network' });
    expect(notice?.color).toBe('yellow');
    expect(notice?.message).toContain('상태를 먼저 확인');
    expect(notice?.needsReload).toBe(true);
  });
});

describe('parseInviteRecipientEmail', () => {
  it('비우거나 공백만 입력하면 받는 사람 제한 없는 초대(null)로 본다', () => {
    expect(parseInviteRecipientEmail('')).toEqual({ ok: true, value: null });
    expect(parseInviteRecipientEmail('   ')).toEqual({ ok: true, value: null });
  });

  it('형식이 맞으면 앞뒤 공백을 뺀 값을 돌려준다', () => {
    expect(parseInviteRecipientEmail('  Seller@Example.com ')).toEqual({
      ok: true,
      value: 'Seller@Example.com',
    });
  });

  it.each([
    'not-an-email',
    'a@b',
    'a b@example.com',
    `${'a'.repeat(250)}@example.com`,
  ])('형식이 틀린 입력 %p는 오류 문구를 돌려준다', (input) => {
    expect(parseInviteRecipientEmail(input)).toEqual({
      ok: false,
      error: '이메일 형식이 올바르지 않아요.',
    });
  });
});
