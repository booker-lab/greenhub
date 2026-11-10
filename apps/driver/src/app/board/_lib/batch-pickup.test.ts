import { describe, expect, it } from 'vitest';
import {
  type BatchPickupCandidate,
  type BatchPickupResponse,
  batchPickupBlockReason,
  buildBatchPickupConfirmContent,
  buildBatchPickupSummaryText,
  classifyBatchPickupResponse,
  isBatchPickupSelectable,
  runBatchPickup,
  summarizeBatchPickup,
} from './batch-pickup';

const notRequired = {
  required: false,
  holdAt: null,
  chargeId: null,
  status: 'NOT_REQUIRED',
  canPay: false,
  paid: false,
  requiresRecovery: false,
} as const;

function candidate(overrides: Partial<BatchPickupCandidate> = {}): BatchPickupCandidate {
  return {
    id: 'order-1',
    status: 'PREPARING',
    assignedToMe: true,
    storeId: 'store-1',
    deliveryMethod: 'direct',
    deliveryDate: '2026-11-10T01:00:00.000Z',
    redeliveryPayment: notRequired,
    ...overrides,
  };
}

function response(status: number, body?: unknown, options: { malformed?: boolean } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (options.malformed) throw new SyntaxError('bad json');
      return body;
    },
  } satisfies BatchPickupResponse;
}

const ack = (orderId: string) => response(200, { orderId, status: 'DELIVERING' });

describe('한 번에 수거 선택 가능 판정', () => {
  it('내 수거·회차 직배송·배송 시작 허용·storeId 있음이면 고를 수 있다', () => {
    expect(isBatchPickupSelectable(candidate())).toBe(true);
  });

  it('목록이 상세와 같은 회차 값(schemaVersion·roundId)을 실으면 상세 규칙으로 본다', () => {
    expect(
      isBatchPickupSelectable(
        candidate({ deliveryDate: undefined, schemaVersion: 2, roundId: 'r' }),
      ),
    ).toBe(true);
    expect(isBatchPickupSelectable(candidate({ schemaVersion: 1, roundId: 'r' }))).toBe(false);
    expect(isBatchPickupSelectable(candidate({ schemaVersion: 2, roundId: null }))).toBe(false);
  });

  it('맡을 수 있는 주문(미배정)과 배정 여부를 모르는 이전 응답은 고를 수 없다', () => {
    expect(batchPickupBlockReason(candidate({ assignedToMe: false }))).toBe('NOT_MINE');
    expect(batchPickupBlockReason(candidate({ assignedToMe: undefined }))).toBe('NOT_MINE');
  });

  it('재배송비 결제 대기·운영 확인 필요는 고를 수 없다', () => {
    expect(
      batchPickupBlockReason(
        candidate({
          redeliveryPayment: {
            required: true,
            holdAt: '2026-11-10T00:00:00.000Z',
            chargeId: 'c',
            status: 'PENDING',
            canPay: true,
            paid: false,
            requiresRecovery: false,
          },
        }),
      ),
    ).toBe('PAYMENT');
    expect(
      batchPickupBlockReason(
        candidate({
          redeliveryPayment: {
            required: true,
            holdAt: null,
            chargeId: 'c',
            status: 'PAID',
            canPay: false,
            paid: true,
            requiresRecovery: true,
          },
        }),
      ),
    ).toBe('PAYMENT');
    expect(batchPickupBlockReason(candidate({ redeliveryPayment: undefined }))).toBe('PAYMENT');
  });

  it('storeId가 목록에 없는 주문(이전 API)과 형식이 어긋난 storeId는 고를 수 없다', () => {
    expect(batchPickupBlockReason(candidate({ storeId: undefined }))).toBe('NO_STORE');
    expect(batchPickupBlockReason(candidate({ storeId: '' }))).toBe('NO_STORE');
    expect(batchPickupBlockReason(candidate({ storeId: '../admin' }))).toBe('NO_STORE');
  });

  it('회차 직배송이 아니면(거점·택배·회차 표시 없음) 고를 수 없다', () => {
    expect(batchPickupBlockReason(candidate({ deliveryMethod: 'hub' }))).toBe('NOT_ROUND_DIRECT');
    expect(batchPickupBlockReason(candidate({ deliveryDate: undefined }))).toBe('NOT_ROUND_DIRECT');
    expect(batchPickupBlockReason(candidate({ deliveryDate: null }))).toBe('NOT_ROUND_DIRECT');
  });

  it('수거 대기가 아니면 고를 수 없다', () => {
    expect(batchPickupBlockReason(candidate({ status: 'DELIVERING' }))).toBe('NOT_PREPARING');
  });
});

