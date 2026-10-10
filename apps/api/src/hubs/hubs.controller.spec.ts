import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { HubsController } from './hubs.controller';

function contextFor(handler: (...args: never[]) => unknown, role: string): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => HubsController,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u-1', role } }) }),
  } as unknown as ExecutionContext;
}

describe('HubsController 권한 계약', () => {
  it('모든 거점 경로는 인증 후 판매자 또는 관리자 역할만 통과한다', () => {
    expect(Reflect.getMetadata(ROLES_KEY, HubsController)).toEqual(['seller', 'admin']);
    expect(Reflect.getMetadata(GUARDS_METADATA, HubsController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
  });

  it.each([
    ['seller', true],
    ['admin', true],
    ['consumer', false],
    ['driver', false],
  ])('%s 역할의 거점 주문 목록 접근은 %p', (role, allowed) => {
    const guard = new RolesGuard(new Reflector());
    for (const handler of [
      HubsController.prototype.getHubs,
      HubsController.prototype.getHub,
      HubsController.prototype.getHubOrders,
      HubsController.prototype.createHub,
      HubsController.prototype.updateHub,
      HubsController.prototype.deleteHub,
    ]) {
      expect(guard.canActivate(contextFor(handler, role))).toBe(allowed);
    }
  });

  it('거점 주문 목록은 요청자 id와 status를 서비스에 그대로 넘긴다', async () => {
    const hubs = { getHubOrders: jest.fn().mockResolvedValue({ orders: [], hasMore: false }) };
    const controller = new HubsController(hubs as never);

    await expect(
      controller.getHubOrders(
        'store-1',
        'hub-1',
        { sub: 'seller-1', role: 'seller' } as never,
        'HUB_ARRIVED',
      ),
    ).resolves.toEqual({ orders: [], hasMore: false });
    expect(hubs.getHubOrders).toHaveBeenCalledWith('store-1', 'hub-1', 'seller-1', 'HUB_ARRIVED');
  });
});
