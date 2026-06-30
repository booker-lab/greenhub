import { UnauthorizedException } from '@nestjs/common';
import { KakaoClient } from './kakao.client';

describe('KakaoClient', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  const response = (ok: boolean, body: unknown) =>
    ({ ok, json: () => Promise.resolve(body) }) as Response;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('카카오 사용자 응답을 Green Hub 프로필로 정규화한다', async () => {
    fetchSpy.mockResolvedValue(
      response(true, {
        id: 12345,
        kakao_account: {
          email: 'kakao@example.com',
          profile: { nickname: '카카오사용자' },
        },
      }),
    );

    await expect(new KakaoClient().getUser('access-token')).resolves.toEqual({
      kakaoId: '12345',
      email: 'kakao@example.com',
      name: '카카오사용자',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('https://kapi.kakao.com/v2/user/me?'),
      expect.any(Object),
    );
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
  });

  it('카카오 401 응답은 인증 실패로 변환한다', async () => {
    fetchSpy.mockResolvedValue(response(false, {}));

    await expect(new KakaoClient().getUser('bad-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('id가 없는 카카오 응답은 인증 실패로 처리한다', async () => {
    fetchSpy.mockResolvedValue(response(true, { kakao_account: { email: 'kakao@example.com' } }));

    await expect(new KakaoClient().getUser('access-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
