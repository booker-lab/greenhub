import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
// biome-ignore lint/style/useImportType: Nest DI가 생성자 메타데이터에서 클래스 값을 사용한다.
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '../../auth/types/jwt-payload.type';
import { ROLES_KEY, type UserRole } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const { user } = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    if (!user?.role) return false;
    return required.includes(user.role as UserRole);
  }
}
