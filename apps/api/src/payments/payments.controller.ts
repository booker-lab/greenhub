import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { AuditService } from '../common/audit/audit.service';
import { PortoneClient } from './portone.client';
import { PortoneWebhookDto } from './dto/portone-webhook.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly portone: PortoneClient,
    private readonly audit: AuditService,
  ) {}

  @Post('webhook/portone')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Body() dto: PortoneWebhookDto,
    @Headers('webhook-id') webhookId: string,
    @Headers('webhook-timestamp') webhookTimestamp: string,
    @Headers('webhook-signature') webhookSignature: string,
  ) {
    const rawBody = req.rawBody;
    this.logger.log(
      `webhook received: id=${webhookId ?? 'MISSING'} ts=${webhookTimestamp ?? 'MISSING'} sig=${webhookSignature ? 'present' : 'MISSING'} rawBody=${rawBody ? `${rawBody.length}bytes` : 'MISSING'}`,
    );

    try {
      this.portone.verifyWebhookSignature(webhookId, webhookTimestamp, rawBody!, webhookSignature);
    } catch (e) {
      this.logger.error(`webhook sig verify failed: ${(e as Error).message}`);
      await this.audit.log('payment.webhook.invalid_sig', {
        detail: {
          webhookId: webhookId ?? null,
          webhookTimestamp: webhookTimestamp ?? null,
          error: (e as Error).message,
        },
      });
      throw e;
    }
    return this.paymentsService.handleWebhook(dto);
  }

  @Get(':paymentId')
  @UseGuards(JwtAuthGuard)
  getPayment(@Param('paymentId') paymentId: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.getPayment(paymentId, user.sub);
  }
}

// Spec: 환불은 OrdersService 내부 취소 흐름에서만 실행 (외부 직접 노출 금지)
@Controller('stores/:storeId/orders/:orderId')
export class RefundController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('payment')
  @UseGuards(JwtAuthGuard)
  getOrderPayment(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.paymentsService.getPaymentByOrder(storeId, orderId, user.sub);
  }
}
