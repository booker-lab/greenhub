import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { dateRangeKST } from '@greenhub/shared';
import * as admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { RoundOrderLifecycleService } from '../orders/round-order-lifecycle.service';
import type { OrderStatus } from '../orders/dto/update-status.dto';
import { getAllowedTransitions } from '../orders/orders.helpers';
import { PaymentsService } from '../payments/payments.service';
import { releaseLegacyDailyCapacityInTransaction } from '../payments/_lib/legacy-daily-capacity';
import { SettlementsService } from '../settlements/settlements.service';
import {
  QueryAdminSettlementsDto,
  QueryAdminOrdersDto,
  QueryAdminDriversDto,
  SuspendUserDto,
  SetCommissionDto,
  ForceRefundDto,
  UpsertBannerDto,
} from './dto/admin.dto';

const LEGACY_REFUND_CLAIM_MS = 5 * 60 * 1000;

type LegacyRefundClaimResult =
  | { kind: 'done' }
  | { kind: 'in_progress' }
  | { kind: 'claimed'; token: string };

@Injectable()
export class AdminService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementsService,
    private readonly roundLifecycle: RoundOrderLifecycleService,
  ) {}

  // ── Stores ──────────────────────────────────────────────────────

  async getStores() {
    const snap = await (
      this.firestore.collection('stores').orderBy('createdAt', 'desc') as any
    ).get();

    return {
      stores: snap.docs.map((d: any) => d.data()),
      total: snap.size,
    };
  }

  async setCommission(storeId: string, dto: SetCommissionDto) {
    const ref = this.firestore.doc(`stores/${storeId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다.');

    await ref.update({
      commissionRate: dto.rate,
      updatedAt: this.firestore.Timestamp.now(),
    });
    return { storeId, commissionRate: dto.rate };
  }

  // 판매자 "치우기"(아카이브) — 영구 삭제 아님, status='archived' 표시.
  // 기록 가드: 주문·정산 기록이 하나라도 있으면 차단(법적 책임·이력 보존).
  async archiveStore(storeId: string) {
    const ref = this.firestore.doc(`stores/${storeId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다.');

    // 존재 여부만 확인하면 되므로 limit(1) — 쿼리 비용 최소화.
    const [orderSnap, settlementSnap] = await Promise.all([
      (this.firestore.collection('orders').where('storeId', '==', storeId).limit(1) as any).get(),
      (
        this.firestore.collection('settlements').where('storeId', '==', storeId).limit(1) as any
      ).get(),
    ]);
    if (!orderSnap.empty || !settlementSnap.empty) {
      throw new BadRequestException('주문·정산 기록이 있는 판매자는 정리할 수 없습니다.');
    }

    const now = this.firestore.Timestamp.now();
    await ref.update({ status: 'archived', archivedAt: now, updatedAt: now });
    return { storeId, status: 'archived' };
  }

  // 아카이브 복구 — active 복원 + archivedAt 제거.
  async restoreStore(storeId: string) {
    const ref = this.firestore.doc(`stores/${storeId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다.');

    await ref.update({
      status: 'active',
      archivedAt: this.firestore.FieldValue.delete(),
      updatedAt: this.firestore.Timestamp.now(),
    });
    return { storeId, status: 'active' };
  }

  // ── Users ────────────────────────────────────────────────────────

  async getUsers() {
    const snap = await (
      this.firestore
        .collection('users')
        .where('role', '==', 'consumer')
        .orderBy('createdAt', 'desc') as any
    ).get();

    return {
      users: snap.docs.map((d: any) => {
        const { passwordHash: _pw, ...user } = d.data();
        return user;
      }),
      total: snap.size,
    };
  }

  async suspendUser(userId: string, dto: SuspendUserDto) {
    const ref = this.firestore.doc(`users/${userId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    await ref.update({
      suspended: dto.suspended,
      updatedAt: this.firestore.Timestamp.now(),
    });
    return { userId, suspended: dto.suspended };
  }

  // ── Orders ───────────────────────────────────────────────────────

  async getOrders(dto: QueryAdminOrdersDto) {
    let query = this.firestore.collection('orders') as any;

    if (dto.storeId) {
      query = query.where('storeId', '==', dto.storeId);
    }
    if (dto.status) {
      query = query.where('status', '==', dto.status);
    }

    query = query.orderBy('createdAt', 'desc').limit(200);
    const snap = await query.get();

    return {
      orders: snap.docs.map((d: any) => d.data()),
      total: snap.size,
    };
  }

  async forceRefund(orderId: string, dto: ForceRefundDto) {
    const orderRef = this.firestore.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');

    const order = orderSnap.data()!;
    const reason = dto.reason ?? '관리자 강제 환불';

    if (order['schemaVersion'] === 2 && order['roundId']) {
      const result = await this.roundLifecycle.cancelForRound({
        storeId: order['storeId'],
        orderId,
        expectedStatus: order['status'],
        reason,
      });
      await this.settlements.cancelSettlement(orderId);
      return result;
    }

    return this.forceLegacyRefund(orderId, reason);
  }

  private async forceLegacyRefund(orderId: string, reason: string) {
    const claim = await this.claimLegacyRefund(orderId, reason);
    if (claim.kind === 'done') {
      await this.settlements.cancelSettlement(orderId);
      return { ok: true, orderId };
    }
    if (claim.kind === 'in_progress') {
      throw new ConflictException('주문 환불이 이미 처리 중입니다.');
    }

    try {
      // 주문 claim을 획득한 뒤에만 provider를 호출한다.
      await this.payments.processRefundByOrderId(orderId, reason);
    } catch (error) {
      await this.recordLegacyRefundState(orderId, claim.token, 'REFUND_FAILED', reason);
      throw error;
    }

    try {
      await this.applyLegacyLocalCancellation(orderId, claim.token, reason);
      await this.settlements.cancelSettlement(orderId);
    } catch (error) {
      await this.recordLegacyRefundState(orderId, claim.token, 'LOCAL_FAILED', reason);
      throw error;
    }

    return { ok: true, orderId };
  }

  private async claimLegacyRefund(
    orderId: string,
    reason: string,
  ): Promise<LegacyRefundClaimResult> {
    const token = randomUUID();
    let result: LegacyRefundClaimResult = { kind: 'claimed', token };

    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');

      const order = orderSnap.data() as Record<string, any>;
      const cancellation = (order['cancellation'] ?? null) as Record<string, any> | null;
      const cancellationStatus = cancellation?.['status'] as string | undefined;

      // 이미 cancellation까지 완료된 취소는 외부 provider와 capacity를 다시 건드리지 않는다.
      if (order['status'] === 'CANCELLED' && cancellationStatus === 'COMPLETED') {
        result = { kind: 'done' };
        return;
      }

      let expiredClaim = false;
      if (cancellationStatus === 'REFUNDING') {
        const refundClaim = cancellation?.['refundClaim'] as
          | { token?: string; expiresAt?: number }
          | undefined;
        if (
          !refundClaim ||
          typeof refundClaim.token !== 'string' ||
          refundClaim.token.length === 0 ||
          typeof refundClaim.expiresAt !== 'number'
        ) {
          result = { kind: 'in_progress' };
          return;
        }
        if (refundClaim.expiresAt > Date.now()) {
          result = { kind: 'in_progress' };
          return;
        }
        expiredClaim = true;
      }

      const retryable = ['LOCAL_PENDING', 'LOCAL_FAILED', 'REFUND_FAILED'].includes(
        cancellationStatus ?? '',
      );
      const statusAllowsRefund = this.isLegacyRefundableStatus(order['status']);
      const cancelledRetryAllowsRefund =
        order['status'] === 'CANCELLED' && (retryable || expiredClaim);
      const cancelledWithoutState = order['status'] === 'CANCELLED' && !cancellation;
      if (!statusAllowsRefund && !cancelledRetryAllowsRefund && !cancelledWithoutState) {
        throw new BadRequestException('현재 주문 상태에서는 관리자 환불을 처리할 수 없습니다.');
      }

      const now = this.firestore.Timestamp.now();
      tx.update(orderRef, {
        cancellation: {
          status: 'REFUNDING',
          reason,
          refundClaim: {
            token,
            expiresAt: Date.now() + LEGACY_REFUND_CLAIM_MS,
          },
          updatedAt: this.toIso(now),
        },
        updatedAt: now,
      });
    });

    return result;
  }

  private async applyLegacyLocalCancellation(orderId: string, token: string, reason: string) {
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');

      const order = orderSnap.data() as Record<string, any>;
      const cancellation = (order['cancellation'] ?? null) as Record<string, any> | null;
      if (
        cancellation?.['status'] !== 'REFUNDING' ||
        cancellation?.['refundClaim']?.['token'] !== token
      ) {
        throw new ConflictException('주문 환불 claim이 더 이상 유효하지 않습니다.');
      }

      await releaseLegacyDailyCapacityInTransaction(this.firestore, tx, orderId, reason);
      const now = this.firestore.Timestamp.now();
      tx.update(orderRef, {
        status: 'CANCELLED',
        cancelReason: reason,
        cancellation: {
          status: 'COMPLETED',
          reason,
          completedAt: this.toIso(now),
          updatedAt: this.toIso(now),
        },
        updatedAt: now,
      });
    });
  }

  private async recordLegacyRefundState(
    orderId: string,
    token: string,
    status: 'REFUND_FAILED' | 'LOCAL_FAILED',
    reason: string,
  ) {
    await this.firestore.runTransaction(async (tx) => {
      const orderRef = this.firestore.doc(`orders/${orderId}`);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) return;

      const cancellation = (orderSnap.data()?.['cancellation'] ?? null) as Record<
        string,
        any
      > | null;
      const ownsClaim = cancellation?.['refundClaim']?.['token'] === token;
      const localCompletionFailed =
        status === 'LOCAL_FAILED' && cancellation?.['status'] === 'COMPLETED';
      if (!ownsClaim && !localCompletionFailed) return;

      const now = this.firestore.Timestamp.now();
      tx.update(orderRef, {
        cancellation: {
          status,
          reason,
          updatedAt: this.toIso(now),
        },
        updatedAt: now,
      });
    });
  }

  private isLegacyRefundableStatus(status: unknown): status is OrderStatus {
    return (
      typeof status === 'string' &&
      getAllowedTransitions('admin', status as OrderStatus).includes('CANCELLED')
    );
  }

  private toIso(value: any) {
    if (value instanceof Date) return value.toISOString();
    if (typeof value?.toDate === 'function') return value.toDate().toISOString();
    return new Date(value).toISOString();
  }

  // ── Settlements ──────────────────────────────────────────────────

  async getSettlements(dto: QueryAdminSettlementsDto) {
    let query = this.firestore.collection('settlements') as any;

    if (dto.storeId) {
      query = query.where('storeId', '==', dto.storeId);
    }
    if (dto.from) {
      const { start } = dateRangeKST(dto.from);
      query = query.where('settledAt', '>=', this.firestore.Timestamp.fromDate(start));
    }
    if (dto.to) {
      const { endExclusive } = dateRangeKST(dto.to);
      query = query.where('settledAt', '<', this.firestore.Timestamp.fromDate(endExclusive));
    }

    query = query.orderBy('settledAt', 'desc').limit(500);
    const snap = await query.get();

    return {
      settlements: snap.docs.map((d: any) => d.data()),
      total: snap.size,
    };
  }

  // N1: 트랜잭션 내 status 재확인 후 paid 전이 — 더블클릭/동시 클릭 이중 paid 경합 차단.
  // 비트랜잭션이면 두 요청이 모두 confirmed를 읽고 둘 다 paid update → paidAt 갱신 경합.
  async markAsPaid(settlementId: string) {
    const ref = this.firestore.doc(`settlements/${settlementId}`);

    await this.firestore.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new NotFoundException('정산 내역을 찾을 수 없습니다.');

      const data = snap.data()!;
      if (data['status'] === 'paid') {
        throw new BadRequestException('이미 지급 완료된 정산입니다.');
      }
      if (data['status'] !== 'confirmed') {
        throw new BadRequestException('confirmed 상태의 정산만 지급 처리할 수 있습니다.');
      }

      const now = this.firestore.Timestamp.now();
      t.update(ref, {
        status: 'paid',
        paidAt: now,
        updatedAt: now,
      });
    });

    return { settlementId, status: 'paid' };
  }

  // ── Drivers ──────────────────────────────────────────────────────

  async getDrivers(dto: QueryAdminDriversDto) {
    // 복합 인덱스 없이도 동작하도록 role 단일 필터 후 메모리 필터링
    const snap = await (
      this.firestore.collection('users').where('role', '==', 'driver').limit(100) as any
    ).get();

    let drivers = snap.docs.map((d: any) => {
      const { passwordHash: _pw, ...user } = d.data();
      return user;
    });

    if (dto.status === 'pending') {
      drivers = drivers.filter((d: any) => !d.driverApproved && !d.suspended);
    } else if (dto.status === 'approved') {
      drivers = drivers.filter((d: any) => d.driverApproved && !d.suspended);
    } else if (dto.status === 'suspended') {
      drivers = drivers.filter((d: any) => d.suspended);
    }

    drivers.sort((a: any, b: any) => (b.createdAt?._seconds ?? 0) - (a.createdAt?._seconds ?? 0));

    return { drivers, total: drivers.length };
  }

  async approveDriver(userId: string) {
    const ref = this.firestore.doc(`users/${userId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('드라이버를 찾을 수 없습니다.');

    const data = snap.data()!;
    if (data['role'] !== 'driver') {
      throw new BadRequestException('드라이버 계정이 아닙니다.');
    }

    await ref.update({
      driverApproved: true,
      updatedAt: this.firestore.Timestamp.now(),
    });
    return { userId, driverApproved: true };
  }

  async suspendDriver(userId: string, dto: SuspendUserDto) {
    const ref = this.firestore.doc(`users/${userId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('드라이버를 찾을 수 없습니다.');

    const data = snap.data()!;
    if (data['role'] !== 'driver') {
      throw new BadRequestException('드라이버 계정이 아닙니다.');
    }

    await ref.update({
      suspended: dto.suspended,
      updatedAt: this.firestore.Timestamp.now(),
    });
    if (dto.suspended) {
      await admin.auth().revokeRefreshTokens(userId);
    }
    return { userId, suspended: dto.suspended };
  }

  // ── Invite ───────────────────────────────────────────────────────

  async generateInvite(adminId: string) {
    const token = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
    const now = this.firestore.Timestamp.now();

    // 7일 만료
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.firestore.doc(`invites/${token}`).set({
      token,
      createdBy: adminId,
      usedAt: null,
      usedBy: null,
      expiresAt: this.firestore.Timestamp.fromDate(expiresAt),
      createdAt: now,
    });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getInvites() {
    const snap = await (
      this.firestore.collection('invites').orderBy('createdAt', 'desc').limit(50) as any
    ).get();

    return snap.docs.map((d: any) => d.data());
  }

  // ── Banner ───────────────────────────────────────────────────────

  async getBanner() {
    const snap = await this.firestore.doc('banners/main_hero').get();
    return snap.exists ? snap.data() : null;
  }

  async upsertBanner(dto: UpsertBannerDto) {
    const {
      updatedAt: _u,
      createdAt: _c,
      ...fields
    } = dto as UpsertBannerDto & Record<string, unknown>;
    const ref = this.firestore.doc('banners/main_hero');
    await ref.set({ ...fields, updatedAt: this.firestore.Timestamp.now() }, { merge: true });
    const snap = await ref.get();
    return snap.data();
  }
}
