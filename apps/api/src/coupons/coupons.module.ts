import { Module } from '@nestjs/common';
import { CouponsController, PublicCouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

@Module({
  controllers: [PublicCouponsController, CouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
