import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsBoolean, ValidateIf } from 'class-validator';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

export class UpdateNotificationPreferencesDto {
  @ValidateIf((preferences) => preferences.sms === undefined)
  @IsBoolean()
  alimtalk?: boolean;

  @ValidateIf((preferences) => preferences.alimtalk === undefined)
  @IsBoolean()
  sms?: boolean;
}

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
    @Body() preferences: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(user.sub, preferences);
  }
}
