import { EventEmitter } from 'node:events';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { NEVER, of, throwError } from 'rxjs';
import {
  InFlightSlots,
  REVIEW_PHOTO_UPLOAD_CONCURRENCY,
  ReviewPhotoUploadSlotsInterceptor,
} from './review-photo-upload-slots.interceptor';

function contextWith(response: EventEmitter): ExecutionContext {
  return {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({}) }),
  } as unknown as ExecutionContext;
}

const handlerOf = (result: CallHandler['handle']): CallHandler => ({ handle: result });

describe('후기 사진 업로드 동시 처리 상한', () => {
  it('자리는 상한까지만 잡히고, 반납은 여러 번 불러도 한 번만 된다', () => {
    const slots = new InFlightSlots(2);
    const first = slots.tryAcquire();
    const second = slots.tryAcquire();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(slots.tryAcquire()).toBeNull();

    first!();
    first!();
    expect(slots.inFlight).toBe(1);
    expect(slots.tryAcquire()).not.toBeNull();
    expect(slots.inFlight).toBe(2);
  });

  it('상한을 넘으면 처리 흐름을 시작하지 않고 전역 요청 한도와 같은 429 문구로 거절한다', () => {
    const interceptor = new ReviewPhotoUploadSlotsInterceptor();
    for (let i = 0; i < REVIEW_PHOTO_UPLOAD_CONCURRENCY; i += 1) {
      interceptor
        .intercept(
          contextWith(new EventEmitter()),
          handlerOf(() => NEVER),
        )
        .subscribe();
    }
    const handle = jest.fn(() => of('never'));
    let thrown: unknown;
    try {
      interceptor.intercept(contextWith(new EventEmitter()), handlerOf(handle));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ThrottlerException);
    expect((thrown as ThrottlerException).getStatus()).toBe(429);
    expect((thrown as ThrottlerException).message).toBe(
      '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it('처리 흐름이 성공·실패로 끝나면 자리를 돌려주고, 응답이 닫혀도 두 번 빼지 않는다', () => {
    const interceptor = new ReviewPhotoUploadSlotsInterceptor();
    const okResponse = new EventEmitter();
    interceptor
      .intercept(
        contextWith(okResponse),
        handlerOf(() => of('ok')),
      )
      .subscribe();
    expect(interceptor.slots.inFlight).toBe(0);
    okResponse.emit('close');
    expect(interceptor.slots.inFlight).toBe(0);

    interceptor
      .intercept(
        contextWith(new EventEmitter()),
        handlerOf(() => throwError(() => new Error('x'))),
      )
      .subscribe({ error: () => undefined });
    expect(interceptor.slots.inFlight).toBe(0);
  });

  it('처리 흐름이 끝나지 않아도 응답 연결이 닫히면 자리를 돌려준다', () => {
    const interceptor = new ReviewPhotoUploadSlotsInterceptor();
    const response = new EventEmitter();
    interceptor
      .intercept(
        contextWith(response),
        handlerOf(() => NEVER),
      )
      .subscribe();
    expect(interceptor.slots.inFlight).toBe(1);

    response.emit('close');
    expect(interceptor.slots.inFlight).toBe(0);
  });
});
