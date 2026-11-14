import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifyDriverApplicationFailure,
  fetchMyDriverApplication,
  saveMyDriverApplication,
} from './driver-application-api';

describe('가입 신청 API 거절 분류', () => {
  it.each([
    [401, 'DRIVER_APPLICATION_TICKET_INVALID', 'expired'],
    [403, 'DRIVER_ALREADY_APPROVED', 'approved'],
    [403, 'DRIVER_APPLICATION_NOT_ALLOWED', 'not-allowed'],
    [409, 'DRIVER_APPLICATION_REVISION_LIMIT', 'revision-limit'],
    [409, undefined, 'failed'],
    [400, undefined, 'invalid'],
    [429, undefined, 'failed'],
    [503, undefined, 'failed'],
  ])('%s %s → %s', (status, code, expected) => {
    expect(classifyDriverApplicationFailure(status, code)).toBe(expected);
  });
});

describe('가입 신청 API 호출', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('티켓을 Bearer로 실어 조회하고 캐시하지 않는다', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'none', application: null, prefill: { realName: '' } }),
      ),
    );

    await expect(fetchMyDriverApplication('a.b.c')).resolves.toEqual({
      ok: true,
      data: { status: 'none', application: null, prefill: { realName: '' } },
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.test/driver-applications/me');
    expect(init).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      headers: { Authorization: 'Bearer a.b.c' },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('저장은 PUT JSON으로 보내고 거절 code를 분류한다', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code: 'DRIVER_ALREADY_APPROVED' }), { status: 403 }),
    );
    const input = {
      realName: '김기사',
      phone: '01012345678',
      vehicleType: 'van' as const,
      consent: true as const,
      consentVersion: 'v',
    };

    await expect(saveMyDriverApplication('a.b.c', input)).resolves.toEqual({
      ok: false,
      failure: 'approved',
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('PUT');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer a.b.c',
    });
    expect(JSON.parse(init.body)).toEqual(input);
  });

  it('응답이 없거나 본문이 깨지면 일시 실패로 본다', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(fetchMyDriverApplication('a.b.c')).resolves.toEqual({
      ok: false,
      failure: 'failed',
    });
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    await expect(fetchMyDriverApplication('a.b.c')).resolves.toEqual({
      ok: false,
      failure: 'failed',
    });
  });
});
