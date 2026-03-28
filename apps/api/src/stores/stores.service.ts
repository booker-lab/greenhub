import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { UpdateStoreDto } from './dto/update-store.dto';

@Injectable()
export class StoresService {
  constructor(private readonly firestore: FirestoreService) {}

  async updateStore(
    storeId: string,
    requesterId: string,
    dto: UpdateStoreDto,
  ): Promise<{ id: string }> {
    const storeRef = this.firestore.doc(`stores/${storeId}`);
    const storeSnap = await storeRef.get();

    if (!storeSnap.exists) {
      throw new NotFoundException('스토어를 찾을 수 없습니다');
    }

    const storeData = storeSnap.data();

    // **소유권 검증**: JWT의 storeId와 URL의 storeId가 일치해야 함
    if (storeData?.ownerId !== requesterId) {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    }

    const updatePayload: Record<string, unknown> = {
      updatedAt: this.firestore.FieldValue.serverTimestamp(),
    };

    if (dto.name !== undefined) updatePayload.name = dto.name;
    if (dto.ceoName !== undefined) updatePayload.ceoName = dto.ceoName;
    if (dto.phone !== undefined) updatePayload.phone = dto.phone;
    if (dto.address !== undefined) updatePayload.address = dto.address;
    if (dto.businessNumber !== undefined) updatePayload.businessNumber = dto.businessNumber;
    if (dto.logoUrl !== undefined) updatePayload.logoUrl = dto.logoUrl;

    // **온보딩 완료 판별**: 필수 4개 필드 모두 채워지면 status를 active로 전환
    const merged = { ...storeData, ...updatePayload };
    const isOnboardingComplete =
      merged.name && merged.ceoName && merged.phone && merged.address;

    if (isOnboardingComplete && storeData?.status === 'invited') {
      updatePayload.status = 'active';
    }

    await storeRef.update(updatePayload);

    return { id: storeId };
  }
}
