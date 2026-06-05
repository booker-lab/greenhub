import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';

const SETTLEMENTS_DEFAULT_LIMIT = 100;
const SETTLEMENTS_MAX_LIMIT = 500;

type BulkPayFailureSource = BadRequestException | HttpException | Error;

export function settlementQueryLimit(limit?: number) {
  return Math.min(limit ?? SETTLEMENTS_DEFAULT_LIMIT, SETTLEMENTS_MAX_LIMIT);
}

export function settlementCursorDate(cursor?: string) {
  if (!cursor) return null;
  const date = new Date(cursor);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toIsoCursor(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && 'toDate' in value) {
    const date = (value as { toDate?: () => Date }).toDate?.();
    return date ? date.toISOString() : null;
  }
  return null;
}

export function bulkPayFailureReason(error: unknown) {
  if (error instanceof NotFoundException) {
    return '정산 내역을 찾을 수 없습니다.';
  }
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    const message =
      typeof response === 'object' && response !== null && 'message' in response
        ? (response as { message?: unknown }).message
        : error.message;

    if (typeof message === 'string' && message.length > 0) return message;
    if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  }
  if (isMessageError(error) && error.message.length > 0) {
    return error.message;
  }
  return '지급 처리에 실패했습니다.';
}

function isMessageError(error: unknown): error is BulkPayFailureSource {
  return error instanceof HttpException || error instanceof Error;
}
