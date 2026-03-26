import { Module } from '@nestjs/common';
import { ProductsController, DeliveryConfigController, DailyCapsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController, DeliveryConfigController, DailyCapsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
