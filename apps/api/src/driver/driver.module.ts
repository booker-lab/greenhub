import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';

@Module({
  imports: [OrdersModule],
  controllers: [DriverController],
  providers: [DriverService],
})
export class DriverModule {}
