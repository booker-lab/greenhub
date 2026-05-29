import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminBannersService } from './admin-banners.service';

@Module({
  imports: [PaymentsModule],
  controllers: [AdminController],
  providers: [AdminService, AdminBannersService],
})
export class AdminModule {}
