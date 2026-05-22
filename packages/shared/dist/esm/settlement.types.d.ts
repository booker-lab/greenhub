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
/** 사용자 확정값: 셀러본 색 채택(pending=yellow) */
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
}
//# sourceMappingURL=settlement.types.d.ts.map