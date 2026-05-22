"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_COLOR = exports.STATUS_LABEL = exports.SETTLEMENT_STATUSES = void 0;
/** 4상태 배열 — DTO 검증(@IsIn)·집계 루프 등에서 재사용 */
exports.SETTLEMENT_STATUSES = [
    'pending',
    'confirmed',
    'paid',
    'cancelled',
];
/** 사용자 확정값: 셀러본 라벨 채택 */
exports.STATUS_LABEL = {
    pending: '정산 대기',
    confirmed: '확정',
    paid: '지급 완료',
    cancelled: '취소',
};
/** 사용자 확정값: 셀러본 색 채택(pending=yellow) */
exports.STATUS_COLOR = {
    pending: 'yellow',
    confirmed: 'blue',
    paid: 'green',
    cancelled: 'red',
};
