import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { ReviewsService } from './reviews.service';

/**
 * 후기 사진 업로드(`POST /reviews/:reviewId/photos`)의 쓴 사람·남은 자리 확인을 multipart 파싱 전에 한다.
 *
 * Nest는 가드를 인터셉터보다 먼저 실행하므로, 이 가드가 거절하면 FilesInterceptor(multer)가
 * 사진 바이트를 메모리에 받지 않는다. 오류·상태 코드는 ReviewsService.addReviewPhotos와 같다
 * (관리자도 자기가 쓴 후기에만 올릴 수 있다). 장 수는 아직 모르므로 한 장 이상 자리가 남았는지만 보고,
 * 실제 장 수와 최종 판정은 서비스가 저장 transaction 안에서 다시 한다.
 */
@Injectable()
export class ReviewPhotoOwnerGuard implements CanActivate {
  constructor(private readonly reviews: ReviewsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: JwtPayload; params?: Record<string, string | undefined> }>();
    const userId = req.user?.sub;
    if (typeof userId !== 'string' || !userId) throw new ForbiddenException();
    await this.reviews.assertCanAddPhotos(req.params?.['reviewId'] ?? '', userId);
    return true;
  }
}
