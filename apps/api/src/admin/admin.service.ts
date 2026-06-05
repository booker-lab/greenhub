import type { OrderStatus } from '@greenhub/shared';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
// biome-ignore lint/style/useImportType: Nest 생성자 주입 런타임 메타데이터에 클래스 값이 필요하다.
import { FirestoreService } from '../firestore/firestore.service';
// biome-ignore lint/style/useImportType: Nest 생성자 주입 런타임 메타데이터에 클래스 값이 필요하다.
import { PaymentsService } from '../payments/payments.service';
import { getDriversPage } from './admin-drivers.helpers';
import { revokeInviteToken, rollbackInviteSellerAccount } from './admin-invite-lifecycle.helpers';
import { createInviteTokenPrefixes, getInvitesPage } from './admin-invites.helpers';
import { updateAdminOrderTracking } from './admin-order-tracking.helpers';
import { getAdminOrderDetail, getOrdersPage } from './admin-orders.helpers';
import {
  getDefaultCommissionRate,
  setDefaultCommissionRate,
} from './admin-platform-config.helpers';
import {
  bulkPayFailureReason,
  settlementCursorDate,
  settlementQueryLimit,
  toIsoCursor,
} from './admin-settlements.helpers';
import { countByStatus, sumNumberField } from './admin-store-summary.helpers';
import type {
  ForceRefundDto,
  QueryAdminDriversDto,
  QueryAdminInvitesDto,
  QueryAdminOrdersDto,
  QueryAdminSettlementsDto,
  SetCommissionDto,
  SetDefaultCommissionDto,
  SuspendUserDto,
  UpdateOrderTrackingDto,
} from './dto/admin.dto';

const ADMIN_USERS_LIMIT = 5000;
const DEFAULT_FORCE_REFUND_REASON = '관리자 강제 환불';
const DEFAULT_INVITE_EXPIRY_DAYS = 7;
const RISK_FORCE_REFUND_STATUSES: OrderStatus[] = [
  'DELIVERING',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'REVIEWED',
];
const RISK_FORCE_REFUND_REASON_MESSAGE = '배달 후 환불은 사유(5자 이상)가 필수입니다.';

