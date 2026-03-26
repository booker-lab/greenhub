import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('me')
  getMyNotifications(@CurrentUser() user: JwtPayload) {
    return this.notificationsService.getUserNotifications(user.sub);
  }

  @Patch('me/preferences')
  updatePreferences(
    @CurrentUser() user: JwtPayload,
    @Body() preferences: Record<string, boolean>,
  ) {
    return this.notificationsService.updatePreferences(user.sub, preferences);
  }
}
