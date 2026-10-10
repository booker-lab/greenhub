import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { DeliveryPhotosService } from './delivery-photos.service';

const DELIVERY_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 업로드 요청은 사진 파일 1개(`photo`)와 텍스트 필드 1개(`idempotencyKey`)만 쓴다.
 * 그 밖의 파트·필드·중첩 필드명은 파싱 단계에서 거절한다.
 * fieldNestingDepth·fieldArrayIndexLimit는 Nest MulterOptions 타입에 없어 별도 상수로 둔다.
 */
export const DELIVERY_PHOTO_UPLOAD_LIMITS = {
  fileSize: DELIVERY_PHOTO_MAX_BYTES,
  files: 1,
  fields: 1,
  parts: 2,
  fieldNameSize: 64,
  fieldSize: 256,
  headerPairs: 20,
  fieldNestingDepth: 0,
  fieldArrayIndexLimit: 0,
};

interface UploadedPhoto {
  buffer: Buffer;
  mimetype: string;
}

@Controller('stores/:storeId/orders/:orderId/delivery-photos')
@UseGuards(JwtAuthGuard)
export class DeliveryPhotosController {
  constructor(
    @Inject(DeliveryPhotosService)
    private readonly deliveryPhotos: DeliveryPhotosService,
  ) {}

  // 역할 가드는 multipart 파싱(FileInterceptor)보다 먼저 실행된다.
  // 업로드 자격(담당 Driver)의 최종 판정은 서비스가 계속 소유한다.
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles('driver')
  @UseInterceptors(FileInterceptor('photo', { limits: DELIVERY_PHOTO_UPLOAD_LIMITS }))
  upload(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @CurrentUser() user: JwtPayload,
    @Body('idempotencyKey') idempotencyKey: string,
    @UploadedFile() photo?: UploadedPhoto,
  ) {
    if (!photo?.buffer) {
      throw new BadRequestException('배송 사진 파일이 필요합니다.');
    }
    return this.deliveryPhotos.uploadAndComplete({
      storeId,
      orderId,
      requesterId: user.sub,
      requesterRole: user.role,
      idempotencyKey,
      content: photo.buffer,
      contentType: photo.mimetype,
    });
  }

  @Get(':photoId/url')
  createReadUrl(
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Param('photoId') photoId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.deliveryPhotos.createReadUrl({
      storeId,
      orderId,
      photoId,
      requesterId: user.sub,
      requesterRole: user.role,
    });
  }
}
