import { Module } from '@nestjs/common';
import { OrderCapacityService } from './order-capacity.service';

@Module({
  providers: [OrderCapacityService],
  exports: [OrderCapacityService],
})
export class OrderCapacityModule {}
