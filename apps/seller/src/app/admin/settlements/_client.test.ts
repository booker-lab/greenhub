import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// AdminSettlementsClient는 '@/' alias를 사용하므로 vitest에서 직접 import할 수 없다.
// 따라서 이 focused test는 화면의 read-state 분기와 기존 action/filter 배선을 소스에서 고정한다.
const source = readFileSync(new URL('./_client.tsx', import.meta.url), 'utf8');

describe('AdminSettlementsClient 조회 복구 배선', () => {
  it('useAdminSettlements의 error/reload를 소비한다', () => {
    expect(source).toContain('useAdminSettlements({');
    expect(source).toMatch(
      /const\s*\{\s*settlements,\s*loading,\s*error,\s*reload,\s*markAsPaid\s*\}/,
    );
  });

  it('조회 실패 메시지와 명시적 retry를 표시한다', () => {
    expect(source).toContain('error !== null && !loading');
    expect(source).toContain('정산 목록을 불러오지 못했습니다.');
    expect(source).toContain(`{error}`);
    expect(source).toContain('<Button onClick={reload}');
    expect(source).toContain('다시 조회');
  });

  it('조회 실패에서는 정상 0건 수와 빈 목록으로 합쳐지지 않는다', () => {
    expect(source).toContain('!loading && error === null');
    expect(source).toContain('settlements.length > 0 && <SummaryCards');
    expect(source).toContain('<SettlementTable');
    expect(source).toContain('loading={loading}');
  });

  it('정상 empty와 필터 배선을 유지한다', () => {
    expect(source).toContain('settlements.length > 0');
    expect(source).toContain('storeFilter={storeFilter}');
    expect(source).toContain('fromFilter={fromFilter}');
    expect(source).toContain('toFilter={toFilter}');
    expect(source).toContain('onStoreChange={setStoreFilter}');
    expect(source).toContain('onFromChange={setFromFilter}');
    expect(source).toContain('onToChange={setToFilter}');
    expect(source).toContain('storeId: storeFilter || undefined');
    expect(source).toContain('from: fromFilter || undefined');
    expect(source).toContain('to: toFilter || undefined');
  });

  it('기존 markAsPaid 확인·처리 경로를 유지한다', () => {
    expect(source).toContain('const runPay = async () =>');
    expect(source).toContain('await markAsPaid(payTargetId)');
    expect(source).toContain('setPayTargetId(null)');
    expect(source).toContain('opened={payTargetId !== null}');
    expect(source).toContain('onConfirm={runPay}');
  });
});
