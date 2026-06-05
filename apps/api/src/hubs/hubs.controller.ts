import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type {
  AssignHubStaffDto,
  CreateHubDto,
  CreateHubStaffInviteDto,
  UpdateHubDto,
} from './dto/create-hub.dto';
import type { HubStaffInvitesService } from './hub-staff-invites.service';
import type { HubsService } from './hubs.service';

@Controller('stores/:storeId/hubs')
@UseGuards(JwtAuthGuard)
export class HubsController {
  constructor(
    private readonly hubsService: HubsService,
    private readonly hubStaffInvitesService: HubStaffInvitesService,
  ) {}

  @Get()
  getHubs(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.hubsService.getHubs(storeId, user.sub, user.role, {
      storeId: user.storeId,
      hubId: user.hubId,
      hubIds: user.hubIds,
    });
  }

  @Get(':hubId')
  getHub(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hubsService.getHub(storeId, hubId, user.sub, user.role, {
      storeId: user.storeId,
      hubId: user.hubId,
      hubIds: user.hubIds,
    });
  }

  @Get(':hubId/staff')
  getHubStaff(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hubsService.getHubStaff(storeId, hubId, user.sub, user.role);
  }

  @Get(':hubId/staff-candidates')
  getHubStaffCandidates(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hubsService.getHubStaffCandidates(storeId, hubId, user.sub, user.role);
  }

  @Get(':hubId/staff-invites')
  getHubStaffInvites(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hubStaffInvitesService.getHubStaffInvites(storeId, hubId, user.sub, user.role);
  }

  @Get(':hubId/orders')
  getHubOrders(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
  ) {
    return this.hubsService.getHubOrders(storeId, hubId, user.sub, user.role, status, {
      storeId: user.storeId,
      hubId: user.hubId,
      hubIds: user.hubIds,
    });
  }

  @Post(':hubId/staff-invite')
  @HttpCode(HttpStatus.CREATED)
  createHubStaffInvite(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateHubStaffInviteDto,
  ) {
    return this.hubsService.createHubStaffInvite(storeId, hubId, user.sub, user.role, dto);
  }

  @Post(':hubId/staff')
  @HttpCode(HttpStatus.OK)
  assignHubStaff(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssignHubStaffDto,
  ) {
    return this.hubsService.assignHubStaff(storeId, hubId, dto.staffId, user.sub, user.role);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createHub(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateHubDto,
  ) {
    return this.hubsService.createHub(storeId, user.sub, user.role, dto);
  }

  @Patch(':hubId')
  @HttpCode(HttpStatus.OK)
  updateHub(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateHubDto,
  ) {
    return this.hubsService.updateHub(storeId, hubId, user.sub, user.role, dto);
  }

  @Delete(':hubId/staff/:staffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeHubStaff(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @Param('staffId') staffId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hubsService.revokeHubStaff(storeId, hubId, staffId, user.sub, user.role);
  }

  @Delete(':hubId/staff-invites/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeHubStaffInvite(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @Param('token') token: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hubStaffInvitesService.revokeHubStaffInvite(
      storeId,
      hubId,
      token,
      user.sub,
      user.role,
    );
  }

  @Delete(':hubId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteHub(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hubsService.deleteHub(storeId, hubId, user.sub, user.role);
  }
}
