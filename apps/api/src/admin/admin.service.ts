import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type * as admin from 'firebase-admin';
import { isWithdrawnUser } from '../auth/account-withdrawal';
import { normalizeEmail } from '../auth/email-identity';
import {
  INVITE_NOT_FOUND_MESSAGE,
  assertInviteTokenFormat,
  inviteConflict,
} from '../auth/invite-conflict';
import { AuditService, type AdminAuditEntry } from '../common/audit/audit.service';
import { FirestoreService } from '../firestore/firestore.service';
import { customerOrderLabel } from '../notifications/customer-order-label';
import { NotificationsService } from '../notifications/notifications.service';
import {
  REFUND_NOTICE_REASONS,
  refundNoticeIdempotencyKey,
} from '../notifications/refund-notice-reasons';
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
import { listAdminSettlements, summarizeAdminSettlements } from './_lib/admin-settlements-query';
import {
  AdminSettlementFilterDto,
  QueryAdminSettlementsDto,
  QueryAdminOrdersDto,
  QueryAdminDriversDto,
  SuspendUserDto,
  SetCommissionDto,
  ForceRefundDto,
  UpsertBannerDto,
} from './dto/admin.dto';
import type { GenerateInviteDto } from './dto/invite.dto';
import {
  ADMIN_DRIVER_LIST_DEFAULT_LIMIT,
  ADMIN_DRIVER_LIST_FIELDS,
  ADMIN_DRIVER_LIST_MAX_LIMIT,
  ADMIN_ORDER_LIST_DEFAULT_LIMIT,
  ADMIN_ORDER_LIST_MAX_LIMIT,
  ADMIN_STORE_LIST_FIELDS,
  pickListFields,
  readAdminListCursor,
  readStoreNames,
  resolveAdminListLimit,
  toAdminOrderRow,
} from './admin-lists';

const LEGACY_REFUND_CLAIM_MS = 5 * 60 * 1000;
// 판매자 초대 토큰 유효 기간(발급 시점부터 72시간).
export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

// 관리자 목록 응답은 화면이 쓰는 필드만 내려준다(저장 배송지·세션·외부 로그인 식별자 등은 제외).
const ADMIN_USER_LIST_FIELDS = ['id', 'email', 'name', 'phone', 'suspended', 'createdAt'] as const;

