import { Module } from '@nestjs/common';
import { HubStaffInvitesService } from './hub-staff-invites.service';
import { HubsController } from './hubs.controller';
import { HubsService } from './hubs.service';

@Module({
  controllers: [HubsController],
  providers: [HubsService, HubStaffInvitesService],
  exports: [HubsService, HubStaffInvitesService],
})
export class HubsModule {}
