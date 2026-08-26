import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettlementsModule } from '../settlements/settlements.module';

@Module({
  imports: [PaymentsModule, OrdersModule, SettlementsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
