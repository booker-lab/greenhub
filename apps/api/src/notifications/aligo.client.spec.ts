import type { ConfigService } from '@nestjs/config';
import { AligoClient } from './aligo.client';

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

const configured = {
  ALIGO_API_KEY: 'test-api-key',
  ALIGO_USER_ID: 'test-user',
  ALIGO_SENDER_KEY: 'test-sender-key',
  ALIGO_SENDER_PHONE: '0212345678',
  ALIGO_TEMPLATE_CODES_JSON: JSON.stringify({
    [templateCode]: 'provider-delivery-held',
  }),
};

describe('AligoClient local DENY_ALL_EXTERNAL_PROVIDER_DISPATCH', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('알림톡 dispatch를 차단하고 외부 fetch를 하지 않는다', async () => {
    jest.spyOn(global, 'fetch');
    const client = makeClient({
      ...configured,
      GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY: 'DENY_ALL_EXTERNAL_PROVIDER_DISPATCH',
    });

    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      channel: null,
      alimtalkAttempts: 0,
      smsAttempts: 0,
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('문자 dispatch를 차단하고 외부 fetch를 하지 않는다', async () => {
    jest.spyOn(global, 'fetch');
    const client = makeClient({
      ...configured,
      GREENHUB_LOCAL_PROVIDER_OUTBOUND_POLICY: 'DENY_ALL_EXTERNAL_PROVIDER_DISPATCH',
    });

    await expect(client.sendSms(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      channel: null,
      alimtalkAttempts: 0,
      smsAttempts: 0,
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('DENY 정책이 없으면 기존 설정 누락 계약을 유지한다', async () => {
    jest.spyOn(global, 'fetch');
    const client = makeClient({});

    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      channel: null,
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
