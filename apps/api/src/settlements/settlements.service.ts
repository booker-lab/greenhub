import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { FirestoreService } from '../firestore/firestore.service';
import { QuerySettlementsDto, QuerySummaryDto } from './dto/query-settlements.dto';

export type SettlementStatus = 'pending' | 'confirmed' | 'paid' | 'cancelled';

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);
  private readonly feeRate: number;
  private readonly confirmDelayDays: number;

  constructor(
    private readonly firestore: FirestoreService,
    private readonly config: ConfigService,
  ) {
    this.feeRate = parseFloat(this.config.get<string>('PLATFORM_FEE_RATE') ?? '0.05');
    this.confirmDelayDays = parseInt(
      this.config.get<string>('SETTLEMENT_CONFIRM_DELAY_DAYS') ?? '1',
      10,
    );
  }

  // **자동 생성**: 주문이 완료 상태(REVIEWED/DELIVERED/PICKED_UP)에 도달 시 호출
  // N6: 중복 확인(read)→생성(set)을 트랜잭션으로 묶어 동시 전이 경합 차단.
  // 같은 주문이 짧은 간격으로 두 전이(DELIVERED→REVIEWED 등)를 타거나 동시 호출 시
  // 비트랜잭션이면 둘 다 exists=false를 읽고 둘 다 set → 후자가 전자를 덮어써 settledAt 갱신.
  async createSettlement(order: Record<string, unknown>, completedStatus: string): Promise<void> {
    const orderId = order['id'] as string;
    const ref = this.firestore.doc(`settlements/${orderId}`);

    const totalAmount = (order['totalAmount'] as number) ?? 0;
    const platformFee = Math.floor(totalAmount * this.feeRate);
    const netAmount = totalAmount - platformFee;

    await this.firestore.runTransaction(async (t) => {
      // 트랜잭션 내 중복 재확인 — 동시 호출 중 한쪽만 set 통과
      const existing = await t.get(ref);
      if (existing.exists) return;

      const now = this.firestore.Timestamp.now();
      t.set(ref, {
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
        confirmedAt: null,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      });
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

  // **confirm 마감 배치 (A-1 해소)**: settledAt이 마감 경계를 지난 pending 정산을 confirmed로 자동 전이.
  // 스펙(settlements.md §2)은 pending→confirmed→paid를 명시하나 confirm 전이 코드가 부재해
  // 전 정산이 pending 고착 → 어드민 "지급처리" 버튼(confirmed에서만 노출) 영구 미표시였음.
  // payments cleanupPendingOrders(쿼리→개별처리) 패턴 동형. 서버 TZ 미설정이라 KST 보정 필수.
  @Cron('0 4 * * *', { timeZone: 'Asia/Seoul' })
  async confirmDueSettlements(): Promise<void> {
    const cutoff = new Date(Date.now() - this.confirmDelayDays * 24 * 60 * 60 * 1000);
    const snap = await this.firestore
      .collection('settlements')
      .where('status', '==', 'pending')
      .where('settledAt', '<', this.firestore.Timestamp.fromDate(cutoff))
      .get();

    if (snap.empty) return;

    let confirmed = 0;
    // 트랜잭션 내 재확인으로 멱등성 확보 + 취소 경합 차단(GAP-1):
    // 배치 도중 cancelSettlement가 cancelled로 바꿨다면 status가 더는 pending이 아니므로 skip → cancelled 미덮어씀.
    const results = await Promise.all(
      snap.docs.map((doc) =>
        this.firestore.runTransaction(async (t) => {
          const fresh = await t.get(doc.ref);
          if (!fresh.exists || fresh.data()?.['status'] !== 'pending') return false;
          const now = this.firestore.Timestamp.now();
          t.update(doc.ref, {
            status: 'confirmed' as SettlementStatus,
            confirmedAt: now,
            updatedAt: now,
          });
          return true;
        }),
      ),
    );

    confirmed = results.filter(Boolean).length;
    this.logger.log(`[SettlementScheduler] confirmed ${confirmed}건`);
  }

  // **취소 반영**: 주문 CANCELLED 시 해당 settlement status → 'cancelled'
  // B-5(N6): 트랜잭션으로 read→update 묶어 경합 차단.
  // B-6(N7): 이미 paid(지급 완료)된 정산은 cancelled로 덮어쓰지 않음(역전이 가드).
  //   비트랜잭션·무조건 update 시 지급 후 주문 취소 경로를 타면 paid→cancelled로 덮여 회계 손실.
  //   confirmDueSettlements의 "cancelled 미덮어씀"(GAP-1)과 대칭(paid 미덮어씀).
  async cancelSettlement(orderId: string): Promise<void> {
    const ref = this.firestore.doc(`settlements/${orderId}`);
    await this.firestore.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) return;
      const status = snap.data()?.['status'] as SettlementStatus;
      if (status === 'paid') {
        // 환불 회계 별도 처리는 범위 외 — 최소 덮어쓰기 차단
        this.logger.warn(
          `[cancelSettlement] paid 정산 ${orderId} 취소 시도 — cancelled 미적용(역전이 가드)`,
        );
        return;
      }
      if (status === 'cancelled') return; // 멱등
      t.update(ref, {
        status: 'cancelled' as SettlementStatus,
        updatedAt: this.firestore.Timestamp.now(),
      });
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
