export type UserRole = 'consumer' | 'seller' | 'driver' | 'hub_staff' | 'admin';

export type AuthProvider = 'kakao' | 'naver' | 'email';

export interface JwtPayload {
  sub: string;
  role: UserRole;
  storeId?: string;
  hubId?: string;
  hubIds?: string[];
  iat: number;
  exp: number;
}

export interface SavedAddress {
  id: string;
  label: string;
  address: string;
  addressDetail: string;
  zipCode: string;
  isDefault: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: UserRole;
  storeId: string | null;
  hubId?: string | null;
  hubIds?: string[];
  providers: AuthProvider[];
  savedAddresses: SavedAddress[];
  fcmToken: string | null;
  createdAt: string; // ISO8601
  updatedAt: string; // ISO8601
}
