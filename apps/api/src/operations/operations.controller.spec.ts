import { ForbiddenException } from '@nestjs/common';
import { validate } from 'class-validator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { OperationActionDto } from './dto/operation-action.dto';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

type Data = Record<string, unknown>;

function makeFirestore(initial: Record<string, Data>) {
  const records = new Map(Object.entries(initial));
  const doc = (path: string) => ({
    get: jest.fn(async () => ({
      exists: records.has(path),
      data: () => records.get(path),
    })),
    update: jest.fn(async (data: Data) => {
      records.set(path, { ...(records.get(path) ?? {}), ...data });
    }),
  });
  const firestore = {
    doc,
    collection: jest.fn((name: string) => {
      const filters: Array<[string, unknown]> = [];
      return {
        where(field: string, _operator: string, value: unknown) {
          filters.push([field, value]);
          return this;
        },
        async get() {
          return {
            docs: Array.from(records.entries())
              .filter(([path, data]) => {
                return (
                  path.startsWith(`${name}/`) &&
                  filters.every(([field, value]) => data[field] === value)
                );
              })
              .map(([, data]) => ({ data: () => data })),
          };
        },
      };
    }),
    Timestamp: { now: jest.fn(() => '2026-07-17T10:00:00.000+09:00') },
  };
  return { firestore, records };
}

function makeController(initial: Record<string, Data>) {
  const store = makeFirestore(initial);
  const payments = { processRefundByOrderId: jest.fn().mockResolvedValue(undefined) };
  const notifications = { resendSms: jest.fn().mockResolvedValue({ success: true }) };
  const service = new OperationsService(
    store.firestore as never,
    payments as never,
    notifications as never,
  );
  const executeAction = jest.spyOn(service, 'executeAction');
  return {
    ...store,
    controller: new OperationsController(service),
    executeAction,
    notifications,
    payments,
  };
}

const seller = { sub: 'seller-1', role: 'seller' as const };
const otherSeller = { sub: 'seller-2', role: 'seller' as const };
const safeIssue = {
  id: 'issue-1',
  storeId: 'store-1',
  orderId: 'order-1',
  paymentId: 'payment-1',
  type: 'REFUND_FAILED',
  severity: 'warning',
  status: 'OPEN',
  latestSnapshot: {
    orderStatus: 'CANCELLED',
    paymentStatus: 'PAID',
    phone: '민감한 전화번호',
  },
  actions: [],
};

describe('운영 예외 컨트롤러 계약', () => {
  it('인증과 seller·admin 역할 가드를 컨트롤러 전체에 요구한다', () => {
    const guards = Reflect.getMetadata('__guards__', OperationsController);
    expect(guards).toHaveLength(2);
    expect(Reflect.getMetadata(ROLES_KEY, OperationsController)).toEqual(['seller', 'admin']);
  });

  it('셀러는 자기 스토어 운영 예외만 목록 조회한다', async () => {
    const { controller } = makeController({
      'stores/store-1': { ownerId: 'seller-1' },
      'operationIssues/issue-1': safeIssue,
      'operationIssues/issue-2': { ...safeIssue, id: 'issue-2', storeId: 'store-2' },
    });

    await expect(controller.list('store-1', seller)).resolves.toMatchObject({
      items: [{ id: 'issue-1', storeId: 'store-1', status: 'OPEN' }],
    });
  });

  it('다른 스토어 목록과 상세 조회를 거부한다', async () => {
    const { controller } = makeController({
      'stores/store-1': { ownerId: 'seller-1' },
      'operationIssues/issue-1': safeIssue,
    });

    await expect(controller.list('store-1', otherSeller)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.get('store-2', 'issue-1', seller)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('다른 스토어 운영 예외에는 조치를 실행하지 않는다', async () => {
    const { controller, executeAction, payments } = makeController({
      'stores/store-2': { ownerId: 'seller-2' },
      'operationIssues/issue-1': safeIssue,
    });

    await expect(
      controller.execute('store-2', 'issue-1', seller, { actionType: 'RETRY_REFUND' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(executeAction).not.toHaveBeenCalled();
    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
  });

  it.each([
    'RETRY_REFUND',
    'RESEND_SMS',
  ] as const)('%s 조치는 인증 사용자 식별자를 actorId로 전달한다', async (actionType) => {
    const { controller, executeAction } = makeController({
      'stores/store-1': { ownerId: 'seller-1' },
      'operationIssues/issue-1': safeIssue,
      'orders/order-1': { status: 'CANCELLED' },
      'payments/payment-1': { status: actionType === 'RETRY_REFUND' ? 'PAID' : 'CANCELLED' },
    });

    await controller.execute('store-1', 'issue-1', seller, { actionType });

    expect(executeAction).toHaveBeenCalledWith({
      issueId: 'issue-1',
      actorId: 'seller-1',
      actionType,
    });
  });

  it('알 수 없는 조치 유형과 actorId 주입 필드를 검증에서 거부한다', async () => {
    const invalid = Object.assign(new OperationActionDto(), {
      actionType: 'DELETE_ISSUE',
      actorId: 'seller-2',
    });
    const errors = await validate(invalid, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['actionType', 'actorId']),
    );
  });

  it('해결된 항목 재조치는 외부 부작용을 만들지 않는다', async () => {
    const { controller, notifications, payments } = makeController({
      'stores/store-1': { ownerId: 'seller-1' },
      'operationIssues/issue-1': { ...safeIssue, status: 'RESOLVED' },
      'orders/order-1': { status: 'DELIVERED' },
      'payments/payment-1': { status: 'REFUNDED' },
    });

    await controller.execute('store-1', 'issue-1', seller, { actionType: 'RETRY_REFUND' });
    await controller.execute('store-1', 'issue-1', seller, { actionType: 'RESEND_SMS' });

    expect(payments.processRefundByOrderId).not.toHaveBeenCalled();
    expect(notifications.resendSms).not.toHaveBeenCalled();
  });

  it('상세와 재조회 응답에서 개인정보와 비밀값을 제외한다', async () => {
    const { controller } = makeController({
      'stores/store-1': { ownerId: 'seller-1' },
      'operationIssues/issue-1': {
        ...safeIssue,
        phone: '민감한 전화번호',
        address: '민감한 주소',
        messageBody: '민감한 본문',
        token: '민감한 토큰',
      },
      'orders/order-1': { status: 'CANCELLED', address: '민감한 주소' },
      'payments/payment-1': { status: 'PAID', secret: '민감한 비밀값' },
    });

    const detail = await controller.get('store-1', 'issue-1', seller);
    const refreshed = await controller.refresh('store-1', 'issue-1', seller);

    expect(JSON.stringify({ detail, refreshed })).not.toMatch(
      /민감한|phone|address|messageBody|token|secret/i,
    );
    expect(refreshed).toMatchObject({
      currentState: { orderStatus: 'CANCELLED', paymentStatus: 'PAID' },
    });
  });
});
