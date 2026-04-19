export type StoreStatus = 'invited' | 'active' | 'suspended';
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
}
//# sourceMappingURL=store.types.d.ts.map