import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConfigValues, isProductionRuntime } from '../config/runtime-config';

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

type KakaoTokenInfoResponse = {
  id?: number | string;
  app_id?: number | string;
};

/** 카카오 API 호출 시간 상한. 연결부터 본문 읽기까지 덮는다. */
export const KAKAO_REQUEST_TIMEOUT_MS = 5_000;

@Injectable()
export class KakaoClient {
  private readonly baseUrl = 'https://kapi.kakao.com';
  private readonly logger = new Logger(KakaoClient.name);
  /** 비어 있으면 토큰 발급 앱 비교만 건너뛴다. 운영 로그인을 막지 않도록 경고만 남긴다. */
  private readonly appId: string;

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    this.appId = (this.config.get<string>('KAKAO_APP_ID') ?? '').trim();
    if (!this.appId && isProductionRuntime(getConfigValues(this.config))) {
      this.logger.warn('KAKAO_APP_ID가 설정되지 않아 카카오 토큰 발급 앱 확인을 건너뜁니다.');
    }
  }

  async getUser(accessToken: string): Promise<KakaoProfile> {
    const propertyKeys = JSON.stringify([
      'kakao_account.email',
      'kakao_account.profile',
      'kakao_account.name',
    ]);
    const params = new URLSearchParams({ property_keys: propertyKeys });
    const body = await this.request<KakaoUserResponse>(
      `${this.baseUrl}/v2/user/me?${params}`,
      accessToken,
      '유효하지 않은 카카오 access token입니다.',
    );
    const kakaoId = body?.id;
    if (typeof kakaoId !== 'number' && typeof kakaoId !== 'string') {
      throw new UnauthorizedException('카카오 사용자 응답이 올바르지 않습니다.');
    }

    await this.assertTokenIssuedForUser(accessToken, String(kakaoId));

    const account = body?.kakao_account;
    const name = account?.name ?? account?.profile?.nickname ?? `kakao-${kakaoId}`;

    return {
      kakaoId: String(kakaoId),
      email: account?.email ?? null,
      name,
    };
  }

  /** access token이 같은 사용자에게, 설정된 경우 우리 앱에서 발급됐는지 확인한다. */
  private async assertTokenIssuedForUser(accessToken: string, kakaoId: string): Promise<void> {
    const info = await this.request<KakaoTokenInfoResponse>(
      `${this.baseUrl}/v1/user/access_token_info`,
      accessToken,
      '유효하지 않은 카카오 access token입니다.',
    );
    const tokenUserId = info?.id;
    if (
      (typeof tokenUserId !== 'number' && typeof tokenUserId !== 'string') ||
      String(tokenUserId) !== kakaoId
    ) {
      this.logger.warn('카카오 토큰 정보의 사용자와 사용자 조회 결과가 일치하지 않습니다.');
      throw new UnauthorizedException('유효하지 않은 카카오 access token입니다.');
    }
    if (!this.appId) return;

    const tokenAppId = info?.app_id;
    if (
      (typeof tokenAppId !== 'number' && typeof tokenAppId !== 'string') ||
      String(tokenAppId) !== this.appId
    ) {
      this.logger.warn('다른 카카오 앱에서 발급된 access token으로 로그인을 거부했습니다.');
      throw new UnauthorizedException('유효하지 않은 카카오 access token입니다.');
    }
  }

  /**
   * 시간 상한을 걸고 카카오 API를 GET 호출한다. 시간 초과·네트워크 오류·비정상 응답은
   * 모두 내부 정보 없이 401로 끝나 로그인이 깔끔하게 실패한다.
   */
  private async request<T>(url: string, accessToken: string, rejectedMessage: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), KAKAO_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        },
        signal: controller.signal,
      }).catch(() => {
        if (controller.signal.aborted) {
          this.logger.warn(`카카오 API 요청 시간 초과 timeoutMs=${KAKAO_REQUEST_TIMEOUT_MS}`);
        }
        throw new UnauthorizedException('카카오 사용자 정보를 확인할 수 없습니다.');
      });

      if (!response.ok) {
        throw new UnauthorizedException(rejectedMessage);
      }

      const body = (await response.json().catch(() => null)) as T | null;
      if (body === null || typeof body !== 'object') {
        throw new UnauthorizedException('카카오 사용자 응답이 올바르지 않습니다.');
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }
}
