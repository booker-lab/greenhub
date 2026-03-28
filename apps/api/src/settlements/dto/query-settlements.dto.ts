import { IsDateString, IsOptional } from 'class-validator';

export class QuerySettlementsDto {
  @IsDateString()
  @IsOptional()
  from?: string;

  @IsDateString()
  @IsOptional()
  to?: string;
}

export class QuerySummaryDto {
  @IsDateString()
  @IsOptional()
  date?: string;
}
