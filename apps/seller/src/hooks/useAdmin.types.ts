import type { OrderStatus, SettlementStatus, StoreStatus } from '@greenhub/shared';
import type { AdminCommandOutcome } from './useAdmin.outcome';

// 관리자 화면 공통 타입 — 도메인별 훅 파일과 화면이 함께 쓴다.

/** archive/restore처럼 ApiError를 직접 전파하는 경로의 reconciliation 결과. */
export interface AdminReconciliation {
  reconciled: boolean;
  readError: string | null;
}

// ── Types ────────────────────────────────────────────────────────

// 관리자 판매자 목록 응답(허용 필드만). 정산 계좌·소유자 id는 내려오지 않는다.
export interface AdminStore {
  id: string;
  name: string;
  status: StoreStatus;
  commissionRate?: number;
  /** 대표자 이름·연락처. 가입 전(초대 중) 판매자는 비어 있을 수 있다. */
  ceoName?: string;
  phone?: string;
  createdAt: unknown;
  archivedAt?: unknown;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
  suspended?: boolean;
  createdAt: unknown;
}

// 관리자 주문 목록 한 줄. 고객은 이름만 내려오고 전화·주소는 내려오지 않는다.
export interface AdminOrder {
  id: string;
  orderNumber?: string | null;
  storeId: string;
  /** 가게 이름. 가게 문서가 없거나 이름이 비어 있으면 null. */
  storeName?: string | null;
  buyerName?: string | null;
  /** 첫 상품명 + "외 N개". */
  productSummary?: string | null;
  /** 취소 진행 상태(REFUNDING·REFUND_FAILED·LOCAL_PENDING·LOCAL_FAILED·COMPLETED). */
  cancellationStatus?: string | null;
  status: OrderStatus;
  totalAmount: number;
  deliveryMethod: string;
  createdAt: unknown;
  // 회차 주문 판별(강제환불 허용 상태가 일반 주문과 다름)
  schemaVersion?: number;
  roundId?: string | null;
  // 소비자 요청사항(회차 주문만)
  requestNote?: string | null;
}

/** 관리자 정산 지급용 판매자 계좌(지급 대상 confirmed 행에만 온다). */
export interface AdminPayoutAccount {
  bankName: string;
  accountHolder: string;
  accountNumber: string;
}

/** 확정·지급을 막는 사유. PROVIDER_REVERSAL = 결제사 취소·분쟁 운영 기록이 열려 있음. */
export type AdminSettlementHoldReason = 'PROVIDER_REVERSAL';

export interface AdminSettlement {
  id: string;
  storeId: string;
  /** 가게 이름(서버가 붙인다). 이름이 없거나 가게 문서가 없으면 null. */
  storeName?: string | null;
  orderId: string;
  /** 판매자 주문번호. 정산에 없으면 서버가 주문 문서에서 읽는다. 끝내 없으면 null. */
  orderNumber?: string | null;
  totalAmount: number;
  /** 정산을 만들 때 쓴 수수료율(0~1). */
  platformFeeRate?: number;
  platformFee: number;
  netAmount: number;
  status: SettlementStatus; // N3: string → 공유 SettlementStatus(SSOT)
  settledAt: unknown;
  confirmedAt?: unknown | null; // N8: B-1 confirm 배치 신규 필드(어드민도 표시 대비)
  paidAt: unknown | null;
  /** 지급 뒤 주문이 환불돼 판매자에게 돌려받아야 하는지(결정 ④). */
  recoveryRequired?: boolean;
  recoveryAmount?: number | null;
  holdReason?: AdminSettlementHoldReason | null;
  payoutAccount?: AdminPayoutAccount | null;
}

/** GET /admin/settlements/summary — 같은 조건 전체 합계(서버 계산). */
export interface AdminSettlementsSummary {
  count: number;
  payable: { count: number; netAmount: number };
  paid: { count: number; netAmount: number };
  platformFee: number;
  recovery: { count: number; amount: number };
  truncated: boolean;
}

export interface InviteToken {
  token: string;
  createdBy: string;
  usedAt: string | null;
  usedBy: string | null;
  expiresAt: string | null;
  createdAt: string | null;
  /** 관리자 취소 시각. 취소 기능 이전에 만든 문서에는 필드가 없다. */
  revokedAt?: string | null;
  revokedBy?: string | null;
  /** 받는 사람 이메일(정규화). 지정하지 않은 초대는 null, 이 기능 이전 문서에는 필드가 없다. */
  recipientEmail?: string | null;
}

/** 초대 발급 응답. */
export interface IssuedInvite {
  token: string;
  expiresAt: string;
  recipientEmail?: string | null;
}

/**
 * 초대 취소 결과. 공통 AdminCommandOutcome에 409 본문의 reason
 * (already_revoked·already_used·expired)을 더해 화면이 사유별 안내를 고를 수 있게 한다.
 */
export type InviteRevokeOutcome =
  | Extract<AdminCommandOutcome, { kind: 'confirmed' }>
  | (Extract<AdminCommandOutcome, { kind: 'rejected' }> & { reason: string | null })
  | Extract<AdminCommandOutcome, { kind: 'unknown' }>;

export type DriverStatus = 'all' | 'pending' | 'approved' | 'suspended';

export interface AdminDriver {
  id: string;
  name: string;
  email: string | null;
  phone?: string | null;
  driverApproved: boolean;
  suspended?: boolean;
  createdAt: unknown;
}

export interface BannerCta {
  label: string;
  href: string;
}

export interface AdminBanner {
  imageUrl?: string;
  tagText?: string;
  headline?: string;
  subText?: string;
  cta1?: BannerCta;
  cta2?: BannerCta;
  isActive?: boolean;
}
