import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DAY_MS,
  evaluateAll,
  evaluateM1,
  evaluateM2,
  evaluateO1,
  evaluateO2,
  evaluateO3,
  evaluateO4,
  evaluateP1,
  evaluateP2,
  evaluateS0,
  evaluateS1,
  evaluateS2,
  evaluateS3,
  GREEN,
  HOUR_MS,
  kstDate,
  keyAgeDays,
  RED,
  selectRounds,
  summarize,
  toMillis,
  YELLOW,
} from './morning-check-rules.mjs';

// 2026-10-22 07:30 KST = 2026-10-21 22:30 UTC
const NOW = Date.UTC(2026, 9, 21, 22, 30);
const STORE_NAMES = { 'store-a': '디어 오키드', 'store-b': '난플렉스' };
const base = (extra) => ({ now: NOW, storeNames: STORE_NAMES, failedSources: [], ...extra });
const iso = (ms) => new Date(ms).toISOString();
const ts = (ms) => ({ toMillis: () => ms });

describe('시각 도우미', () => {
  test('Timestamp·Date·ISO·숫자·날짜만 있는 문자열을 밀리초로 바꾼다', () => {
    assert.equal(toMillis(ts(NOW)), NOW);
    assert.equal(toMillis(new Date(NOW)), NOW);
    assert.equal(toMillis(iso(NOW)), NOW);
    assert.equal(toMillis('2026-10-22T07:30:00+09:00'), NOW);
    assert.equal(toMillis(NOW), NOW);
    assert.equal(toMillis({ _seconds: NOW / 1000, _nanoseconds: 0 }), NOW);
    assert.equal(toMillis('2026-10-22'), Date.UTC(2026, 9, 21, 15, 0));
    assert.equal(toMillis(null), null);
    assert.equal(toMillis('엉터리'), null);
  });

  test('KST 날짜는 UTC 15시에 넘어간다', () => {
    assert.equal(kstDate(NOW), '2026-10-22');
    assert.equal(kstDate(Date.UTC(2026, 9, 21, 14, 59, 59)), '2026-10-21');
    assert.equal(kstDate(Date.UTC(2026, 9, 21, 15, 0, 0)), '2026-10-22');
  });
});

describe('M1 지급 후 환불', () => {
  const paid = [
    { id: 'o1', status: 'paid', storeId: 'store-a', orderNumber: '20261021-000012', netAmount: 32000 },
    { id: 'o2', status: 'paid', storeId: 'store-b', orderNumber: '20261021-000013', netAmount: 10000 },
    { id: 'o3', status: 'paid', storeId: 'store-b', orderNumber: '20261021-000014', netAmount: 5000 },
  ];

  test('주문 취소나 결제 환불 시각이 있으면 1건부터 🔴', () => {
    const item = evaluateM1(
      base({
        paidSettlements: paid,
        ordersById: { o1: { status: 'CANCELLED' }, o2: { status: 'DELIVERED' }, o3: { status: 'DELIVERED' } },
        paymentsById: { o1: { refundedAt: null }, o2: { refundedAt: ts(NOW - HOUR_MS) }, o3: { refundedAt: null } },
      }),
    );
    assert.equal(item.level, RED);
    assert.deepEqual(
      item.entries.map((e) => [e.orderNumber, e.storeName, e.amount, e.note]),
      [
        ['20261021-000012', '디어 오키드', 32000, '지급 완료 후 주문 취소'],
        ['20261021-000013', '난플렉스', 10000, '지급 완료 후 결제 환불'],
      ],
    );
  });

  test('취소·환불이 없으면 🟢, paid가 아닌 정산은 보지 않는다', () => {
    const item = evaluateM1(
      base({
        paidSettlements: [{ ...paid[0], status: 'confirmed' }, paid[2]],
        ordersById: { o1: { status: 'CANCELLED' }, o3: { status: 'DELIVERED' } },
        paymentsById: { o3: {} },
      }),
    );
    assert.equal(item.level, GREEN);
    assert.equal(item.count, 0);
  });
});

