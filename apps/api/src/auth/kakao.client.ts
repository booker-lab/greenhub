import { Injectable, UnauthorizedException } from '@nestjs/common';

export type KakaoProfile = {
  kakaoId: string;
  email: string | null;
  name: string;
};

type KakaoUserResponse = {
  id?: number | string;
  kakao_account?: {
    email?: string;
    name?: string;
    profile?: {
      nickname?: string;
    };
  };
};

@Injectable()
export class KakaoClient {
  private readonly baseUrl = 'https://kapi.kakao.com';

  async getUser(accessToken: string): Promise<KakaoProfile> {
    const propertyKeys = JSON.stringify([
      'kakao_account.email',
      'kakao_account.profile',
      'kakao_account.name',
    ]);
    const params = new URLSearchParams({ property_keys: propertyKeys });
    const response = await fetch(`${this.baseUrl}/v2/user/me?${params}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
    }).catch(() => {
      throw new UnauthorizedException('카카오 사용자 정보를 확인할 수 없습니다.');
    });

    if (!response.ok) {
      throw new UnauthorizedException('유효하지 않은 카카오 access token입니다.');
    }

    const body = (await response.json().catch(() => null)) as KakaoUserResponse | null;
    const kakaoId = body?.id;
    if (typeof kakaoId !== 'number' && typeof kakaoId !== 'string') {
      throw new UnauthorizedException('카카오 사용자 응답이 올바르지 않습니다.');
    }

    const account = body?.kakao_account;
    const name = account?.name ?? account?.profile?.nickname ?? `kakao-${kakaoId}`;

    return {
      kakaoId: String(kakaoId),
      email: account?.email ?? null,
      name,
    };
  }
}
