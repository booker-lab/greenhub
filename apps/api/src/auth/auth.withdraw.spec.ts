import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import { createOccFirestore } from '../../test/helpers/firestore-occ-fake';
import type { AuditService } from '../common/audit/audit.service';
import type { FirestoreService } from '../firestore/firestore.service';
import type { OpsAlertService } from '../ops-alerts/ops-alert.service';
import {
  WITHDRAWAL_ACTIVE_ORDER_MESSAGE,
  isActiveCheckoutReservation,
  isWithdrawalBlockingOrder,
} from './account-withdrawal';
import { AuthService } from './auth.service';
import { emailIdentityKey } from './email-identity';
import type { KakaoClient } from './kakao.client';

jest.mock('firebase-admin', () => ({ auth: jest.fn() }));

const UID = 'consumer-1';
const KAKAO_ID = '4242';
const EMAIL = 'kakao@example.com';
const CONSUMER = { sub: UID, role: 'consumer' as const, sid: 'sid-1' };

function makeService(options: { unlink?: 'unlinked' | 'not_configured' | 'failed' } = {}) {
  const occ = createOccFirestore();
  const jwt = { sign: jest.fn(() => 'signed-token'), verify: jest.fn() };
  const config = { get: jest.fn((_key: string, fallback?: string) => fallback ?? 'secret') };
  const kakaoClient = {
    getUser: jest.fn().mockResolvedValue({ kakaoId: KAKAO_ID, email: EMAIL, name: '새 이름' }),
    unlinkUser: jest.fn().mockResolvedValue(options.unlink ?? 'unlinked'),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const opsAlert = { send: jest.fn().mockResolvedValue(true) };
  const service = new AuthService(
    occ.firestore as unknown as FirestoreService,
    jwt as unknown as JwtService,
    config as unknown as ConfigService,
    kakaoClient as unknown as KakaoClient,
    audit as unknown as AuditService,
    opsAlert as unknown as OpsAlertService,
  );

  occ.seed(`users/${UID}`, {
    id: UID,
    role: 'consumer',
    storeId: null,
    kakaoId: KAKAO_ID,
    email: EMAIL,
    name: '홍길동',
    phone: '010-0000-0000',
    providers: ['kakao'],
    savedAddresses: [{ id: 'a1', address: '경기도 이천시' }],
    fcmToken: 'fcm-token',
    notificationPreferences: { orderStatus: true },
    activeSessionIds: ['sid-1'],
  });
  occ.seed(`refreshTokens/${UID}`, { sessions: { 'sid-1': { token: 'hashed', createdAt: 1 } } });
  occ.seed(`kakaoIdentities/${KAKAO_ID}`, { userId: UID });
  occ.seed(`emailIdentities/${emailIdentityKey(EMAIL)}`, { userId: UID, email: EMAIL });
  occ.seed('restockSubscriptions/p1_consumer-1', { productId: 'p1', userId: UID });
  occ.seed('restockSubscriptions/p1_other', { productId: 'p1', userId: 'other' });
  occ.seed('notifications/n1', { userId: UID, title: '배송 완료' });
  occ.seed('notifications/n2', { userId: 'other', title: '배송 완료' });
  occ.seed('aiUsage/consumer-1_2026-10-21', { uid: UID, count: 1 });

  return { occ, service, kakaoClient, audit, opsAlert, jwt };
}

describe('소비자 회원 탈퇴 판정 규칙', () => {
  it.each([
    ['결제 대기', { status: 'PENDING' }, true],
    ['준비 중', { status: 'PREPARING' }, true],
    ['배송 중', { status: 'DELIVERING' }, true],
    ['거점 도착', { status: 'HUB_ARRIVED' }, true],
    ['배송 보류', { status: 'DELIVERY_HELD' }, true],
    ['취소 진행 중', { status: 'CANCELLED', cancellation: { status: 'REFUND_FAILED' } }, true],
    [
      '재배송비 미결제',
      { status: 'PREPARING', deliveryHold: { customerResponsible: true, redeliveryFee: 3000 } },
      true,
    ],
    ['배송 완료', { status: 'DELIVERED' }, false],
    ['취소 완료', { status: 'CANCELLED', cancellation: { status: 'COMPLETED' } }, false],
  ])('%s 주문의 탈퇴 차단 여부', (_label, order, blocking) => {
    expect(isWithdrawalBlockingOrder(order)).toBe(blocking);
  });

  it('만료 전 HELD 결제 예약만 진행 중으로 본다', () => {
    const now = Date.parse('2026-10-21T00:00:00Z');
    expect(
      isActiveCheckoutReservation({ status: 'HELD', expiresAt: '2026-10-21T00:10:00Z' }, now),
    ).toBe(true);
    expect(
      isActiveCheckoutReservation({ status: 'HELD', expiresAt: '2026-10-20T23:50:00Z' }, now),
    ).toBe(false);
    expect(
      isActiveCheckoutReservation({ status: 'CONSUMED', expiresAt: '2026-10-21T00:10:00Z' }, now),
    ).toBe(false);
    expect(isActiveCheckoutReservation({ status: 'HELD' }, now)).toBe(true);
  });
});

describe('AuthService.withdraw', () => {
  it('진행 중인 주문이 있으면 409로 막고 아무것도 바꾸지 않는다', async () => {
    const { occ, service, kakaoClient } = makeService();
    occ.seed('orders/o1', { userId: UID, status: 'PREPARING' });

    await expect(service.withdraw(CONSUMER)).rejects.toThrow(
      new ConflictException(WITHDRAWAL_ACTIVE_ORDER_MESSAGE),
    );

    expect(occ.getData(`users/${UID}`)).toMatchObject({ name: '홍길동', kakaoId: KAKAO_ID });
    expect(occ.getData(`refreshTokens/${UID}`)).toBeDefined();
    expect(occ.getData(`kakaoIdentities/${KAKAO_ID}`)).toBeDefined();
    expect(occ.getData('notifications/n1')).toBeDefined();
    expect(kakaoClient.unlinkUser).not.toHaveBeenCalled();
  });

  it('결제창을 연 예약(만료 전 HELD)이 있으면 409로 막는다', async () => {
    const { occ, service } = makeService();
    occ.seed('checkoutReservations/r1', {
      userId: UID,
      status: 'HELD',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });

    await expect(service.withdraw(CONSUMER)).rejects.toBeInstanceOf(ConflictException);
    expect(occ.getData(`users/${UID}`)).toMatchObject({ name: '홍길동' });
  });

  it('소비자가 아니면 403으로 거부한다', async () => {
    const { service } = makeService();
    for (const role of ['seller', 'driver', 'admin'] as const) {
      await expect(service.withdraw({ sub: UID, role })).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('성공하면 세션을 폐기하고 개인정보를 지우며 연결 문서·부속 기록을 삭제한다', async () => {
    const { occ, service, kakaoClient, audit, opsAlert } = makeService();
    occ.seed('orders/o-done', { userId: UID, status: 'DELIVERED', recipientName: '홍길동' });
    occ.seed('orders/o-cancel', { userId: UID, status: 'CANCELLED' });
    occ.seed('checkoutReservations/r-old', { userId: UID, status: 'CONSUMED' });

    await service.withdraw(CONSUMER);

    const user = occ.getData(`users/${UID}`)!;
    for (const field of [
      'name',
      'phone',
      'email',
      'savedAddresses',
      'fcmToken',
      'kakaoId',
      'passwordHash',
      'notificationPreferences',
    ]) {
      expect(user).not.toHaveProperty(field);
    }
    expect(user).toMatchObject({ id: UID, role: 'consumer', activeSessionIds: [] });
    expect(user['withdrawnAt']).toBeInstanceOf(Date);
    expect(user['sessionsRevokedAt']).toBeInstanceOf(Date);

    expect(occ.getData(`refreshTokens/${UID}`)).toBeUndefined();
    expect(occ.getData(`kakaoIdentities/${KAKAO_ID}`)).toBeUndefined();
    expect(occ.getData(`emailIdentities/${emailIdentityKey(EMAIL)}`)).toBeUndefined();
    expect(occ.getData('restockSubscriptions/p1_consumer-1')).toBeUndefined();
    expect(occ.getData('notifications/n1')).toBeUndefined();
    expect(occ.getData('aiUsage/consumer-1_2026-10-21')).toBeUndefined();

    // 다른 사용자의 기록과 주문 기록(법정 보관)은 그대로 둔다.
    expect(occ.getData('restockSubscriptions/p1_other')).toBeDefined();
    expect(occ.getData('notifications/n2')).toBeDefined();
    expect(occ.getData('orders/o-done')).toMatchObject({ recipientName: '홍길동' });

    expect(kakaoClient.unlinkUser).toHaveBeenCalledWith(KAKAO_ID);
    expect(opsAlert.send).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith('auth.withdrawn', {
      userId: UID,
      detail: { kakaoUnlink: 'unlinked' },
    });
  });

  it('탈퇴 뒤 같은 카카오 계정으로 로그인하면 새 계정이 만들어진다', async () => {
    const { occ, service } = makeService();
    await service.withdraw(CONSUMER);

    const result = await service.kakaoLogin({ kakaoAccessToken: 'token', targetRole: 'consumer' });

    expect(result.user['id']).not.toBe(UID);
    expect(result.user).toMatchObject({ kakaoId: KAKAO_ID, role: 'consumer' });
    expect(occ.getData(`kakaoIdentities/${KAKAO_ID}`)).toMatchObject({ userId: result.user['id'] });
    expect(occ.getData(`users/${UID}`)).not.toHaveProperty('kakaoId');
  });

  it('탈퇴한 계정의 refresh token은 거부한다', async () => {
    const { service, jwt } = makeService();
    await service.withdraw(CONSUMER);
    jwt.verify.mockReturnValue({ sub: UID, role: 'consumer', sid: 'sid-1', typ: 'refresh' });

    await expect(service.refresh('old-refresh-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('이미 탈퇴한 문서로 다시 탈퇴를 요청하면 401로 거부한다', async () => {
    const { service } = makeService();
    await service.withdraw(CONSUMER);

    await expect(service.withdraw(CONSUMER)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    'failed',
    'not_configured',
  ] as const)('카카오 연결 끊기가 %s여도 탈퇴는 끝나고 식별자 없는 운영 알림만 보낸다', async (unlink) => {
    const { occ, service, opsAlert, audit } = makeService({ unlink });

    await expect(service.withdraw(CONSUMER)).resolves.toBeUndefined();

    expect(occ.getData(`users/${UID}`)).toHaveProperty('withdrawnAt');
    expect(opsAlert.send).toHaveBeenCalledTimes(1);
    const alertText = JSON.stringify(opsAlert.send.mock.calls[0][0]);
    expect(alertText).not.toContain(UID);
    expect(alertText).not.toContain(KAKAO_ID);
    expect(audit.log).toHaveBeenCalledWith('auth.withdrawn', {
      userId: UID,
      detail: { kakaoUnlink: unlink },
    });
  });
});
