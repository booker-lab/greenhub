import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigModule, type ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { KAKAO_REQUEST_TIMEOUT_MS, KakaoClient } from './kakao.client';

describe('KakaoClient', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let warnSpy: jest.SpiedFunction<Logger['warn']>;
  const response = (ok: boolean, body: unknown) =>
    ({ ok, json: () => Promise.resolve(body) }) as Response;

  const makeClient = (values: Record<string, string> = {}) =>
    new KakaoClient({
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService);

  const userBody = {
    id: 12345,
    kakao_account: {
      email: 'kakao@example.com',
      profile: { nickname: '카카오사용자' },
    },
  };

  // /v2/user/me와 /v1/user/access_token_info를 URL로 구분해 응답한다.
  const mockKakao = (tokenInfo: unknown, user: unknown = userBody) =>
    fetchSpy.mockImplementation(async (input) =>
      String(input).includes('/v1/user/access_token_info')
        ? response(true, tokenInfo)
        : response(true, user),
    );

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    warnSpy.mockRestore();
    jest.useRealTimers();
  });

  it('Nest DI에서 ConfigService를 주입받아 생성된다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true })],
      providers: [KakaoClient],
    }).compile();

    expect(moduleRef.get(KakaoClient)).toBeInstanceOf(KakaoClient);
    await moduleRef.close();
  });

  it('카카오 사용자 응답을 Green Hub 프로필로 정규화한다', async () => {
    mockKakao({ id: 12345, app_id: 777, expires_in: 3600 });

    await expect(makeClient().getUser('access-token')).resolves.toEqual({
      kakaoId: '12345',
      email: 'kakao@example.com',
      name: '카카오사용자',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://kapi.kakao.com/v2/user/me?'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://kapi.kakao.com/v1/user/access_token_info',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    for (const [, init] of fetchSpy.mock.calls) {
      expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe(
        'Bearer access-token',
      );
    }
  });

  it('카카오 401 응답은 인증 실패로 변환한다', async () => {
    fetchSpy.mockResolvedValue(response(false, {}));

    await expect(makeClient().getUser('bad-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('id가 없는 카카오 응답은 인증 실패로 처리한다', async () => {
    fetchSpy.mockResolvedValue(response(true, { kakao_account: { email: 'kakao@example.com' } }));

    await expect(makeClient().getUser('access-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  describe('토큰 발급 앱·사용자 확인', () => {
    it('KAKAO_APP_ID와 토큰의 app_id가 같으면 로그인한다', async () => {
      mockKakao({ id: 12345, app_id: 777 });

      await expect(makeClient({ KAKAO_APP_ID: '777' }).getUser('access-token')).resolves.toEqual(
        expect.objectContaining({ kakaoId: '12345' }),
      );
    });

    it('다른 앱에서 발급된 토큰은 로그인을 거부한다', async () => {
      mockKakao({ id: 12345, app_id: 999 });

      await expect(
        makeClient({ KAKAO_APP_ID: '777' }).getUser('access-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('KAKAO_APP_ID가 있는데 토큰 정보에 app_id가 없으면 거부한다', async () => {
      mockKakao({ id: 12345 });

      await expect(
        makeClient({ KAKAO_APP_ID: '777' }).getUser('access-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('토큰 정보의 사용자 id가 다르면 거부한다', async () => {
      mockKakao({ id: 54321, app_id: 777 });

      await expect(
        makeClient({ KAKAO_APP_ID: '777' }).getUser('access-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('토큰 정보 조회가 실패하면 거부한다', async () => {
      fetchSpy.mockImplementation(async (input) =>
        String(input).includes('/v1/user/access_token_info')
          ? response(false, {})
          : response(true, userBody),
      );

      await expect(makeClient().getUser('access-token')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('KAKAO_APP_ID가 없으면 app_id 비교 없이 로그인한다', async () => {
      mockKakao({ id: 12345, app_id: 999 });

      await expect(makeClient().getUser('access-token')).resolves.toEqual(
        expect.objectContaining({ kakaoId: '12345' }),
      );
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('운영에서 KAKAO_APP_ID가 없으면 경고를 한 번 남기고 로그인은 허용한다', async () => {
      mockKakao({ id: 12345, app_id: 999 });
      const client = makeClient({ NODE_ENV: 'production' });

      await client.getUser('access-token');
      await client.getUser('access-token');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('KAKAO_APP_ID');
    });
  });

  it('카카오가 시간 상한 안에 응답하지 않으면 인증 실패로 끝낸다', async () => {
    jest.useFakeTimers();
    fetchSpy.mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('This operation was aborted', 'AbortError')),
          );
        }),
    );

    const pending = makeClient()
      .getUser('access-token')
      .catch((caught) => caught);
    await jest.advanceTimersByTimeAsync(KAKAO_REQUEST_TIMEOUT_MS - 1);
    expect(jest.getTimerCount()).toBe(1);
    await jest.advanceTimersByTimeAsync(1);

    const error = await pending;
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(jest.getTimerCount()).toBe(0);
  });
});
