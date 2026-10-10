import type { ConfigService } from '@nestjs/config';

const proxyAgentConstructor = jest.fn();
const undiciFetch = jest.fn();

jest.mock('undici', () => ({
  ProxyAgent: jest.fn().mockImplementation((url: string) => {
    proxyAgentConstructor(url);
    return { kind: 'proxy-agent' };
  }),
  fetch: (...args: unknown[]) => undiciFetch(...args),
}));

import { AligoClient, resolveAligoOutboundFetch } from './aligo.client';

type Data = Record<string, unknown>;

const phone = '01012345678';
const templateCode = 'ORDER_DELIVERY_HELD';
const variables = { orderId: 'order-1', reason: '연락 불가' };
const proxyUrl = 'http://fixie:proxy-password@proxy.example.test:80'; // trufflehog:ignore

const configured = {
  ALIGO_API_KEY: 'test-api-key',
  ALIGO_USER_ID: 'test-user',
  ALIGO_SENDER_KEY: 'test-sender-key',
  ALIGO_SENDER_PHONE: '0212345678',
  ALIGO_TEMPLATE_CODES_JSON: JSON.stringify({ [templateCode]: 'provider-delivery-held' }),
};

function makeClient(config: Data = {}) {
  const configService = {
    get: jest.fn((key: string, fallback: string) => config[key] ?? fallback),
  } as unknown as ConfigService;
  return new AligoClient(configService);
}

function jsonResponse(body: unknown) {
  return { status: 200, json: async () => body };
}

describe('ALIGO 송신 프록시(ALIGO_OUTBOUND_PROXY_URL)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    proxyAgentConstructor.mockClear();
    undiciFetch.mockReset();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('설정이 없으면 기존처럼 전역 fetch로 직접 호출하고 프록시를 만들지 않는다', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(jsonResponse({ code: 0, info: { mid: 1 } }));
    const client = makeClient(configured);

    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: true,
      channel: 'alimtalk',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://kakaoapi.aligo.in/akv10/alimtalk/send/',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(proxyAgentConstructor).not.toHaveBeenCalled();
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it('설정이 있으면 알림톡을 프록시 dispatcher로 보내고 전역 fetch는 쓰지 않는다', async () => {
    undiciFetch.mockResolvedValue(jsonResponse({ code: 0, info: { mid: 1 } }));
    const client = makeClient({ ...configured, ALIGO_OUTBOUND_PROXY_URL: proxyUrl });

    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: true,
      channel: 'alimtalk',
    });

    expect(proxyAgentConstructor).toHaveBeenCalledWith(proxyUrl);
    expect(undiciFetch).toHaveBeenCalledWith(
      'https://kakaoapi.aligo.in/akv10/alimtalk/send/',
      expect.objectContaining({ method: 'POST', dispatcher: { kind: 'proxy-agent' } }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('설정이 있으면 문자 발송도 같은 프록시로 보낸다', async () => {
    undiciFetch.mockResolvedValue(jsonResponse({ result_code: '1', msg_id: '123' }));
    const client = makeClient({ ...configured, ALIGO_OUTBOUND_PROXY_URL: proxyUrl });

    await client.sendSms(phone, templateCode, variables);

    expect(undiciFetch).toHaveBeenCalledWith(
      'https://apis.aligo.in/send/',
      expect.objectContaining({ method: 'POST', dispatcher: { kind: 'proxy-agent' } }),
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each([
    'not a url',
    'ftp://proxy.example.test:21',
    'socks5://fixie:pw@proxy.example.test:1080', // trufflehog:ignore
  ])('형식이 잘못된 설정(%s)이면 직접 호출로 우회하지 않고 네트워크 호출 없이 거부한다', async (invalid) => {
    const client = makeClient({ ...configured, ALIGO_OUTBOUND_PROXY_URL: invalid });

    await expect(client.sendAlimtalk(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      outcome: 'REJECTED',
      alimtalkAttempts: 0,
      smsAttempts: 0,
      errorMessage: 'ALIGO 송신 프록시 설정이 올바르지 않습니다.',
    });
    await expect(client.sendSms(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      smsAttempts: 0,
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(undiciFetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://fixie:proxy-password@proxy.example.test:80', // trufflehog:ignore
    'https://fixie:proxy-password@proxy.example.test:443', // trufflehog:ignore
  ])('운영 고정 IP 프록시 형식(%s)은 http·https 모두 허용한다', (allowed) => {
    expect(resolveAligoOutboundFetch(allowed)).toHaveProperty('fetch');
    expect(proxyAgentConstructor).toHaveBeenCalledWith(allowed);
  });

  it('프록시 설정 오류 메시지에 인증 정보 원문을 남기지 않는다', () => {
    const secretish = 'ftp://fixie:proxy-password@proxy.example.test:21'; // trufflehog:ignore
    const result = resolveAligoOutboundFetch(secretish);

    expect(result).toEqual({ configError: 'ALIGO 송신 프록시 설정이 올바르지 않습니다.' });
    expect(JSON.stringify(result)).not.toContain('proxy-password');
  });
});
