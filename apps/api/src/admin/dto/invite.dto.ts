import { IsEmail, IsOptional, MaxLength } from 'class-validator';

// 이메일 주소 길이 상한(RFC 5321 경로 길이).
export const INVITE_RECIPIENT_EMAIL_MAX_LENGTH = 254;

export class GenerateInviteDto {
  // 받는 사람 이메일. 지정하면 그 이메일(정규화 비교)로만 가입할 수 있고, 비우면 기존처럼 제한이 없다.
  @IsOptional()
  @IsEmail()
  @MaxLength(INVITE_RECIPIENT_EMAIL_MAX_LENGTH)
  recipientEmail?: string;
}
