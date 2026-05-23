"use strict";
/**
 * 날짜 유틸 — KST(UTC+9) 기준 SSOT (#CL-48)
 *
 * `new Date().toISOString()`은 UTC 기준이라 KST 00:00~08:59 시간대에
 * `slice(0,10)`/`split('T')[0]`로 추출한 날짜가 전날로 밀린다(자정 직후 캘린더 오작동).
 * 셀러 곳곳에 흩어진 인라인 +9h 보정을 이 함수로 통일한다.
 *
 * 주의: 이 파일은 shared 패키지 최초의 '런타임 함수'다(기존은 타입/상수 전용).
 * dual ESM/CJS 빌드(tsc + tsc -p tsconfig.cjs.json) 양쪽에 정상 산출되어야 한다.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.todayKST = todayKST;
exports.toDateStrKST = toDateStrKST;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
/** KST 기준 오늘 날짜를 YYYY-MM-DD로 반환 (UTC 자정~오전9시 하루 밀림 방지) */
function todayKST() {
    return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
/** 주어진 시각의 KST 기준 날짜를 YYYY-MM-DD로 반환 */
function toDateStrKST(date) {
    return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}
