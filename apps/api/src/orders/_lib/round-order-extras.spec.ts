import { BadRequestException } from '@nestjs/common';
import { normalizeGift, resolveSelectedOptions } from './round-order-extras';

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

describe('선물 정보 정리', () => {
  it('없으면 null, 이름이 비면 거부한다', () => {
    expect(normalizeGift(undefined)).toBeNull();
    expect(() => normalizeGift({ recipientName: ' ', senderName: '김그린', cardMessage: '' })).toThrow(
      BadRequestException,
    );
  });

  it('한 줄로 정리한다', () => {
    expect(
      normalizeGift({ recipientName: ' 박꽃님 ', senderName: '김그린', cardMessage: '개업\n축하해요' }),
    ).toEqual({ recipientName: '박꽃님', senderName: '김그린', cardMessage: '개업 축하해요' });
  });
});
