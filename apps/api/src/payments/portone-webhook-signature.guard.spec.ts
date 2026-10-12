import { type ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import type { PortoneClient } from './portone.client';
import {
  PortoneWebhookSignatureGuard,
  WEBHOOK_REJECTION_LOG_WINDOW_MS,
} from './portone-webhook-signature.guard';

type FakeRequest = {
  rawBody?: unknown;
  headers: Record<string, string | string[] | undefined>;
};

const RAW_BODY = Buffer.from('{"type":"Transaction.Paid"}', 'utf8');
const FIXED_NOW_MS = Date.parse('2026-10-12T00:00:00.000Z');

function contextFor(req: FakeRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

function signedRequest(overrides: Partial<FakeRequest['headers']> = {}): FakeRequest {
  return {
    rawBody: RAW_BODY,
    headers: {
      'webhook-id': 'webhook-1',
      'webhook-timestamp': '1760227200',
      'webhook-signature': 'v1,signature',
      ...overrides,
    },
  };
}

describe('PortoneWebhookSignatureGuard', () => {
  let verifyWebhookSignature: jest.Mock;
  let guard: PortoneWebhookSignatureGuard;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    verifyWebhookSignature = jest.fn();
    guard = new PortoneWebhookSignatureGuard({
      verifyWebhookSignature,
    } as unknown as PortoneClient);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('raw body와 세 헤더를 그대로 verifier에 넘기고 통과하면 true를 돌려준다', () => {
    expect(guard.canActivate(contextFor(signedRequest()))).toBe(true);

    expect(verifyWebhookSignature).toHaveBeenCalledWith(
      'webhook-1',
      '1760227200',
      RAW_BODY,
      'v1,signature',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['raw body 없음', { ...signedRequest(), rawBody: undefined }],
    ['raw body가 Buffer가 아님', { ...signedRequest(), rawBody: '{"type":"x"}' }],
    ['webhook-id 없음', signedRequest({ 'webhook-id': undefined })],
    ['webhook-timestamp 공백', signedRequest({ 'webhook-timestamp': '   ' })],
    ['webhook-signature 없음', signedRequest({ 'webhook-signature': undefined })],
    ['헤더가 문자열이 아님', signedRequest({ 'webhook-id': ['a', 'b'] })],
  ])('%s이면 verifier를 부르지 않고 401로 거부한다', (_label, req) => {
    expect(() => guard.canActivate(contextFor(req))).toThrow(
      new UnauthorizedException('웹훅 인증 정보가 누락되었습니다.'),
    );
    expect(verifyWebhookSignature).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('webhook rejected: reason=missing_credentials');
  });

  it('verifier의 예외를 그대로 던지고 사유를 signature_mismatch로 남긴다', () => {
    const error = new UnauthorizedException('웹훅 서명이 올바르지 않습니다.');
    verifyWebhookSignature.mockImplementation(() => {
      throw error;
    });

    expect(() => guard.canActivate(contextFor(signedRequest()))).toThrow(error);
    expect(warnSpy).toHaveBeenCalledWith('webhook rejected: reason=signature_mismatch');
  });

  it('timestamp 오류는 timestamp_out_of_range로 남긴다', () => {
    verifyWebhookSignature.mockImplementation(() => {
      throw new UnauthorizedException('웹훅 timestamp가 올바르지 않습니다.');
    });

    expect(() => guard.canActivate(contextFor(signedRequest()))).toThrow(UnauthorizedException);
    expect(warnSpy).toHaveBeenCalledWith('webhook rejected: reason=timestamp_out_of_range');
  });

  it('같은 구간의 실패는 경고 한 줄로 모으고 다음 구간 첫 경고에 건수를 붙인다', () => {
    verifyWebhookSignature.mockImplementation(() => {
      throw new UnauthorizedException('웹훅 서명이 올바르지 않습니다.');
    });
    for (let index = 0; index < 3; index += 1) {
      expect(() => guard.canActivate(contextFor(signedRequest()))).toThrow(UnauthorizedException);
    }
    expect(warnSpy).toHaveBeenCalledTimes(1);

    (Date.now as jest.Mock).mockReturnValue(FIXED_NOW_MS + WEBHOOK_REJECTION_LOG_WINDOW_MS);
    expect(() => guard.canActivate(contextFor(signedRequest()))).toThrow(UnauthorizedException);

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[1][0]).toBe(
      'webhook rejected: reason=signature_mismatch suppressedSinceLastWarning=2',
    );
  });
});
