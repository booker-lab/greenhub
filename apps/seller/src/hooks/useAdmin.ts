'use client';

// 관리자 화면 훅 진입점 — 화면은 계속 '@/hooks/useAdmin'만 import한다.
// 구현은 도메인별 파일이 소유한다(500라인 한도 대응 분할).
// - useAdmin.types: 공통 타입
// - useAdmin.list: 목록 공통 훅·command 실행
// - useAdmin.accounts: 판매자·소비자·드라이버
// - useAdmin.commerce: 주문·정산
// - useAdmin.banner / useAdmin.invite: 배너·초대

export type { AdminCommandOutcome } from './useAdmin.outcome';
export { classifyAdminCommandError, describeAdminCommandOutcome } from './useAdmin.outcome';
export * from './useAdmin.types';
export { useAdminDrivers, useAdminStores, useAdminUsers } from './useAdmin.accounts';
export { useAdminOrders, useAdminSettlements } from './useAdmin.commerce';
export { useAdminBanner } from './useAdmin.banner';
export { useAdminInvite } from './useAdmin.invite';
