import {
  POST_DELIVERY_REFUND_MEMO_MAX_LENGTH,
  POST_DELIVERY_REFUND_REASON_CODES,
  type PostDeliveryRefundReasonCode,
} from '@greenhub/shared';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** 배송 후 환불 요청 본문. 사유 코드와 메모(한 줄)는 모두 필수다. */
export class PostDeliveryRefundDto {
  @IsIn(POST_DELIVERY_REFUND_REASON_CODES)
  reasonCode!: PostDeliveryRefundReasonCode;

  @IsString()
  @MinLength(1)
  @MaxLength(POST_DELIVERY_REFUND_MEMO_MAX_LENGTH)
  @Matches(/^\P{Cc}*$/u, {
    message: '환불 메모에는 줄바꿈이나 제어문자를 사용할 수 없습니다.',
  })
  memo!: string;
}
