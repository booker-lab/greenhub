import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class WebhookData {
  @IsString()
  paymentId: string;

  @IsString()
  storeId: string;

  @IsOptional()
  @IsString()
  transactionId?: string;
}

export class PortoneWebhookDto {
  // Transaction.Paid | Transaction.Failed | Transaction.Cancelled | Transaction.PartialCancelled
  @IsString()
  type: string;

  @IsOptional()
  @IsString()
  timestamp?: string;

  @ValidateNested()
  @Type(() => WebhookData)
  data: WebhookData;
}
