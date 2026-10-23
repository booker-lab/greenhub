import { OPTION_STOCK_NAME_MAX_LENGTH, OPTION_STOCK_QUANTITY_MAX } from '@greenhub/shared';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

/** 새 재고 품목. 수량은 지금 손에 있는 개수다. */
export class CreateOptionStockDto {
  @IsString()
  @MaxLength(OPTION_STOCK_NAME_MAX_LENGTH)
  @Matches(/\S/, { message: '재고 이름을 입력하세요.' })
  @Matches(/^\P{Cc}*$/u, { message: '재고 이름에는 줄바꿈이나 제어문자를 쓸 수 없습니다.' })
  name!: string;

  @IsInt()
  @Min(0)
  @Max(OPTION_STOCK_QUANTITY_MAX)
  quantity!: number;
}

/**
 * 재고 품목 고치기. 수량은 둘 중 하나만 보낸다.
 * - addQuantity: 새로 출력한 개수만큼 더한다.
 * - remainingQuantity: 지금 실제로 남은 개수로 맞춘다(결제 중·결제 완료 수량은 그대로 둔다).
 */
export class UpdateOptionStockDto {
  @IsOptional()
  @IsString()
  @MaxLength(OPTION_STOCK_NAME_MAX_LENGTH)
  @Matches(/\S/, { message: '재고 이름을 입력하세요.' })
  @Matches(/^\P{Cc}*$/u, { message: '재고 이름에는 줄바꿈이나 제어문자를 쓸 수 없습니다.' })
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(OPTION_STOCK_QUANTITY_MAX)
  addQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(OPTION_STOCK_QUANTITY_MAX)
  remainingQuantity?: number;
}
