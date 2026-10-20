import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { dateRangeKST } from '@greenhub/shared';
import type * as admin from 'firebase-admin';
import { normalizeEmail } from '../auth/email-identity';
import {
  INVITE_NOT_FOUND_MESSAGE,
  assertInviteTokenFormat,
  inviteConflict,
} from '../auth/invite-conflict';
import { AuditService, type AdminAuditEntry } from '../common/audit/audit.service';
import { FirestoreService } from '../firestore/firestore.service';
import { RoundOrderLifecycleService } from '../orders/round-order-lifecycle.service';
import type { OrderStatus } from '../orders/dto/update-status.dto';
import { getAllowedTransitions } from '../orders/orders.helpers';
import { PaymentsService } from '../payments/payments.service';
import { releaseLegacyDailyCapacityInTransaction } from '../payments/_lib/legacy-daily-capacity';
import { releaseLegacyGroupQuantityInTransaction } from '../orders/_lib/legacy-group-quantity';
import { hasOpenProviderReversalInTransaction } from '../settlements/_lib/provider-reversal-hold';
import {
  type CancelSettlementResult,
  SettlementsService,
} from '../settlements/settlements.service';
import {
  SESSIONS_REVOKED_AT_FIELD,
  revokeFirebaseSessions,
  sessionsRevokedAtMillis,
} from '../auth/session-revocation';
import {
  QueryAdminSettlementsDto,
  QueryAdminOrdersDto,
  QueryAdminDriversDto,
  SuspendUserDto,
  SetCommissionDto,
  ForceRefundDto,
  UpsertBannerDto,
} from './dto/admin.dto';
import type { GenerateInviteDto } from './dto/invite.dto';

const LEGACY_REFUND_CLAIM_MS = 5 * 60 * 1000;
// 판매자 초대 토큰 유효 기간(발급 시점부터 72시간).
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

// 관리자 목록 응답은 화면이 쓰는 필드만 내려준다(저장 배송지·세션·외부 로그인 식별자 등은 제외).
const ADMIN_USER_LIST_FIELDS = ['id', 'email', 'name', 'phone', 'suspended', 'createdAt'] as const;
const ADMIN_DRIVER_LIST_FIELDS = [
  'id',
  'name',
  'email',
  'driverApproved',
  'suspended',
  'createdAt',
] as const;

function pickListFields(data: Record<string, unknown>, fields: readonly string[]) {
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (data[field] !== undefined) picked[field] = data[field];
  }
  return picked;
}

