import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { INVITE_TOKEN_PATTERN } from '../invite-conflict';

export class KakaoLoginDto {
  @IsString()
  kakaoAccessToken: string;

  @IsOptional()
  @IsIn(['consumer', 'seller', 'driver'])
  @IsString()
  targetRole?: 'consumer' | 'seller' | 'driver';

  // 판매자 앱 초대 링크로 들어온 첫 로그인만 싣는다. 관리자 취소 경로와 같은 영숫자 1~64자 규칙이다.
  @IsOptional()
  @IsString()
  @Matches(INVITE_TOKEN_PATTERN)
  inviteToken?: string;
}
