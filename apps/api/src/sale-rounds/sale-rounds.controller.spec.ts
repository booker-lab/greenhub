import 'reflect-metadata';
import { UpdateSaleRoundStatusDto } from './dto/sale-round.dto';
import { SaleRoundsController } from './sale-rounds.controller';

describe('판매 회차 컨트롤러 DTO 런타임 계약', () => {
  it('상태 변경 body를 UpdateSaleRoundStatusDto로 검증한다', () => {
    const parameterTypes = Reflect.getMetadata(
      'design:paramtypes',
      SaleRoundsController.prototype,
      'updateStatus',
    ) as unknown[];

    expect(parameterTypes[3]).toBe(UpdateSaleRoundStatusDto);
  });
});
