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
    try {
      this.portone.verifyWebhookSignature(
        webhookId,
        webhookTimestamp,
        req.rawBody!,
        webhookSignature,
      );
    } catch (e) {
      await this.audit.log('payment.webhook.invalid_sig', {
        detail: { webhookId: webhookId ?? null, webhookTimestamp: webhookTimestamp ?? null },
      });
      throw e;
    }
    return this.paymentsService.handleWebhook(dto);
  }

  @Get(':paymentId')
  @UseGuards(JwtAuthGuard)
  getPayment(
    @Param('paymentId') paymentId: string,
    @CurrentUser() user: JwtPayload,
  ) {
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
