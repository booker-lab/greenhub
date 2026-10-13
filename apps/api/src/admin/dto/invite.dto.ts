import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

// 이메일 주소 길이 상한(RFC 5321 경로 길이).
export const INVITE_RECIPIENT_EMAIL_MAX_LENGTH = 254;

export class GenerateInviteDto {
  // 받는 사람 이메일(필수). 그 이메일(정규화 비교)로만 가입할 수 있다.
  // 빠지거나 빈 값·공백뿐인 값은 400이다.
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(INVITE_RECIPIENT_EMAIL_MAX_LENGTH)
  recipientEmail: string;
}
