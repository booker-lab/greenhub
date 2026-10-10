import { IsInt, Max, Min } from 'class-validator';

/** 하루 배송 슬롯 상한. */
export const DAILY_CAP_MAX = 10_000;

export class UpdateDailyCapDto {
  @IsInt()
  @Min(0)
  @Max(DAILY_CAP_MAX)
  totalCap: number;
}
