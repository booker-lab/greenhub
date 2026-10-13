import { customerOrderLabel } from './customer-order-label';

describe('customerOrderLabel', () => {
  it('고객 화면과 같은 주문번호를 알림 본문에 쓴다', () => {
    expect(customerOrderLabel({ orderNumber: '20261101-000003' }, 'a'.repeat(32))).toBe(
      '20261101-000003',
    );
    expect(customerOrderLabel({ orderNumber: ' 20261101-000003 ' }, 'doc-1')).toBe(
      '20261101-000003',
    );
  });

  it('주문번호가 없는 옛 주문은 문서 ID를 그대로 쓴다', () => {
    expect(customerOrderLabel({}, 'doc-1')).toBe('doc-1');
    expect(customerOrderLabel({ orderNumber: '' }, 'doc-1')).toBe('doc-1');
    expect(customerOrderLabel({ orderNumber: 42 }, 'doc-1')).toBe('doc-1');
    expect(customerOrderLabel(null, 'doc-1')).toBe('doc-1');
  });
});
