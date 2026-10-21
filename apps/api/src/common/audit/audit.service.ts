import { createHmac, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type * as admin from 'firebase-admin';
import { FirestoreService } from '../../firestore/firestore.service';

export type AuditAction =
  | 'auth.login.failed'
  | 'auth.login.suspended'
  | 'auth.logout'
  | 'auth.token.stolen' // refresh token 재사용 감지
  | 'auth.kakao.forbidden'
  | 'auth.withdrawn' // 소비자 회원 탈퇴(개인정보 익명화·세션 폐기)
  | 'payment.amount_tampered' // 금액 위변조 감지
  | 'payment.webhook.invalid_sig'; // 서명 검증 실패

export interface AuditLog {
  id: string;
  action: AuditAction;
  userId?: string;
  ip?: string;
  detail?: Record<string, unknown>;
  createdAt: unknown;
}

// 어드민이 운영 데이터를 바꾼 기록. 보안 사건 기록(auditLogs)과 섞지 않고 adminAuditLogs에 둔다.
// createdAt 단일 정렬만 쓰므로 복합 인덱스가 필요 없다.
export const ADMIN_AUDIT_COLLECTION = 'adminAuditLogs';
export const ADMIN_AUDIT_LIST_LIMIT = 100;

export type AdminAuditAction =
  | 'admin.store.commission_changed'
  | 'admin.store.archived'
  | 'admin.store.restored'
  | 'admin.user.suspended'
  | 'admin.user.unsuspended'
  | 'admin.driver.approved'
  | 'admin.driver.suspended'
  | 'admin.driver.unsuspended'
  | 'admin.order.force_refunded'
  | 'admin.order.post_delivery_refunded'
  | 'admin.settlement.paid'
  | 'admin.banner.updated'
  | 'admin.partner_inquiry.contacted'
  | 'admin.partner_inquiry.deleted'
  // 판매자(또는 관리자)가 정산 계좌를 저장. 계좌번호는 끝 4자리만 남긴다.
  | 'store.payout_account.updated';

export type AdminAuditTargetType =
  | 'store'
  | 'user'
  | 'driver'
  | 'order'
  | 'settlement'
  | 'banner'
  | 'partner_inquiry';

export interface AdminAuditEntry {
  action: AdminAuditAction;
  actorId: string;
  targetType: AdminAuditTargetType;
  targetId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
}

const EMAIL_HMAC_KEY_CONTEXT = 'greenhub:audit:email:v1';

/**
 * 감사 로그 detail의 이메일 원문을 저장하지 않는다.
 * - userId가 있으면 그 사용자를 이미 식별하므로 이메일을 버린다.
 * - userId가 없으면(없는 계정 등) 같은 입력끼리만 묶을 수 있도록 keyed HMAC(`emailHmac`)만 남긴다.
 * - HMAC 키가 없으면 이메일을 버린다.
 */
export function minimizeAuditDetail(
  detail: Record<string, unknown> | undefined,
  opts: { userId?: string; emailHmacKey: Buffer | null },
): Record<string, unknown> | null {
  if (!detail) return null;
  if (!Object.hasOwn(detail, 'email')) return detail;

  const { email, ...rest } = detail;
  if (opts.userId || !opts.emailHmacKey || typeof email !== 'string') return rest;

  const normalized = email.trim().toLowerCase();
  return {
    ...rest,
    emailHmac: createHmac('sha256', opts.emailHmacKey).update(normalized).digest('hex'),
  };
}

@Injectable()
export class AuditService {
  private readonly emailHmacKey: Buffer | null;

  constructor(
    private readonly firestore: FirestoreService,
    config: ConfigService,
  ) {
    // 별도 비밀값을 늘리지 않고 서버 서명 secret에서 용도별 키를 파생한다.
    const secret = config.get<string>('JWT_SECRET')?.trim();
    this.emailHmacKey = secret
      ? createHmac('sha256', secret).update(EMAIL_HMAC_KEY_CONTEXT).digest()
      : null;
  }

  async log(
    action: AuditAction,
    opts: { userId?: string; ip?: string; detail?: Record<string, unknown> } = {},
  ): Promise<void> {
    const id = randomUUID();
    await this.firestore.doc(`auditLogs/${id}`).set({
      id,
      action,
      userId: opts.userId ?? null,
      ip: opts.ip ?? null,
      detail: minimizeAuditDetail(opts.detail, {
        userId: opts.userId,
        emailHmacKey: this.emailHmacKey,
      }),
      createdAt: this.firestore.Timestamp.now(),
    });
  }

  /**
   * 어드민 행동 1건을 남긴다. tx를 주면 같은 트랜잭션에 함께 쓴다(작업과 기록이 함께 커밋되거나 함께 취소).
   * 고객 이름·전화·주소는 넣지 않는다. 대상은 ID로만 가리킨다.
   */
  async logAdmin(entry: AdminAuditEntry, tx?: admin.firestore.Transaction): Promise<void> {
    const id = randomUUID();
    const ref = this.firestore.doc(`${ADMIN_AUDIT_COLLECTION}/${id}`);
    const record = {
      id,
      action: entry.action,
      actorId: entry.actorId,
      targetType: entry.targetType,
      targetId: entry.targetId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      reason: entry.reason?.trim() || null,
      createdAt: this.firestore.Timestamp.now(),
    };
    if (tx) {
      tx.set(ref, record);
      return;
    }
    await ref.set(record);
  }

  async listAdmin(limit = ADMIN_AUDIT_LIST_LIMIT): Promise<Record<string, unknown>[]> {
    const snap = await this.firestore
      .collection(ADMIN_AUDIT_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => d.data());
  }
}
