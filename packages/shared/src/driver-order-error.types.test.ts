import { describe, expect, it } from 'vitest'
import {
  DRIVER_ORDER_AUTHORITY_DENIED,
  DRIVER_ORDER_ERROR_CODES,
  DRIVER_ORDER_NOT_FOUND,
  DRIVER_ORDER_STATE_CONFLICT,
  isDriverOrderErrorCode,
} from './driver-order-error.types.js'

describe('driver order error code contract', () => {
  it('ratified codes are distinct stable strings', () => {
    expect(DRIVER_ORDER_AUTHORITY_DENIED).toBe('DRIVER_ORDER_AUTHORITY_DENIED')
    expect(DRIVER_ORDER_STATE_CONFLICT).toBe('DRIVER_ORDER_STATE_CONFLICT')
    expect(DRIVER_ORDER_NOT_FOUND).toBe('DRIVER_ORDER_NOT_FOUND')
    expect(new Set(DRIVER_ORDER_ERROR_CODES).size).toBe(3)
  })

  it('discriminates only ratified codes', () => {
    expect(isDriverOrderErrorCode(DRIVER_ORDER_AUTHORITY_DENIED)).toBe(true)
    expect(isDriverOrderErrorCode(DRIVER_ORDER_STATE_CONFLICT)).toBe(true)
    expect(isDriverOrderErrorCode(DRIVER_ORDER_NOT_FOUND)).toBe(true)
    expect(isDriverOrderErrorCode('DRIVER_ORDER_ALREADY_APPLIED')).toBe(false)
    expect(isDriverOrderErrorCode('FORBIDDEN')).toBe(false)
    expect(isDriverOrderErrorCode(undefined)).toBe(false)
  })
})
