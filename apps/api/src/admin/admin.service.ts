import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../firestore/firestore.service';
import { PaymentsService } from '../payments/payments.service';
import {
  QueryAdminSettlementsDto,
  QueryAdminOrdersDto,
  QueryAdminDriversDto,
  SuspendUserDto,
  SetCommissionDto,
  ForceRefundDto,
  UpsertBannerDto,
} from './dto/admin.dto';

@Injectable()
export class AdminService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly payments: PaymentsService,
  ) {}

  // ── Stores ──────────────────────────────────────────────────────

  async getStores() {
    const snap = await (this.firestore
      .collection('stores')
      .orderBy('createdAt', 'desc') as any).get();

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

  // ── Users ────────────────────────────────────────────────────────

  async getUsers() {
    const snap = await (this.firestore
      .collection('users')
      .where('role', '==', 'consumer')
      .orderBy('createdAt', 'desc') as any).get();

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
    const orderSnap = await this.firestore.doc(`orders/${orderId}`).get();
    if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');

    const order = orderSnap.data()!;
    if (order['status'] === 'CANCELLED') {
      throw new BadRequestException('이미 취소된 주문입니다.');
    }

    const reason = dto.reason ?? '관리자 강제 환불';
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
    if (dto.from) {
      query = query.where(
        'settledAt',
        '>=',
        this.firestore.Timestamp.fromDate(new Date(dto.from)),
      );
    }
    if (dto.to) {
      const toDate = new Date(dto.to);
      toDate.setHours(23, 59, 59, 999);
      query = query.where(
        'settledAt',
        '<=',
        this.firestore.Timestamp.fromDate(toDate),
      );
    }

    query = query.orderBy('settledAt', 'desc').limit(500);
    const snap = await query.get();

    return {
      settlements: snap.docs.map((d: any) => d.data()),
      total: snap.size,
    };
  }

  async markAsPaid(settlementId: string) {
    const ref = this.firestore.doc(`settlements/${settlementId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('정산 내역을 찾을 수 없습니다.');

    const data = snap.data()!;
    if (data['status'] === 'paid') {
      throw new BadRequestException('이미 지급 완료된 정산입니다.');
    }
    if (data['status'] !== 'confirmed') {
      throw new BadRequestException('confirmed 상태의 정산만 지급 처리할 수 있습니다.');
    }

    const now = this.firestore.Timestamp.now();
    await ref.update({
      status: 'paid',
      paidAt: now,
      updatedAt: now,
    });

    return { settlementId, status: 'paid' };
  }

  // ── Drivers ──────────────────────────────────────────────────────

  async getDrivers(dto: QueryAdminDriversDto) {
    // 복합 인덱스 없이도 동작하도록 role 단일 필터 후 메모리 필터링
    const snap = await (this.firestore
      .collection('users')
      .where('role', '==', 'driver')
      .limit(100) as any).get();

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

    drivers.sort((a: any, b: any) =>
      (b.createdAt?._seconds ?? 0) - (a.createdAt?._seconds ?? 0),
    );

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
    const snap = await (this.firestore
      .collection('invites')
      .orderBy('createdAt', 'desc')
      .limit(50) as any).get();

    return snap.docs.map((d: any) => d.data());
  }

  // ── Banner ───────────────────────────────────────────────────────

  async getBanner() {
    const snap = await this.firestore.doc('banners/main_hero').get();
    return snap.exists ? snap.data() : null;
  }

  async upsertBanner(dto: UpsertBannerDto) {
    const ref = this.firestore.doc('banners/main_hero');
    await ref.set(
      { ...dto, updatedAt: this.firestore.Timestamp.now() },
      { merge: true },
    );
    const snap = await ref.get();
    return snap.data();
  }
}
