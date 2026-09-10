export const DRIVER_ORDER_AUTHORITY_DENIED = 'DRIVER_ORDER_AUTHORITY_DENIED'

export const DRIVER_ORDER_STATE_CONFLICT = 'DRIVER_ORDER_STATE_CONFLICT'

export const DRIVER_ORDER_NOT_FOUND = 'DRIVER_ORDER_NOT_FOUND'

export type DriverOrderErrorCode =
  | typeof DRIVER_ORDER_AUTHORITY_DENIED
  | typeof DRIVER_ORDER_STATE_CONFLICT
  | typeof DRIVER_ORDER_NOT_FOUND

export const DRIVER_ORDER_ERROR_CODES: readonly DriverOrderErrorCode[] = [
  DRIVER_ORDER_AUTHORITY_DENIED,
  DRIVER_ORDER_STATE_CONFLICT,
  DRIVER_ORDER_NOT_FOUND,
]

export interface DriverOrderErrorEnvelope {
  statusCode: 403 | 404 | 409
  message: string
  error: string
  code: DriverOrderErrorCode
}

export function isDriverOrderErrorCode(value: unknown): value is DriverOrderErrorCode {
  return (
    value === DRIVER_ORDER_AUTHORITY_DENIED ||
    value === DRIVER_ORDER_STATE_CONFLICT ||
    value === DRIVER_ORDER_NOT_FOUND
  )
}
