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

/**
 * 한 사용자(sub)가 동시에 잡을 수 있는 자리. 소비자 앱은 사진(최대 3장)을 요청 하나로 올리므로
 * 정상 사용은 1건이다. 이 상한이 없으면 사진 자리가 남은 후기를 가진 계정 하나가 본문을 천천히
 * 보내는 업로드 4건으로 프로세스 전체 자리를 모두 붙잡아 다른 사용자의 업로드를 막을 수 있다.
 */
export const REVIEW_PHOTO_UPLOAD_PER_USER_CONCURRENCY = 1;

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

/** 키(사용자)별 대기열 없는 동시 처리 카운터. 0이 된 키는 지워 크기가 처리 중인 요청 수를 넘지 않는다. */
export class PerKeyInFlightSlots {
  private readonly active = new Map<string, number>();

  constructor(readonly limit: number) {}

  /** 지금 자리를 잡고 있는 키 수. */
  get keys(): number {
    return this.active.size;
  }

  inFlight(key: string): number {
    return this.active.get(key) ?? 0;
  }

  /** 키의 자리를 하나 잡고 반납 함수(여러 번 불러도 한 번만 반납)를 돌려준다. 자리가 없으면 null. */
  tryAcquire(key: string): (() => void) | null {
    const current = this.active.get(key) ?? 0;
    if (current >= this.limit) return null;
    this.active.set(key, current + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.active.get(key) ?? 1) - 1;
      if (left <= 0) this.active.delete(key);
      else this.active.set(key, left);
    };
  }
}

/**
 * 후기 사진 업로드의 동시 처리 수를 REVIEW_PHOTO_UPLOAD_CONCURRENCY로 묶는다.
 * FilesInterceptor보다 앞(바깥)에 두어 자리가 없으면 multipart 본문을 읽기 전에 429로 거절한다.
 * 쓴 사람 확인(ReviewPhotoOwnerGuard)은 가드라 이보다 먼저 실행되므로, 올릴 수 없는 요청은 자리를 잡지 않는다.
 *
 * 사용자(sub)별로도 REVIEW_PHOTO_UPLOAD_PER_USER_CONCURRENCY건까지만 받아, 한 계정이 자리를 독점하지 못하게 한다.
 *
 * 반납은 한 번만 한다.
 * - 처리 흐름이 끝날 때(finalize): 성공·오류, 그리고 multer가 연결 끊김을 오류로 끝낼 때. 기본 경로다.
 * - 본문을 다 받기 전(req.complete가 false)에 응답 연결이 닫힐 때: 처리 흐름이 끝나지 않는 예외
 *   상황에서도 자리가 새지 않게 하는 안전장치다. 본문을 다 받은 뒤에는 연결이 닫혀도 핸들러가 사진
 *   버퍼를 든 채 계속 처리하므로 반납하지 않는다(먼저 반납하면 메모리 상한을 우회할 수 있다).
 */
@Injectable()
export class ReviewPhotoUploadSlotsInterceptor implements NestInterceptor {
  readonly slots = new InFlightSlots(REVIEW_PHOTO_UPLOAD_CONCURRENCY);
  readonly perUser = new PerKeyInFlightSlots(REVIEW_PHOTO_UPLOAD_PER_USER_CONCURRENCY);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<{ user?: { sub?: unknown }; complete?: boolean }>();
    const sub = req.user?.sub;
    // ReviewPhotoOwnerGuard가 사용자 없는 요청을 먼저 거절하므로 여기서는 sub가 있다.
    const releaseUser =
      typeof sub === 'string' && sub ? this.perUser.tryAcquire(sub) : () => undefined;
    if (!releaseUser) throw new ThrottlerException(THROTTLE_ERROR_MESSAGE);
    const releaseSlot = this.slots.tryAcquire();
    if (!releaseSlot) {
      releaseUser();
      throw new ThrottlerException(THROTTLE_ERROR_MESSAGE);
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseSlot();
      releaseUser();
    };
    http
      .getResponse<{ once(event: 'close', listener: () => void): unknown }>()
      .once('close', () => {
        if (!req.complete) release();
      });
    return next.handle().pipe(finalize(release));
  }
}