describe('M2 수수료율 차이', () => {
  const stores = [
    { id: 'store-a', name: '디어 오키드', commissionRate: 0.03 },
    { id: 'store-b', name: '난플렉스', commissionRate: 0.05 },
    { id: 'store-c', name: '빈 가게' },
  ];

  test('가게 율이 최근 정산 율과 다르면 🟡, 가장 최근 정산 기준으로 비교한다', () => {
    const item = evaluateM2(
      base({
        stores,
        recentSettlements: [
          { storeId: 'store-a', platformFeeRate: 0.03, settledAt: ts(NOW - 3 * DAY_MS) },
          { storeId: 'store-a', platformFeeRate: 0.05, settledAt: ts(NOW - DAY_MS) },
          { storeId: 'store-b', platformFeeRate: 0.05, settledAt: ts(NOW - DAY_MS) },
          { storeId: 'store-c', platformFeeRate: 0.05, settledAt: ts(NOW - DAY_MS) },
        ],
      }),
    );
    assert.equal(item.level, YELLOW);
    assert.equal(item.entries.length, 1);
    assert.equal(item.entries[0].storeName, '디어 오키드');
    assert.equal(item.entries[0].note, '화면 3% · 정산 5%');
    assert.equal(item.summary, '1곳 · 정책 결정 대기');
  });

  test('같으면(부동소수 오차 포함) 🟢, 최근 정산이 없으면 비교하지 않는다', () => {
    const item = evaluateM2(
      base({
        stores: [{ id: 'store-a', commissionRate: 0.1 + 0.2 - 0.25 }, { id: 'store-b', commissionRate: 0.01 }],
        recentSettlements: [{ storeId: 'store-a', platformFeeRate: 0.05, settledAt: ts(NOW) }],
      }),
    );
    assert.equal(item.level, GREEN);
  });
});

describe('O1 배송 마감 지남', () => {
  const rounds = [
    { id: 'r-past', schedule: { deliveryEndAt: iso(NOW - 1) } },
    { id: 'r-now', schedule: { deliveryEndAt: iso(NOW) } },
  ];

  test('회차 마감이 now보다 1ms라도 앞이고 미완료면 🔴, 마감 = now는 아직 아니다', () => {
    const item = evaluateO1(
      base({
        rounds,
        roundOrders: [
          { roundId: 'r-past', status: 'PREPARING', orderNumber: 'A-1', storeId: 'store-a', totalAmount: 50000 },
          { roundId: 'r-past', status: 'DELIVERED', orderNumber: 'A-2', storeId: 'store-a' },
          { roundId: 'r-past', status: 'PENDING', orderNumber: 'A-3', storeId: 'store-a' },
          { roundId: 'r-now', status: 'PREPARING', orderNumber: 'A-4', storeId: 'store-a' },
        ],
      }),
    );
    assert.equal(item.level, RED);
    assert.deepEqual(
      item.entries.map((e) => [e.orderNumber, e.amount]),
      [['A-1', 50000]],
    );
  });

  test('끝난 상태(DELIVERED·PICKED_UP·REVIEWED·CANCELLED)는 모두 빠진다', () => {
    const item = evaluateO1(
      base({
        rounds,
        roundOrders: ['DELIVERED', 'PICKED_UP', 'REVIEWED', 'CANCELLED'].map((status, i) => ({
          roundId: 'r-past',
          status,
          orderNumber: `D-${i}`,
        })),
      }),
    );
    assert.equal(item.level, GREEN);
  });

  test('회차 없는 주문: 희망 배송일이 어제면 🔴, 오늘이면 아직 아니다', () => {
    const item = evaluateO1(
      base({
        openOrdersWithoutRound: [
          { status: 'ACCEPTED', orderNumber: 'B-1', requestedDeliveryDate: '2026-10-21', storeId: 'store-b' },
          { status: 'ACCEPTED', orderNumber: 'B-2', requestedDeliveryDate: '2026-10-22', storeId: 'store-b' },
          { status: 'ACCEPTED', orderNumber: 'B-3', requestedDeliveryDate: '2026-10-21', roundId: 'r-x' },
        ],
      }),
    );
    assert.equal(item.level, RED);
    assert.deepEqual(item.entries.map((e) => e.orderNumber), ['B-1']);
    assert.equal(item.entries[0].note, '희망 배송일 2026-10-21 지남');
  });

  test('날짜 없는 주문: updatedAt이 48시간 넘으면 🟡 짐작, 정확히 48시간·보류 주문(O4 몫)은 아니다', () => {
    const item = evaluateO1(
      base({
        openOrdersWithoutRound: [
          { status: 'PREPARING', orderNumber: 'C-1', updatedAt: ts(NOW - 48 * HOUR_MS - 1) },
          { status: 'PREPARING', orderNumber: 'C-2', updatedAt: ts(NOW - 48 * HOUR_MS) },
          { status: 'PREPARING', orderNumber: 'C-3' },
          { status: 'DELIVERY_HELD', orderNumber: 'C-4', updatedAt: ts(NOW - 5 * DAY_MS) },
        ],
      }),
    );
    assert.equal(item.level, YELLOW);
    assert.deepEqual(item.entries.map((e) => e.orderNumber), ['C-1']);
    assert.match(item.entries[0].note, /^짐작/);
  });

  test('🔴과 🟡이 섞이면 항목 수준은 🔴', () => {
    const item = evaluateO1(
      base({
        openOrdersWithoutRound: [
          { status: 'PREPARING', orderNumber: 'C-1', updatedAt: ts(NOW - 3 * DAY_MS) },
          { status: 'PREPARING', orderNumber: 'B-1', requestedDeliveryDate: '2026-10-20' },
        ],
      }),
    );
    assert.equal(item.level, RED);
    assert.equal(summarize([item]).counts.red, 1);
    assert.equal(summarize([item]).counts.yellow, 1);
  });
});

