import type { ConfigService } from '@nestjs/config';
import {
  AligoClient,
  classifyAligoPermanentError,
  classifyAlimtalkProviderError,
  classifySmsProviderError,
} from './aligo.client';
import { NotificationsService } from './notifications.service';

type Data = Record<string, unknown>;

const phone = '01012345678';
const templateCode = 'ORDER_DELIVERY_HELD';
const variables = { orderId: 'order-1', reason: '연락 불가' };

const configured = {
  ALIGO_API_KEY: 'test-api-key',
  ALIGO_USER_ID: 'test-user',
  ALIGO_SENDER_KEY: 'test-sender-key',
  ALIGO_SENDER_PHONE: '0212345678',
  ALIGO_TEMPLATE_CODES_JSON: JSON.stringify({ [templateCode]: 'provider-delivery-held' }),
};

function makeClient(config: Data = configured) {
  const configService = {
    get: jest.fn((key: string, fallback: string) => config[key] ?? fallback),
  } as unknown as ConfigService;
  return new AligoClient(configService);
}

function alimtalkReject(code: number, message: string, status?: number) {
  return {
    status,
    json: jest.fn().mockResolvedValue({ code, message }),
  } as unknown as Response;
}

function smsReply(resultCode: number, message: string) {
  return {
    json: jest.fn().mockResolvedValue({ result_code: resultCode, message, msg_id: 'MSG-1' }),
  } as unknown as Response;
}

function fetchUrls(): string[] {
  return ((global.fetch as jest.Mock).mock.calls as Array<[string, unknown]>).map(([url]) =>
    String(url),
  );
}

describe('classifyAligoPermanentError — 재시도해도 결과가 같은 ALIGO 영구 오류', () => {
  it.each([
    [-99, '보유건수가 부족합니다', 'INSUFFICIENT_BALANCE'],
    [-99, '포인트가 부족합니다.', 'INSUFFICIENT_BALANCE'],
    [-99, '인증되지 않는 서버 IP 입니다.', 'UNAUTHORIZED_IP'],
    [-99, '등록되지 않은 인증키 입니다.', 'AUTH_FAILED'],
    [-99, '인증오류입니다.', 'AUTH_FAILED'],
    [-101, '인증오류입니다.', 'AUTH_FAILED'],
    [-99, '등록되지 않은 발신번호입니다.', 'SENDER_NOT_REGISTERED'],
    [-99, '템플릿코드가 존재하지 않습니다.', 'TEMPLATE_INVALID'],
    [
      -99,
      '발신 프로파일 키(=senderkey)파라메더 정보가 전달되지 않았습니다.',
      'SENDER_PROFILE_INVALID',
    ],
  ])('code=%s "%s" → %s', (code, message, reason) => {
    expect(classifyAligoPermanentError({ code, message })).toBe(reason);
  });

  it.each([
    [-99, '알 수 없는 오류'],
    [-1, '일시 오류'],
    [-1, 'timeout'],
    [-1, '초당 발송 한도를 초과했습니다'],
    [400, '잘못된 요청입니다'],
  ])('근거 없는 응답 code=%s "%s"는 영구 사유로 분류하지 않는다', (code, message) => {
    expect(classifyAligoPermanentError({ code, message })).toBeNull();
  });

  it('영구 사유는 재시도 가능 코드(-99)보다 우선해 PERMANENT로 분류된다', () => {
    expect(classifyAlimtalkProviderError({ code: -99, message: '보유건수가 부족합니다' })).toBe(
      'PERMANENT',
    );
    expect(classifySmsProviderError({ code: -99, message: '포인트가 부족합니다.' })).toBe(
      'PERMANENT',
    );
    // 사유가 확인되지 않은 -99는 기존처럼 재시도한다.
    expect(classifyAlimtalkProviderError({ code: -99, message: '알 수 없는 오류' })).toBe(
      'RETRYABLE',
    );
  });
});

