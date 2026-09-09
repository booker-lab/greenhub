import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAdminOrdersReadState } from './_lib';

// AdminOrdersClient는 '@/' alias를 사용하므로 vitest에서 직접 import할 수 없다.
// (seller vitest에는 tsconfig paths 매핑이 없어 '@/hooks/useAdmin' 해석이 실패한다.)
// 따라서 본 focused test는 _client.tsx 소스의 배선(wiring)을 고정하고,
// 실제 상태 분기는 순수 함수인 getAdminOrdersReadState로 증명한다.
// READ-ONLY인 OrdersTable/_lib의 동작 자체는 각자의 focused test가 소유한다.

const source = readFileSync(new URL('./_client.tsx', import.meta.url), 'utf8');

const FETCH_ERROR_MESSAGE = '주문 목록 조회 중 오류 발생';

describe('AdminOrdersClient read recovery wiring', () => {
  it('useAdminOrders의 error/reload를 소비한다', () => {
    expect(source).toContain('useAdminOrders({');
    expect(source).toMatch(/const\s*\{\s*orders,\s*loading,\s*error,\s*reload,\s*forceRefund\s*\}/);
  });

  it('error가 존재할 때 empty-only UI로 collapse되지 않는다', () => {
    // _client가 error를 table로 전달한다.
    expect(source).toContain('error={error}');
    // _client 자체가 빈 주문 copy로 Collapse하지 않는다 — 실패 표현은 table이 소유한다.
    expect(source).not.toContain('주문이 없습니다.');
    // 전달된 error는 table 분기에서 EMPTY가 아닌 FETCH_ERROR가 된다.
    expect(
      getAdminOrdersReadState({ loading: false, error: FETCH_ERROR_MESSAGE, orders: [] }),
    ).toBe('FETCH_ERROR');
  });

  it('retry가 reload 경로를 사용한다', () => {
    expect(source).toContain('onRetry={reload}');
  });

  it('정상 empty는 기존 정상 empty로 유지된다', () => {
    // 성공+0건은 EMPTY로 유지되어야 한다.
    expect(getAdminOrdersReadState({ loading: false, error: null, orders: [] })).toBe('EMPTY');
    // _client는 orders/loading을 그대로 전달하므로 정상 분기를 가로채지 않는다.
    expect(source).toContain('orders={orders}');
    expect(source).toContain('loading={loading}');
    // 실패 전용 copy/재시도를 _client가 중복 렌더하지 않는다.
    expect(source).not.toContain('다시 조회');
    expect(source).not.toContain('불러오지 못했습니다');
  });

  it('기존 refund callback을 유지한다', () => {
    expect(source).toContain('forceRefund(orderId');
    expect(source).toContain('onRefund={handleRefund}');
    expect(source).toContain('processingId={processingId}');
  });

  it('기존 filter 배선을 변경하지 않는다', () => {
    expect(source).toContain('<OrdersFilters');
    expect(source).toContain('storeFilter={storeFilter}');
    expect(source).toContain('statusFilter={statusFilter}');
    expect(source).toContain('onStoreChange={setStoreFilter}');
    expect(source).toContain('onStatusChange={setStatusFilter}');
  });
});
