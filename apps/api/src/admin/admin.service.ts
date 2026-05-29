import type { OrderStatus } from '@greenhub/shared';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
// biome-ignore lint/style/useImportType: Nest 생성자 주입 런타임 메타데이터에 클래스 값이 필요하다.
import { FirestoreService } from '../firestore/firestore.service';
// biome-ignore lint/style/useImportType: Nest 생성자 주입 런타임 메타데이터에 클래스 값이 필요하다.
import { PaymentsService } from '../payments/payments.service';
import type {
  ForceRefundDto,
  QueryAdminDriversDto,
  QueryAdminOrdersDto,
  QueryAdminSettlementsDto,
  SetCommissionDto,
  SuspendUserDto,
  UpsertBannerDto,
} from './dto/admin.dto';

const ADMIN_USERS_LIMIT = 5000;
const ADMIN_ORDERS_DEFAULT_LIMIT = 50;
const DEFAULT_FORCE_REFUND_REASON = '관리자 강제 환불';
const RISK_FORCE_REFUND_STATUSES: OrderStatus[] = [
  'DELIVERING',
  'HUB_ARRIVED',
  'PICKED_UP',
  'DELIVERED',
  'REVIEWED',
];
const RISK_FORCE_REFUND_REASON_MESSAGE = '배달 후 환불은 사유(5자 이상)가 필수입니다.';
const INVITE_REVOKE_REASON_MESSAGE: Record<InviteRevokeReason, string> = {
  already_used: '이미 사용된 초대 토큰입니다.',
  already_revoked: '이미 취소된 초대 토큰입니다.',
  expired: '만료된 초대 토큰입니다.',
};

type BulkPayFailure = {
  id: string;
  reason: string;
};

type InviteRevokeReason = 'already_used' | 'already_revoked' | 'expired';
type InviteRevokeData = {
  usedAt?: unknown;
  revokedAt?: unknown;
  expiresAt?: unknown;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly payments: PaymentsService,
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

  // ── Orders ───────────────────────────────────────────────────────

  async getOrders(dto: QueryAdminOrdersDto) {
    let query = this.firestore.collection('orders') as any;

    if (dto.storeId) {
      query = query.where('storeId', '==', dto.storeId);
    }
    if (dto.status) {
      query = query.where('status', '==', dto.status);
    }

    const sortDirection = dto.sort === 'createdAt_asc' ? 'asc' : 'desc';
    const limit = dto.limit ?? ADMIN_ORDERS_DEFAULT_LIMIT;
    query = query.orderBy('createdAt', sortDirection);
    if (dto.cursor) {
      query = query.startAfter(this.firestore.Timestamp.fromDate(new Date(dto.cursor)));
    }
    query = query.limit(limit + 1);
    const snap = await query.get();
    const docs = snap.docs.slice(0, limit);
    const nextDoc = snap.docs.length > limit ? docs.at(-1) : null;

    return {
      orders: docs.map((d: any) => d.data()),
      total: docs.length,
      nextCursor: nextDoc ? this.toIsoCursor(nextDoc.data()?.createdAt) : null,
    };
  }

  private toIsoCursor(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && 'toDate' in value) {
      const date = (value as { toDate?: () => Date }).toDate?.();
      return date ? date.toISOString() : null;
    }
    return null;
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

  // ── Drivers ──────────────────────────────────────────────────────

  async bulkMarkAsPaid(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const ok: string[] = [];
    const failed: BulkPayFailure[] = [];

    for (const id of uniqueIds) {
      try {
        await this.markAsPaid(id);
        ok.push(id);
      } catch (error) {
        failed.push({ id, reason: this.getBulkPayFailureReason(error) });
      }
    }

    return { ok, failed };
  }

  private getBulkPayFailureReason(error: unknown) {
    if (error instanceof NotFoundException) {
      return '정산 내역을 찾을 수 없습니다.';
    }
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      const message =
        typeof response === 'object' && response !== null && 'message' in response
          ? (response as { message?: unknown }).message
          : error.message;

      if (typeof message === 'string' && message.length > 0) return message;
      if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
    }
    if (error instanceof HttpException && error.message.length > 0) {
      return error.message;
    }
    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }
    return '지급 처리에 실패했습니다.';
  }

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

  async revokeInvite(token: string, adminId: string) {
    const ref = this.firestore.doc(`invites/${token}`);

    await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException('초대 토큰을 찾을 수 없습니다.');

      const invite = snap.data();
      if (!invite) throw new NotFoundException('초대 토큰을 찾을 수 없습니다.');

      const reason = this.getInviteRevokeBlockReason(invite);
      if (reason) throw this.createInviteRevokeConflict(reason);

      const now = this.firestore.Timestamp.now();
      tx.set(ref, { revokedAt: now, revokedBy: adminId }, { merge: true });
    });

    return { ok: true };
  }

  private getInviteRevokeBlockReason(invite: InviteRevokeData): InviteRevokeReason | null {
    if (invite.usedAt !== null && invite.usedAt !== undefined) return 'already_used';
    if (invite.revokedAt !== null && invite.revokedAt !== undefined) return 'already_revoked';
    const expiresAtMs = this.toInviteExpiresAtMs(invite.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) return 'expired';
    return null;
  }

  private toInviteExpiresAtMs(value: unknown): number {
    if (typeof value === 'object' && value !== null && 'toMillis' in value) {
      const toMillis = (value as { toMillis?: unknown }).toMillis;
      return typeof toMillis === 'function' ? toMillis() : Number.NaN;
    }
    if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
      return new Date(value).getTime();
    }
    return Number.NaN;
  }

  private createInviteRevokeConflict(reason: InviteRevokeReason) {
    return new ConflictException({
      message: INVITE_REVOKE_REASON_MESSAGE[reason],
      reason,
    });
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
