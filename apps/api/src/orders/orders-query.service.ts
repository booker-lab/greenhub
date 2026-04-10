import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';

@Injectable()
export class OrdersQueryService {
  constructor(private readonly firestore: FirestoreService) {}

  async getOrder(storeId: string, orderId: string, requesterId: string) {
    const snap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!snap.exists || snap.data()!['storeId'] !== storeId) {
      throw new NotFoundException('주문을 찾을 수 없습니다.');
    }
    const order = snap.data()!;
    if (order['userId'] !== requesterId) {
      const userSnap = await this.firestore.doc(`users/${requesterId}`).get();
      const userData = userSnap.data();
      const role = userData?.['role'];
      // admin·seller·driver는 타인 주문 조회 허용
      if (role !== 'seller' && role !== 'driver' && role !== 'admin') {
        throw new ForbiddenException();
      }
      // 판매자는 자신의 storeId 주문만 조회 가능 (admin·driver는 제한 없음)
      if (role === 'seller' && userData?.['storeId'] !== storeId) {
        throw new ForbiddenException();
      }
    }
    return order;
  }

  async getOrders(
    storeId: string,
    requesterId: string,
    query: { userId?: string; status?: string; saleType?: string },
  ) {
    const userSnap = await this.firestore.doc(`users/${requesterId}`).get();
    const userData = userSnap.data();
    const role = userData?.['role'];

    // 판매자는 자신의 storeId 주문만 조회 가능 (admin·driver는 storeId 제한 없음)
    if (role === 'seller' && userData?.['storeId'] !== storeId) {
      throw new ForbiddenException();
    }

    const VALID_STATUSES = ['PENDING','RECRUITING','CONFIRMED','ACCEPTED','PREPARING','DELIVERING','HUB_ARRIVED','PICKED_UP','DELIVERED','CANCELLED','REVIEWED'];
    const VALID_SALE_TYPES = ['normal', 'group'];

    if (query.status && !VALID_STATUSES.includes(query.status)) {
      throw new BadRequestException(`유효하지 않은 status: ${query.status}`);
    }
    if (query.saleType && !VALID_SALE_TYPES.includes(query.saleType)) {
      throw new BadRequestException(`유효하지 않은 saleType: ${query.saleType}`);
    }

    let ref = this.firestore
      .collection('orders')
      .where('storeId', '==', storeId) as any;

    if (query.userId) ref = ref.where('userId', '==', query.userId);
    if (query.status) ref = ref.where('status', '==', query.status);
    if (query.saleType) ref = ref.where('saleType', '==', query.saleType);

    const snap = await ref.get();
    return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  }
}
