import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class TimestampInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(map((data) => serializeDeep(data)));
  }
}

function isTimestamp(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    '_seconds' in (v as object) &&
    typeof (v as Record<string, unknown>)['toDate'] === 'function'
  );
}

function serializeDeep(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (isTimestamp(value)) {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeDeep);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as object)) {
      out[k] = serializeDeep(v);
    }
    return out;
  }
  return value;
}
