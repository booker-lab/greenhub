export type UserRole = 'consumer' | 'seller' | 'driver' | 'admin';
export type AuthProvider = 'kakao' | 'naver' | 'email';
export interface JwtPayload {
    sub: string;
    role: UserRole;
    storeId?: string;
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
    providers: AuthProvider[];
    savedAddresses: SavedAddress[];
    fcmToken: string | null;
    createdAt: string;
    updatedAt: string;
}
//# sourceMappingURL=auth.types.d.ts.map