describe('알림톡 영구 오류의 재시도 중단과 SMS 대체 판정', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('잔액 부족이면 알림톡 1회로 끝내고 SMS 대체도 건너뛴다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(alimtalkReject(-99, '보유건수가 부족합니다'));

    const result = await makeClient().sendAlimtalk(phone, templateCode, variables);

    expect(result).toMatchObject({
      success: false,
      outcome: 'REJECTED',
      errorClass: 'PERMANENT',
      permanentErrorReason: 'INSUFFICIENT_BALANCE',
      channel: null,
      alimtalkAttempts: 1,
      smsAttempts: 0,
      needsVerify: false,
      errorMessage: '보유건수가 부족합니다',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(fetchUrls().some((url) => url.includes('apis.aligo.in/send'))).toBe(false);
  });

  it('송신 IP 미인증(-99)이면 알림톡 1회로 끝내고 SMS 대체도 건너뛴다', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(alimtalkReject(-99, '인증되지 않는 서버 IP 입니다.'));

    const result = await makeClient().sendAlimtalk(phone, templateCode, variables);

    expect(result).toMatchObject({
      outcome: 'REJECTED',
      errorClass: 'PERMANENT',
      permanentErrorReason: 'UNAUTHORIZED_IP',
      alimtalkAttempts: 1,
      smsAttempts: 0,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('계정 인증 오류(-101)면 SMS 대체 없이 끝낸다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(alimtalkReject(-101, '인증오류입니다.'));

    const result = await makeClient().sendAlimtalk(phone, templateCode, variables);

    expect(result).toMatchObject({
      outcome: 'REJECTED',
      permanentErrorReason: 'AUTH_FAILED',
      alimtalkAttempts: 1,
      smsAttempts: 0,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('템플릿 오류는 알림톡 재시도를 멈추되 SMS 대체 1회는 유지한다', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(alimtalkReject(-99, '템플릿코드가 존재하지 않습니다.'))
      .mockResolvedValueOnce(smsReply(1, 'success'));

    const result = await makeClient().sendAlimtalk(phone, templateCode, variables);

    expect(result).toMatchObject({
      success: true,
      outcome: 'ACCEPTED',
      channel: 'sms',
      alimtalkAttempts: 1,
      smsAttempts: 1,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(fetchUrls()[1]).toContain('apis.aligo.in/send');
  });

  it('템플릿 오류 뒤 SMS도 실패하면 SMS 실패 사유를 최종 사유로 남긴다', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(alimtalkReject(-99, '템플릿코드가 존재하지 않습니다.'))
      .mockResolvedValueOnce(smsReply(-99, '포인트가 부족합니다.'));

    const result = await makeClient().sendAlimtalk(phone, templateCode, variables);

    expect(result).toMatchObject({
      success: false,
      outcome: 'REJECTED',
      errorClass: 'PERMANENT',
      permanentErrorReason: 'INSUFFICIENT_BALANCE',
      alimtalkAttempts: 1,
      smsAttempts: 1,
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('일시 오류(timeout 문구)는 기존대로 3회 재시도 뒤 SMS로 대체한다', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(alimtalkReject(-1, 'timeout'))
      .mockResolvedValueOnce(alimtalkReject(-1, 'timeout'))
      .mockResolvedValueOnce(alimtalkReject(-1, 'timeout'))
      .mockResolvedValueOnce(smsReply(1, 'success'));

    const promise = makeClient().sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({
      success: true,
      channel: 'sms',
      alimtalkAttempts: 3,
      smsAttempts: 1,
    });
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('5xx 응답은 기존대로 3회 재시도 뒤 SMS로 대체한다', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(alimtalkReject(9, '서버 오류', 502))
      .mockResolvedValueOnce(alimtalkReject(9, '서버 오류', 503))
      .mockResolvedValueOnce(alimtalkReject(9, '서버 오류', 500))
      .mockResolvedValueOnce(smsReply(1, 'success'));

    const promise = makeClient().sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();

    const result = await promise;
    expect(result).toMatchObject({
      success: true,
      channel: 'sms',
      alimtalkAttempts: 3,
      smsAttempts: 1,
    });
    expect(result.permanentErrorReason ?? null).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('사유를 확인할 수 없는 -99는 보수적으로 기존 재시도를 유지한다', async () => {
    jest.useFakeTimers();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(alimtalkReject(-99, '알 수 없는 오류'))
      .mockResolvedValueOnce(alimtalkReject(-99, '알 수 없는 오류'))
      .mockResolvedValueOnce(alimtalkReject(-99, '알 수 없는 오류'))
      .mockResolvedValueOnce(smsReply(1, 'success'));

    const promise = makeClient().sendAlimtalk(phone, templateCode, variables);
    await jest.runAllTimersAsync();

    await expect(promise).resolves.toMatchObject({
      channel: 'sms',
      alimtalkAttempts: 3,
      smsAttempts: 1,
    });
  });

  it('직접 SMS 발송의 잔액 부족도 영구 사유를 결과에 남긴다', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(smsReply(-99, '포인트가 부족합니다.'));

    await expect(makeClient().sendSms(phone, templateCode, variables)).resolves.toMatchObject({
      success: false,
      outcome: 'REJECTED',
      errorClass: 'PERMANENT',
      permanentErrorReason: 'INSUFFICIENT_BALANCE',
      smsAttempts: 1,
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('알림 기록에 provider 오류 분류를 남긴다', () => {
  function makeService(aligoResult: Data) {
    const records = new Map<string, Data>();
    records.set('users/user-1', { id: 'user-1', phone });
    const firestore = {
      doc: (path: string) => ({
        get: jest.fn(async () => ({
          exists: records.has(path),
          data: () => records.get(path),
        })),
        set: jest.fn(async (data: Data) => {
          records.set(path, data);
        }),
      }),
      Timestamp: { now: jest.fn(() => new Date(0)) },
    };
    const aligo = { sendAlimtalk: jest.fn().mockResolvedValue(aligoResult) };
    const issueWriter = { createOrMergeIssue: jest.fn() };
    const service = new (
      NotificationsService as unknown as new (
        ...args: unknown[]
      ) => NotificationsService
    )(firestore, aligo, {}, issueWriter);
    const notifications = () =>
      Array.from(records.entries())
        .filter(([path]) => path.startsWith('notifications/'))
        .map(([, data]) => data);
    return { service, notifications, issueWriter };
  }

  it('잔액 부족 최종 실패는 errorClass·permanentErrorReason을 알림 기록에 남긴다', async () => {
    const { service, notifications, issueWriter } = makeService({
      success: false,
      outcome: 'REJECTED',
      errorClass: 'PERMANENT',
      permanentErrorReason: 'INSUFFICIENT_BALANCE',
      channel: null,
      message: '본문',
      alimtalkAttempts: 1,
      smsAttempts: 0,
      providerReceipt: null,
      attemptId: 'attempt-1',
      needsVerify: false,
      errorMessage: '보유건수가 부족합니다',
    });

    await service.sendToUser('user-1', templateCode, variables);

    expect(notifications()).toEqual([
      expect.objectContaining({
        status: 'failed',
        attemptCount: 1,
        errorClass: 'PERMANENT',
        permanentErrorReason: 'INSUFFICIENT_BALANCE',
        errorMessage: '보유건수가 부족합니다',
      }),
    ]);
    // 주문 없는 발송이므로 운영 이슈 같은 새 부수효과는 없다.
    expect(issueWriter.createOrMergeIssue).not.toHaveBeenCalled();
  });

  it('성공 기록은 분류를 null로 남긴다', async () => {
    const { service, notifications } = makeService({
      success: true,
      outcome: 'ACCEPTED',
      errorClass: null,
      channel: 'alimtalk',
      message: '본문',
      alimtalkAttempts: 1,
      smsAttempts: 0,
      providerReceipt: 'MID-1',
      attemptId: 'attempt-1',
      needsVerify: false,
    });

    await service.sendToUser('user-1', templateCode, variables);

    expect(notifications()).toEqual([
      expect.objectContaining({ status: 'sent', errorClass: null, permanentErrorReason: null }),
    ]);
  });
});
