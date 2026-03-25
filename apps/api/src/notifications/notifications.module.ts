import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AligoClient } from './aligo.client';

@Module({
  providers: [NotificationsService, AligoClient],
  exports: [NotificationsService],
})
export class NotificationsModule {}
