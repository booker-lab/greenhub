import { NOTIFICATION_TEMPLATES, renderNotificationMessage } from './notification-templates';

describe('알림 본문 필수 변수 계약', () => {
  it('registry의 모든 템플릿이 requiredVariables를 명시한다', () => {
    for (const template of Object.values(NOTIFICATION_TEMPLATES)) {
      expect(Array.isArray(template.requiredVariables)).toBe(true);
    }
  });

  it.each([
    undefined,
    '',
    '   ',
  ])('누락 또는 공백 필수 변수를 빈 문자열로 렌더링하지 않는다', (name) => {
    expect(() =>
      renderNotificationMessage('ORDER_ACCEPTED', {
        orderId: 'order-1',
        ...(name === undefined ? {} : { name }),
      }),
    ).toThrow('name');
  });
});
