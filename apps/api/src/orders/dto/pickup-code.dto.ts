import { Matches } from 'class-validator';

/** 거점 픽업 코드는 주문 생성 때 만드는 숫자 6자리다(orders.helpers generatePickupCode). */
export const PICKUP_CODE_PATTERN = /^\d{6}$/;

/** 픽업 확인(고객)·거점 수령 확인(판매자) 본문. 패턴이 문자열 여부와 길이 6을 함께 고정한다. */
export class PickupCodeDto {
  @Matches(PICKUP_CODE_PATTERN, { message: '픽업 코드는 숫자 6자리여야 합니다.' })
  pickupCode: string;
}
