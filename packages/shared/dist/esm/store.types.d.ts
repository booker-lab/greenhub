export type StoreStatus = 'invited' | 'active' | 'archived';
export declare const DEFAULT_SALES_MODE: "legacy";
export type SalesMode = typeof DEFAULT_SALES_MODE | 'round_direct';
export declare function normalizeSalesMode(salesMode: SalesMode | null | undefined): SalesMode;
export interface Store {
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
//# sourceMappingURL=store.types.d.ts.map