import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// AdminSettlementsClient는 '@/' alias를 사용하므로 vitest에서 직접 import할 수 없다.
// 따라서 이 focused test는 화면의 read-state 분기와 action/filter 배선을 소스에서 고정한다.
const source = readFileSync(new URL('./_client.tsx', import.meta.url), 'utf8');

describe('AdminSettlementsClient 배선', () => {
  it('조회 실패 메시지와 명시적 retry를 표시한다', () => {
    expect(source).toContain('error !== null && !loading');
    expect(source).toContain('정산 목록을 불러오지 못했습니다.');
    expect(source).toContain('<Button onClick={reload}');
  });

  it('상태 탭·가게 이름 선택·기간 필터를 조회 조건으로 넘긴다', () => {
    expect(source).toContain('tabs={ADMIN_SETTLEMENT_FILTER_TABS}');
    expect(source).toContain("status: statusFilter === 'all' ? undefined : statusFilter");
    expect(source).toContain('storeOptions={toStoreOptions(stores)}');
    expect(source).toContain('storeId: storeFilter || undefined');
    expect(source).toContain('from: fromFilter || undefined');
    expect(source).toContain('to: toFilter || undefined');
  });

  it('합계는 서버 합계를 쓰고(계좌 없음·보류만 불러온 행), 더 보기는 hasMore일 때만 보인다', () => {
    expect(source).toMatch(/<SummaryCards\s+summary=\{summary\}/);
    expect(source).toContain('loadedRows={settlements}');
    expect(source).not.toContain('sumPayable');
    expect(source).toContain('{hasMore && (');
    expect(source).toContain('onLoadMore={loadMore}');
  });

  it('지급 확인·처리 경로를 유지한다', () => {
    expect(source).toContain('await markAsPaid(payTarget.id)');
    expect(source).toContain('describePayConfirm(payTarget)');
    expect(source).toContain('onConfirm={runPay}');
    expect(source).toContain('confirmDisabled={payTarget !== null && !canPay(payTarget)}');
    expect(source).toContain('describeAdminCommandOutcome(outcome,');
  });
});
