import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export const CANCEL_REASON_MAX_LENGTH = 100;

/**
 * 고객 주문 취소 본문. 사유는 선택이며 없으면 서비스가 기본 문구를 쓴다.
 * 사유는 결제 취소 요청과 주문 기록에 그대로 쓰이므로 짧은 한 줄 문자열만 받는다.
 */
export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(CANCEL_REASON_MAX_LENGTH)
  @Matches(/^\P{Cc}*$/u, {
    message: '취소 사유에는 줄바꿈이나 제어문자를 사용할 수 없습니다.',
  })
  reason?: string;
}
