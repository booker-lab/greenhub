/**
 * 정산(Settlement) 공유 타입·상수 — SSOT (F-1/S4)
 *
 * 통합 전: SettlementStatus·STATUS_LABEL·STATUS_COLOR가 4곳에 따로 정의됐고
 * 라벨/색이 서로 달랐다(셀러 "정산 대기"/yellow vs 어드민 "대기"/gray).
 * → 사용자 확정: 셀러본 채택. 백엔드(타입만)·셀러·어드민 전부 여기서 import.
 *
 * 주의: 다른 *.types.ts는 타입만 export하나, 정산은 라벨/색 상수도 공유한다
 * (셀러·어드민 화면이 동일 표기를 써야 하므로). 상수는 런타임 값이라 백엔드는
 * 타입만 사용하고 라벨/색은 프론트만 import한다.
 */
export type SettlementStatus = 'pending' | 'confirmed' | 'paid' | 'cancelled';
/** 4상태 배열 — DTO 검증(@IsIn)·집계 루프 등에서 재사용 */
export declare const SETTLEMENT_STATUSES: SettlementStatus[];
/** 사용자 확정값: 셀러본 라벨 채택 */
export declare const STATUS_LABEL: Record<SettlementStatus, string>;
/**
 * 사용자 확정값: 셀러본 색 채택(pending=yellow).
 * 디자인 기준(파랑 안 씀·Mantine 기본 green 대신 brand)과 주문 상태 체계(진행=초록, 완료=회색)에 맞춘다.
 */
export declare const STATUS_COLOR: Record<SettlementStatus, string>;
/**
 * 정산 문서 공유 인터페이스 — 셀러·어드민 필드 합집합(N8).
 *
 * 통합 전 불일치: 셀러 `Settlement`는 storeId/paidAt/confirmedAt 누락,
 * 어드민 `AdminSettlement`는 confirmedAt 누락. 여기서 합집합으로 정의하고
 * 앱별로 일부 필드만 사용한다(차이 허용). confirmedAt은 B-1 confirm 배치가
 * set하는 신규 필드라 양쪽 다 미정의였음 → 공유 타입에 신규 포함.
 *
 * settledAt/paidAt/confirmedAt은 직렬화 형태가 호출 경로마다 달라
 * (Firestore Timestamp · { _seconds } · null) unknown으로 둔다.
 */
export interface Settlement {
    id: string;
    orderId: string;
    storeId?: string;
    totalAmount: number;
    platformFee: number;
    netAmount: number;
    status: SettlementStatus;
    settledAt: unknown;
    confirmedAt?: unknown | null;
    paidAt?: unknown | null;
    /** 지급 완료 뒤 주문이 환불돼 판매자에게서 돌려받아야 하는 돈. 없으면 회수 대상 아님. */
    recovery?: SettlementRecovery | null;
}
/**
 * 회수 기록 상태 — 배송 뒤 환불 계획서 §2.3.
 * PENDING: 돌려받을 돈이 남음 / RECOVERED: 관리자가 계좌로 받은 뒤 "회수 완료"를 누름.
 * 정산 status(paid)는 바꾸지 않고 이 칸만 붙인다(지급 사실은 그대로 남긴다).
 */
export type SettlementRecoveryStatus = 'PENDING' | 'RECOVERED';
export interface SettlementRecovery {
    status: SettlementRecoveryStatus;
    /** 돌려받을 금액 = 그 정산의 판매자 지급액(netAmount) */
    amount: number;
    createdAt: unknown;
    recoveredAt: unknown | null;
    recoveredBy: string | null;
}
export declare const RECOVERY_STATUS_LABEL: Record<SettlementRecoveryStatus, string>;
//# sourceMappingURL=settlement.types.d.ts.map