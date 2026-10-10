import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../../firestore/firestore.service';

export type AuditAction =
  | 'auth.login.failed'
  | 'auth.login.suspended'
  | 'auth.logout'
  | 'auth.token.stolen' // refresh token 재사용 감지
  | 'auth.kakao.forbidden'
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
    const id = uuidv4();
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
}
