import { describe, expect, it } from 'vitest';
import {
  getAllowedOperationAction,
  ISSUE_LABELS,
  readOperationIssue,
  readOperationIssueList,
  readStoreOperationIssueList,
} from './operation-issues';

const baseIssue = {
  id: 'issue-1',
  storeId: 'store-1',
  orderId: 'order-1',
  paymentId: 'payment-1',
  type: 'AUTO_REFUND_FAILED',
  severity: 'warning',
  status: 'OPEN',
  createdAt: '2026-07-18T01:00:00.000Z',
  updatedAt: '2026-07-18T02:00:00.000Z',
  resolvedAt: null,
  latestSnapshot: {
    orderStatus: 'CANCELLED',
    paymentStatus: 'REFUND_FAILED',
    phone: '010-0000-0000',
  },
  actions: [],
};

function requireIssue(value: unknown) {
  const issue = readOperationIssue(value);
  expect(issue).not.toBeNull();
  if (!issue) throw new Error('테스트 운영 기록을 읽지 못했습니다.');
  return issue;
}

describe('주문 상세 운영 예외 계약', () => {
  it('현재 주문의 안전한 응답만 읽고 허용되지 않은 스냅샷 필드는 버린다', () => {
    const issues = readOperationIssueList(
      {
        items: [
          baseIssue,
          { ...baseIssue, id: 'issue-2', orderId: 'other-order' },
          { ...baseIssue, id: 'issue-3', status: 'UNKNOWN' },
        ],
      },
      { storeId: 'store-1', orderId: 'order-1' },
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: 'issue-1',
      latestSnapshot: {
        orderStatus: 'CANCELLED',
        paymentStatus: 'REFUND_FAILED',
      },
    });
    expect(issues[0]?.latestSnapshot).not.toHaveProperty('phone');
  });

  it('환불과 고객 안내의 열린 예외에만 서버 허용 조치를 연결한다', () => {
    expect(getAllowedOperationAction(requireIssue(baseIssue))).toBe('RETRY_REFUND');
    expect(
      getAllowedOperationAction(
        requireIssue({
          ...baseIssue,
          type: 'CUSTOMER_NOTICE_FAILED',
        }),
      ),
    ).toBe('RESEND_SMS');

    for (const type of ['PAYMENT_LOOKUP_FAILED', 'REDELIVERY_FAILED'] as const) {
      expect(getAllowedOperationAction(requireIssue({ ...baseIssue, type }))).toBeNull();
    }
    expect(
      getAllowedOperationAction(requireIssue({ ...baseIssue, status: 'RESOLVED' })),
    ).toBeNull();
  });

  it('성공·실패 감사 기록과 직전 재조회 상태만 검증해 보존한다', () => {
    const issue = readOperationIssue({
      ...baseIssue,
      currentState: {
        orderStatus: 'CANCELLED',
        paymentStatus: 'PAID',
        address: '경기도 이천시',
      },
      actions: [
        {
          actorId: 'seller-1',
          actionType: 'RETRY_REFUND',
          performedAt: { _seconds: 1784336400, _nanoseconds: 0 },
          status: 'SUCCEEDED',
        },
        {
          actorId: 'seller-1',
          actionType: 'RETRY_REFUND',
          performedAt: '2026-07-18T03:00:00.000Z',
          status: 'FAILED',
          failureReason: '환불 제공자 일시 오류',
        },
      ],
    });

    expect(issue?.currentState).toEqual({
      orderStatus: 'CANCELLED',
      paymentStatus: 'PAID',
    });
    expect(issue?.actions).toHaveLength(2);
    expect(issue?.actions[0]?.performedAt).toBe('2026-07-18T01:00:00.000Z');
    expect(issue?.actions[1]).toMatchObject({
      status: 'FAILED',
      failureReason: '환불 제공자 일시 오류',
    });
  });
});

describe('가게 전체 운영 기록 목록', () => {
  it('같은 가게의 기록을 열린 기록·critical 우선·최근 순으로 읽고 다른 가게 기록은 버린다', () => {
    const issues = readStoreOperationIssueList(
      {
        items: [
          {
            ...baseIssue,
            id: 'resolved',
            status: 'RESOLVED',
            updatedAt: '2026-07-19T00:00:00.000Z',
          },
          { ...baseIssue, id: 'warning-new', updatedAt: '2026-07-18T05:00:00.000Z' },
          {
            ...baseIssue,
            id: 'critical-old',
            type: 'FINALIZATION_REFUND_FAILED',
            severity: 'critical',
            updatedAt: '2026-07-18T01:00:00.000Z',
          },
          { ...baseIssue, id: 'other-store', storeId: 'store-2' },
        ],
      },
      'store-1',
    );
    expect(issues.map((issue) => issue.id)).toEqual(['critical-old', 'warning-new', 'resolved']);
  });

  it('서버가 critical로 남기는 결과 불명확 기록 유형을 걸러내지 않는다', () => {
    for (const type of ['FINALIZATION_REFUND_FAILED', 'DELIVERY_PHOTO_RECONCILIATION_REQUIRED']) {
      const issue = requireIssue({ ...baseIssue, type, severity: 'critical' });
      expect(issue.type).toBe(type);
      expect(ISSUE_LABELS[issue.type]).toBeTruthy();
      expect(getAllowedOperationAction(issue)).toBeNull();
    }
  });

  it('응답 모양이 다르면 빈 목록으로 위장하지 않는다', () => {
    expect(() => readStoreOperationIssueList({ issues: [] }, 'store-1')).toThrow();
  });
});
