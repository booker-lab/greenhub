import {
  NOTIFICATION_NAME_FALLBACK,
  NOTIFICATION_TEMPLATES,
  NOTIFICATION_VARIABLE_MAX_LENGTH,
  renderNotificationMessage,
  sanitizeNotificationVariable,
  toSingleLineText,
} from './notification-templates';

describe('알림 본문 필수 변수 계약', () => {
  it('registry의 모든 템플릿이 requiredVariables를 명시한다', () => {
    for (const template of Object.values(NOTIFICATION_TEMPLATES)) {
      expect(Array.isArray(template.requiredVariables)).toBe(true);
    }
  });

  it('모든 템플릿 본문의 변수는 requiredVariables에 선언돼 있다', () => {
    for (const template of Object.values(NOTIFICATION_TEMPLATES)) {
      const placeholders = Array.from(template.body.matchAll(/#\{([A-Za-z0-9_]+)\}/g)).map(
        (match) => match[1],
      );
      for (const key of placeholders) {
        expect(template.requiredVariables).toContain(key);
      }
    }
  });

  it.each([
    undefined,
    '',
    '   ',
    '\n\t\u200B',
  ])('누락 또는 공백 필수 변수를 빈 문자열로 렌더링하지 않는다', (name) => {
    expect(() =>
      renderNotificationMessage('ORDER_ACCEPTED', {
        orderId: 'order-1',
        ...(name === undefined ? {} : { name }),
      }),
    ).toThrow('name');
  });
});

describe('알림 본문 변수 정리', () => {
  it('한글 이름과 일반 값은 그대로 렌더링한다', () => {
    expect(
      renderNotificationMessage('ORDER_ACCEPTED', { name: '김그린', orderId: '20261009-000001' }),
    ).toBe('김그린님, 주문 20261009-000001이 접수되었습니다.');
  });

  it('변수 안의 줄바꿈·탭·제어문자는 공백 한 칸으로 바꿔 한 줄로 만든다', () => {
    expect(
      renderNotificationMessage('ORDER_CANCELLED', {
        orderId: 'order-1',
        reason: '재고\r\n부족\t\u0007 안내',
      }),
    ).toBe('주문 order-1이 취소되었습니다.\n사유: 재고 부족 안내');
  });

  it('보이지 않는 서식 문자(zero-width, 양방향 제어, BOM)는 제거한다', () => {
    expect(sanitizeNotificationVariable('productName', '호\u200B접\u202E란\uFEFF')).toBe('호접란');
  });

  it('템플릿 고정 문구의 줄바꿈은 유지한다', () => {
    expect(
      renderNotificationMessage('ORDER_DELIVERY_HELD', { orderId: 'order-1', reason: '부재' }),
    ).toBe('주문 order-1의 배송이 보류되었습니다.\n사유: 부재');
  });

  it('변수별 상한을 넘으면 말줄임표를 붙여 상한 글자 수로 자른다', () => {
    const longName = '가'.repeat(40);
    const sanitized = sanitizeNotificationVariable('name', longName);
    expect(Array.from(sanitized)).toHaveLength(NOTIFICATION_VARIABLE_MAX_LENGTH['name']);
    expect(sanitized.endsWith('…')).toBe(true);

    const message = renderNotificationMessage('ORDER_ACCEPTED', {
      name: longName,
      orderId: 'order-1',
    });
    expect(message).toBe(`${'가'.repeat(19)}…님, 주문 order-1이 접수되었습니다.`);
  });

  it('상한 안의 값은 자르지 않는다', () => {
    expect(sanitizeNotificationVariable('name', '가'.repeat(20))).toBe('가'.repeat(20));
  });

  it.each([
    '[그린러브] 환불신청 http://example.test/x',
    'www.example.test',
    '환불안내 bit.ly/abc',
    '그린러브.kr 확인',
  ])('이름 변수가 링크·도메인을 포함하면(%s) 고정 호칭으로 바꾼다', (name) => {
    expect(renderNotificationMessage('ORDER_ACCEPTED', { name, orderId: 'order-1' })).toBe(
      `${NOTIFICATION_NAME_FALLBACK}님, 주문 order-1이 접수되었습니다.`,
    );
  });

  it.each([
    'john.doe',
    'Mr.Kim',
    'kim.ys',
    'J.Lee',
  ])('점이 들어간 일반 이름(%s)은 그대로 둔다', (name) => {
    expect(sanitizeNotificationVariable('name', name)).toBe(name);
  });

  it.each([
    'example.com',
    'shop.co.kr 문의',
    'evil.xyz',
  ])('흔한 최상위 도메인으로 끝나는 이름(%s)은 고정 호칭으로 바꾼다', (name) => {
    expect(sanitizeNotificationVariable('name', name)).toBe(NOTIFICATION_NAME_FALLBACK);
  });

  it('이름이 아닌 변수는 링크 판정으로 바꾸지 않는다', () => {
    expect(sanitizeNotificationVariable('hubAddress', '서울시 강남구 example.test')).toBe(
      '서울시 강남구 example.test',
    );
  });

  it('toSingleLineText는 문자열이 아니면 빈 문자열을 돌려준다', () => {
    expect(toSingleLineText(undefined, 10)).toBe('');
    expect(toSingleLineText(123, 10)).toBe('');
  });
});
