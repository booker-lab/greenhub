import { SetMetadata } from '@nestjs/common';

export type UserRole = 'consumer' | 'seller' | 'driver';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