type LegacyRefundClaimResult =
  | { kind: 'done' }
  | { kind: 'in_progress' }
  | { kind: 'claimed'; token: string };

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly payments: PaymentsService,
    private readonly settlements: SettlementsService,
    private readonly roundLifecycle: RoundOrderLifecycleService,
    private readonly audit: AuditService,
  ) {}

  // 작업이 끝난 뒤 기록한다. 기록 실패로 이미 끝난 작업을 되돌리지 않으므로 오류 로그만 남긴다.
  private async recordAdmin(entry: AdminAuditEntry) {
    try {
      await this.audit.logAdmin(entry);
    } catch (error) {
      this.logger.error(
        `[AdminAudit] 기록 실패 action=${entry.action} error=${(error as Error)?.name ?? 'unknown'}`,
      );
    }
  }

  getAuditLogs() {
    return this.audit.listAdmin();
  }

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

  async setCommission(storeId: string, dto: SetCommissionDto, actorId: string) {
    const ref = this.firestore.doc(`stores/${storeId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다.');

    await ref.update({
      commissionRate: dto.rate,
      updatedAt: this.firestore.Timestamp.now(),
    });
    await this.recordAdmin({
      action: 'admin.store.commission_changed',
      actorId,
      targetType: 'store',
      targetId: storeId,
      before: { commissionRate: snap.data()?.['commissionRate'] ?? null },
      after: { commissionRate: dto.rate },
    });
    return { storeId, commissionRate: dto.rate };
  }

  // 판매자 "치우기"(아카이브) — 영구 삭제 아님, status='archived' 표시.
  // 기록 가드: 주문·정산 기록이 하나라도 있으면 차단(법적 책임·이력 보존).
  async archiveStore(storeId: string, actorId: string) {
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
    await this.recordAdmin({
      action: 'admin.store.archived',
      actorId,
      targetType: 'store',
      targetId: storeId,
      before: { status: snap.data()?.['status'] ?? null },
      after: { status: 'archived' },
    });
    return { storeId, status: 'archived' };
  }

  // 아카이브 복구 — active 복원 + archivedAt 제거. 치운(archived) 판매자만 복구한다.
  async restoreStore(storeId: string, actorId: string) {
    const ref = this.firestore.doc(`stores/${storeId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다.');
    if (snap.data()?.['status'] !== 'archived') {
      throw new ConflictException('정리된 판매자만 복구할 수 있습니다.');
    }

    await ref.update({
      status: 'active',
      archivedAt: this.firestore.FieldValue.delete(),
      updatedAt: this.firestore.Timestamp.now(),
    });
    await this.recordAdmin({
      action: 'admin.store.restored',
      actorId,
      targetType: 'store',
      targetId: storeId,
      before: { status: snap.data()?.['status'] ?? null },
      after: { status: 'active' },
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
      users: snap.docs.map((d: any) => pickListFields(d.data(), ADMIN_USER_LIST_FIELDS)),
      total: snap.size,
    };
  }

  // 소비자 정지 — 소비자 계정만 대상. 판매자·기사·관리자 계정과 요청한 관리자 자신은 정지하지 않는다.
  async suspendUser(userId: string, dto: SuspendUserDto, actorId: string) {
    if (userId === actorId) {
      throw new BadRequestException('자기 자신의 계정은 정지할 수 없습니다.');
    }
    const ref = this.firestore.doc(`users/${userId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('사용자를 찾을 수 없습니다.');

    const data = snap.data()!;
    if (data['role'] !== 'consumer') {
      throw new BadRequestException('소비자 계정이 아닙니다.');
    }

    await ref.update(this.suspensionUpdate(dto.suspended));
    if (dto.suspended) {
      await this.revokeSuspendedUserSessions(userId);
    }
    await this.recordAdmin({
      action: dto.suspended ? 'admin.user.suspended' : 'admin.user.unsuspended',
      actorId,
      targetType: 'user',
      targetId: userId,
      before: { suspended: snap.data()?.['suspended'] === true },
      after: { suspended: dto.suspended },
      reason: dto.reason,
    });
    return { userId, suspended: dto.suspended };
  }

  // 정지할 때는 이전에 발급된 API access token도 거부되도록 세션 폐기 시각을 함께 기록한다.
  private suspensionUpdate(suspended: boolean) {
    return {
      suspended,
      ...(suspended
        ? {
            [SESSIONS_REVOKED_AT_FIELD]: this.firestore.Timestamp.fromMillis(
              sessionsRevokedAtMillis(),
            ),
          }
        : {}),
      updatedAt: this.firestore.Timestamp.now(),
    };
  }

  // 정지된 계정의 API refresh 기록과 Firebase 클라이언트 세션을 끊는다(로그아웃과 같은 폐기).
  private async revokeSuspendedUserSessions(userId: string) {
    await this.firestore.doc(`refreshTokens/${userId}`).delete();
    await revokeFirebaseSessions(userId, this.logger);
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

  async forceRefund(orderId: string, dto: ForceRefundDto, actorId: string) {
    const orderRef = this.firestore.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');

    const order = orderSnap.data()!;
    const reason = dto.reason ?? '관리자 강제 환불';

    let result: Record<string, unknown>;
    if (order['schemaVersion'] === 2 && order['roundId']) {
      const cancelled = await this.roundLifecycle.cancelForRound({
        storeId: order['storeId'],
        orderId,
        expectedStatus: order['status'],
        reason,
        customerNotice: 'ADMIN_REFUND',
      });
      // 회차 취소가 이미 정산을 반영했어도 다시 불러 회수 필요 여부를 받는다(멱등).
      const recovery = await this.settlements.cancelSettlement(orderId);
      result = { ...cancelled, ...recovery };
    } else {
      result = await this.forceLegacyRefund(orderId, reason);
    }
    // 이미 지급한 정산이면 화면이 "판매자에게 돌려받아야 할 금액"을 알리도록 응답과 기록에 싣는다.
    const recoveryAfter =
      result['recoveryRequired'] === true
        ? { recoveryRequired: true, recoveryAmount: result['recoveryAmount'] }
        : {};

    // 환불이 실패해 예외가 나면 여기까지 오지 않으므로 성공한 환불만 기록된다.
    await this.recordAdmin({
      action: 'admin.order.force_refunded',
      actorId,
      targetType: 'order',
      targetId: orderId,
      before: { status: order['status'] ?? null },
      after: { status: 'CANCELLED', ...recoveryAfter },
      reason,
    });
    return result;
  }

  private async forceLegacyRefund(
    orderId: string,
    reason: string,
  ): Promise<{ ok: true; orderId: string } & CancelSettlementResult> {
    const claim = await this.claimLegacyRefund(orderId, reason);
    if (claim.kind === 'done') {
      const recovery = await this.settlements.cancelSettlement(orderId);
      return { ok: true, orderId, ...recovery };
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

    let recovery: CancelSettlementResult;
    try {
      await this.applyLegacyLocalCancellation(orderId, claim.token, reason);
      recovery = await this.settlements.cancelSettlement(orderId);
    } catch (error) {
      await this.recordLegacyRefundState(orderId, claim.token, 'LOCAL_FAILED', reason);
      throw error;
    }

    return { ok: true, orderId, ...recovery };
  }

  private async claimLegacyRefund(
    orderId: string,
    reason: string,
  ): Promise<LegacyRefundClaimResult> {
    const token = randomUUID();

    // Retry purity: the post-transaction decision must come from the committed
    // attempt's return value only. An outer `let result` mutated inside the
    // callback would leak an aborted attempt's done/in_progress decision into
    // a retried claim (or vice versa). See
    // ADMIN-LEGACY-REFUND-OCC-RETRY-PURITY-CLOSURE-02.
    const claimResult = await this.firestore.runTransaction<LegacyRefundClaimResult>(
      async (tx) => {
        const orderRef = this.firestore.doc(`orders/${orderId}`);
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) throw new NotFoundException('주문을 찾을 수 없습니다.');

        const order = orderSnap.data() as Record<string, any>;
        const cancellation = (order['cancellation'] ?? null) as Record<string, any> | null;
        const cancellationStatus = cancellation?.['status'] as string | undefined;

        // 이미 cancellation까지 완료된 취소는 외부 provider와 capacity를 다시 건드리지 않는다.
        if (order['status'] === 'CANCELLED' && cancellationStatus === 'COMPLETED') {
          return { kind: 'done' };
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
            return { kind: 'in_progress' };
          }
          if (refundClaim.expiresAt > Date.now()) {
            return { kind: 'in_progress' };
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
        return { kind: 'claimed', token };
      },
    );

    return claimResult;
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

      // Already CANCELLED (e.g. seller won a cross-path race, or a retry after the
      // flip): converge to COMPLETED without restoring group quantity or capacity
      // again. Capacity release stays idempotent; group restoration is exactly-once
      // because only the transaction that flips to CANCELLED performs it.
      if (order['status'] === 'CANCELLED') {
        await releaseLegacyDailyCapacityInTransaction(this.firestore, tx, orderId, reason);
        const convergedAt = this.firestore.Timestamp.now();
        tx.update(orderRef, {
          cancellation: {
            status: 'COMPLETED',
            reason,
            completedAt: this.toIso(convergedAt),
            updatedAt: this.toIso(convergedAt),
          },
          updatedAt: convergedAt,
        });
        return;
      }

      await releaseLegacyDailyCapacityInTransaction(this.firestore, tx, orderId, reason);
      await releaseLegacyGroupQuantityInTransaction(this.firestore, tx, orderId, order);
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
    if (dto.status) {
      query = query.where('status', '==', dto.status);
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
  async markAsPaid(settlementId: string, actorId: string) {
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
      // 결제사 취소·분쟁 운영 기록이 OPEN이면 지급하지 않는다. 같은 트랜잭션에서 읽어 경합을 막는다.
      const orderId = typeof data['orderId'] === 'string' ? data['orderId'] : settlementId;
      if (await hasOpenProviderReversalInTransaction(this.firestore, t, orderId)) {
        throw new ConflictException(
          '결제사 취소·분쟁 확인이 끝나지 않은 주문입니다. 운영 확인 기록을 먼저 처리한 뒤 지급하세요.',
        );
      }

      const now = this.firestore.Timestamp.now();
      t.update(ref, {
        status: 'paid',
        paidAt: now,
        paidBy: actorId,
        updatedAt: now,
      });
      // 지급 표시와 기록을 같은 트랜잭션에 넣어, 기록 없는 지급이 생기지 않게 한다.
      await this.audit.logAdmin(
        {
          action: 'admin.settlement.paid',
          actorId,
          targetType: 'settlement',
          targetId: settlementId,
          before: { status: 'confirmed' },
          after: { status: 'paid' },
        },
        t,
      );
    });

    return { settlementId, status: 'paid' };
  }

  // ── Drivers ──────────────────────────────────────────────────────

  async getDrivers(dto: QueryAdminDriversDto) {
    // 복합 인덱스 없이도 동작하도록 role 단일 필터 후 메모리 필터링·정렬한다.
    // 정렬 전에 잘리지 않도록 넉넉히 읽고, 한도를 넘는 기사가 더 있으면 hasMore로 알린다.
    const ADMIN_DRIVER_SCAN_LIMIT = 500;
    const snap = await (
      this.firestore
        .collection('users')
        .where('role', '==', 'driver')
        .limit(ADMIN_DRIVER_SCAN_LIMIT + 1) as any
    ).get();
    const hasMore = snap.docs.length > ADMIN_DRIVER_SCAN_LIMIT;

    let drivers = snap.docs
      .slice(0, ADMIN_DRIVER_SCAN_LIMIT)
      .map((d: any) => pickListFields(d.data(), ADMIN_DRIVER_LIST_FIELDS));

    if (dto.status === 'pending') {
      drivers = drivers.filter((d: any) => !d.driverApproved && !d.suspended);
    } else if (dto.status === 'approved') {
      drivers = drivers.filter((d: any) => d.driverApproved && !d.suspended);
    } else if (dto.status === 'suspended') {
      drivers = drivers.filter((d: any) => d.suspended);
    }

    drivers.sort((a: any, b: any) => (b.createdAt?._seconds ?? 0) - (a.createdAt?._seconds ?? 0));

    return { drivers, total: drivers.length, hasMore };
  }

  async approveDriver(userId: string, actorId: string) {
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
    await this.recordAdmin({
      action: 'admin.driver.approved',
      actorId,
      targetType: 'driver',
      targetId: userId,
      before: { driverApproved: data['driverApproved'] === true },
      after: { driverApproved: true },
    });
    return { userId, driverApproved: true };
  }

  async suspendDriver(userId: string, dto: SuspendUserDto, actorId: string) {
    const ref = this.firestore.doc(`users/${userId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('드라이버를 찾을 수 없습니다.');

    const data = snap.data()!;
    if (data['role'] !== 'driver') {
      throw new BadRequestException('드라이버 계정이 아닙니다.');
    }

    await ref.update(this.suspensionUpdate(dto.suspended));
    if (dto.suspended) {
      await this.revokeSuspendedUserSessions(userId);
    }
    await this.recordAdmin({
      action: dto.suspended ? 'admin.driver.suspended' : 'admin.driver.unsuspended',
      actorId,
      targetType: 'driver',
      targetId: userId,
      before: { suspended: data['suspended'] === true },
      after: { suspended: dto.suspended },
      reason: dto.reason,
    });
    return { userId, suspended: dto.suspended };
  }

  // ── Invite ───────────────────────────────────────────────────────

  /**
   * 판매자 초대 토큰을 발급한다. 받는 사람 이메일(recipientEmail)은 필수이고(DTO 검증),
   * 정규화(trim·소문자)해 저장한다. 가입은 같은 정규화 이메일로만 받는다.
   */
  async generateInvite(adminId: string, dto: GenerateInviteDto) {
    const token = randomUUID().replace(/-/g, '').substring(0, 16).toUpperCase();
    const now = this.firestore.Timestamp.now();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const recipientEmail = normalizeEmail(dto.recipientEmail);

    await this.firestore.doc(`invites/${token}`).set({
      token,
      createdBy: adminId,
      usedAt: null,
      usedBy: null,
      recipientEmail,
      expiresAt: this.firestore.Timestamp.fromDate(expiresAt),
      createdAt: now,
    });

    return {
      token,
      expiresAt: expiresAt.toISOString(),
      recipientEmail,
    };
  }

  async getInvites() {
    const snap = await (
      this.firestore.collection('invites').orderBy('createdAt', 'desc').limit(50) as any
    ).get();

    return snap.docs.map((d: any) => d.data());
  }

  /**
   * 아직 쓰이지 않은 유효 초대 토큰만 취소한다. 문서는 지우지 않고 revokedAt·revokedBy를 남긴다.
   * 상태 우선순위(revokedAt > usedAt > 만료)대로 409 + reason으로 거부하고,
   * 가입 트랜잭션과 같은 문서를 트랜잭션으로 읽어 동시 가입과 한쪽만 성공하게 한다.
   */
  async revokeInvite(token: string, adminId: string) {
    assertInviteTokenFormat(token);
    const ref = this.firestore.doc(`invites/${token}`);
    const revokedAt = new Date();

    await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException(INVITE_NOT_FOUND_MESSAGE);
      const invite = snap.data()!;

      if (invite['revokedAt'] != null) {
        throw inviteConflict('already_revoked', '이미 취소된 초대 토큰입니다.');
      }
      if (invite['usedAt'] != null) {
        throw inviteConflict('already_used', '이미 사용된 초대 토큰은 취소할 수 없습니다.');
      }
      if ((invite['expiresAt'] as admin.firestore.Timestamp).toMillis() < revokedAt.getTime()) {
        throw inviteConflict('expired', '만료된 초대 토큰은 취소할 수 없습니다.');
      }

      tx.update(ref, {
        revokedAt: this.firestore.Timestamp.fromDate(revokedAt),
        revokedBy: adminId,
      });
    });

    return { token, revokedAt: revokedAt.toISOString() };
  }

  // ── Banner ───────────────────────────────────────────────────────

  async getBanner() {
    const snap = await this.firestore.doc('banners/main_hero').get();
    return snap.exists ? snap.data() : null;
  }

  async upsertBanner(dto: UpsertBannerDto, actorId: string) {
    const {
      updatedAt: _u,
      createdAt: _c,
      ...fields
    } = dto as UpsertBannerDto & Record<string, unknown>;
    const ref = this.firestore.doc('banners/main_hero');
    const previous = ((await ref.get()).data() ?? {}) as Record<string, unknown>;
    await ref.set({ ...fields, updatedAt: this.firestore.Timestamp.now() }, { merge: true });
    const snap = await ref.get();
    // 바꾼 칸만 이전 값과 함께 남긴다.
    const before = Object.fromEntries(Object.keys(fields).map((k) => [k, previous[k] ?? null]));
    await this.recordAdmin({
      action: 'admin.banner.updated',
      actorId,
      targetType: 'banner',
      targetId: 'main_hero',
      before,
      after: fields,
    });
    return snap.data();
  }
}
