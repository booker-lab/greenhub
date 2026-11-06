// 사이드바 할 일 수의 조회 경로와 응답 읽기 — 순수 함수(vitest에서 '@/' alias 없이 검증한다).
// 새 API 없이 기존 관리자 조회 세 개로 센다(2026-11-01 사용자 결정, design-direction.md §5 어드민).
// - 주문: 배송 보류(DELIVERY_HELD). 서버가 상태로 거른 뒤 자르므로 hasMore면 "더 있음"이다.
//   환불 실패는 상태 필터가 없어 셀 수 없다(할 일 요약 API 제안).
// - 정산: 지급 가능 정산 건수(합계 조회 payable.count). 합계가 잘렸으면(truncated) "더 있음"이다.
// - 기사: 승인 대기. 서버가 한 쪽을 받은 뒤 거르므로 한 번에 받을 수 있는 최대 건수로 묻는다.

import type { AdminTodoCount, AdminTodoKey } from './navItems';

export const ADMIN_TODO_PATHS: Record<AdminTodoKey, string> = {
  orders: '/admin/orders?status=DELIVERY_HELD&limit=100',
  settlements: '/admin/settlements/summary',
  drivers: '/admin/drivers?status=pending&limit=200',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readList(body: unknown, key: string): AdminTodoCount | null {
  if (!isRecord(body) || !Array.isArray(body[key])) return null;
  return { count: (body[key] as unknown[]).length, more: body.hasMore === true };
}

/** 응답 모양이 다르면 null(숫자를 쓰지 않음)이다. */
export function readAdminTodoCount(key: AdminTodoKey, body: unknown): AdminTodoCount | null {
  if (key === 'orders') return readList(body, 'orders');
  if (key === 'drivers') return readList(body, 'drivers');
  if (!isRecord(body) || !isRecord(body.payable) || typeof body.payable.count !== 'number') {
    return null;
  }
  return { count: body.payable.count, more: body.truncated === true };
}
