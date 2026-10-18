import type { StoreProfileExtras } from './benchmark.types.js';
export type StoreStatus = 'invited' | 'active' | 'archived';
export declare const DEFAULT_SALES_MODE: "legacy";
export type SalesMode = typeof DEFAULT_SALES_MODE | 'round_direct';
export declare function normalizeSalesMode(salesMode: SalesMode | null | undefined): SalesMode;
export interface Store extends StoreProfileExtras {
    id: string;
    ownerId: string;
    name: string;
    ceoName: string;
    phone: string;
    address: string;
    businessNumber: string | null;
    logoUrl: string | null;
    status: StoreStatus;
    salesMode?: SalesMode;
    createdAt: unknown;
    updatedAt: unknown;
}
export interface UpdateStoreRequest {
    name?: string;
    ceoName?: string;
    phone?: string;
    address?: string;
    businessNumber?: string;
    logoUrl?: string;
    salesMode?: SalesMode;
}
/**
 * Public store profile — explicit allowlist for unauthenticated reads.
 * id/name/logoUrl/salesMode와 공개 소개(StoreProfileExtras)만. Never ownerId/ceoName/phone/address/
 * businessNumber/status/timestamps.
 */
export interface StorePublicProfile extends StoreProfileExtras {
    id: string;
    name: string;
    logoUrl: string | null;
    salesMode: SalesMode;
}
//# sourceMappingURL=store.types.d.ts.map