export type StoreStatus = 'invited' | 'active' | 'archived';

export const DEFAULT_SALES_MODE = 'legacy' as const;

export type SalesMode = typeof DEFAULT_SALES_MODE | 'round_direct';

export function normalizeSalesMode(salesMode: SalesMode | null | undefined): SalesMode {
  return salesMode ?? DEFAULT_SALES_MODE;
}

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
