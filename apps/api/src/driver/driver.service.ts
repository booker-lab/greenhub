import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';

const DRIVER_VISIBLE_STATUSES = ['PREPARING', 'DELIVERING'] as const;

@Injectable()
export class DriverService {
  constructor(private readonly firestore: FirestoreService) {}

  async getOrders(driverId: string, statusQuery?: string) {
    const requestedStatuses = statusQuery
      ? statusQuery.split(',').filter((s) => DRIVER_VISIBLE_STATUSES.includes(s as any))
      : [...DRIVER_VISIBLE_STATUSES];

    if (requestedStatuses.length === 0) return [];

    // Firestore 'in' 쿼리로 PREPARING + DELIVERING 동시 조회
    const snap = await this.firestore
      .collection('orders')
      .where('status', 'in', requestedStatuses)
      .orderBy('preparedAt', 'asc')
      .get();

    return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  }
}
