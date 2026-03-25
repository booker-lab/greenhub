import { Module } from '@nestjs/common';
import { ProductsController, DeliveryConfigController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController, DeliveryConfigController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
