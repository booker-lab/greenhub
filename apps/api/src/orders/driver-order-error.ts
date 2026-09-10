import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  DRIVER_ORDER_AUTHORITY_DENIED,
  DRIVER_ORDER_NOT_FOUND,
  DRIVER_ORDER_STATE_CONFLICT,
} from '@greenhub/shared';

// Driver-order error response convergence owner.
//
// Existing HTTP status / FSM / idempotency contracts are unchanged.
// This helper only adds a stable additive machine-readable `code`
// while preserving the existing statusCode / message / error envelope.
//
// Classification (semantic cause, not message text):
// - AUTHORITY_DENIED: requester lacks driver role / approval / scope ownership.
// - STATE_CONFLICT: persisted / FSM / precondition state drift (403 pre-tx or 409 in-tx).
// - NOT_FOUND: existing 404 existence-hiding boundary.

export function throwDriverOrderAuthorityDenied(message: string): never {
  throw new ForbiddenException({
    statusCode: 403,
    message,
    error: 'Forbidden',
    code: DRIVER_ORDER_AUTHORITY_DENIED,
  });
}

export function throwDriverOrderStateConflict(message: string, inTransaction = false): never {
  if (inTransaction) {
    throw new ConflictException({
      statusCode: 409,
      message,
      error: 'Conflict',
      code: DRIVER_ORDER_STATE_CONFLICT,
    });
  }
  throw new ForbiddenException({
    statusCode: 403,
    message,
    error: 'Forbidden',
    code: DRIVER_ORDER_STATE_CONFLICT,
  });
}

export function throwDriverOrderNotFound(
  message = '주문을 찾을 수 없습니다.',
): never {
  throw new NotFoundException({
    statusCode: 404,
    message,
    error: 'Not Found',
    code: DRIVER_ORDER_NOT_FOUND,
  });
}

export function readHttpExceptionBody(error: unknown): Record<string, unknown> | null {
  if (
    typeof error !== 'object' ||
    error === null ||
    typeof (error as { getResponse?: unknown }).getResponse !== 'function'
  ) {
    return null;
  }
  const body = (error as { getResponse: () => unknown }).getResponse();
  if (typeof body === 'string') return { message: body };
  if (typeof body === 'object' && body !== null) {
    return body as Record<string, unknown>;
  }
  return null;
}
