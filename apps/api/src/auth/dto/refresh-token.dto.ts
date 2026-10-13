import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// 리프레시 토큰은 sub·role·storeId·typ·aud·iat·exp만 담은 HS256 JWT라 수백 자 안쪽이다.
// 상한은 실제 길이보다 넉넉히 잡아 정상 토큰은 막지 않고, 비정상적으로 큰 본문만 검증 전에 거른다.
export const REFRESH_TOKEN_MAX_LENGTH = 2048;

// `POST /auth/refresh`. 세 앱의 Auth.js 서버가 `{ refreshToken }` 하나만 보낸다.
export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(REFRESH_TOKEN_MAX_LENGTH)
  refreshToken: string;
}