describe('한 번에 수거 응답 판정(상세 규칙과 같다)', () => {
  it('ACK orderId·status가 맞으면 시작', async () => {
    expect(await classifyBatchPickupResponse(ack('a'), 'a')).toBe('STARTED');
  });

  it('ACK 불일치·본문 해석 실패 2xx는 확인 필요', async () => {
    expect(await classifyBatchPickupResponse(ack('other'), 'a')).toBe('NEEDS_CHECK');
    expect(
      await classifyBatchPickupResponse(response(200, { orderId: 'a', status: 'PREPARING' }), 'a'),
    ).toBe('NEEDS_CHECK');
    expect(await classifyBatchPickupResponse(response(200, null, { malformed: true }), 'a')).toBe(
      'NEEDS_CHECK',
    );
  });

  it('401·AUTHORITY_DENIED·코드 없는 403은 인증 상실', async () => {
    expect(await classifyBatchPickupResponse(response(401), 'a')).toBe('AUTH_LOST');
    expect(
      await classifyBatchPickupResponse(
        response(403, { code: 'DRIVER_ORDER_AUTHORITY_DENIED' }),
        'a',
      ),
    ).toBe('AUTH_LOST');
    expect(await classifyBatchPickupResponse(response(403, {}), 'a')).toBe('AUTH_LOST');
  });

  it('STATE_CONFLICT·NOT_FOUND는 이미 바뀜', async () => {
    expect(
      await classifyBatchPickupResponse(
        response(409, { code: 'DRIVER_ORDER_STATE_CONFLICT' }),
        'a',
      ),
    ).toBe('ALREADY_CHANGED');
    expect(
      await classifyBatchPickupResponse(
        response(403, { code: 'DRIVER_ORDER_STATE_CONFLICT' }),
        'a',
      ),
    ).toBe('ALREADY_CHANGED');
    expect(
      await classifyBatchPickupResponse(response(404, { code: 'DRIVER_ORDER_NOT_FOUND' }), 'a'),
    ).toBe('ALREADY_CHANGED');
  });

  it('5xx·코드 없는 404·그 밖 4xx는 확인 필요', async () => {
    expect(await classifyBatchPickupResponse(response(500, {}), 'a')).toBe('NEEDS_CHECK');
    expect(await classifyBatchPickupResponse(response(404, null, { malformed: true }), 'a')).toBe(
      'NEEDS_CHECK',
    );
    expect(await classifyBatchPickupResponse(response(422, {}), 'a')).toBe('NEEDS_CHECK');
  });
});

