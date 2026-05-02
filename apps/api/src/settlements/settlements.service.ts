import { Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirestoreService } from '../firestore/firestore.service';
import { QuerySettlementsDto, QuerySummaryDto } from './dto/query-settlements.dto';

export type SettlementStatus = 'pending' | 'confirmed' | 'paid' | 'cancelled';

@Injectable()
export class SettlementsService {
  private readonly feeRate: number;

  constructor(
    private readonly firestore: FirestoreService,
    private readonly config: ConfigService,
  ) {
    this.feeRate = parseFloat(this.config.get<string>('PLATFORM_FEE_RATE') ?? '0.05');
  }

  // **자동 생성**: 주문이 완료 상태(REVIEWED/DELIVERED/PICKED_UP)에 도달 시 호출
  async createSettlement(order: Record<string, unknown>, completedStatus: string): Promise<void> {
    const orderId = order['id'] as string;
    const ref = this.firestore.doc(`settlements/${orderId}`);

    // 중복 생성 방지
    const existing = await ref.get();
    if (existing.exists) return;

    const totalAmount = (order['totalAmount'] as number) ?? 0;
    const platformFee = Math.floor(totalAmount * this.feeRate);
    const netAmount = totalAmount - platformFee;
    const now = this.firestore.Timestamp.now();

    await ref.set({
      id: orderId,
      storeId: order['storeId'],
      orderId,
      totalAmount,
      platformFeeRate: this.feeRate,
      platformFee,
      netAmount,
      status: 'pending' as SettlementStatus,
      completedStatus,
      settledAt: now,
      paidAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async getSettlements(
    storeId: string,
    requesterId: string,
    role: string,
    dto: QuerySettlementsDto,
  ) {
    await this.verifyOwnership(storeId, requesterId, role);

    let ref = this.firestore.collection('settlements').where('storeId', '==', storeId) as any;

    if (dto.from) {
      ref = ref.where('settledAt', '>=', this.firestore.Timestamp.fromDate(new Date(dto.from)));
    }
    if (dto.to) {
      // to 날짜 23:59:59까지 포함
      const toDate = new Date(dto.to);
      toDate.setHours(23, 59, 59, 999);
      ref = ref.where('settledAt', '<=', this.firestore.Timestamp.fromDate(toDate));
    }

    ref = ref.orderBy('settledAt', 'asc');

    const snap = await ref.get();
    const settlements = snap.docs.map((d: any) => d.data());

    return { settlements, total: settlements.length };
  }

  async getSummary(storeId: string, requesterId: string, role: string, dto: QuerySummaryDto) {
    await this.verifyOwnership(storeId, requesterId, role);

    const targetDate = dto.date ?? new Date().toISOString().split('T')[0];
    const start = new Date(targetDate);
    const end = new Date(targetDate);
    end.setHours(23, 59, 59, 999);

    const snap = await (
      this.firestore
        .collection('settlements')
        .where('storeId', '==', storeId)
        .where('settledAt', '>=', this.firestore.Timestamp.fromDate(start))
        .where('settledAt', '<=', this.firestore.Timestamp.fromDate(end)) as any
    ).get();

    const settlements: Record<string, unknown>[] = snap.docs.map((d: any) => d.data());

    const byStatus: Record<SettlementStatus, number> = {
      pending: 0,
      confirmed: 0,
      paid: 0,
      cancelled: 0,
    };
    let totalAmount = 0;
    let totalPlatformFee = 0;
    let totalNetAmount = 0;

    for (const s of settlements) {
      const status = s['status'] as SettlementStatus;
      if (status in byStatus) byStatus[status]++;
      totalAmount += (s['totalAmount'] as number) ?? 0;
      totalPlatformFee += (s['platformFee'] as number) ?? 0;
      totalNetAmount += (s['netAmount'] as number) ?? 0;
    }

    return {
      date: targetDate,
      count: settlements.length,
      totalAmount,
      totalPlatformFee,
      totalNetAmount,
      byStatus,
    };
  }

  // **취소 반영**: 주문 CANCELLED 시 해당 settlement status → 'cancelled'
  async cancelSettlement(orderId: string): Promise<void> {
    const ref = this.firestore.doc(`settlements/${orderId}`);
    const snap = await ref.get();
    if (!snap.exists) return;
    await ref.update({
      status: 'cancelled' as SettlementStatus,
      updatedAt: this.firestore.Timestamp.now(),
    });
  }

  private async verifyOwnership(storeId: string, requesterId: string, role: string) {
    if (role === 'admin') return;
    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!storeSnap.exists || storeSnap.data()?.['ownerId'] !== requesterId) {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    }
  }
}