describe('볼 회차 고르기', () => {
  test('마감이 최근 7일 안이거나 시작이 오늘(KST)인 회차만', () => {
    const rounds = [
      { id: 'ended-1ms', schedule: { deliveryEndAt: iso(NOW - 1), deliveryStartAt: iso(NOW - DAY_MS) } },
      { id: 'ended-7d', schedule: { deliveryEndAt: iso(NOW - 7 * DAY_MS), deliveryStartAt: iso(NOW - 8 * DAY_MS) } },
      { id: 'ended-7d+1', schedule: { deliveryEndAt: iso(NOW - 7 * DAY_MS - 1), deliveryStartAt: iso(NOW - 8 * DAY_MS) } },
      { id: 'today', schedule: { deliveryStartAt: '2026-10-22T09:00:00+09:00', deliveryEndAt: '2026-10-22T18:00:00+09:00' } },
      { id: 'tomorrow', schedule: { deliveryStartAt: '2026-10-23T00:00:00+09:00', deliveryEndAt: '2026-10-23T18:00:00+09:00' } },
    ];
    assert.deepEqual(selectRounds(rounds, NOW).map((r) => r.id), ['ended-1ms', 'ended-7d', 'today']);
  });
});

describe('O2·O3 오늘 배송', () => {
  const rounds = [
    { id: 'r-today', schedule: { deliveryStartAt: '2026-10-22T00:00:00+09:00' } },
    { id: 'r-yesterday', schedule: { deliveryStartAt: '2026-10-21T23:59:59+09:00' } },
  ];
  const roundOrders = [
    { roundId: 'r-today', status: 'ACCEPTED', orderNumber: 'T-1', storeId: 'store-a' },
    { roundId: 'r-today', status: 'CONFIRMED', orderNumber: 'T-2', storeId: 'store-a' },
    { roundId: 'r-today', status: 'PREPARING', orderNumber: 'T-3', deliveryMethod: 'direct', driverId: null },
    { roundId: 'r-today', status: 'PREPARING', orderNumber: 'T-4', deliveryMethod: 'direct', driverId: 'd1' },
    { roundId: 'r-today', status: 'PREPARING', orderNumber: 'T-5', deliveryMethod: 'parcel' },
    { roundId: 'r-yesterday', status: 'ACCEPTED', orderNumber: 'Y-1' },
    { roundId: 'r-yesterday', status: 'PREPARING', orderNumber: 'Y-2', deliveryMethod: 'direct' },
  ];

  test('O2: 오늘 시작 회차의 ACCEPTED·CONFIRMED만 🟡', () => {
    const item = evaluateO2(base({ rounds, roundOrders }));
    assert.equal(item.level, YELLOW);
    assert.deepEqual(item.entries.map((e) => e.orderNumber), ['T-1', 'T-2']);
  });

  test('O3: 오늘 시작 회차의 직배송 PREPARING인데 기사 없음만 🟡', () => {
    const item = evaluateO3(base({ rounds, roundOrders }));
    assert.equal(item.level, YELLOW);
    assert.deepEqual(item.entries.map((e) => e.orderNumber), ['T-3']);
  });

  test('오늘 회차가 없으면 🟢', () => {
    assert.equal(evaluateO2(base({ rounds: [rounds[1]], roundOrders })).level, GREEN);
    assert.equal(evaluateO3(base({ rounds: [rounds[1]], roundOrders })).level, GREEN);
  });
});

