import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { SETTLEMENT_STATUSES, type SettlementStatus } from '@greenhub/shared';

/** 정산 목록 이어받기 위치 = 앞 응답의 마지막 정산 문서 id(주문 id와 같다). 경로 구분자는 받지 않는다. */
export const SETTLEMENT_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class QuerySettlementsDto {
  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;

  @IsIn(SETTLEMENT_STATUSES)
  @IsOptional()
  status?: SettlementStatus;

  /** 한 번에 받을 건수. 생략하면 기본값, 상한을 넘으면 상한으로 줄인다(서비스에서 처리). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number;

  /** 앞 응답의 nextCursor. 그 다음 정산부터 이어서 받는다. */
  @IsString()
  @Matches(SETTLEMENT_CURSOR_PATTERN)
  @IsOptional()
  cursor?: string;
}

export class QuerySummaryDto {
  @IsDateString()
  @IsOptional()
  date?: string;
}