type BulkPayFailure = {
  id: string;
  reason: string;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly payments: PaymentsService,
  ) {}

  async getStores() {
    const snap = await (
      this.firestore.collection('stores').orderBy('createdAt', 'desc') as any
    ).get();

    return {
      stores: snap.docs.map((d: any) => d.data()),
      total: snap.size,
    };
  }

  async getPlatformConfig() {
    return { defaultCommissionRate: await getDefaultCommissionRate(this.firestore) };
  }

  async setDefaultCommission(dto: SetDefaultCommissionDto) {
    return setDefaultCommissionRate(this.firestore, dto.rate);
  }

  async getStoreSummary(storeId: string) {
    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    if (!storeSnap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다.');

    const storeData = (storeSnap.data() ?? {}) as Record<string, unknown>;
    const store = { id: storeId, ...storeData };
    const ownerId = typeof storeData.ownerId === 'string' ? storeData.ownerId : null;
    const [ownerSnap, ordersSnap, settlementsSnap] = await Promise.all([
      ownerId ? this.firestore.doc(`users/${ownerId}`).get() : Promise.resolve(null),
      (this.firestore.collection('orders').where('storeId', '==', storeId) as any).get(),
      (this.firestore.collection('settlements').where('storeId', '==', storeId) as any).get(),
    ]);
    const ownerData = ownerSnap?.exists ? ownerSnap.data() : null;

    return {
      store,
      owner: ownerId
        ? {
            id: ownerId,
            name: ownerData?.name ?? null,
            email: ownerData?.email ?? null,
            phone: ownerData?.phone ?? null,
          }
        : null,
      orders: {
        totalCount: ordersSnap.size,
        totalAmount: sumNumberField(ordersSnap.docs, 'totalAmount'),
        byStatus: countByStatus(ordersSnap.docs),
      },
      settlements: {
        totalCount: settlementsSnap.size,
        platformFee: sumNumberField(settlementsSnap.docs, 'platformFee'),
        netAmount: sumNumberField(settlementsSnap.docs, 'netAmount'),
        byStatus: countByStatus(settlementsSnap.docs),
      },
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

  async getUsers() {
    const snap = await (
      this.firestore
        .collection('users')
        .where('role', '==', 'consumer')
        .orderBy('createdAt', 'desc')
        .limit(ADMIN_USERS_LIMIT) as any
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

  async getOrders(dto: QueryAdminOrdersDto) {
    return getOrdersPage(this.firestore, dto);
  }

  async getOrderDetail(orderId: string) {
    return getAdminOrderDetail(this.firestore, orderId);
  }

  async forceRefund(orderId: string, dto: ForceRefundDto) {
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');

    const order = orderSnap.data();
    if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');
    const status = order.status as OrderStatus;
    if (status === 'CANCELLED') {
      throw new BadRequestException('이미 취소된 주문입니다.');
    }
    const trimmedReason = dto.reason?.trim();
    if (
      RISK_FORCE_REFUND_STATUSES.includes(status) &&
      (!trimmedReason || trimmedReason.length < 5)
    ) {
      throw new BadRequestException(RISK_FORCE_REFUND_REASON_MESSAGE);
    }

    const reason = trimmedReason || DEFAULT_FORCE_REFUND_REASON;
    await this.payments.processRefundByOrderId(orderId, reason);

    await this.firestore.doc(`orders/${orderId}`).update({
      status: 'CANCELLED',
      cancelReason: reason,
      updatedAt: this.firestore.Timestamp.now(),
    });

    return { ok: true, orderId };
  }

  async updateOrderTracking(orderId: string, dto: UpdateOrderTrackingDto, adminId: string) {
    return updateAdminOrderTracking(this.firestore, orderId, dto, adminId);
  }

  // ── Settlements ──────────────────────────────────────────────────

  async getSettlements(dto: QueryAdminSettlementsDto) {
    let query = this.firestore.collection('settlements') as any;

    if (dto.storeId) {
      query = query.where('storeId', '==', dto.storeId);
    }
    if (dto.status) {
      query = query.where('status', '==', dto.status);
    }
    if (dto.from) {
      query = query.where('settledAt', '>=', this.firestore.Timestamp.fromDate(new Date(dto.from)));
    }
    if (dto.to) {
      const toDate = new Date(dto.to);
      toDate.setHours(23, 59, 59, 999);
      query = query.where('settledAt', '<=', this.firestore.Timestamp.fromDate(toDate));
    }

    const limit = settlementQueryLimit(dto.limit);
    const cursorDate = settlementCursorDate(dto.cursor);

    query = query.orderBy('settledAt', 'desc');
    if (cursorDate) {
      query = query.startAfter(this.firestore.Timestamp.fromDate(cursorDate));
    }
    query = query.limit(limit + 1);
    const snap = await query.get();
    const docs = snap.docs.slice(0, limit);
    const nextDoc = snap.docs.length > limit ? docs.at(-1) : null;

    return {
      settlements: docs.map((d: any) => d.data()),
      total: docs.length,
      nextCursor: nextDoc ? toIsoCursor(nextDoc.data()?.settledAt) : null,
    };
  }

  // N1: 트랜잭션 내 status 재확인 후 paid 전이 — 더블클릭/동시 클릭 이중 paid 경합 차단.
  // 비트랜잭션이면 두 요청이 모두 confirmed를 읽고 둘 다 paid update → paidAt 갱신 경합.
  async markAsPaid(settlementId: string) {
    const ref = this.firestore.doc(`settlements/${settlementId}`);

    await this.firestore.runTransaction(async (t) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new NotFoundException('정산 내역을 찾을 수 없습니다.');

      const data = snap.data();
      if (!data) throw new NotFoundException('정산 내역을 찾을 수 없습니다.');
      if (data.status === 'paid') {
        throw new BadRequestException('이미 지급 완료된 정산입니다.');
      }
      if (data.status !== 'confirmed') {
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

  async bulkMarkAsPaid(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const ok: string[] = [];
    const failed: BulkPayFailure[] = [];

    for (const id of uniqueIds) {
      try {
        await this.markAsPaid(id);
        ok.push(id);
      } catch (error) {
        failed.push({ id, reason: bulkPayFailureReason(error) });
      }
    }

    return { ok, failed };
  }

  async getDrivers(dto: QueryAdminDriversDto) {
    return getDriversPage(this.firestore, dto);
  }

  async approveDriver(userId: string) {
    const ref = this.firestore.doc(`users/${userId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('드라이버를 찾을 수 없습니다.');

    const data = snap.data();
    if (!data) throw new NotFoundException('드라이버를 찾을 수 없습니다.');
    if (data.role !== 'driver') {
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

    const data = snap.data();
    if (!data) throw new NotFoundException('드라이버를 찾을 수 없습니다.');
    if (data.role !== 'driver') {
      throw new BadRequestException('드라이버 계정이 아닙니다.');
    }

    await ref.update({
      suspended: dto.suspended,
      updatedAt: this.firestore.Timestamp.now(),
    });
    return { userId, suspended: dto.suspended };
  }

  // ── Invite ───────────────────────────────────────────────────────

  async generateInvite(adminId: string, expiresInDays = DEFAULT_INVITE_EXPIRY_DAYS) {
    const token = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
    const now = this.firestore.Timestamp.now();
    const expiresAt = typeof now.toDate === 'function' ? now.toDate() : new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    await this.firestore.doc(`invites/${token}`).set({
      token,
      tokenPrefixes: createInviteTokenPrefixes(token),
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

  async getInvites(dto: QueryAdminInvitesDto) {
    return getInvitesPage(this.firestore, dto);
  }

  async revokeInvite(token: string, adminId: string) {
    return revokeInviteToken(this.firestore, token, adminId);
  }

  async rollbackInviteSeller(token: string, adminId: string) {
    return rollbackInviteSellerAccount(this.firestore, token, adminId);
  }

  // ── Banner ───────────────────────────────────────────────────────
}
