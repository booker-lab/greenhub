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
 * 업로드 요청은 사진 파일 1개(`photo`)와 텍스트 필드 `idempotencyKey`, 선택 필드 `expectedHoldAt`만 쓴다.
 * 파트·필드 개수와 중첩 필드명은 파싱 단계에서, 그 밖의 필드 이름·중복 필드는 컨트롤러에서 거절한다.
 * fieldNestingDepth·fieldArrayIndexLimit는 Nest MulterOptions 타입에 없어 별도 상수로 둔다.
 */
export const DELIVERY_PHOTO_UPLOAD_LIMITS = {
  fileSize: DELIVERY_PHOTO_MAX_BYTES,
  files: 1,
  fields: 2,
  parts: 3,
  fieldNameSize: 64,
  fieldSize: 256,
  headerPairs: 20,
  fieldNestingDepth: 0,
  fieldArrayIndexLimit: 0,
};

const DELIVERY_PHOTO_UPLOAD_FIELDS = new Set(['idempotencyKey', 'expectedHoldAt']);

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
    @Body() body: Record<string, unknown> | undefined,
    @UploadedFile() photo?: UploadedPhoto,
  ) {
    const fields = body ?? {};
    // 알 수 없는 필드와 같은 이름을 두 번 보낸 필드(multer가 배열로 합친다)는 받지 않는다.
    for (const [name, value] of Object.entries(fields)) {
      if (!DELIVERY_PHOTO_UPLOAD_FIELDS.has(name) || typeof value !== 'string') {
        throw new BadRequestException('배송 사진 업로드 요청 형식이 올바르지 않습니다.');
      }
    }
    if (!photo?.buffer) {
      throw new BadRequestException('배송 사진 파일이 필요합니다.');
    }
    const idempotencyKey = fields['idempotencyKey'];
    if (typeof idempotencyKey !== 'string') {
      throw new BadRequestException('업로드 요청 식별자 형식이 올바르지 않습니다.');
    }
    return this.deliveryPhotos.uploadAndComplete({
      storeId,
      orderId,
      requesterId: user.sub,
      requesterRole: user.role,
      idempotencyKey,
      // 촬영 때 본 보류 표시. 보내지 않은 이전 앱은 확인하지 않는다(서비스가 형식을 판정한다).
      ...(fields['expectedHoldAt'] === undefined ? {} : { expectedHoldAt: fields['expectedHoldAt'] }),
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
