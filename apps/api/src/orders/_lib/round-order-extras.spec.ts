import { BadRequestException } from '@nestjs/common';
import { normalizeGift, resolvePackageLabel, resolveSelectedOptions } from './round-order-extras';

const OPTIONS = [
  {
    id: 'pot',
    name: '화분',
    choices: [
      { id: 'basic', label: '기본 화분', priceDelta: 0 },
      { id: 'ceramic', label: '도자기 화분', priceDelta: 8000 },
    ],
  },
  {
    id: 'wrap',
    name: '포장',
    choices: [
      { id: 'none', label: '포장 없음', priceDelta: 0 },
      { id: 'gift', label: '선물 포장', priceDelta: 3000 },
    ],
  },
];

// 2026-10-30 전 상품 문서처럼 needsText가 남아 있는 축하 토퍼 묶음
const LEGACY_TOPPER_OPTIONS = [
  {
    id: 'topper',
    name: '축하 토퍼',
    choices: [
      { id: 'none', label: '토퍼 없음', priceDelta: 0 },
      { id: 'promotion', label: '祝 昇進', priceDelta: 5000, needsText: true },
    ],
  },
];

describe('회차 주문 옵션 계산', () => {
  it('옵션이 없는 상품은 추가 금액 0, 선택지를 받지 않는다', () => {
    expect(resolveSelectedOptions(undefined, undefined)).toEqual({ selected: [], priceDelta: 0 });
    expect(() => resolveSelectedOptions(undefined, ['basic'])).toThrow(BadRequestException);
  });

  it('묶음마다 고른 선택지의 금액을 더하고 스냅샷을 만든다', () => {
    const result = resolveSelectedOptions(OPTIONS, ['ceramic', 'gift']);
    expect(result.priceDelta).toBe(11000);
    expect(result.selected).toEqual([
      { groupId: 'pot', groupName: '화분', choiceId: 'ceramic', choiceLabel: '도자기 화분', priceDelta: 8000 },
      { groupId: 'wrap', groupName: '포장', choiceId: 'gift', choiceLabel: '선물 포장', priceDelta: 3000 },
    ]);
  });

  it.each([
    ['한 묶음만 고름', ['ceramic']],
    ['같은 묶음에서 둘을 고름', ['basic', 'ceramic']],
    ['없는 선택지', ['ceramic', 'unknown']],
    ['중복 선택지', ['ceramic', 'ceramic']],
  ])('%s은 거부한다', (_label, ids) => {
    expect(() => resolveSelectedOptions(OPTIONS, ids)).toThrow(BadRequestException);
  });
});

describe('축하 토퍼 옵션', () => {
  it('예전 상품 문서에 needsText가 남아 있어도 문구 없이 고른 선택지로만 계산한다', () => {
    const result = resolveSelectedOptions(LEGACY_TOPPER_OPTIONS, ['promotion']);
    expect(result.priceDelta).toBe(5000);
    expect(result.selected).toEqual([
      { groupId: 'topper', groupName: '축하 토퍼', choiceId: 'promotion', choiceLabel: '祝 昇進', priceDelta: 5000 },
    ]);
  });
});

describe('포장 라벨 문구', () => {
  const GIFT = { recipientName: '박꽃님', recipientPhone: '010-9876-5432', senderName: '김그린', cardMessage: '' };

  it('선물이 아니면 넣은 문구를 한 줄로 정리하고, 없거나 비면 라벨 없음이다', () => {
    expect(resolvePackageLabel(' 그린\n플라워 ', null)).toBe('그린 플라워');
    expect(resolvePackageLabel(undefined, null)).toBeNull();
    expect(resolvePackageLabel('   ', null)).toBeNull();
  });

  it('20자를 넘으면 잘라 내지 않고 거부한다', () => {
    expect(resolvePackageLabel('가'.repeat(20), null)).toBe('가'.repeat(20));
    expect(() => resolvePackageLabel('가'.repeat(21), null)).toThrow(BadRequestException);
  });

  it('선물이면 보내는 분 이름이 라벨이고, 라벨 문구를 따로 보내면 거부한다', () => {
    expect(resolvePackageLabel(undefined, GIFT)).toBe('김그린');
    expect(() => resolvePackageLabel('다른 이름', GIFT)).toThrow(BadRequestException);
  });
});

describe('선물 정보 정리', () => {
  it('없으면 null, 이름이 비면 거부한다', () => {
    expect(normalizeGift(undefined)).toBeNull();
    expect(() =>
      normalizeGift({ recipientName: ' ', recipientPhone: '010-1234-5678', senderName: '김그린', cardMessage: '' }),
    ).toThrow(BadRequestException);
  });

  it('보내는 분 이름은 포장 라벨이라 20자를 넘으면 잘라 내지 않고 거부한다', () => {
    expect(() =>
      normalizeGift({
        recipientName: '박꽃님',
        recipientPhone: '010-9876-5432',
        senderName: `${'가'.repeat(10)}\n${'나'.repeat(10)}`,
        cardMessage: '',
      }),
    ).toThrow('보내는 분 이름은 20자까지 쓸 수 있어요.');
  });

  it('받는 분 휴대폰 번호가 틀리면 거부한다', () => {
    expect(() =>
      normalizeGift({ recipientName: '박꽃님', recipientPhone: '02-123-4567', senderName: '김그린', cardMessage: '' }),
    ).toThrow(BadRequestException);
  });

  it('한 줄로 정리한다', () => {
    expect(
      normalizeGift({
        recipientName: ' 박꽃님 ',
        recipientPhone: '01098765432',
        senderName: '김그린',
        cardMessage: '개업\n축하해요',
      }),
    ).toEqual({
      recipientName: '박꽃님',
      recipientPhone: '010-9876-5432',
      senderName: '김그린',
      cardMessage: '개업 축하해요',
    });
  });
});
