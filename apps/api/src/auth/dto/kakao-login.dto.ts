import { IsEmail, IsOptional, IsString } from 'class-validator';

export class KakaoLoginDto {
  @IsString()
  kakaoId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  targetRole?: 'consumer' | 'seller' | 'driver' | 'hub_staff';

  @IsOptional()
  @IsString()
  inviteToken?: string;
}