describe('O4 배송 보류 장기화', () => {
  test('풀리지 않은 보류가 24시간을 넘으면 🟡, 정확히 24시간·풀린 보류는 아니다', () => {
    const item = evaluateO4(
      base({
        heldOrders: [
          { status: 'DELIVERY_HELD', orderNumber: 'H-1', deliveryHold: { heldAt: iso(NOW - 24 * HOUR_MS - 1), reasonCode: 'ABSENT' } },
          { status: 'DELIVERY_HELD', orderNumber: 'H-2', deliveryHold: { heldAt: iso(NOW - 24 * HOUR_MS) } },
          { status: 'DELIVERY_HELD', orderNumber: 'H-3', deliveryHold: { heldAt: iso(NOW - 3 * DAY_MS), resolvedAt: iso(NOW) } },
          { status: 'DELIVERY_HELD', orderNumber: 'H-4', deliveryHold: { heldAt: ts(NOW - 2 * DAY_MS), resolvedAt: null } },
        ],
      }),
    );
    assert.equal(item.level, YELLOW);
    assert.deepEqual(item.entries.map((e) => e.orderNumber), ['H-1', 'H-4']);
    assert.equal(item.entries[0].note, '보류 24시간 · ABSENT');
  });
});

describe('P1 기사 승인 대기', () => {
  test('승인 전·정지 아님이 1명부터 🟡, 인원수만 낸다', () => {
    const item = evaluateP1(
      base({
        drivers: [
          { role: 'driver', driverApproved: false, suspended: false },
          { role: 'driver', driverApproved: false, suspended: true },
          { role: 'driver', driverApproved: true },
        ],
      }),
    );
    assert.equal(item.level, YELLOW);
    assert.equal(item.count, 1);
    assert.deepEqual(item.entries, []);
    assert.equal(summarize([item]).counts.yellow, 1);
  });

  test('0명이면 🟢', () => {
    assert.equal(evaluateP1(base({ drivers: [{ role: 'driver', driverApproved: true }] })).level, GREEN);
  });
});

