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
    expect(source).toMatch(
      /const\s*\{\s*orders,\s*hasMore,\s*loading,\s*loadingMore,\s*error,\s*moreError,\s*reload,\s*loadMore,\s*forceRefund,\s*postDeliveryRefund,?\s*\}/,
    );
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

  it('강제환불은 브라우저 prompt 대신 대상이 보이는 확인창을 거친다', () => {
    expect(source).not.toContain('prompt(');
    expect(source).toContain('onRefund={openRefund}');
    expect(source).toContain('<RefundConfirmModal');
    expect(source).toContain('target={refundTarget}');
    expect(source).toContain('onConfirm={runRefund}');
    expect(source).toContain('forceRefund(order.id, normalizeRefundReason(refundReason))');
  });

  it('배송 후 환불은 사유·메모 확인창을 거쳐 같은 처리 중 잠금으로 보낸다', () => {
    expect(source).toContain('onPostDeliveryRefund={openDeliveredRefund}');
    expect(source).toContain('<PostDeliveryRefundModal');
    expect(source).toContain('target={deliveredTarget}');
    expect(source).toContain('onConfirm={runDeliveredRefund}');
    expect(source).toContain('postDeliveryRefund(order.id, reasonCode, deliveredMemo.trim())');
  });

  it('처리 중 잠금은 주문 id 묶음이라 여러 건을 이어서 처리해도 각자 유지된다', () => {
    expect(source).toContain('processingIds={processingIds}');
    expect(source).toContain('inFlightRef.current.has(target.id)');
    expect(source).toContain('inFlightRef.current.delete(target.id)');
    expect(source).not.toContain('setProcessingId(null)');
  });

  it('기존 filter 배선을 변경하지 않는다', () => {
    expect(source).toContain('<OrdersFilters');
    expect(source).toContain('storeFilter={storeFilter}');
    expect(source).toContain('statusFilter={statusFilter}');
    expect(source).toContain('onStoreChange={setStoreFilter}');
    expect(source).toContain('onStatusChange={setStatusFilter}');
    // 가게는 ID 입력 대신 판매자 목록 이름으로 고른다.
    expect(source).toContain('storeOptions={buildStoreOptions(stores)}');
    expect(source).toContain('storeId: storeFilter || undefined');
  });

  it('서버가 더 있다고 알리면 더 보기로 이어 받는다(조회 실패 중에는 감춘다)', () => {
    expect(source).toContain('<LoadMoreFooter');
    expect(source).toContain('onLoadMore={loadMore}');
    expect(source).toContain('moreError={moreError}');
    expect(source).toContain('error === null && !loading');
  });
});
