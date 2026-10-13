import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateStoreDto } from './dto/update-store.dto';
import { STORE_CREATOR_ROLES, StoresService } from './stores.service';

@Controller('stores')
@UseGuards(JwtAuthGuard)
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get(':storeId')
  getStore(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.storesService.getStore(storeId, user.sub);
  }
  @Post()
  @UseGuards(RolesGuard)
  @Roles(...STORE_CREATOR_ROLES)
  @HttpCode(HttpStatus.CREATED)
  createStore(@CurrentUser() user: JwtPayload, @Body() dto: UpdateStoreDto) {
    return this.storesService.createStore(user.sub, dto);
  }

  @Patch(':storeId')
  @HttpCode(HttpStatus.OK)
  updateStore(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateStoreDto,
  ) {
    return this.storesService.updateStore(storeId, user.sub, dto);
  }
}

/**
 * Public store profile — no auth guard (OWNER_SCOPED owner API above is unchanged).
 * Contract: GET /stores/:storeId/public-profile → { id, name, logoUrl, salesMode }.
 */
@Controller('stores')
export class PublicStoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get(':storeId/public-profile')
  getPublicProfile(@Param('storeId') storeId: string) {
    return this.storesService.getPublicProfile(storeId);
  }
}
