import { EventEmitter } from 'node:events';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { NEVER, of, Subject, throwError } from 'rxjs';
import {
  InFlightSlots,
  PerKeyInFlightSlots,
  REVIEW_PHOTO_UPLOAD_CONCURRENCY,
  ReviewPhotoUploadSlotsInterceptor,
} from './review-photo-upload-slots.interceptor';

let nextUser = 0;
// 기본은 매번 다른 사용자다. 같은 사용자 시험은 request를 직접 넘긴다.
function contextWith(
  response: EventEmitter,
  request: { user?: { sub: string }; complete?: boolean } = {
    user: { sub: `user-${(nextUser += 1)}` },
  },
): ExecutionContext {
  return {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
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

  it('본문을 받는 중(req.complete false)에 응답 연결이 닫히면 처리 흐름이 끝나지 않아도 자리를 돌려준다', () => {
    const interceptor = new ReviewPhotoUploadSlotsInterceptor();
    const response = new EventEmitter();
    interceptor
      .intercept(
        contextWith(response, { user: { sub: 'user-a' }, complete: false }),
        handlerOf(() => NEVER),
      )
      .subscribe();
    expect(interceptor.slots.inFlight).toBe(1);

    response.emit('close');
    expect(interceptor.slots.inFlight).toBe(0);
    expect(interceptor.perUser.keys).toBe(0);
  });

  it('본문을 다 받은 뒤 연결이 닫혀도 핸들러가 끝날 때까지 자리를 잡고 있는다', () => {
    const interceptor = new ReviewPhotoUploadSlotsInterceptor();
    const response = new EventEmitter();
    const handlerDone = new Subject<string>();
    interceptor
      .intercept(
        contextWith(response, { user: { sub: 'user-a' }, complete: true }),
        handlerOf(() => handlerDone),
      )
      .subscribe();

    // 사진 버퍼를 든 핸들러가 아직 돈다. 여기서 반납하면 끊고 다시 보내는 방식으로 상한을 우회한다.
    response.emit('close');
    expect(interceptor.slots.inFlight).toBe(1);
    expect(interceptor.perUser.inFlight('user-a')).toBe(1);

    handlerDone.next('ok');
    handlerDone.complete();
    expect(interceptor.slots.inFlight).toBe(0);
    expect(interceptor.perUser.keys).toBe(0);
  });

  it('같은 사용자의 두 번째 동시 업로드는 429로 거절하고, 다른 사용자는 받는다', () => {
    const interceptor = new ReviewPhotoUploadSlotsInterceptor();
    interceptor
      .intercept(
        contextWith(new EventEmitter(), { user: { sub: 'user-a' } }),
        handlerOf(() => NEVER),
      )
      .subscribe();

    expect(() =>
      interceptor.intercept(
        contextWith(new EventEmitter(), { user: { sub: 'user-a' } }),
        handlerOf(() => of('x')),
      ),
    ).toThrow(ThrottlerException);
    // 사용자 상한으로 거절된 요청은 프로세스 자리를 잡지 않는다.
    expect(interceptor.slots.inFlight).toBe(1);

    interceptor
      .intercept(
        contextWith(new EventEmitter(), { user: { sub: 'user-b' } }),
        handlerOf(() => NEVER),
      )
      .subscribe();
    expect(interceptor.slots.inFlight).toBe(2);
  });

  it('프로세스 자리가 없어 거절되면 잡았던 사용자 자리도 돌려준다', () => {
    const interceptor = new ReviewPhotoUploadSlotsInterceptor();
    for (let i = 0; i < REVIEW_PHOTO_UPLOAD_CONCURRENCY; i += 1) {
      interceptor.intercept(contextWith(new EventEmitter()), handlerOf(() => NEVER)).subscribe();
    }
    expect(() =>
      interceptor.intercept(
        contextWith(new EventEmitter(), { user: { sub: 'late-user' } }),
        handlerOf(() => of('x')),
      ),
    ).toThrow(ThrottlerException);
    expect(interceptor.perUser.inFlight('late-user')).toBe(0);
  });

  it('사용자별 카운터는 0이 된 키를 지운다', () => {
    const slots = new PerKeyInFlightSlots(1);
    const release = slots.tryAcquire('k');
    expect(slots.tryAcquire('k')).toBeNull();
    expect(slots.keys).toBe(1);
    release!();
    release!();
    expect(slots.keys).toBe(0);
    expect(slots.tryAcquire('k')).not.toBeNull();
  });
});
