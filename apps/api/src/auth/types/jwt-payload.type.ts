export class JwtPayload {
  sub: string;
  role: 'consumer' | 'seller' | 'driver' | 'admin';
  // seller/admin은 storeId를 가질 수 있음. consumer/driver는 null.
  // string | null | undefined 모두 허용 — JWT 페이로드 역직렬화 호환성 유지
  storeId?: string | null;
  // 토큰 종류와 수신자. 배포 전에 발급된 토큰에는 없으므로 선택 필드로 둔다.
  typ?: 'access' | 'refresh';
  aud?: string | string[];
  iat?: number;
  exp?: number;
}
