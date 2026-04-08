import { Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { FirestoreService } from '../../firestore/firestore.service';

export type AuditAction =
  | 'auth.login.success'
  | 'auth.login.failed'
  | 'auth.logout'
  | 'auth.token.stolen'           // refresh token 재사용 감지
  | 'auth.kakao.success'
  | 'auth.kakao.forbidden'
  | 'payment.completed'
  | 'payment.refunded'
  | 'payment.amount_tampered'     // 금액 위변조 감지
  | 'payment.webhook.invalid_sig' // 서명 검증 실패
  | 'access.forbidden';           // 권한 없는 접근 시도

export interface AuditLog {
  id: string;
  action: AuditAction;
  userId?: string;
  ip?: string;
  detail?: Record<string, unknown>;
  createdAt: unknown;
}

@Injectable()
export class AuditService {
  constructor(private readonly firestore: FirestoreService) {}

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
      detail: opts.detail ?? null,
      createdAt: this.firestore.Timestamp.now(),
    });
  }
}
