import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { StoresService } from './stores.service';
import { UpdateStoreDto } from './dto/update-store.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('stores')
@UseGuards(JwtAuthGuard)
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get(':storeId')
  getStore(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.storesService.getStore(storeId, user.sub);
  }
  @Post()
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
