import { IsDateString, IsIn, IsOptional } from 'class-validator';
import { SETTLEMENT_STATUSES, type SettlementStatus } from '@greenhub/shared';

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
}

export class QuerySummaryDto {
  @IsDateString()
  @IsOptional()
  date?: string;
}
