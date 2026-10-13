import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { FirestoreService } from '../firestore/firestore.service';
import { projectSellerOrder } from '../orders/seller-order-read-model';
import { CreateHubDto, UpdateHubDto } from './dto/create-hub.dto';

/** 거점 주문 목록 1회 응답 상한. 넘으면 hasMore=true로 알린다. */
export const HUB_ORDER_LIST_LIMIT = 100;

function createdAtMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof value === 'object') {
    const ts = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    if (typeof ts._seconds === 'number') return ts._seconds * 1000;
  }
  return 0;
}

function compareCreatedAtDesc(a: Record<string, unknown>, b: Record<string, unknown>): number {
  return createdAtMillis(b['createdAt']) - createdAtMillis(a['createdAt']);
}

@Injectable()
export class HubsService {
  constructor(private readonly firestore: FirestoreService) {}

  async getHubs(storeId: string, requesterId: string) {
    await this.verifyOwnership(storeId, requesterId);

    const snap = await (
      this.firestore
        .collection('hubs')
        .where('storeId', '==', storeId)
        .orderBy('createdAt', 'asc') as any
    ).get();

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

    const hubId = randomUUID();
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

  async updateHub(storeId: string, hubId: string, requesterId: string, dto: UpdateHubDto) {
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

  async getHubOrders(storeId: string, hubId: string, requesterId: string, status?: unknown) {
    if (status !== undefined && (typeof status !== 'string' || status.length === 0)) {
      throw new BadRequestException('status 값이 올바르지 않습니다');
    }

    await this.verifyOwnership(storeId, requesterId);

    const hubSnap = await this.firestore.doc(`hubs/${hubId}`).get();
    if (!hubSnap.exists || hubSnap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('거점을 찾을 수 없습니다');
    }

    // 등호 조건만 쓰므로 단일 필드 자동 인덱스 병합으로 처리된다(복합 인덱스 불필요).
    // storeId 조건으로 다른 매장 주문이 같은 hubId를 가리켜도 섞이지 않게 한다.
    let ref = this.firestore
      .collection('orders')
      .where('hubId', '==', hubId)
      .where('storeId', '==', storeId) as any;
    if (status) ref = ref.where('status', '==', status);

    const snap = await ref.limit(HUB_ORDER_LIST_LIMIT + 1).get();
    const docs = snap.docs.slice(0, HUB_ORDER_LIST_LIMIT);
    const orders = docs
      .map((d: any) => projectSellerOrder({ id: d.id, ...d.data() }, 'list'))
      .sort(compareCreatedAtDesc);

    return { orders, hasMore: snap.docs.length > HUB_ORDER_LIST_LIMIT };
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
