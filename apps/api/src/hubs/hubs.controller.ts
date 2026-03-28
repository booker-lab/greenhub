import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { HubsService } from './hubs.service';
import { CreateHubDto, UpdateHubDto } from './dto/create-hub.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('stores/:storeId/hubs')
@UseGuards(JwtAuthGuard)
export class HubsController {
  constructor(private readonly hubsService: HubsService) {}

  @Get()
  getHubs(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hubsService.getHubs(storeId, user.sub);
  }

  @Get(':hubId')
  getHub(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hubsService.getHub(storeId, hubId, user.sub);
  }

  @Get(':hubId/orders')
  getHubOrders(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
  ) {
    return this.hubsService.getHubOrders(storeId, hubId, user.sub, status);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createHub(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateHubDto,
  ) {
    return this.hubsService.createHub(storeId, user.sub, dto);
  }

  @Patch(':hubId')
  @HttpCode(HttpStatus.OK)
  updateHub(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateHubDto,
  ) {
    return this.hubsService.updateHub(storeId, hubId, user.sub, dto);
  }

  @Delete(':hubId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteHub(
    @Param('storeId') storeId: string,
    @Param('hubId') hubId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.hubsService.deleteHub(storeId, hubId, user.sub);
  }
}
