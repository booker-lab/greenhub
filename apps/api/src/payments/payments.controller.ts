import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PortoneWebhookDto } from './dto/portone-webhook.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('webhook/portone')
  @HttpCode(HttpStatus.OK)
  handleWebhook(@Body() dto: PortoneWebhookDto) {
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

  @Post('refund')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller')
  @HttpCode(HttpStatus.OK)
  refundOrder(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body('reason') reason?: string,
  ) {
    return this.paymentsService.refundOrder(
      storeId,
      orderId,
      user.sub,
      reason,
    );
  }
}
