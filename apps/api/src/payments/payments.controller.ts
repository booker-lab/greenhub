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
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { PaymentsService } from './payments.service';
import { PortoneClient } from './portone.client';
import { PortoneWebhookDto } from './dto/portone-webhook.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';

// 서명 검증 실패는 요청마다 저장하지 않고, 구간마다 경고 한 줄과 직전 구간의 건수만 남긴다.
export const WEBHOOK_REJECTION_LOG_WINDOW_MS = 60 * 1000;

type WebhookRejectionReason =
  | 'missing_credentials'
  | 'timestamp_out_of_range'
  | 'signature_mismatch';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);
  private rejectionWindowStartedAt: number | null = null;
  private suppressedRejections = 0;

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly portone: PortoneClient,
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
    let reason: WebhookRejectionReason = 'missing_credentials';
    try {
      if (
        !Buffer.isBuffer(rawBody) ||
        !webhookId?.trim() ||
        !webhookTimestamp?.trim() ||
        !webhookSignature?.trim()
      ) {
        throw new UnauthorizedException('웹훅 인증 정보가 누락되었습니다.');
      }
      reason = 'signature_mismatch';
      this.portone.verifyWebhookSignature(webhookId, webhookTimestamp, rawBody, webhookSignature);
    } catch (e) {
      if (reason === 'signature_mismatch' && /timestamp/.test((e as Error).message ?? '')) {
        reason = 'timestamp_out_of_range';
      }
      this.recordWebhookRejection(reason);
      throw e;
    }
    this.logger.log(`webhook verified: id=${webhookId.slice(0, 80)} type=${dto.type.slice(0, 60)}`);
    return this.paymentsService.handleWebhook(dto);
  }

  // 요청 값(헤더·본문)은 남기지 않는다. 구간의 첫 실패만 경고하고, 나머지는 다음 구간 첫 경고에 건수로 합친다.
  private recordWebhookRejection(reason: WebhookRejectionReason) {
    const now = Date.now();
    if (
      this.rejectionWindowStartedAt !== null &&
      now - this.rejectionWindowStartedAt < WEBHOOK_REJECTION_LOG_WINDOW_MS
    ) {
      this.suppressedRejections += 1;
      return;
    }
    const suppressed = this.suppressedRejections;
    this.rejectionWindowStartedAt = now;
    this.suppressedRejections = 0;
    this.logger.warn(
      `webhook rejected: reason=${reason}${suppressed > 0 ? ` suppressedSinceLastWarning=${suppressed}` : ''}`,
    );
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
