// PILOT-REFUND-PROVIDER-IDEMPOTENCY-BINDING-28B focused proofs.
// PortoneClient cancel POST idempotency transport (I11) + key-shape contract.
//
// - I11: the exact key passed to refund() is transmitted as the
//   `Idempotency-Key` header of the cancel POST.
// - Key helper guarantees: 16-256 ASCII, namespaced per refund operation,
//   unique per call, no secret/PII/user-input material.
// - Malformed keys fail closed (throw, no fetch); omitted keys keep the
//   legacy unkeyed POST shape (finalization path untouched).
// - No live provider: global.fetch is fully mocked.

import type { ConfigService } from '@nestjs/config';
import {
  PortoneClient,
  PortoneError,
  createPortoneRefundIdempotencyKey,
  isPortoneIdempotencyKeyShape,
} from './portone.client';

describe('PortoneClient refund idempotency transport 28B (I11)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const makeClient = () =>
    new PortoneClient({
      get: jest.fn().mockReturnValue('v2-test-secret'),
    } as unknown as ConfigService);

  const okCancel = () =>
    new Response(null, { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('I11. cancel POST carries the exact Idempotency-Key header', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okCancel());
    global.fetch = fetchMock;

    const key = createPortoneRefundIdempotencyKey('payment-refund');
    await makeClient().refund('payment-1', 100000, '고객 요청', key);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://api.portone.io/payments/payment-1/cancel', {
      method: 'POST',
      headers: {
        Authorization: 'PortOne v2-test-secret',
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify({ reason: '고객 요청', amount: 100000 }),
    });
  });

  it('I11. retry with the same key sends the same header value twice (single provider operation)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okCancel());
    global.fetch = fetchMock;

    const key = createPortoneRefundIdempotencyKey('order-charge-refund');
    const client = makeClient();
    await client.refund('order-charge-c-1', 3000, '주문 취소', key);
    await client.refund('order-charge-c-1', 3000, '주문 취소', key);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe(key);
    expect(fetchMock.mock.calls[1][1].headers['Idempotency-Key']).toBe(key);
  });

  it('omitted key keeps the legacy unkeyed POST shape (non-28B callers unchanged)', async () => {
    const fetchMock = jest.fn().mockResolvedValue(okCancel());
    global.fetch = fetchMock;

    await makeClient().refund('payment-1', 100, '사유');

    expect(fetchMock).toHaveBeenCalledWith('https://api.portone.io/payments/payment-1/cancel', {
      method: 'POST',
      headers: {
        Authorization: 'PortOne v2-test-secret',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reason: '사유', amount: 100 }),
    });
  });

  it.each(['short', '', '한글키-1234567890123456', 'has space in key 123456', 'a'.repeat(257)])(
    'malformed key %p fails closed with no fetch',
    async (badKey) => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock;

      const error = await makeClient()
        .refund('payment-1', 100, '사유', badKey)
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(PortoneError);
      expect(error).toMatchObject({ status: 400, type: 'INVALID_IDEMPOTENCY_KEY' });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('key helper: namespaced, ASCII 16-256, unique per operation, no PII', () => {
    const payKey = createPortoneRefundIdempotencyKey('payment-refund');
    const chargeKey = createPortoneRefundIdempotencyKey('order-charge-refund');

    for (const key of [payKey, chargeKey]) {
      expect(isPortoneIdempotencyKeyShape(key)).toBe(true);
    }
    expect(payKey.startsWith('ghr-payment-refund-')).toBe(true);
    expect(chargeKey.startsWith('ghr-order-charge-refund-')).toBe(true);
    // Distinct namespaces even for otherwise identical operations.
    expect(payKey).not.toBe(chargeKey);

    const again = createPortoneRefundIdempotencyKey('payment-refund');
    expect(again).not.toBe(payKey);

    // No secret/PII/user-input material can enter: the helper takes only a
    // fixed namespace literal, never payment payloads.
    expect(payKey).not.toContain('v2-test-secret');
  });

  it('shape guard rejects non-ASCII and out-of-range values', () => {
    expect(isPortoneIdempotencyKeyShape('x'.repeat(15))).toBe(false);
    expect(isPortoneIdempotencyKeyShape('x'.repeat(16))).toBe(true);
    expect(isPortoneIdempotencyKeyShape('x'.repeat(256))).toBe(true);
    expect(isPortoneIdempotencyKeyShape('x'.repeat(257))).toBe(false);
    expect(isPortoneIdempotencyKeyShape('키'.repeat(8))).toBe(false);
    expect(isPortoneIdempotencyKeyShape(undefined)).toBe(false);
    expect(isPortoneIdempotencyKeyShape(null)).toBe(false);
    expect(isPortoneIdempotencyKeyShape(123)).toBe(false);
  });
});
