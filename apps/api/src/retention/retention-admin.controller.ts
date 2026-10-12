import { Body, Controller, Param, Put, UseGuards } from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
// biome-ignore lint/style/useImportType: ValidationPipe가 런타임 DTO 클래스 메타데이터로 body를 검증한다.
import { SetLegalHoldDto } from './dto/set-legal-hold.dto';
// biome-ignore lint/style/useImportType: Nest DI가 런타임 생성자 타입 메타데이터로 서비스를 주입한다.
import { RetentionService } from './retention.service';

@Controller('admin/retention')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class RetentionAdminController {
  constructor(private readonly retention: RetentionService) {}

  /** 분쟁·법적 보존이 필요한 주문의 보관 기록 파기를 보류하거나 보류를 해제한다. */
  @Put('orders/:orderId/legal-hold')
  setOrderLegalHold(
    @Param('orderId') orderId: string,
    @Body() dto: SetLegalHoldDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.retention.setOrderLegalHold({
      orderId,
      hold: dto.hold,
      reason: dto.reason.trim(),
      actorId: user.sub,
    });
  }
}
