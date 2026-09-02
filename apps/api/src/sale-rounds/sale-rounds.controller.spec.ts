import 'reflect-metadata';
import { UpdateSaleRoundStatusDto } from './dto/sale-round.dto';
import { PublicSaleRoundsController, SaleRoundsController } from './sale-rounds.controller';
import type { SaleRoundsService } from './sale-rounds.service';

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

describe('공개 판매 회차 컨트롤러 위임 계약', () => {
  it('공개 목록·상세 호출은 서비스의 공개 경계 메서드로 그대로 위임한다', async () => {
    const saleRoundsService = {
      listPublicRounds: jest.fn().mockResolvedValue({ items: [] }),
      getPublicRound: jest.fn().mockResolvedValue({ id: 'round-1' }),
    } as unknown as SaleRoundsService;
    const controller = new PublicSaleRoundsController(saleRoundsService);

    await expect(controller.getPublicRounds('store-1')).resolves.toEqual({ items: [] });
    expect(saleRoundsService.listPublicRounds).toHaveBeenCalledWith('store-1');

    await expect(controller.getPublicRound('store-1', 'round-1')).resolves.toEqual({
      id: 'round-1',
    });
    expect(saleRoundsService.getPublicRound).toHaveBeenCalledWith('store-1', 'round-1');
  });
});
