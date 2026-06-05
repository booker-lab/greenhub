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
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import type { UpdateStoreDto } from './dto/update-store.dto';
// biome-ignore lint/style/useImportType: NestJS 생성자 주입 메타데이터에 런타임 값이 필요하다.
import { StoresService } from './stores.service';

@Controller('public/stores')
export class PublicStoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get()
  getPublicStores() {
    return this.storesService.getPublicStores();
  }

  @Get(':storeId')
  getPublicStore(@Param('storeId') storeId: string) {
    return this.storesService.getPublicStore(storeId);
  }
}

@Controller('stores')
@UseGuards(JwtAuthGuard)
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Get(':storeId')
  getStore(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.storesService.getStore(storeId, user.sub, user.role);
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
    return this.storesService.updateStore(storeId, user.sub, dto, user.role);
  }
}