describe('P2 초대 만료 임박', () => {
  test('안 쓴 초대가 now < 만료 ≤ now+24시간이면 🟡', () => {
    const item = evaluateP2(
      base({
        invites: [
          { expiresAt: ts(NOW + 24 * HOUR_MS), usedAt: null, revokedAt: null },
          { expiresAt: ts(NOW + 24 * HOUR_MS + 1), usedAt: null, revokedAt: null },
          { expiresAt: ts(NOW), usedAt: null, revokedAt: null },
          { expiresAt: ts(NOW + HOUR_MS), usedAt: ts(NOW - HOUR_MS), revokedAt: null },
          { expiresAt: ts(NOW + HOUR_MS), usedAt: null, revokedAt: ts(NOW - HOUR_MS) },
          { expiresAt: ts(NOW + 2 * HOUR_MS + 1), usedAt: null, revokedAt: null },
        ],
      }),
    );
    assert.equal(item.level, YELLOW);
    assert.deepEqual(item.entries.map((e) => e.note), ['24시간 뒤 만료', '2시간 뒤 만료']);
  });
});

describe('S1 보안 사건', () => {
  test('최근 24시간 안 1건부터 🔴, 정확히 24시간 전은 빠진다', () => {
    const item = evaluateS1(
      base({
        auditLogs: [
          { action: 'payment.amount_tampered', createdAt: ts(NOW - 24 * HOUR_MS + 1) },
          { action: 'payment.amount_tampered', createdAt: ts(NOW) },
          { action: 'auth.token.stolen', createdAt: ts(NOW - 24 * HOUR_MS) },
          { action: 'payment.webhook.invalid_sig', createdAt: ts(NOW - HOUR_MS) },
          { action: 'auth.login.failed', createdAt: ts(NOW) },
        ],
      }),
    );
    assert.equal(item.level, RED);
    assert.equal(item.count, 3);
    assert.deepEqual(
      item.entries.map((e) => [e.note, e.count]),
      [
        ['payment.amount_tampered', 2],
        ['payment.webhook.invalid_sig', 1],
      ],
    );
  });

  test('없으면 🟢', () => {
    assert.equal(evaluateS1(base({ auditLogs: [] })).level, GREEN);
  });
});

describe('S2 로그인 실패 급증', () => {
  const failed = (count, at) => Array.from({ length: count }, () => ({ action: 'auth.login.failed', createdAt: ts(at) }));

  test('최근 10건 이상이면서 직전 7일 하루 평균의 3배 이상이면 🟡', () => {
    // 직전 7일 21건 = 하루 평균 3건 → 3배 = 9건. 최근 10건이면 둘 다 넘는다.
    const item = evaluateS2(base({ auditLogs: [...failed(10, NOW - HOUR_MS), ...failed(21, NOW - 3 * DAY_MS)] }));
    assert.equal(item.level, YELLOW);
    assert.equal(item.count, 10);
  });

  test('최근 9건이면 평균이 0이어도 🟢', () => {
    assert.equal(evaluateS2(base({ auditLogs: failed(9, NOW - HOUR_MS) })).level, GREEN);
  });

  test('최근 10건이라도 평균의 3배 미만이면 🟢(직전 7일 28건 = 평균 4건 → 3배 12건)', () => {
    const item = evaluateS2(base({ auditLogs: [...failed(10, NOW - HOUR_MS), ...failed(28, NOW - 2 * DAY_MS)] }));
    assert.equal(item.level, GREEN);
  });

  test('경계: 정확히 3배(최근 12건·직전 28건)는 🟡, 8일보다 오래된 기록은 기준에 넣지 않는다', () => {
    const item = evaluateS2(
      base({
        auditLogs: [
          ...failed(12, NOW - HOUR_MS),
          ...failed(28, NOW - 2 * DAY_MS),
          ...failed(100, NOW - 8 * DAY_MS),
        ],
      }),
    );
    assert.equal(item.level, YELLOW);
  });
});

