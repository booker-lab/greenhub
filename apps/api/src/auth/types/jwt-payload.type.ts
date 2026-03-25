export class JwtPayload {
  sub: string;
  role: 'consumer' | 'seller' | 'driver';
  storeId?: string;
  iat?: number;
  exp?: number;
}
