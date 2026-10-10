import type { ConfigService } from '@nestjs/config';
import { AligoClient, normalizeAligoRecipientPhone } from './aligo.client';

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
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('알림톡 dispatch를 차단하고 외부 fetch를 하지 않는다', async () => {
    global.fetch = jest.fn();
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
    global.fetch = jest.fn();
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
    global.fetch = jest.fn();
    const client = makeClient({});

    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      channel: null,
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('ALIGO 수신번호 단일 휴대폰 형식 강제', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it.each([
    ['01012345678', '01012345678'],
    ['010-1234-5678', '01012345678'],
    [' 010 1234 5678 ', '01012345678'],
    ['(010)1234-5678', '01012345678'],
    ['+82 10-1234-5678', '01012345678'],
    ['+82-010-1234-5678', '01012345678'],
    ['011-123-4567', '0111234567'],
  ])('%s → %s로 정규화한다', (raw, expected) => {
    expect(normalizeAligoRecipientPhone(raw)).toBe(expected);
  });

  it.each([
    '01012345678,01087654321',
    '010-1234-5678;010-8765-4321',
    '02-123-4567',
    '1588-0000',
    '',
    '010-1234-567',
    'abc',
  ])('단일 휴대폰 번호가 아닌 값(%s)은 거부한다', (raw) => {
    expect(normalizeAligoRecipientPhone(raw)).toBeNull();
  });

  it('여러 번호를 이은 수신번호는 알림톡·문자 모두 외부 호출 없이 거부한다', async () => {
    global.fetch = jest.fn();
    const client = makeClient(configured);

    await expect(
      client.sendAlimtalk('01012345678,01087654321', templateCode, variables),
    ).resolves.toMatchObject({
      success: false,
      outcome: 'REJECTED',
      alimtalkAttempts: 0,
      smsAttempts: 0,
      errorMessage: '수신번호가 단일 휴대폰 번호 형식이 아닙니다.',
    });
    await expect(
      client.sendSms('01012345678,01087654321', templateCode, variables),
    ).resolves.toMatchObject({ success: false, outcome: 'REJECTED', smsAttempts: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('하이픈이 있는 번호는 숫자만 남겨 receiver로 보낸다', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ code: 0, info: { mid: 1 } }),
    });
    const client = makeClient(configured);

    await client.sendAlimtalk('010-1234-5678', templateCode, variables);

    const body = (global.fetch as jest.Mock).mock.calls[0][1].body as URLSearchParams;
    expect(body.get('receiver_1')).toBe('01012345678');
  });
});
