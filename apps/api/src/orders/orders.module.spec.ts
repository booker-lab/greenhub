import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../app.module';
import { SaleRoundsModule } from '../sale-rounds/sale-rounds.module';
import { OrderCapacityModule } from './order-capacity.module';
import { OrderChargesService } from './order-charges.service';
import { OrdersModule } from './orders.module';

function metadata<T>(target: object, key: string): T[] {
  return Reflect.getMetadata(key, target) ?? [];
}

describe('회차 직배송 모듈 연결', () => {
  it('OrdersModule은 예약 모듈과 재배송비 provider를 필수 연결한다', () => {
    expect(metadata(OrdersModule, MODULE_METADATA.IMPORTS)).toContain(OrderCapacityModule);
    expect(metadata(OrdersModule, MODULE_METADATA.PROVIDERS)).toContain(OrderChargesService);
  });

  it('AppModule은 SaleRoundsModule을 실제 라우팅 모듈로 등록한다', () => {
    expect(metadata(AppModule, MODULE_METADATA.IMPORTS)).toContain(SaleRoundsModule);
  });
});
