import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
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

describe('공개 판매 회차 묶음 응답 옵션', () => {
  function makeController() {
    const saleRoundsService = {
      listPublicRounds: jest.fn().mockResolvedValue({ items: [] }),
      listPublicRoundsWithItems: jest.fn().mockResolvedValue({ items: [{ id: 'round-1' }] }),
    } as unknown as SaleRoundsService;
    return { saleRoundsService, controller: new PublicSaleRoundsController(saleRoundsService) };
  }

  it('include=items면 묶음 응답으로, past는 정수로 넘긴다(생략 시 기본값)', async () => {
    const { saleRoundsService, controller } = makeController();

    await controller.getPublicRounds('store-1', 'items', '2');
    expect(saleRoundsService.listPublicRoundsWithItems).toHaveBeenCalledWith('store-1', 2);
    await controller.getPublicRounds('store-1', 'items');
    expect(saleRoundsService.listPublicRoundsWithItems).toHaveBeenLastCalledWith('store-1', 3);
    expect(saleRoundsService.listPublicRounds).not.toHaveBeenCalled();
  });

  it('include 값이 다르거나 past가 잘못되면 400으로 거부한다', () => {
    const { saleRoundsService, controller } = makeController();

    expect(() => controller.getPublicRounds('store-1', 'everything')).toThrow(BadRequestException);
    expect(() => controller.getPublicRounds('store-1', 'items', '99')).toThrow(BadRequestException);
    expect(saleRoundsService.listPublicRoundsWithItems).not.toHaveBeenCalled();
  });
});
