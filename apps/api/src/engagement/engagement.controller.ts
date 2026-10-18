import { REVIEW_PHOTO_MAX_BYTES, REVIEW_PHOTO_MAX_COUNT } from '@greenhub/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import {
  CreatePartnerInquiryDto,
  CreateProductRequestDto,
  CreateReviewDto,
  HideReviewDto,
  UnhideReviewDto,
} from './dto/engagement.dto';
import { EngagementService } from './engagement.service';
import { type ReviewPhotoUpload, ReviewsService } from './reviews.service';

// 공개 쓰기(찾는 상품 제안·입점 문의)는 기본 1분 100회보다 좁게 막는다.
const PUBLIC_WRITE_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/**
 * 후기 사진 업로드는 사진 파일(`photos`)만 최대 REVIEW_PHOTO_MAX_COUNT개 받는다(배송 사진 업로드와 같은 방식).
 * 텍스트 필드와 그 밖의 파트는 파싱 단계에서 거절한다.
 */
export const REVIEW_PHOTO_UPLOAD_LIMITS = {
  fileSize: REVIEW_PHOTO_MAX_BYTES,
  files: REVIEW_PHOTO_MAX_COUNT,
  fields: 0,
  parts: REVIEW_PHOTO_MAX_COUNT,
  fieldNameSize: 64,
  headerPairs: 20,
};

/** 로그인 없이 읽고 쓰는 경로. */
@Controller()
export class PublicEngagementController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly engagement: EngagementService,
  ) {}

  @Get('products/:productId/reviews')
  productReviews(@Param('productId') productId: string) {
    return this.reviews.getProductReviews(productId);
  }

  @Get('stores/:storeId/review-stats')
  storeReviewStats(@Param('storeId') storeId: string) {
    return this.reviews.getStoreReviewStats(storeId);
  }

  @Post('stores/:storeId/product-requests')
  @Throttle(PUBLIC_WRITE_THROTTLE)
  @HttpCode(HttpStatus.CREATED)
  createProductRequest(@Param('storeId') storeId: string, @Body() dto: CreateProductRequestDto) {
    return this.engagement.createProductRequest(storeId, dto.text);
  }

  @Post('partner-inquiries')
  @Throttle(PUBLIC_WRITE_THROTTLE)
  @HttpCode(HttpStatus.CREATED)
  createPartnerInquiry(@Body() dto: CreatePartnerInquiryDto) {
    return this.engagement.createPartnerInquiry(dto);
  }
}

/** 로그인한 고객의 후기·알림 신청. */
@Controller()
@UseGuards(JwtAuthGuard)
export class MyEngagementController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly engagement: EngagementService,
  ) {}

  @Get('orders/:orderId/reviews')
  orderReviews(@Param('orderId') orderId: string, @CurrentUser() user: JwtPayload) {
    return this.reviews.listOrderReviews(orderId, user.sub);
  }

  @Post('orders/:orderId/reviews')
  @UseGuards(RolesGuard)
  @Roles('consumer', 'admin')
  @HttpCode(HttpStatus.CREATED)
  createReview(
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.createReview(orderId, user.sub, dto);
  }

  // 역할 가드는 multipart 파싱(FilesInterceptor)보다 먼저 실행된다. 쓴 사람 확인은 서비스가 한다.
  @Post('reviews/:reviewId/photos')
  @UseGuards(RolesGuard)
  @Roles('consumer', 'admin')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FilesInterceptor('photos', REVIEW_PHOTO_MAX_COUNT, { limits: REVIEW_PHOTO_UPLOAD_LIMITS }),
  )
  addReviewPhotos(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFiles() photos?: ReviewPhotoUpload[],
  ) {
    return this.reviews.addReviewPhotos(reviewId, user.sub, photos ?? []);
  }

  @Delete('reviews/:reviewId')
  @UseGuards(RolesGuard)
  @Roles('consumer', 'admin')
  deleteReview(@Param('reviewId') reviewId: string, @CurrentUser() user: JwtPayload) {
    return this.reviews.deleteOwnReview(reviewId, user.sub);
  }

  @Get('me/restock-subscriptions')
  myRestock(@CurrentUser() user: JwtPayload) {
    return this.engagement.listMyRestock(user.sub);
  }

  @Put('me/restock-subscriptions/:productId')
  subscribeRestock(@Param('productId') productId: string, @CurrentUser() user: JwtPayload) {
    return this.engagement.subscribeRestock(user.sub, productId);
  }

  @Delete('me/restock-subscriptions/:productId')
  unsubscribeRestock(@Param('productId') productId: string, @CurrentUser() user: JwtPayload) {
    return this.engagement.unsubscribeRestock(user.sub, productId);
  }
}

/** 판매자·관리자가 모아 보는 고객 반응. */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('seller', 'admin')
export class SellerEngagementController {
  constructor(
    private readonly reviews: ReviewsService,
    private readonly engagement: EngagementService,
  ) {}

  @Get('stores/:storeId/reviews')
  storeReviews(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.reviews.listStoreReviews(storeId, user.sub, user.role);
  }

  @Post('reviews/:reviewId/hide')
  @HttpCode(HttpStatus.OK)
  hideReview(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: HideReviewDto,
  ) {
    return this.reviews.hideReview(reviewId, { userId: user.sub, role: user.role }, dto.reason);
  }

  @Post('reviews/:reviewId/unhide')
  @HttpCode(HttpStatus.OK)
  unhideReview(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UnhideReviewDto,
  ) {
    return this.reviews.unhideReview(reviewId, { userId: user.sub, role: user.role }, dto.reason);
  }

  @Get('stores/:storeId/restock-subscriptions/summary')
  restockSummary(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.engagement.restockSummary(storeId, user.sub, user.role);
  }

  @Get('stores/:storeId/product-requests')
  productRequests(@Param('storeId') storeId: string, @CurrentUser() user: JwtPayload) {
    return this.engagement.listProductRequests(storeId, user.sub, user.role);
  }
}

/** 관리자 전용 입점 문의 목록. */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminEngagementController {
  constructor(private readonly engagement: EngagementService) {}

  @Get('admin/partner-inquiries')
  partnerInquiries() {
    return this.engagement.listPartnerInquiries();
  }
}
