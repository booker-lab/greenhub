import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DRIVER_VISIBLE_STATUSES } from '../../orders/driver-order-scope.service';

const STATUS_TOKEN = `(?:${DRIVER_VISIBLE_STATUSES.join('|')})`;

/** 기사 노출 상태를 쉼표로 이은 목록(예: PREPARING,DELIVERING). 다른 값은 거부한다. */
export const DRIVER_STATUS_QUERY_PATTERN = new RegExp(`^${STATUS_TOKEN}(?:,${STATUS_TOKEN})*$`);

/** GET /driver/orders 쿼리. */
export class DriverOrdersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(DRIVER_STATUS_QUERY_PATTERN, {
    message: `status는 ${DRIVER_VISIBLE_STATUSES.join(', ')} 중 하나 이상을 쉼표로 이어야 합니다.`,
  })
  status?: string;
}
