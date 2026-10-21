import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PostDeliveryRefundDto } from '../orders/dto/post-delivery-refund.dto';
import { AdminPostDeliveryRefundService } from './admin-post-delivery-refund.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPostDeliveryRefundController {
  constructor(private readonly refunds: AdminPostDeliveryRefundService) {}

  @Post('orders/:orderId/post-delivery-refund')
  @HttpCode(HttpStatus.OK)
  refund(
    @Param('orderId') orderId: string,
    @Body() dto: PostDeliveryRefundDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.refunds.refund(orderId, dto, user.sub);
  }
}
