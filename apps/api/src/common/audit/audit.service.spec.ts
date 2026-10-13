import { AuditService, minimizeAuditDetail } from './audit.service';

function makeService(jwtSecret: string | undefined) {
  const set = jest.fn().mockResolvedValue(undefined);
  const firestore = {
    doc: jest.fn().mockReturnValue({ set }),
    Timestamp: { now: () => 'now' },
  };
  const config = { get: (key: string) => (key === 'JWT_SECRET' ? jwtSecret : undefined) };
  return { set, service: new AuditService(firestore as never, config as never) };
}

describe('AuditService', () => {
  it('없는 계정의 로그인 실패는 이메일 원문 대신 HMAC만 남긴다', async () => {
    const { set, service } = makeService('unit-test-secret');
    await service.log('auth.login.failed', {
      detail: { email: 'Someone@Example.com ', reason: 'user_not_found' },
    });

    const record = set.mock.calls[0][0];
    expect(record.detail).toEqual({ reason: 'user_not_found', emailHmac: expect.any(String) });
    expect(record.detail.emailHmac).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(record).toLowerCase()).not.toContain('example.com');
  });

  it('같은 이메일은 대소문자·공백과 관계없이 같은 HMAC으로 묶인다', async () => {
    const { set, service } = makeService('unit-test-secret');
    await service.log('auth.login.failed', { detail: { email: 'a@example.com' } });
    await service.log('auth.login.failed', { detail: { email: ' A@Example.com' } });
    await service.log('auth.login.failed', { detail: { email: 'b@example.com' } });
    const [first, second, third] = set.mock.calls.map((call) => call[0].detail.emailHmac);
    expect(first).toBe(second);
    expect(first).not.toBe(third);
  });

  it('userId가 있으면 이메일을 남기지 않는다', async () => {
    const { set, service } = makeService('unit-test-secret');
    await service.log('auth.login.failed', {
      userId: 'user-1',
      detail: { email: 'a@example.com', reason: 'wrong_password' },
    });
    expect(set.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      detail: { reason: 'wrong_password' },
    });
    expect(set.mock.calls[0][0].detail).not.toHaveProperty('email');
    expect(set.mock.calls[0][0].detail).not.toHaveProperty('emailHmac');
  });

  it('HMAC 키가 없으면 이메일을 버린다', async () => {
    const { set, service } = makeService(undefined);
    await service.log('auth.login.failed', {
      detail: { email: 'a@example.com', reason: 'user_not_found' },
    });
    expect(set.mock.calls[0][0].detail).toEqual({ reason: 'user_not_found' });
  });

  it('이메일이 없는 detail과 빈 detail은 그대로 저장한다', async () => {
    const { set, service } = makeService('unit-test-secret');
    await service.log('payment.amount_tampered', {
      userId: 'user-1',
      detail: { orderId: 'o-1', expected: 1000, actual: 10 },
    });
    await service.log('auth.logout', { userId: 'user-1' });
    expect(set.mock.calls[0][0].detail).toEqual({ orderId: 'o-1', expected: 1000, actual: 10 });
    expect(set.mock.calls[1][0]).toMatchObject({ userId: 'user-1', ip: null, detail: null });
  });

  it('minimizeAuditDetail은 입력 객체를 바꾸지 않는다', () => {
    const detail = { email: 'a@example.com', reason: 'x' };
    minimizeAuditDetail(detail, { emailHmacKey: Buffer.from('k') });
    expect(detail).toEqual({ email: 'a@example.com', reason: 'x' });
  });
});
