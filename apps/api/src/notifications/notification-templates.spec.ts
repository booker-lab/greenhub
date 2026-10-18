import { DELIVERY_HOLD_CUSTOMER_REASONS } from '../orders/orders-lifecycle.service';
import { ROUND_DIRECT_NOTIFICATION_TEMPLATE_CODES } from './aligo-template-codes';
import {
  containsLinkLike,
  containsPhoneNumber,
  NOTIFICATION_NAME_FALLBACK,
  NOTIFICATION_SELLER_TEXT_FALLBACKS,
  NOTIFICATION_TEMPLATES,
  NOTIFICATION_VARIABLE_MAX_LENGTH,
  renderNotificationMessage,
  sanitizeNotificationVariable,
  toSingleLineText,
} from './notification-templates';
import { REFUND_NOTICE_REASONS } from './refund-notice-reasons';

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

  it('이름·판매자 입력 변수가 아닌 시스템 변수는 링크·번호 판정으로 바꾸지 않는다', () => {
    expect(sanitizeNotificationVariable('pickupCode', '1588-1234')).toBe('1588-1234');
    expect(sanitizeNotificationVariable('orderId', '20261009-000001')).toBe('20261009-000001');
  });

  it('toSingleLineText는 문자열이 아니면 빈 문자열을 돌려준다', () => {
    expect(toSingleLineText(undefined, 10)).toBe('');
    expect(toSingleLineText(123, 10)).toBe('');
  });
});

