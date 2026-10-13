import { describe, expect, it } from 'vitest';
import { readStoreOperationIssueList } from '../orders/[id]/operation-issues';
import {
  attachManualResolutions,
  canManuallyResolve,
  isValidManualResolveMemo,
  normalizeManualResolveMemo,
  readManualResolution,
} from './manual-resolve';

const baseItem = {
  id: 'issue-1',
  storeId: 'store-1',
  orderId: 'order-1',
  paymentId: 'order-1',
  type: 'DELIVERY_PHOTO_RECONCILIATION_REQUIRED',
  severity: 'critical',
  status: 'OPEN',
  createdAt: '2026-10-10T01:00:00.000Z',
  updatedAt: '2026-10-10T02:00:00.000Z',
  resolvedAt: null,
  resolution: null,
  latestSnapshot: {},
  actions: [],
};

const manual = {
  method: 'MANUAL',
  actorId: 'seller-1',
  actorRole: 'seller',
  memo: '고객과 통화해 확인했어요',
  resolvedAt: { _seconds: 1_791_000_000, _nanoseconds: 0 },
};

function parse(payload: { items: unknown[] }) {
  return attachManualResolutions(payload, readStoreOperationIssueList(payload, 'store-1'));
}

describe('운영 기록 수동 닫기 화면 계약', () => {
  it('닫힌 기록의 수동 해결 경위를 읽어 붙이고 열린 기록에는 붙이지 않는다', () => {
    const issues = parse({
      items: [
        {
          ...baseItem,
          id: 'closed',
          status: 'RESOLVED',
          resolvedAt: '2026-10-10T03:00:00.000Z',
          resolution: manual,
        },
        { ...baseItem, id: 'open', resolution: manual },
      ],
    });

    expect(issues.find((issue) => issue.id === 'closed')?.resolution).toEqual({
      actorId: 'seller-1',
      actorRole: 'seller',
      memo: '고객과 통화해 확인했어요',
      resolvedAt: new Date(1_791_000_000 * 1000).toISOString(),
    });
    expect(issues.find((issue) => issue.id === 'open')?.resolution).toBeNull();
  });

  it('resolution이 없는 이전 응답과 자동 해결 기록도 그대로 읽는다', () => {
    const { resolution: _drop, ...legacy } = baseItem;
    const issues = parse({
      items: [
        legacy,
        {
          ...baseItem,
          id: 'auto',
          type: 'AUTO_REFUND_FAILED',
          status: 'RESOLVED',
          resolvedAt: '2026-10-10T03:00:00.000Z',
          actions: [
            {
              actorId: 'seller-1',
              actionType: 'RETRY_REFUND',
              performedAt: '2026-10-10T03:00:00.000Z',
              status: 'SUCCEEDED',
            },
          ],
        },
      ],
    });

    expect(issues.map((issue) => [issue.id, issue.resolution])).toEqual([
      ['issue-1', null],
      ['auto', null],
    ]);
  });

  it.each([
    ['방식이 다름', { ...manual, method: 'AUTO' }],
    ['역할이 다름', { ...manual, actorRole: 'consumer' }],
    ['수행자 형식 오류', { ...manual, actorId: '../users' }],
    ['빈 메모', { ...manual, memo: '   ' }],
    ['시각 없음', { ...manual, resolvedAt: null }],
  ])('%s 경위는 표시하지 않는다', (_label, value) => {
    expect(readManualResolution(value)).toBeNull();
  });

  it('표시할 메모는 한 줄로 맞춘다', () => {
    expect(readManualResolution({ ...manual, memo: '첫 줄\n둘째 줄' })?.memo).toBe('첫 줄 둘째 줄');
  });

  it('메모는 공백·제어문자를 정리한 뒤 1~200자만 받는다', () => {
    expect(normalizeManualResolveMemo('  첫 줄\r\n둘째 줄\t ')).toBe('첫 줄 둘째 줄');
    expect(isValidManualResolveMemo('   ')).toBe(false);
    expect(isValidManualResolveMemo('가'.repeat(200))).toBe(true);
    expect(isValidManualResolveMemo('가'.repeat(201))).toBe(false);
  });

  it('판매자는 결제사 취소·분쟁 기록을 닫을 수 없고 관리자는 닫을 수 있다', () => {
    const [photo, reversal, closed] = parse({
      items: [
        baseItem,
        {
          ...baseItem,
          id: 'reversal',
          type: 'PROVIDER_REVERSAL_DETECTED',
          updatedAt: '2026-10-10T01:30:00.000Z',
        },
        { ...baseItem, id: 'closed', status: 'RESOLVED', resolvedAt: '2026-10-10T03:00:00.000Z' },
      ],
    });

    expect(canManuallyResolve(photo, 'seller')).toBe(true);
    expect(canManuallyResolve(reversal, 'seller')).toBe(false);
    expect(canManuallyResolve(reversal, 'admin')).toBe(true);
    expect(canManuallyResolve(closed, 'admin')).toBe(false);
    expect(canManuallyResolve(photo, 'consumer')).toBe(false);
    expect(canManuallyResolve(photo, null)).toBe(false);
  });
});
