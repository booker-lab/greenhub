import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { finalize, type Observable } from 'rxjs';
import { THROTTLE_ERROR_MESSAGE } from '../common/guards/throttle-message';

/**
 * 이 프로세스에서 동시에 받는 후기 사진 업로드 요청 수 상한.
 * multer 메모리 저장소는 요청 하나에 최대 3장 × 5MB = 15MB를 버퍼로 들고, 서비스가 메타데이터를 지운
 * 사본을 한 벌 더 만들어 최악 약 30MB다. 4건이면 약 120MB로 API 인스턴스 1Gi(Cloud Run 절차서)
 * 안에서 다른 경로가 쓸 몫을 남긴다. 소비자 앱은 긴 변 1600px JPEG로 줄여 올리므로(장당 수백 KB)
 * 정상 사용에서 4건이 동시에 겹치는 일은 드물고, 겹치면 429 안내 뒤 다시 시도하면 된다.
 */
export const REVIEW_PHOTO_UPLOAD_CONCURRENCY = 4;

/** 대기열 없이 자리가 없으면 바로 거절하는 프로세스 안 동시 처리 카운터. */
export class InFlightSlots {
  private active = 0;

  constructor(readonly limit: number) {}

  get inFlight(): number {
    return this.active;
  }

  /** 자리를 하나 잡고 반납 함수(여러 번 불러도 한 번만 반납)를 돌려준다. 자리가 없으면 null. */
  tryAcquire(): (() => void) | null {
    if (this.active >= this.limit) return null;
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
    };
  }
}

/**
 * 후기 사진 업로드의 동시 처리 수를 REVIEW_PHOTO_UPLOAD_CONCURRENCY로 묶는다.
 * FilesInterceptor보다 앞(바깥)에 두어 자리가 없으면 multipart 본문을 읽기 전에 429로 거절한다.
 * 쓴 사람 확인(ReviewPhotoOwnerGuard)은 가드라 이보다 먼저 실행되므로, 올릴 수 없는 요청은 자리를 잡지 않는다.
 *
 * 반납은 둘 중 먼저 오는 쪽에서 한 번만 한다.
 * - 처리 흐름이 끝날 때(finalize): 성공·오류, 그리고 multer가 연결 끊김을 오류로 끝낼 때.
 * - 응답 연결이 닫힐 때('close'): 응답을 다 보냈거나 클라이언트가 중간에 끊었을 때. 처리 흐름이
 *   끝나지 않는 예외 상황에서도 자리가 영구히 새지 않게 하는 안전장치다.
 */
@Injectable()
export class ReviewPhotoUploadSlotsInterceptor implements NestInterceptor {
  readonly slots = new InFlightSlots(REVIEW_PHOTO_UPLOAD_CONCURRENCY);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const release = this.slots.tryAcquire();
    if (!release) throw new ThrottlerException(THROTTLE_ERROR_MESSAGE);
    context
      .switchToHttp()
      .getResponse<{ once(event: 'close', listener: () => void): unknown }>()
      .once('close', release);
    return next.handle().pipe(finalize(release));
  }
}