describe('한 번에 수거 실행', () => {
  const orders = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('앞 응답을 받은 뒤 다음을 보낸다(동시에 보내지 않는다)', async () => {
    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const run = await runBatchPickup({
      orders,
      isCurrent: () => true,
      send: async (order) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        events.push(`send:${order.id}`);
        await new Promise((resolve) => setTimeout(resolve, 1));
        events.push(`done:${order.id}`);
        inFlight -= 1;
        return ack(order.id);
      },
    });
    expect(maxInFlight).toBe(1);
    expect(events).toEqual(['send:a', 'done:a', 'send:b', 'done:b', 'send:c', 'done:c']);
    expect(run.stoppedBy).toBeNull();
    expect(summarizeBatchPickup(run.results)).toEqual({
      started: 3,
      alreadyChanged: 0,
      needsCheck: 0,
      notSent: 0,
    });
  });

  it('중간에 401이면 멈추고 나머지는 보내지 않는다', async () => {
    const sent: string[] = [];
    const run = await runBatchPickup({
      orders,
      isCurrent: () => true,
      send: async (order) => {
        sent.push(order.id);
        return order.id === 'b' ? response(401) : ack(order.id);
      },
    });
    expect(sent).toEqual(['a', 'b']);
    expect(run.stoppedBy).toBe('AUTH_LOST');
    expect(run.results.map((result) => result.outcome)).toEqual([
      'STARTED',
      'AUTH_LOST',
      'NOT_SENT',
    ]);
  });

  it('AUTHORITY_DENIED 403도 멈추고 나머지는 보내지 않는다', async () => {
    const sent: string[] = [];
    const run = await runBatchPickup({
      orders,
      isCurrent: () => true,
      send: async (order) => {
        sent.push(order.id);
        return response(403, { code: 'DRIVER_ORDER_AUTHORITY_DENIED' });
      },
    });
    expect(sent).toEqual(['a']);
    expect(run.stoppedBy).toBe('AUTH_LOST');
  });

  it('불확실(시간 초과·네트워크·5xx·ACK 불일치)은 다시 보내지 않고 확인 필요로 두고 다음으로 간다', async () => {
    const sent: string[] = [];
    const run = await runBatchPickup({
      orders: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      isCurrent: () => true,
      send: async (order) => {
        sent.push(order.id);
        if (order.id === 'a') throw new Error('timeout');
        if (order.id === 'b') return response(503, {});
        if (order.id === 'c') return ack('someone-else');
        return ack(order.id);
      },
    });
    expect(sent).toEqual(['a', 'b', 'c', 'd']);
    expect(run.results.map((result) => result.outcome)).toEqual([
      'NEEDS_CHECK',
      'NEEDS_CHECK',
      'NEEDS_CHECK',
      'STARTED',
    ]);
    expect(summarizeBatchPickup(run.results).needsCheck).toBe(3);
  });

  it('이미 바뀐 주문을 따로 센다', async () => {
    const run = await runBatchPickup({
      orders,
      isCurrent: () => true,
      send: async (order) =>
        order.id === 'a'
          ? ack('a')
          : order.id === 'b'
            ? response(409, { code: 'DRIVER_ORDER_STATE_CONFLICT' })
            : response(404, { code: 'DRIVER_ORDER_NOT_FOUND' }),
    });
    const summary = summarizeBatchPickup(run.results);
    expect(summary).toEqual({ started: 1, alreadyChanged: 2, needsCheck: 0, notSent: 0 });
    expect(buildBatchPickupSummaryText(summary).line).toBe('배송 시작 1곳 · 이미 바뀜 2곳');
  });

  it('화면을 떠나거나 세션 scope가 바뀌면 남은 요청을 보내지 않는다', async () => {
    let current = true;
    const sent: string[] = [];
    const run = await runBatchPickup({
      orders,
      isCurrent: () => current,
      send: async (order) => {
        sent.push(order.id);
        return ack(order.id);
      },
      onProgress: (done) => {
        if (done === 1) current = false;
      },
    });
    expect(sent).toEqual(['a']);
    expect(run.stoppedBy).toBe('INTERRUPTED');
    expect(run.results.map((result) => result.outcome)).toEqual([
      'STARTED',
      'NOT_SENT',
      'NOT_SENT',
    ]);
  });

  it('응답을 기다리는 사이 scope가 바뀌면 그 주문은 확인 필요로 두고 멈춘다', async () => {
    let current = true;
    const sent: string[] = [];
    const run = await runBatchPickup({
      orders,
      isCurrent: () => current,
      send: async (order) => {
        sent.push(order.id);
        current = false;
        return ack(order.id);
      },
    });
    expect(sent).toEqual(['a']);
    expect(run.stoppedBy).toBe('INTERRUPTED');
    expect(run.results.map((result) => result.outcome)).toEqual([
      'NEEDS_CHECK',
      'NOT_SENT',
      'NOT_SENT',
    ]);
  });
});

describe('한 번에 수거 확인 창·요약 문구', () => {
  it('주소 목록·상품 총 수·손님 알림 수를 보인다', () => {
    const content = buildBatchPickupConfirmContent([
      {
        id: 'a',
        address: '경기도 이천시 테스트로 1 101동 202호',
        deliveryAddress: { address: '경기도 이천시 테스트로 1' },
        items: [{ quantity: 2 }, { quantity: 1 }],
      },
      { id: 'b', address: '서울시 중구 1', quantity: 2 },
    ]);
    expect(content.title).toBe('2곳 배송을 시작할까요?');
    expect(content.places).toEqual([
      { id: 'a', place: '101동 202호 · 경기도 이천시 테스트로 1' },
      { id: 'b', place: '서울시 중구 1' },
    ]);
    expect(content.itemsLine).toBe('상품 총 5개');
    expect(content.notice).toBe('손님 2명에게 배송 시작 알림이 가요.');
    expect(content.confirmLabel).toBe('2곳 배송 시작');
  });

  it('한 주문이라도 수량을 모르면 상품 총 수를 쓰지 않는다', () => {
    const content = buildBatchPickupConfirmContent([
      { id: 'a', address: 'x', quantity: 1 },
      { id: 'b', address: 'y' },
    ]);
    expect(content.itemsLine).toBeNull();
  });

  it('확인 필요가 있으면 배송 중 탭에서 확인하라고 안내한다', () => {
    const text = buildBatchPickupSummaryText({
      started: 2,
      alreadyChanged: 0,
      needsCheck: 1,
      notSent: 0,
    });
    expect(text.line).toBe('배송 시작 2곳 · 확인 필요 1곳');
    expect(text.notes.join(' ')).toContain('배송 중 탭');
  });
});
