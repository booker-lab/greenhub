import { IsString, MaxLength, ValidateIf } from 'class-validator';

export const FCM_TOKEN_MAX_LENGTH = 4096;

// `PATCH /auth/me/fcm-token`. 사용자 문서의 fcmToken 기본값이 null이므로 null로 지우는 요청도 받는다.
export class FcmTokenDto {
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(FCM_TOKEN_MAX_LENGTH)
  fcmToken: string | null;
}
