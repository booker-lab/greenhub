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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DeliveryPhotosService } from './delivery-photos.service';

const DELIVERY_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

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

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: { fileSize: DELIVERY_PHOTO_MAX_BYTES, files: 1 },
    }),
  )
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
