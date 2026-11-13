import { CUSTOMER_FAULT_CLOSURE_MEMO_MAX_LENGTH } from '@greenhub/shared';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * 고객 사유 종결 요청 본문. 판매자가 손님과 연락한 내용(한 줄)을 반드시 남긴다.
 * 메모는 내부 기록이며 손님에게 보내거나 보여 주지 않는다.
 */
export class CustomerFaultClosureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(CUSTOMER_FAULT_CLOSURE_MEMO_MAX_LENGTH)
  @Matches(/^\P{Cc}*$/u, {
    message: '종결 메모에는 줄바꿈이나 제어문자를 사용할 수 없습니다.',
  })
  memo!: string;
}
