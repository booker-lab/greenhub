import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';

class WebhookData {
  @IsString()
  paymentId: string;

  @IsString()
  storeId: string;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsString()
  cancellationId?: string;
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
