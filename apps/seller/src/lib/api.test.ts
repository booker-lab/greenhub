import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiErrorMessage,
  apiJson,
  SERVER_LOAD_FAILED_MESSAGE,
  SERVER_SAVE_FAILED_MESSAGE,
} from './api';

vi.mock('@/lib/api-base-url', () => ({ getApiBaseUrl: () => 'http://api.test' }));

describe('apiErrorMessage', () => {
  it('5xx 영문 기본 문구는 저장 실패 한국어 안내로 바꾼다', () => {
    expect(apiErrorMessage(500, 'Internal server error', 'POST')).toBe(SERVER_SAVE_FAILED_MESSAGE);
    expect(apiErrorMessage(502, 'Bad Gateway', 'patch')).toBe(SERVER_SAVE_FAILED_MESSAGE);
    expect(SERVER_SAVE_FAILED_MESSAGE).toBe(
      '서버에서 문제가 생겨 저장하지 못했어요. 입력은 그대로 있어요. 잠시 뒤 다시 시도해 주세요.',
    );
  });

  it('조회(GET) 실패는 불러오기 실패 안내를 쓴다', () => {
    expect(apiErrorMessage(500, 'Internal server error')).toBe(SERVER_LOAD_FAILED_MESSAGE);
    expect(apiErrorMessage(500, 'Internal server error', 'GET')).toBe(SERVER_LOAD_FAILED_MESSAGE);
  });

  it('본문 메시지가 없으면 상태와 상관없이 한국어 안내를 쓴다', () => {
    expect(apiErrorMessage(500, undefined, 'POST')).toBe(SERVER_SAVE_FAILED_MESSAGE);
    expect(apiErrorMessage(404, undefined, 'PATCH')).toBe(SERVER_SAVE_FAILED_MESSAGE);
    expect(apiErrorMessage(400, '   ', 'POST')).toBe(SERVER_SAVE_FAILED_MESSAGE);
  });

  it('4xx 서버 메시지는 그대로 둔다', () => {
    expect(apiErrorMessage(400, '상품명을 입력해 주세요.', 'POST')).toBe('상품명을 입력해 주세요.');
    expect(apiErrorMessage(409, 'Conflict', 'POST')).toBe('Conflict');
    // 입력 검증 실패는 배열로 온다(예전 Error 생성자와 같은 이어 붙임)
    expect(
      apiErrorMessage(400, ['price must be a number', 'name should not be empty'], 'POST'),
    ).toBe('price must be a number,name should not be empty');
  });

  it('5xx라도 서버가 일부러 담은 한국어 안내는 살린다', () => {
    expect(apiErrorMessage(503, '잠시 사람이 몰렸어요. 다시 시도해 주세요.', 'POST')).toBe(
      '잠시 사람이 몰렸어요. 다시 시도해 주세요.',
    );
  });
});

describe('apiJson 실패 응답', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        body === undefined
          ? new Response(null, { status })
          : new Response(JSON.stringify(body), {
              status,
              headers: { 'Content-Type': 'application/json' },
            }),
      ),
    );
  }

  async function caught(promise: Promise<unknown>): Promise<ApiError> {
    try {
      await promise;
    } catch (e) {
      if (e instanceof ApiError) return e;
      throw e;
    }
    throw new Error('ApiError가 던져지지 않았어요');
  }

  it('500 "Internal server error"는 상태를 보존한 채 한국어 안내로 던진다', async () => {
    stubFetch(500, { statusCode: 500, message: 'Internal server error' });
    const error = await caught(apiJson('/stores/s1/products', 't', { method: 'POST', body: '{}' }));
    expect(error.status).toBe(500);
    expect(error.message).toBe(SERVER_SAVE_FAILED_MESSAGE);
    expect(error.message).not.toContain('Internal server error');
  });

  it('본문이 없는 5xx도 한국어 안내로 던진다', async () => {
    stubFetch(504, undefined);
    const error = await caught(apiJson('/stores/s1/products', 't'));
    expect(error.status).toBe(504);
    expect(error.message).toBe(SERVER_LOAD_FAILED_MESSAGE);
  });

  it('4xx 한국어 메시지는 그대로 던진다', async () => {
    stubFetch(400, { statusCode: 400, message: '판매 마감 시간이 지났어요.' });
    const error = await caught(apiJson('/sale-rounds/r1', 't', { method: 'PATCH', body: '{}' }));
    expect(error.status).toBe(400);
    expect(error.message).toBe('판매 마감 시간이 지났어요.');
    expect(error.code).toBeUndefined();
  });

  it('서버가 붙인 기계 판독용 code를 함께 담는다', async () => {
    stubFetch(409, {
      statusCode: 409,
      message: '가입 신청 내용이 바뀌었습니다. 다시 확인해 주세요.',
      code: 'DRIVER_APPLICATION_CHANGED',
    });
    const error = await caught(apiJson('/admin/drivers/d1/approve', 't', { method: 'PATCH' }));
    expect(error.status).toBe(409);
    expect(error.code).toBe('DRIVER_APPLICATION_CHANGED');
  });
});