// 치운 판매자를 복구할 때 돌아갈 수 있는 상태. 그 밖의 값(없음·알 수 없음)은 active로 본다.
function restorableStoreStatus(value: unknown): 'invited' | 'active' {
  return value === 'invited' ? 'invited' : 'active';
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
    @Optional() private readonly notifications?: NotificationsService,
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

    // 정산 계좌·소유자 id 등은 내려주지 않는다(허용 필드만).
    return {
      stores: snap.docs.map((d: any) =>
        pickListFields({ id: d.id, ...d.data() }, ADMIN_STORE_LIST_FIELDS),
      ),
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
  // 치운 가게는 손님 화면에서 숨고 새 주문이 막힌다(판매자 로그인은 그대로).
  // 기록 가드: 주문·정산 기록이 하나라도 있으면 차단(법적 책임·이력 보존).
  // 기록 확인과 상태 변경을 한 트랜잭션에 넣어, 확인 직후 들어온 주문과 엇갈리지 않게 한다.
  async archiveStore(storeId: string, actorId: string) {
    const ref = this.firestore.doc(`stores/${storeId}`);
    const previousStatus = await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다.');
      const status = snap.data()?.['status'] as string | undefined;
      if (status === 'archived') {
        throw new ConflictException('이미 치운 판매자입니다.');
      }

      // 존재 여부만 확인하면 되므로 limit(1) — 쿼리 비용 최소화.
      const [orderSnap, settlementSnap] = await Promise.all([
        tx.get(this.firestore.collection('orders').where('storeId', '==', storeId).limit(1)),
        tx.get(this.firestore.collection('settlements').where('storeId', '==', storeId).limit(1)),
      ]);
      if (!orderSnap.empty || !settlementSnap.empty) {
        throw new BadRequestException('주문·정산 기록이 있는 판매자는 치울 수 없습니다.');
      }

      const now = this.firestore.Timestamp.now();
      tx.update(ref, {
        status: 'archived',
        // 복구할 때 되돌릴 이전 상태(초대 중이던 판매자는 초대 중으로 돌아간다).
        archivedFromStatus: restorableStoreStatus(status),
        archivedAt: now,
        updatedAt: now,
      });
      return status ?? null;
    });

    await this.recordAdmin({
      action: 'admin.store.archived',
      actorId,
      targetType: 'store',
      targetId: storeId,
      before: { status: previousStatus },
      after: { status: 'archived' },
    });
    return { storeId, status: 'archived' };
  }

  // 치운(archived) 판매자만 복구한다. 치우기 전 상태(archivedFromStatus)로 되돌리고, 없으면 active.
  async restoreStore(storeId: string, actorId: string) {
    const ref = this.firestore.doc(`stores/${storeId}`);
    const restoredStatus = await this.firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new NotFoundException('스토어를 찾을 수 없습니다.');
      const data = snap.data() ?? {};
      if (data['status'] !== 'archived') {
        throw new ConflictException('치운 판매자만 복구할 수 있습니다.');
      }

      const status = restorableStoreStatus(data['archivedFromStatus']);
      tx.update(ref, {
        status,
        archivedAt: this.firestore.FieldValue.delete(),
        archivedFromStatus: this.firestore.FieldValue.delete(),
        updatedAt: this.firestore.Timestamp.now(),
      });
      return status;
    });

    await this.recordAdmin({
      action: 'admin.store.restored',
      actorId,
      targetType: 'store',
      targetId: storeId,
      before: { status: 'archived' },
      after: { status: restoredStatus },
    });
    return { storeId, status: restoredStatus };
  }

  // ── Users ────────────────────────────────────────────────────────

  async getUsers() {
    const snap = await (
      this.firestore
        .collection('users')
        .where('role', '==', 'consumer')
        .orderBy('createdAt', 'desc') as any
    ).get();

    // 탈퇴한 소비자(개인정보를 지운 문서)는 목록에서 뺀다. 문서는 주문·결제 참조 때문에 남아 있다.
    const active = snap.docs.filter((d: any) => !isWithdrawnUser(d.data()));
    return {
      users: active.map((d: any) => pickListFields(d.data(), ADMIN_USER_LIST_FIELDS)),
      total: active.length,
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

    // 최신순. (storeId|status, createdAt DESC) 인덱스를 쓰고, 이어받기는 앞 응답 마지막 문서 다음부터.
    query = query.orderBy('createdAt', 'desc');
    if (dto.cursor !== undefined) {
      query = query.startAfter(await readAdminListCursor(this.firestore, 'orders', dto.cursor));
    }

    const limit = resolveAdminListLimit(
      dto.limit,
      ADMIN_ORDER_LIST_DEFAULT_LIMIT,
      ADMIN_ORDER_LIST_MAX_LIMIT,
    );
    const snap = await query.limit(limit + 1).get();
    const docs = snap.docs.slice(0, limit);
    const hasMore = snap.docs.length > limit;
    const records = docs.map((d: any) => ({ id: d.id, ...d.data() }) as Record<string, unknown>);
    const storeNames = await readStoreNames(this.firestore, records.map((order) => order['storeId']));
    const orders = records.map((order) => toAdminOrderRow(order, storeNames));

    // total = 이번 응답에 담긴 건수. hasMore/nextCursor로 다음 쪽을 이어 받는다.
    return {
      orders,
      total: orders.length,
      hasMore,
      nextCursor: hasMore ? (docs[docs.length - 1].id as string) : null,
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
      result = await this.forceLegacyRefund(orderId, reason, order);
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
    before: Record<string, any>,
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

    // 회차 주문(cancelForRound customerNotice)과 같은 안내를 환불이 끝까지 확정된 뒤에만 보낸다.
    if (this.wasPaidBeforeLegacyRefund(before)) {
      await this.sendAdminRefundNotice(before, orderId);
    }
    return { ok: true, orderId, ...recovery };
  }

  // 이미 취소가 끝났던 주문(상태 기록 없는 취소 포함)은 안내하지 않는다. 실패한 환불을 다시
  // 처리하는 경우는 안내가 안 갔을 수 있어 보내고, 멱등 키로 중복을 막는다(회차 주문과 같은 기준).
  private wasPaidBeforeLegacyRefund(order: Record<string, any>): boolean {
    if (order['status'] === 'PENDING') return false;
    if (order['status'] === 'CANCELLED') {
      const cancellationStatus = order['cancellation']?.['status'];
      return cancellationStatus != null && cancellationStatus !== 'COMPLETED';
    }
    return true;
  }

  private async sendAdminRefundNotice(order: Record<string, any>, orderId: string) {
    if (!this.notifications || typeof order['userId'] !== 'string') return;
    try {
      await this.notifications.sendToUser(
        order['userId'],
        'ORDER_CANCELLED',
        {
          orderId: customerOrderLabel(order, orderId),
          reason: REFUND_NOTICE_REASONS.ADMIN_REFUND,
        },
        orderId,
        refundNoticeIdempotencyKey('ADMIN_REFUND', orderId),
      );
    } catch {
      // 안내 실패가 이미 끝난 환불을 되돌리지 않는다. 발송 실패는 알림 서비스가 운영 이슈로 남긴다.
    }
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

  // 목록은 "더 보기"로 이어 받고(hasMore·nextCursor), 행에 가게 이름·주문번호·보류 사유·회수 필드,
  // 지급 대상(confirmed) 행에는 정산 계좌를 붙인다. 합계는 getSettlementsSummary가 같은 조건 전체로 계산한다.
  getSettlements(dto: QueryAdminSettlementsDto) {
    return listAdminSettlements(this.firestore, dto);
  }

  getSettlementsSummary(dto: AdminSettlementFilterDto) {
    return summarizeAdminSettlements(this.firestore, dto);
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
    // 가입 최신순으로 한 쪽씩 읽는다((role, createdAt DESC) 인덱스). 상태 필터는 읽은 쪽 안에서 거르므로
    // 걸러진 결과가 한 쪽보다 적어도 hasMore가 true면 "더 보기"로 이어 받는다.
    let query = this.firestore
      .collection('users')
      .where('role', '==', 'driver')
      .orderBy('createdAt', 'desc') as any;
    if (dto.cursor !== undefined) {
      query = query.startAfter(
        await readAdminListCursor(
          this.firestore,
          'users',
          dto.cursor,
          (data) => data['role'] === 'driver',
        ),
      );
    }

    const limit = resolveAdminListLimit(
      dto.limit,
      ADMIN_DRIVER_LIST_DEFAULT_LIMIT,
      ADMIN_DRIVER_LIST_MAX_LIMIT,
    );
    const snap = await query.limit(limit + 1).get();
    const docs = snap.docs.slice(0, limit);
    const hasMore = snap.docs.length > limit;

    let drivers = docs.map((d: any) =>
      pickListFields({ id: d.id, ...d.data() }, ADMIN_DRIVER_LIST_FIELDS),
    );

    if (dto.status === 'pending') {
      drivers = drivers.filter((d: any) => !d.driverApproved && !d.suspended);
    } else if (dto.status === 'approved') {
      drivers = drivers.filter((d: any) => d.driverApproved && !d.suspended);
    } else if (dto.status === 'suspended') {
      drivers = drivers.filter((d: any) => d.suspended);
    }

    return {
      drivers,
      total: drivers.length,
      hasMore,
      nextCursor: hasMore ? (docs[docs.length - 1].id as string) : null,
    };
  }

  async approveDriver(userId: string, actorId: string) {
    const ref = this.firestore.doc(`users/${userId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('드라이버를 찾을 수 없습니다.');

    const data = snap.data()!;
    if (data['role'] !== 'driver') {
      throw new BadRequestException('드라이버 계정이 아닙니다.');
    }
    // 승인 대기(목록의 pending 판정과 같은 기준)만 승인한다. 정지된 기사를 승인으로 되살리지 않는다.
    if (data['suspended'] === true) {
      throw new ConflictException('정지된 기사는 승인할 수 없습니다. 먼저 정지를 풀어 주세요.');
    }
    if (data['driverApproved'] === true) {
      throw new ConflictException('이미 승인된 기사입니다.');
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
