import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PortoneWebhookDto } from './portone-webhook.dto';

const validationOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
};

describe('PortoneWebhookDto', () => {
  it('PortOne V2 결제 취소 웹훅의 cancellationId를 허용한다', async () => {
    const dto = plainToInstance(PortoneWebhookDto, {
      type: 'Transaction.Cancelled',
      timestamp: '2026-07-16T15:49:52Z',
      data: {
        paymentId: 'payment-1',
        storeId: 'store-1',
        transactionId: 'transaction-1',
        cancellationId: 'cancellation-1',
      },
    });

    await expect(validate(dto, validationOptions)).resolves.toHaveLength(0);
  });
});