describe('S3 운영 확인 기록', () => {
  test('critical은 🔴, warning은 🟡, 그 밖 등급은 보지 않는다', () => {
    const item = evaluateS3(
      base({
        operationIssues: [
          { type: 'PAYMENT_LOOKUP_FAILED', severity: 'critical', storeId: 'store-a', createdAt: ts(NOW) },
          { type: 'REFUND_RETRY', severity: 'warning', storeId: 'store-b', createdAt: ts(NOW) },
          { type: 'INFO', severity: 'info', storeId: 'store-b', createdAt: ts(NOW) },
        ],
      }),
    );
    assert.equal(item.level, RED);
    assert.deepEqual(
      item.entries.map((e) => [e.level, e.storeName]),
      [
        [RED, '디어 오키드'],
        [YELLOW, '난플렉스'],
      ],
    );
  });

  test('warning만 있으면 🟡, 없으면 🟢', () => {
    assert.equal(evaluateS3(base({ operationIssues: [{ severity: 'warning' }] })).level, YELLOW);
    assert.equal(evaluateS3(base({ operationIssues: [] })).level, GREEN);
  });
});

describe('S0 점검 실패와 열쇠 교체 시기', () => {
  test('열쇠를 만든 지 80일은 🟢, 81일은 🟡', () => {
    assert.equal(keyAgeDays('2026-08-03', NOW), 80);
    assert.equal(evaluateS0(base({ keyCreatedAt: '2026-08-03' })).level, GREEN);
    assert.equal(keyAgeDays('2026-08-02', NOW), 81);
    const item = evaluateS0(base({ keyCreatedAt: '2026-08-02' }));
    assert.equal(item.level, YELLOW);
    assert.match(item.entries[0].note, /81일/);
  });

  test('만든 날을 모르면 🟡', () => {
    assert.equal(evaluateS0(base({ keyCreatedAt: undefined })).level, YELLOW);
  });

  test('읽기 실패나 차단 장치 멈춤은 🔴', () => {
    const failed = evaluateS0(base({ keyCreatedAt: '2026-10-01', failures: [{ source: 'orders.held', message: 'PERMISSION_DENIED' }] }));
    assert.equal(failed.level, RED);
    const stopped = evaluateS0(base({ stop: { code: 'key-email-mismatch', message: '다른 열쇠' } }));
    assert.equal(stopped.level, RED);
    assert.equal(stopped.entries.length, 1);
  });
});

describe('전체 보고', () => {
  test('이상이 없으면 🟢 · 건수 0', () => {
    const report = evaluateAll({ now: NOW, keyCreatedAt: '2026-10-01', stores: [] });
    assert.equal(report.date, '2026-10-22');
    assert.equal(report.overall, GREEN);
    assert.deepEqual(report.counts, { red: 0, yellow: 0 });
    assert.equal(report.items.length, 12);
  });

  test('stores에서 가게 이름을 찾아 쓴다', () => {
    const report = evaluateAll({
      now: NOW,
      keyCreatedAt: '2026-10-01',
      stores: [{ id: 'store-a', name: '디어 오키드' }],
      heldOrders: [{ status: 'DELIVERY_HELD', storeId: 'store-a', orderNumber: 'H-1', deliveryHold: { heldAt: iso(NOW - 2 * DAY_MS) } }],
    });
    const o4 = report.items.find((i) => i.id === 'O4');
    assert.equal(o4.entries[0].storeName, '디어 오키드');
    assert.equal(report.overall, YELLOW);
  });

  test('읽기에 실패한 출처를 쓰는 항목은 🟢으로 채우지 않고 확인 못 함으로 둔다', () => {
    const report = evaluateAll({
      now: NOW,
      keyCreatedAt: '2026-10-01',
      failures: [{ source: 'auditLogs', message: 'DEADLINE_EXCEEDED' }],
    });
    const s1 = report.items.find((i) => i.id === 'S1');
    const s2 = report.items.find((i) => i.id === 'S2');
    assert.equal(s1.level, null);
    assert.equal(s1.checked, false);
    assert.equal(s2.checked, false);
    assert.equal(report.overall, RED);
  });

  test('차단 장치가 멈추면 S0 하나만 내고 🔴', () => {
    const report = evaluateAll({ now: NOW, stop: { code: 'key-path-missing', message: '열쇠 경로 없음' } });
    assert.deepEqual(report.items.map((i) => i.id), ['S0']);
    assert.equal(report.overall, RED);
  });
});
