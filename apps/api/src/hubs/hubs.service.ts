import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { CreateHubDto, UpdateHubDto } from './dto/create-hub.dto';

@Injectable()
export class HubsService {
  constructor(private readonly firestore: FirestoreService) {}

  async getHubs(storeId: string, requesterId: string) {
    await this.verifyOwnership(storeId, requesterId);

    const snap = await (this.firestore
      .collection('hubs')
      .where('storeId', '==', storeId)
      .orderBy('createdAt', 'asc') as any).get();

    return { hubs: snap.docs.map((d: any) => d.data()) };
  }

  async getHub(storeId: string, hubId: string, requesterId: string) {
    await this.verifyOwnership(storeId, requesterId);

    const snap = await this.firestore.doc(`hubs/${hubId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('거점을 찾을 수 없습니다');
    }
    return snap.data();
  }

  async createHub(storeId: string, requesterId: string, dto: CreateHubDto) {
    await this.verifyOwnership(storeId, requesterId);

    const hubId = uuidv4();
    const now = this.firestore.Timestamp.now();

    await this.firestore.doc(`hubs/${hubId}`).set({
      id: hubId,
      storeId,
      name: dto.name,
      address: dto.address,
      addressDetail: dto.addressDetail ?? null,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      operatingHours: dto.operatingHours ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return { id: hubId };
  }

  async updateHub(
    storeId: string,
    hubId: string,
    requesterId: string,
    dto: UpdateHubDto,
  ) {
    await this.verifyOwnership(storeId, requesterId);

    const snap = await this.firestore.doc(`hubs/${hubId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('거점을 찾을 수 없습니다');
    }

    const update: Record<string, unknown> = {
      updatedAt: this.firestore.FieldValue.serverTimestamp(),
    };

    if (dto.name !== undefined) update.name = dto.name;
    if (dto.address !== undefined) update.address = dto.address;
    if (dto.addressDetail !== undefined) update.addressDetail = dto.addressDetail;
    if (dto.lat !== undefined) update.lat = dto.lat;
    if (dto.lng !== undefined) update.lng = dto.lng;
    if (dto.operatingHours !== undefined) update.operatingHours = dto.operatingHours;
    if (dto.isActive !== undefined) update.isActive = dto.isActive;

    await this.firestore.doc(`hubs/${hubId}`).update(update);

    return { id: hubId };
  }

  async deleteHub(storeId: string, hubId: string, requesterId: string) {
    await this.verifyOwnership(storeId, requesterId);

    const snap = await this.firestore.doc(`hubs/${hubId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('거점을 찾을 수 없습니다');
    }

    await this.firestore.doc(`hubs/${hubId}`).delete();
  }

  private async verifyOwnership(storeId: string, requesterId: string) {
    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!storeSnap.exists || storeSnap.data()?.['ownerId'] !== requesterId) {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    }
  }
}
