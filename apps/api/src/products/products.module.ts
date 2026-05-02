import { Module } from '@nestjs/common';
import {
  ProductsController,
  PublicProductsController,
  DeliveryConfigController,
  DailyCapsController,
} from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [
    PublicProductsController,
    ProductsController,
    DeliveryConfigController,
    DailyCapsController,
  ],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
