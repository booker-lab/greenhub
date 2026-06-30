import { IsIn, IsOptional, IsString } from 'class-validator';

export class KakaoLoginDto {
  @IsString()
  kakaoAccessToken: string;

  @IsOptional()
  @IsIn(['consumer', 'seller', 'driver', 'hub_staff'])
  @IsString()
  targetRole?: 'consumer' | 'seller' | 'driver' | 'hub_staff';

  @IsOptional()
  @IsString()
  inviteToken?: string;
}
