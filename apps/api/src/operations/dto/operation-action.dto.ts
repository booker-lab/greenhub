import { IsEnum } from 'class-validator';

export const OPERATION_ACTION_TYPES = ['RETRY_REFUND', 'RESEND_SMS'] as const;
export type OperationActionType = (typeof OPERATION_ACTION_TYPES)[number];

export class OperationActionDto {
  @IsEnum(OPERATION_ACTION_TYPES)
  actionType: OperationActionType;
}
