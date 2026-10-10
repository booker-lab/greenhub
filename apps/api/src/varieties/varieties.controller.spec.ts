import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, type UserRole } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { VarietiesController } from './varieties.controller';

type Handler = 'findAll' | 'findOne' | 'create' | 'update';

function handlerOf(name: Handler) {
  return VarietiesController.prototype[name];
}

function contextFor(name: Handler, role: UserRole): ExecutionContext {
  return {
    getHandler: () => handlerOf(name),
    getClass: () => VarietiesController,
    switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'user-1', role } }) }),
  } as unknown as ExecutionContext;
}

describe('VarietiesController 접근 제어', () => {
  const guard = new RolesGuard(new Reflector());

  it.each(['create', 'update'] as const)('%s는 JWT와 역할 가드를 함께 건다', (name) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handlerOf(name))).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, handlerOf(name))).toEqual(['admin']);
  });

  it.each(['create', 'update'] as const)('%s는 consumer·seller·driver에게 거부된다', (name) => {
    for (const role of ['consumer', 'seller', 'driver'] as const) {
      expect(guard.canActivate(contextFor(name, role))).toBe(false);
    }
  });

  it.each(['create', 'update'] as const)('%s는 admin에게 허용된다', (name) => {
    expect(guard.canActivate(contextFor(name, 'admin'))).toBe(true);
  });

  it.each(['findAll', 'findOne'] as const)('%s 조회는 공개 상태를 유지한다', (name) => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handlerOf(name))).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, handlerOf(name))).toBeUndefined();
  });
});
