import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PortoneWebhookDto } from './dto/portone-webhook.dto';
import { PaymentsService } from './payments.service';
import { PortoneWebhookSignatureGuard } from './portone-webhook-signature.guard';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  // 서명 검증은 가드에서 본문 검증보다 먼저 끝난다. 여기에는 서명이 맞는 요청만 들어온다.
  @Post('webhook/portone')
  @HttpCode(HttpStatus.OK)
  @SkipThrottle()
  @UseGuards(PortoneWebhookSignatureGuard)
  async handleWebhook(@Body() dto: PortoneWebhookDto, @Headers('webhook-id') webhookId: string) {
    this.logger.log(`webhook verified: id=${webhookId.slice(0, 80)} type=${dto.type.slice(0, 60)}`);
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
