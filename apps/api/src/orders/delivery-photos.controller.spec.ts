import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { DeliveryPhotosController } from './delivery-photos.controller';

describe('회차 직배송 사진 컨트롤러 계약', () => {
  it('인증 없는 업로드와 조회를 막는 JWT 가드를 컨트롤러 전체에 적용한다', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DeliveryPhotosController) as unknown[];

    expect(guards).toContain(JwtAuthGuard);
  });
});
