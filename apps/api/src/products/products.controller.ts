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
  ParseBoolPipe,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { UpdateDeliveryConfigDto } from './dto/update-delivery-config.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtPayload } from '../auth/types/jwt-payload.type';

@Controller('stores/:storeId/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  getProducts(@Param('storeId') storeId: string, @Query() query: ProductQueryDto) {
    return this.productsService.getProducts(storeId, query);
  }

  @Get(':productId')
  getProduct(@Param('storeId') storeId: string, @Param('productId') productId: string) {
    return this.productsService.getProduct(storeId, productId);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  createProduct(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.createProduct(storeId, user.sub, dto, user.role);
  }

  @Patch(':productId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  updateProduct(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: Partial<CreateProductDto>,
  ) {
    return this.productsService.updateProduct(storeId, productId, user.sub, dto, user.role);
  }

  @Patch(':productId/active')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  toggleActive(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @CurrentUser() user: JwtPayload,
    @Body('isActive', ParseBoolPipe) isActive: boolean,
  ) {
    return this.productsService.toggleProductActive(
      storeId,
      productId,
      user.sub,
      isActive,
      user.role,
    );
  }

  @Delete(':productId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProduct(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.deleteProduct(storeId, productId, user.sub, user.role);
  }
}

@Controller('products')
export class PublicProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  getPublicProducts(@Query() query: ProductQueryDto) {
    return this.productsService.getPublicProducts(query);
  }

  @Get(':productId')
  getPublicProduct(@Param('productId') productId: string) {
    return this.productsService.getPublicProduct(productId);
  }
}

@Controller('stores/:storeId/daily-caps')
export class DailyCapsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  getDailyCaps(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.productsService.getDailyCaps(storeId, user.sub, from, to, user.role);
  }

  @Patch(':date')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  updateDailyCap(
    @Param('storeId') storeId: string,
    @Param('date') date: string,
    @CurrentUser() user: JwtPayload,
    @Body('totalCap') totalCap: number,
  ) {
    return this.productsService.updateDailyCap(storeId, date, user.sub, totalCap, user.role);
  }
}

@Controller('stores/:storeId/delivery-config')
export class DeliveryConfigController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  getDeliveryConfig(@Param('storeId') storeId: string) {
    return this.productsService.getDeliveryConfig(storeId);
  }

  @Patch()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('seller', 'admin')
  updateDeliveryConfig(
    @Param('storeId') storeId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateDeliveryConfigDto,
  ) {
    return this.productsService.updateDeliveryConfig(storeId, user.sub, dto, user.role);
  }
}
