import { IsString, IsEnum } from 'class-validator';

export class PortoneWebhookDto {
  @IsString()
  imp_uid: string;

  @IsString()
  merchant_uid: string;

  @IsEnum(['paid', 'failed', 'cancelled'])
  status: string;
}
