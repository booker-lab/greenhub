import { IsIn, IsOptional, IsString } from 'class-validator';

export class KakaoLoginDto {
  @IsString()
  kakaoAccessToken: string;

  @IsOptional()
  @IsIn(['consumer', 'seller', 'driver'])
  @IsString()
  targetRole?: 'consumer' | 'seller' | 'driver';
}