describe('판매자 입력 변수의 링크·전화번호 정제', () => {
  it.each([
    '010-1234-5678',
    '01012345678',
    '010 1234 5678',
    '010.1234.5678',
    '011-123-4567',
    '02-123-4567',
    '(02)1234-5678',
    '031.123.4567',
    '064-123-4567',
    '070-1234-5678',
    '080-123-4567',
    '0505-123-4567',
    '1588-1234',
    '15881234',
    '1644 5678',
    '1800-1234',
    '+82 10-1234-5678',
    '+82-2-123-4567',
    '０１０－１２３４－５６７８',
    '010–1234–5678',
  ])('전화번호(%s)를 찾는다', (phone) => {
    expect(containsPhoneNumber(`문의는 ${phone}로 해 주세요`)).toBe(true);
  });

  it.each([
    '20261009-000001',
    '2026-10-18',
    '15,000원',
    '06236',
    '2층 201호',
    '중리천로 105-10',
    '1588개',
    '운송장 6123456789012',
  ])('전화번호가 아닌 숫자(%s)는 그대로 둔다', (text) => {
    expect(containsPhoneNumber(text)).toBe(false);
  });

  it.each([
    'https://example.test/x',
    'hxxp://example.test',
    'www.example',
    'example.com',
    'shop.co.kr',
    'bit.ly/abc',
    'me2.do/abc',
    'open.kakao.com/o/abc',
    '그린러브.kr',
    '그린러브.한국',
    'naver . com',
    'naver[.]com',
    'naver (dot) com',
    'naver dot com',
    '네이버닷컴',
    '1.2.3.4',
    'ｅｘａｍｐｌｅ．ｃｏｍ',
    'exa​mple.com',
  ])('웹 주소·도메인(%s)을 찾는다', (link) => {
    expect(containsLinkLike(`자세한 안내 ${link} 확인`)).toBe(true);
  });

  it.each([
    'Cym.goeringii 춘란',
    'Phal. Sogo Yukidian',
    'No.1 호접란',
    '3.5호 화분',
    'Mr.Kim',
    '재고가 없습니다. App 오류로 취소합니다',
    '서울시 강남구 example.test',
  ])('링크가 아닌 문장(%s)은 그대로 둔다', (text) => {
    expect(containsLinkLike(text)).toBe(false);
  });

  it.each([
    ['reason', '환불은 1588-1234로 문의'],
    ['reason', '자세한 내용은 bit.ly/abc 참고'],
    ['reason', '고객센터 02-123-4567'],
    ['productName', '호접란 (주문 문의 010-1234-5678)'],
    ['productName', '호접란 example.com'],
    ['hubAddress', '서울 강남구 테헤란로 1 (문의 02-123-4567)'],
    ['hubAddress', '자세한 위치 https://example.test/map'],
  ])('%s 변수에 링크·전화번호가 있으면 고정 문구로 바꾼다', (key, value) => {
    expect(sanitizeNotificationVariable(key, value)).toBe(NOTIFICATION_SELLER_TEXT_FALLBACKS[key]);
  });

  it('자른 결과가 새로 링크처럼 보여도 고정 문구로 바꾼다', () => {
    const productName = `${'가'.repeat(52)} abc.community`;
    expect(containsLinkLike(productName)).toBe(false);
    expect(sanitizeNotificationVariable('productName', productName)).toBe(
      NOTIFICATION_SELLER_TEXT_FALLBACKS['productName'],
    );
  });

  it('아주 긴 값도 본문에 실리는 앞부분만 판정해 빠르게 정리한다', () => {
    const hubAddress = `${'가'.repeat(200_000)} example.com 02-123-4567`;
    const sanitized = sanitizeNotificationVariable('hubAddress', hubAddress);
    // 링크·번호는 잘려 나가 본문에 실리지 않으므로 앞부분을 그대로 쓴다.
    expect(sanitized).toBe(`${'가'.repeat(NOTIFICATION_VARIABLE_MAX_LENGTH['hubAddress'] - 1)}…`);
  });

  it('판매자 취소 사유에 연락처가 있어도 승인된 본문은 그대로 두고 사유만 바꾼다', () => {
    expect(
      renderNotificationMessage('ORDER_CANCELLED', {
        orderId: '20261009-000001',
        reason: '환불은 1588-1234로 문의',
      }),
    ).toBe('주문 20261009-000001이 취소되었습니다.\n사유: 판매자 사정');
  });

  it('거점 도착 알림의 상품명·거점 주소도 링크·전화번호가 있으면 고정 문구로 바꾼다', () => {
    expect(
      renderNotificationMessage('ORDER_HUB_ARRIVED', {
        productName: '호접란 bit.ly/abc',
        pickupCode: '123456',
        hubAddress: '서울 강남구 테헤란로 1 (문의 02-123-4567)',
      }),
    ).toBe(
      '주문 상품이(가) 거점에 도착했습니다.\n픽업 코드: 123456\n수령 장소: 주문 상세에서 확인해 주세요',
    );
  });

  it('공동구매 알림의 상품명도 같은 기준으로 정제한다', () => {
    expect(
      renderNotificationMessage('GROUP_PREPARING', { productName: '호접란 www.example' }),
    ).toBe('주문 상품 공동구매 상품 준비가 시작되었습니다.');
  });

  it.each([
    ['reason', '재고 부족'],
    ['reason', '판매자 취소'],
    ['reason', '고객 요청'],
    ['reason', '목표 수량 미달성으로 취소'],
    ...Object.values(DELIVERY_HOLD_CUSTOMER_REASONS).map((reason) => ['reason', reason]),
    ...Object.values(REFUND_NOTICE_REASONS).map((reason) => ['reason', reason]),
    ['productName', '미니 호접란 3대 (2.5호 화분)'],
    ['productName', 'Cym.goeringii 춘란'],
    ['hubAddress', '경기도 이천시 부발읍 중리천로 105-10 2층'],
    ['hubAddress', '서울특별시 강남구 테헤란로 152, 06236'],
  ])('%s 변수의 일반 값(%s)은 그대로 둔다', (key, value) => {
    expect(sanitizeNotificationVariable(key, value)).toBe(value);
  });

  it('ALIGO에 승인된 회차 직배송 템플릿 본문 8종은 그대로다', () => {
    expect(
      Object.fromEntries(
        ROUND_DIRECT_NOTIFICATION_TEMPLATE_CODES.map((code) => [
          code,
          NOTIFICATION_TEMPLATES[code].body,
        ]),
      ),
    ).toEqual({
      ORDER_ACCEPTED: '#{name}님, 주문 #{orderId}이 접수되었습니다.',
      ORDER_PREPARING: '주문 #{orderId}의 상품 준비가 시작되었습니다.',
      ORDER_DELIVERING: '주문 #{orderId}의 배송이 시작되었습니다.',
      ORDER_DELIVERY_HELD: '주문 #{orderId}의 배송이 보류되었습니다.\n사유: #{reason}',
      ORDER_REDELIVERY_PAYMENT_REQUESTED: '주문 #{orderId}의 재배송비 결제가 필요합니다.',
      ORDER_REDELIVERY_SCHEDULED: '주문 #{orderId}의 재배송이 예정되었습니다.',
      ORDER_DELIVERED: '주문 #{orderId}의 배송이 완료되었습니다.',
      ORDER_CANCELLED: '주문 #{orderId}이 취소되었습니다.\n사유: #{reason}',
    });
  });
});
