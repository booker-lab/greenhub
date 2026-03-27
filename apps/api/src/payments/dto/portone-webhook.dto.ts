import { IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class WebhookData {
  @IsString()
  paymentId: string;

  @IsString()
  storeId: string;
}

export class PortoneWebhookDto {
  // Transaction.Paid | Transaction.Failed | Transaction.Cancelled | Transaction.PartialCancelled
  @IsString()
  type: string;

  @ValidateNested()
  @Type(() => WebhookData)
  data: WebhookData;
}
