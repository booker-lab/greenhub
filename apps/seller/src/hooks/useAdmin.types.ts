import type { OrderStatus, SettlementStatus, StoreStatus } from '@greenhub/shared';
import type { AdminCommandOutcome } from './useAdmin.outcome';

// 관리자 화면 공통 타입 — 도메인별 훅 파일과 화면이 함께 쓴다.

/** archive/restore처럼 ApiError를 직접 전파하는 경로의 reconciliation 결과. */
export interface AdminReconciliation {
  reconciled: boolean;
  readError: string | null;
}

// ── Types ────────────────────────────────────────────────────────

export interface AdminStore {
  id: string;
  name: string;
  ownerId: string;
  status: StoreStatus;
  commissionRate?: number;
  createdAt: unknown;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
  suspended?: boolean;
  createdAt: unknown;
}

export interface AdminOrder {
  id: string;
  orderNumber?: string;
  storeId: string;
  userId: string;
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

export interface AdminSettlement {
  id: string;
  storeId: string;
  orderId: string;
  totalAmount: number;
  platformFee: number;
  netAmount: number;
  status: SettlementStatus; // N3: string → 공유 SettlementStatus(SSOT)
  settledAt: unknown;
  confirmedAt?: unknown | null; // N8: B-1 confirm 배치 신규 필드(어드민도 표시 대비)
  paidAt: unknown | null;
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
