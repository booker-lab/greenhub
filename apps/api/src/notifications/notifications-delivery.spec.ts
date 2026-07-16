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
      channel: 'alimtalk',
      alimtalkAttempts: 1,
      smsAttempts: 0,
      message: expect.stringContaining('배송이 보류되었습니다'),
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
      channel: 'alimtalk',
      alimtalkAttempts: 3,
      smsAttempts: 0,
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
      channel: 'sms',
      alimtalkAttempts: 3,
      smsAttempts: 1,
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
    function makeService(
      finalResult: {
        success: boolean;
        channel?: 'alimtalk' | 'sms' | null;
        message?: string;
        alimtalkAttempts?: number;
        smsAttempts?: number;
        errorMessage?: string;
      },
      overrides: Data = {},
    ) {
      const records = new Map<string, Data>([
        [
          'users/user-1',
          {
            id: 'user-1',
            phone: '01011112222',
          },
        ],
        [
          'orders/order-1',
          {
            id: 'order-1',
            storeId: 'store-1',
            userId: 'user-1',
            status: 'DELIVERY_HELD',
            deliveryPhone: phone,
            ...overrides,
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
        sendSms: jest.fn().mockResolvedValue({
          success: true,
          channel: 'sms',
          message: '재발송 본문',
          alimtalkAttempts: 0,
          smsAttempts: 1,
        }),
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
      return { service: service as NotificationsService, records, writes, aligo, operations };
    }

    it('문자 대체가 성공하면 실제 채널과 시도 횟수로 배송 연락처 발송을 기록한다', async () => {
      const { service, writes, aligo, records } = makeService({
        success: true,
        channel: 'sms',
        message: '승인된 배송 보류 본문',
        alimtalkAttempts: 3,
        smsAttempts: 1,
      });

      await service.sendToUser('user-1', templateCode, variables, 'order-1');

      expect(aligo.sendAlimtalk).toHaveBeenCalledWith(phone, templateCode, variables);
      const notifications = writes.filter(({ path }) => path.startsWith('notifications/'));
      expect(notifications).toHaveLength(1);
      expect(notifications[0].data).toMatchObject({
        channel: 'sms',
        phone,
        message: '승인된 배송 보류 본문',
        attemptCount: 4,
        status: 'sent',
      });
      expect(writes.filter(({ path }) => path.startsWith('operationIssues/'))).toHaveLength(0);
      expect(records.get('orders/order-1')).toMatchObject({ status: 'DELIVERY_HELD' });
    });

    it('주문 배송 연락처가 없을 때만 사용자 프로필 연락처를 사용한다', async () => {
      const { service, aligo } = makeService(
        {
          success: true,
          channel: 'alimtalk',
          message: '승인된 배송 보류 본문',
          alimtalkAttempts: 1,
          smsAttempts: 0,
        },
        { deliveryPhone: null },
      );

      await service.sendToUser('user-1', templateCode, variables, 'order-1');

      expect(aligo.sendAlimtalk).toHaveBeenCalledWith('01011112222', templateCode, variables);
    });

    it('배송 연락처와 허용된 대체 연락처가 모두 없으면 성공 기록 없이 운영 예외를 만든다', async () => {
      const { service, writes, aligo } = makeService(
        {
          success: true,
          channel: 'alimtalk',
          message: '호출되면 안 됨',
          alimtalkAttempts: 1,
          smsAttempts: 0,
        },
        { deliveryPhone: null },
      );
      const user = (await (service as any).firestore.doc('users/user-1').get()).data();
      user.phone = null;

      await service.sendToUser('user-1', templateCode, variables, 'order-1');

      expect(aligo.sendAlimtalk).not.toHaveBeenCalled();
      expect(writes.filter(({ path }) => path.startsWith('notifications/'))).toHaveLength(0);
      expect(writes.filter(({ path }) => path.startsWith('operationIssues/'))).toHaveLength(1);
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

    it('운영 문자 재발송은 실제 SMS 결과와 단일 시도를 별도 알림 기록으로 남긴다', async () => {
      const { service, writes, aligo } = makeService({
        success: false,
        channel: null,
        message: '승인된 배송 보류 본문',
        alimtalkAttempts: 3,
        smsAttempts: 1,
        errorMessage: '문자 대체 실패',
      });

      await service.sendToUser('user-1', templateCode, variables, 'order-1');
      const issue = writes.find(({ path }) => path.startsWith('operationIssues/'))?.data;

      await expect(service.resendSms(issue as never)).resolves.toMatchObject({
        success: true,
        channel: 'sms',
        smsAttempts: 1,
      });
      expect(aligo.sendSms).toHaveBeenCalledWith(phone, templateCode, variables);
      expect(
        writes.filter(
          ({ path, data }) => path.startsWith('notifications/') && data.channel === 'sms',
        ),
      ).toHaveLength(1);
    });
  });
});
