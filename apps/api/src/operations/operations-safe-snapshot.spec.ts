import { OperationsService } from './operations.service';

type Data = Record<string, unknown>;

function makeService(initial: Record<string, Data>) {
  const records = new Map(Object.entries(initial));
  const firestore = {
    doc: (path: string) => ({
      get: jest.fn(async () => ({ exists: records.has(path), data: () => records.get(path) })),
    }),
    // 목록 조회의 조건·한도는 이 테스트 대상이 아니라서 모두 같은 문서 목록을 돌려준다.
    collection: jest.fn((name: string) => ({
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn(async () => ({
        docs: Array.from(records.entries())
          .filter(([path]) => path.startsWith(`${name}/`))
          .map(([path, data]) => ({ id: path.split('/')[1], data: () => data })),
      })),
    })),
  };
  return new OperationsService(firestore as never, {} as never, {} as never);
}

// 결제사 취소·분쟁 기록(payments.service의 reconcileProviderReversal)이 남기는 스냅샷 모양.
const reversalIssue = {
  id: 'issue-1',
  storeId: 'store-1',
  orderId: 'order-1',
  paymentId: 'order-1',
  type: 'PROVIDER_REVERSAL_DETECTED',
  severity: 'critical',
  status: 'OPEN',
  latestSnapshot: {
    orderStatus: 'ACCEPTED',
    paymentStatus: 'PAID',
    providerStatus: 'CANCELLED',
    providerEvent: 'Transaction.Cancelled',
    settlementStatus: 'confirmed',
    failureStage: 'provider_reversal',
    phone: '민감한 전화번호',
    address: '민감한 주소',
  },
  actions: [],
};

describe('운영 예외 응답 스냅샷', () => {
  it('결제사 취소·분쟁 기록의 결제사·정산 상태는 남기고 허용되지 않은 필드는 버린다', async () => {
    const service = makeService({
      'stores/store-1': { ownerId: 'seller-1' },
      'operationIssues/issue-1': reversalIssue,
    });

    const detail = await service.getIssueForStore('store-1', 'issue-1', 'seller-1', 'seller');
    const list = await service.listIssuesForStore('store-1', 'seller-1', 'seller');

    const expected = {
      orderStatus: 'ACCEPTED',
      paymentStatus: 'PAID',
      failureStage: 'provider_reversal',
      templateCode: null,
      providerStatus: 'CANCELLED',
      providerEvent: 'Transaction.Cancelled',
      settlementStatus: 'confirmed',
    };
    expect(detail['latestSnapshot']).toEqual(expected);
    expect(list.items[0]?.['latestSnapshot']).toEqual(expected);
    expect(JSON.stringify({ detail, list })).not.toMatch(/민감한|phone|address/);
  });

  it('문자열이 아닌 결제사·정산 상태 값은 null로 바꾼다', async () => {
    const service = makeService({
      'operationIssues/issue-1': {
        ...reversalIssue,
        latestSnapshot: {
          providerStatus: { raw: 'CANCELLED' },
          providerEvent: 42,
          settlementStatus: null,
        },
      },
    });

    const detail = await service.getIssueForStore('store-1', 'issue-1', 'admin-1', 'admin');

    expect(detail['latestSnapshot']).toMatchObject({
      providerStatus: null,
      providerEvent: null,
      settlementStatus: null,
    });
  });
});
