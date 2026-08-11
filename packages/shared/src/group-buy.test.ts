import { describe, expect, it } from 'vitest'
import { getGroupBuyStatus } from './group-buy.js'

const now = Date.parse('2026-08-11T00:00:00.000Z')

describe('공동구매 공개 모집 상태', () => {
  it('목표 수량 미만이고 모집기한 전이면 모집 중이다', () => {
    expect(
      getGroupBuyStatus(
        {
          currentQuantity: 2,
          targetQuantity: 10,
          recruitDeadline: '2026-08-12T00:00:00.000Z',
        },
        now,
      ),
    ).toBe('open')
  })

  it('목표 수량을 채우면 수량 마감이다', () => {
    expect(
      getGroupBuyStatus(
        {
          currentQuantity: 10,
          targetQuantity: 10,
          recruitDeadline: '2026-08-12T00:00:00.000Z',
        },
        now,
      ),
    ).toBe('full')
  })

  it('모집기한이 현재 시각과 같거나 지났으면 기한 마감이다', () => {
    expect(
      getGroupBuyStatus(
        {
          currentQuantity: 2,
          targetQuantity: 10,
          recruitDeadline: '2026-08-11T00:00:00.000Z',
        },
        now,
      ),
    ).toBe('expired')
  })

  it('공동구매 설정이 없거나 기한이 올바르지 않으면 판매 불가로 처리한다', () => {
    expect(getGroupBuyStatus(null, now)).toBe('unavailable')
    expect(
      getGroupBuyStatus(
        { currentQuantity: 2, targetQuantity: 10, recruitDeadline: '잘못된 날짜' },
        now,
      ),
    ).toBe('expired')
  })
})
