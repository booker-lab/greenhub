import { describe, expect, it, vi } from 'vitest';
import { buildSalesModeRequest } from './useAdmin.accounts';

// vi.mock은 import보다 먼저 적용된다. vitest에는 '@/' 별칭 설정이 없어 lib/api를 대신한다.
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null }) }));
vi.mock('@/lib/api', () => ({ apiJson: vi.fn() }));

describe('판매 방식 전환 요청', () => {
  it('PATCH /admin/stores/:storeId/sales-mode에 salesMode와 사유를 싣는다', () => {
    expect(buildSalesModeRequest('s-1', 'round_direct', ' 회차 판매 시작 ')).toEqual({
      path: '/admin/stores/s-1/sales-mode',
      init: {
        method: 'PATCH',
        body: JSON.stringify({ salesMode: 'round_direct', reason: '회차 판매 시작' }),
      },
    });
  });

  it('빈 사유는 보내지 않는다', () => {
    for (const reason of [undefined, '', '   ']) {
      expect(JSON.parse(buildSalesModeRequest('s-1', 'legacy', reason).init.body)).toEqual({
        salesMode: 'legacy',
      });
    }
  });

  it('가게 ID는 경로 한 칸으로만 들어간다', () => {
    expect(buildSalesModeRequest('a/b', 'legacy').path).toBe('/admin/stores/a%2Fb/sales-mode');
  });
});
