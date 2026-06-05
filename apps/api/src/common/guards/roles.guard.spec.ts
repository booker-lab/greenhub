import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RolesGuard } from './roles.guard';

function createContext(role?: string): ExecutionContext {
  return {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : undefined }),
    }),
  } as unknown as ExecutionContext;
}

function createGuard(required?: string[]) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => (key === ROLES_KEY ? required : undefined)),
  } as unknown as Reflector;

  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('required role이 없으면 통과시킨다', () => {
    const guard = createGuard(undefined);

    expect(guard.canActivate(createContext('hub_staff'))).toBe(true);
  });

  it('admin 전용 엔드포인트는 admin만 통과시킨다', () => {
    const guard = createGuard(['admin']);

    expect(guard.canActivate(createContext('admin'))).toBe(true);
    expect(guard.canActivate(createContext('seller'))).toBe(false);
    expect(guard.canActivate(createContext('hub_staff'))).toBe(false);
    expect(guard.canActivate(createContext())).toBe(false);
  });
});
