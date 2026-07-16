import type { ConfigService } from '@nestjs/config';
import { AligoClient } from './aligo.client';
import { NotificationsService } from './notifications.service';

type Data = Record<string, unknown>;

const phone = '01012345678';
const templateCode = 'ORDER_DELIVERY_HELD';
const variables = {
  orderId: 'order-1',
  reason: '연락 불가',
};

function makeClient(config: Data = {}) {
  const configService = {
    get: jest.fn((key: string, fallback: string) => config[key] ?? fallback),
  } as unknown as ConfigService;
  return new AligoClient(configService);
}

function response(code: number, message = '오류') {
  return {
    json: jest.fn().mockResolvedValue({ code, message }),
  } as unknown as Response;
}

function requestBody(callIndex: number) {
  const init = (global.fetch as jest.Mock).mock.calls[callIndex][1] as RequestInit;
  return init.body as URLSearchParams;
}

describe('회차 직배송 알림 전달 계약', () => {
  const configured = {
    ALIGO_API_KEY: 'test-api-key',
    ALIGO_USER_ID: 'test-user',
    ALIGO_SENDER_KEY: 'test-sender-key',
    ALIGO_SENDER_PHONE: '0212345678',
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('알림톡이 성공하면 추가 재시도와 문자 대체를 하지 않는다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(0));
    const client = makeClient(configured);

    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: true,
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('/alimtalk/');
  });

  it('일시 오류가 나면 알림톡을 최대 3회까지 재시도하고 성공 시 중단한다', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(-1, '일시 오류'))
      .mockResolvedValueOnce(response(0));
    const client = makeClient(configured);

    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: true,
    });

    expect(global.fetch).toHaveBeenCalledTimes(3);
    for (const [url] of (global.fetch as jest.Mock).mock.calls) {
      expect(String(url)).toContain('/alimtalk/');
    }
  });

  it('알림톡 3회 실패 후 같은 내용을 문자로 대체한다', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(-1, '알림톡 실패'))
      .mockResolvedValueOnce(response(-1, '알림톡 실패'))
      .mockResolvedValueOnce(response(-1, '알림톡 실패'))
      .mockResolvedValueOnce(response(0));
    const client = makeClient(configured);

    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: true,
    });

    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(String((global.fetch as jest.Mock).mock.calls[3][0])).toContain('apis.aligo.in/send');
    expect(requestBody(3).get('receiver')).toBe(phone);
    expect(requestBody(3).get('msg')).toBe(requestBody(0).get('message_1'));
  });

  it('알림톡 설정 키가 누락되면 발송 성공으로 처리하지 않는다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(response(0));
    const client = makeClient();

    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  describe('최종 실패 운영 예외', () => {
    function makeService(finalResult: { success: boolean; errorMessage?: string }) {
      const records = new Map<string, Data>([
        [
          'users/user-1',
          {
            id: 'user-1',
            phone,
          },
        ],
        [
          'orders/order-1',
          {
            id: 'order-1',
            storeId: 'store-1',
            userId: 'user-1',
            status: 'DELIVERY_HELD',
          },
        ],
      ]);
      const writes: Array<{ path: string; data: Data }> = [];
      const doc = jest.fn((path: string) => ({
        get: jest.fn(async () => ({
          exists: records.has(path),
          data: () => records.get(path),
        })),
        set: jest.fn(async (data: Data) => {
          writes.push({ path, data });
          records.set(path, data);
        }),
        update: jest.fn(async (data: Data) => {
          writes.push({ path, data });
          records.set(path, { ...(records.get(path) ?? {}), ...data });
        }),
      }));
      const firestore = {
        doc,
        Timestamp: {
          now: jest.fn(() => new Date('2026-07-17T03:00:00.000+09:00')),
        },
      };
      const aligo = {
        sendAlimtalk: jest.fn().mockResolvedValue(finalResult),
      };
      const payments = {};
      const operations = {
        createOrMergeIssue: jest.fn(async (data: Data) => {
          const path = `operationIssues/${String(data.idempotencyKey)}`;
          if (records.has(path)) return records.get(path);
          const issue = {
            ...data,
            id: path.slice('operationIssues/'.length),
            status: 'OPEN',
          };
          writes.push({ path, data: issue });
          records.set(path, issue);
          return issue;
        }),
      };
      const service = new (NotificationsService as any)(firestore, aligo, payments, operations);
      return { service: service as NotificationsService, records, writes, aligo };
    }

    it('문자 대체가 성공하면 운영 예외를 만들지 않고 기존 일반 알림 기록을 유지한다', async () => {
      const { service, writes, aligo, records } = makeService({ success: true });

      await service.sendToUser('user-1', templateCode, variables, 'order-1');

      expect(aligo.sendAlimtalk).toHaveBeenCalledWith(phone, templateCode, variables);
      expect(writes.filter(({ path }) => path.startsWith('notifications/'))).toHaveLength(1);
      expect(writes.filter(({ path }) => path.startsWith('operationIssues/'))).toHaveLength(0);
      expect(records.get('orders/order-1')).toMatchObject({ status: 'DELIVERY_HELD' });
    });

    it('문자 대체까지 실패하면 CUSTOMER_NOTICE_FAILED 운영 예외를 만든다', async () => {
      const { service, writes, records } = makeService({
        success: false,
        errorMessage: '문자 대체 실패',
      });

      await service.sendToUser('user-1', templateCode, variables, 'order-1');

      const issues = writes.filter(({ path }) => path.startsWith('operationIssues/'));
      expect(issues).toHaveLength(1);
      expect(issues[0].data).toMatchObject({
        orderId: 'order-1',
        type: 'CUSTOMER_NOTICE_FAILED',
        status: 'OPEN',
        idempotencyKey: `customer-notice-failed:order-1:${templateCode}`,
      });
      expect(records.get('orders/order-1')).toMatchObject({ status: 'DELIVERY_HELD' });
    });

    it('동일 알림을 재처리해도 운영 예외를 중복 생성하지 않는다', async () => {
      const { service, writes } = makeService({
        success: false,
        errorMessage: '문자 대체 실패',
      });

      await service.sendToUser('user-1', templateCode, variables, 'order-1');
      await service.sendToUser('user-1', templateCode, variables, 'order-1');

      expect(writes.filter(({ path }) => path.startsWith('operationIssues/'))).toHaveLength(1);
    });
  });
});
