import { ConflictException, NotFoundException } from '@nestjs/common';
import type { FirestoreService } from '../firestore/firestore.service';

export type InviteRevokeReason = 'already_used' | 'already_revoked' | 'expired';
export type InviteRollbackReason =
  | 'not_used'
  | 'already_rolled_back'
  | 'user_not_found'
  | 'not_seller'
  | 'store_not_found'
  | 'store_has_records';

type InviteData = {
  usedAt?: unknown;
  usedBy?: unknown;
  revokedAt?: unknown;
  expiresAt?: unknown;
  sellerRollbackAt?: unknown;
};

const INVITE_REVOKE_REASON_MESSAGE: Record<InviteRevokeReason, string> = {
  already_used: '이미 사용된 초대 토큰입니다.',
  already_revoked: '이미 취소된 초대 토큰입니다.',
  expired: '만료된 초대 토큰입니다.',
};

const INVITE_ROLLBACK_REASON_MESSAGE: Record<InviteRollbackReason, string> = {
  not_used: '아직 사용되지 않은 초대 토큰입니다.',
  already_rolled_back: '이미 되돌린 초대 토큰입니다.',
  user_not_found: '초대 토큰과 연결된 사용자를 찾을 수 없습니다.',
  not_seller: '판매자 계정에 사용된 초대 토큰이 아닙니다.',
  store_not_found: '판매자와 연결된 스토어를 찾을 수 없습니다.',
  store_has_records: '주문·정산 기록이 있는 판매자는 초대 탭에서 되돌릴 수 없습니다.',
};

export async function revokeInviteToken(
  firestore: FirestoreService,
  token: string,
  adminId: string,
) {
  const ref = firestore.doc(`invites/${token}`);

  await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new NotFoundException('초대 토큰을 찾을 수 없습니다.');

    const invite = snap.data();
    if (!invite) throw new NotFoundException('초대 토큰을 찾을 수 없습니다.');

    const reason = getInviteRevokeBlockReason(invite);
    if (reason) throw createInviteRevokeConflict(reason);

    const now = firestore.Timestamp.now();
    tx.set(ref, { revokedAt: now, revokedBy: adminId }, { merge: true });
  });

  return { ok: true };
}

export async function rollbackInviteSellerAccount(
  firestore: FirestoreService,
  token: string,
  adminId: string,
) {
  const inviteRef = firestore.doc(`invites/${token}`);
  let rolledBackUserId = '';

  await firestore.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) throw new NotFoundException('초대 토큰을 찾을 수 없습니다.');

    const invite = inviteSnap.data();
    if (!invite) throw new NotFoundException('초대 토큰을 찾을 수 없습니다.');

    const userId = getInviteRollbackUserId(invite);
    const userRef = userId ? firestore.doc(`users/${userId}`) : null;
    const userSnap = userRef ? await tx.get(userRef) : null;
    const reason = getInviteRollbackBlockReason(invite, userSnap);
    if (reason) throw createInviteRollbackConflict(reason);

    const userData = userSnap?.data();
    if (!userRef || !userData || typeof userId !== 'string') {
      throw createInviteRollbackConflict('user_not_found');
    }

    const storeId =
      typeof userData.storeId === 'string' && userData.storeId.trim() ? userData.storeId : null;
    const storeRef = storeId ? firestore.doc(`stores/${storeId}`) : null;
    const storeSnap = storeRef ? await tx.get(storeRef) : null;
    if (storeRef && !storeSnap?.exists) throw createInviteRollbackConflict('store_not_found');

    if (storeId) {
      const [orderSnap, settlementSnap] = await Promise.all([
        tx.get(firestore.collection('orders').where('storeId', '==', storeId).limit(1) as any),
        tx.get(firestore.collection('settlements').where('storeId', '==', storeId).limit(1) as any),
      ]);
      if (!orderSnap.empty || !settlementSnap.empty) {
        throw createInviteRollbackConflict('store_has_records');
      }
    }

    const now = firestore.Timestamp.now();
    tx.update(userRef, {
      suspended: true,
      sellerRolledBackAt: now,
      sellerRolledBackBy: adminId,
      updatedAt: now,
    });
    if (storeRef) {
      tx.update(storeRef, {
        status: 'archived',
        archivedAt: now,
        archivedBy: adminId,
        archiveReason: 'invite_seller_rollback',
        updatedAt: now,
      });
    }
    tx.set(inviteRef, { sellerRollbackAt: now, sellerRollbackBy: adminId }, { merge: true });
    tx.delete(firestore.doc(`refreshTokens/${userId}`));
    rolledBackUserId = userId;
  });

  return { ok: true, userId: rolledBackUserId };
}

function getInviteRevokeBlockReason(invite: InviteData): InviteRevokeReason | null {
  if (invite.usedAt !== null && invite.usedAt !== undefined) return 'already_used';
  if (invite.revokedAt !== null && invite.revokedAt !== undefined) return 'already_revoked';
  const expiresAtMs = toInviteExpiresAtMs(invite.expiresAt);
  if (Number.isFinite(expiresAtMs) && expiresAtMs < Date.now()) return 'expired';
  return null;
}

function getInviteRollbackUserId(invite: InviteData): string | null {
  return typeof invite.usedBy === 'string' && invite.usedBy.trim() ? invite.usedBy : null;
}

function getInviteRollbackBlockReason(
  invite: InviteData,
  userSnap: { exists?: boolean; data?: () => Record<string, unknown> | undefined } | null,
): InviteRollbackReason | null {
  if (invite.usedAt === null || invite.usedAt === undefined) return 'not_used';
  if (invite.sellerRollbackAt !== null && invite.sellerRollbackAt !== undefined) {
    return 'already_rolled_back';
  }
  if (!getInviteRollbackUserId(invite) || !userSnap?.exists) return 'user_not_found';

  const user = userSnap.data?.();
  if (!user || user.role !== 'seller') return 'not_seller';
  return null;
}

function toInviteExpiresAtMs(value: unknown): number {
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    const toMillis = (value as { toMillis?: unknown }).toMillis;
    return typeof toMillis === 'function' ? toMillis() : Number.NaN;
  }
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
    return new Date(value).getTime();
  }
  return Number.NaN;
}

function createInviteRevokeConflict(reason: InviteRevokeReason) {
  return new ConflictException({
    message: INVITE_REVOKE_REASON_MESSAGE[reason],
    reason,
  });
}

function createInviteRollbackConflict(reason: InviteRollbackReason) {
  return new ConflictException({
    message: INVITE_ROLLBACK_REASON_MESSAGE[reason],
    reason,
  });
}
