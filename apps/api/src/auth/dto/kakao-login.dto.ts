import { IsString, IsOptional, IsEmail } from 'class-validator';

export class KakaoLoginDto {
  @IsString()
  kakaoId: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
