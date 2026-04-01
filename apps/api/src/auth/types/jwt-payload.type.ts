export class JwtPayload {
  sub: string;
  role: 'consumer' | 'seller' | 'driver' | 'admin';
  storeId?: string;
  iat?: number;
  exp?: number;
}
