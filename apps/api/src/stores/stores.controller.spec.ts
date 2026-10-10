import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { StoresController } from './stores.controller';

describe('StoresController role contract', () => {
  const reflector = new Reflector();
  const createStore = StoresController.prototype.createStore;

  it('POST /stores는 판매자 역할만 허용한다', () => {
    expect(reflector.get(ROLES_KEY, createStore)).toEqual(['seller']);
    expect(Reflect.getMetadata(GUARDS_METADATA, createStore)).toContain(RolesGuard);
  });

  it.each([
    ['seller', true],
    ['consumer', false],
    ['driver', false],
    ['admin', false],
  ])('%s 역할의 매장 생성 허용 여부는 %s다', (role, allowed) => {
    const guard = new RolesGuard(reflector);
    const context = {
      getHandler: () => createStore,
      getClass: () => StoresController,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u-1', role } }) }),
    };
    expect(guard.canActivate(context as never)).toBe(allowed);
  });
});
