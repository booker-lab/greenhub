import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export const OPERATION_ISSUE_LIST_DEFAULT_LIMIT = 100;
export const OPERATION_ISSUE_LIST_MAX_LIMIT = 200;
/**
 * 한 번에 훑어 정렬하는 기록 수 상한. 문서 ID(해시) 순서로 잘린 임의의 기록이 아니라
 * 이 범위 안에서 열린 기록·중요도·최근 갱신 순으로 고른다(복합 인덱스 없이).
 */
export const OPERATION_ISSUE_LIST_SCAN_LIMIT = 500;

export class ListOperationIssuesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(OPERATION_ISSUE_LIST_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @Matches(/^[A-Za-z0-9:_-]{1,160}$/)
  orderId?: string;
}
