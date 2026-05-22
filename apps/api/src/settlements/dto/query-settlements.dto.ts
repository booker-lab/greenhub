import { IsDateString, IsIn, IsOptional } from 'class-validator';
import type { SettlementStatus } from '../settlements.service';

const SETTLEMENT_STATUSES: SettlementStatus[] = ['pending', 'confirmed', 'paid', 'cancelled'];

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
