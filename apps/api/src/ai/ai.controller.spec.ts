import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AiController } from './ai.controller';

describe('AiController 권한', () => {
  it('JWT와 역할 검사를 함께 걸고 판매자·관리자만 허용한다', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AiController)).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, AiController)).toEqual(['seller', 'admin']);
  });

  it.each([
    ['seller', true],
    ['admin', true],
    ['consumer', false],
    ['driver', false],
  ])('%s 토큰의 생성 요청 허용 여부는 %s', (role, allowed) => {
    const guard = new RolesGuard(new Reflector());
    const context = {
      getHandler: () => AiController.prototype.generateContent,
      getClass: () => AiController,
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u1', role } }) }),
    };
    expect(guard.canActivate(context as never)).toBe(allowed);
  });
});
