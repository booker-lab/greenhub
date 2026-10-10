import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

export const OPERATION_ISSUE_LIST_DEFAULT_LIMIT = 100;
export const OPERATION_ISSUE_LIST_MAX_LIMIT = 200;

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
