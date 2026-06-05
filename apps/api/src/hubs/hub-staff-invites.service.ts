import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FirestoreService } from '../firestore/firestore.service';

type RequesterRole = 'consumer' | 'seller' | 'driver' | 'hub_staff' | 'admin';
type HubData = Record<string, unknown> & {
  storeId?: string;
};
type HubStaffInviteData = Record<string, unknown> & {
  token?: string;
  storeId?: string;
  hubId?: string;
  usedAt?: unknown;
  revokedAt?: unknown;
  expiresAt?: unknown;
  createdAt?: unknown;
};

@Injectable()
export class HubStaffInvitesService {
  constructor(private readonly firestore: FirestoreService) {}

  async getHubStaffInvites(
    storeId: string,
    hubId: string,
    requesterId: string,
    role: RequesterRole,
  ) {
    await this.verifySellerOwnership(storeId, requesterId, role);
    await this.verifyOwnedHub(storeId, hubId);

    const snap = await (
      this.firestore
        .collection('hubStaffInvites')
        .where('storeId', '==', storeId)
        .where('hubId', '==', hubId)
        .orderBy('createdAt', 'desc') as any
    ).get();

    return {
      invites: snap.docs.map((doc: any) => {
        const invite = doc.data() as HubStaffInviteData;
        const token = String(invite.token ?? '');
        return {
          token,
          inviteUrl: this.buildInviteUrl(token),
          expiresAt: this.toIso(invite.expiresAt),
          createdAt: this.toIso(invite.createdAt),
          usedAt: this.toIso(invite.usedAt),
          revokedAt: this.toIso(invite.revokedAt),
        };
      }),
    };
  }

  async revokeHubStaffInvite(
    storeId: string,
    hubId: string,
    token: string,
    requesterId: string,
    role: RequesterRole,
  ) {
    await this.verifySellerOwnership(storeId, requesterId, role);
    await this.verifyOwnedHub(storeId, hubId);

    const inviteRef = this.firestore.doc(`hubStaffInvites/${token}`);
    const inviteSnap = await inviteRef.get();
    const invite = inviteSnap.data() as HubStaffInviteData | undefined;
    if (!inviteSnap.exists || invite?.storeId !== storeId || invite.hubId !== hubId) {
      throw new NotFoundException('스태프 초대를 찾을 수 없습니다');
    }
    if (invite.usedAt) {
      throw new ConflictException('이미 사용된 초대는 취소할 수 없습니다');
    }
    if (invite.revokedAt) {
      throw new ConflictException('이미 취소된 초대입니다');
    }
    if (this.isExpired(invite.expiresAt)) {
      throw new ConflictException('만료된 초대는 취소할 수 없습니다');
    }

    const now = this.firestore.Timestamp.now();
    await inviteRef.update({
      revokedAt: now,
      revokedBy: requesterId,
      updatedAt: now,
    });
  }

  private async verifySellerOwnership(storeId: string, requesterId: string, role: RequesterRole) {
    if (role !== 'seller') {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    }

    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    const store = storeSnap.data() as { ownerId?: string } | undefined;
    if (!storeSnap.exists || store?.ownerId !== requesterId) {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    }
  }

  private async verifyOwnedHub(storeId: string, hubId: string) {
    const hubSnap = await this.firestore.doc(`hubs/${hubId}`).get();
    const hub = hubSnap.data() as HubData | undefined;
    if (!hubSnap.exists || hub?.storeId !== storeId) {
      throw new NotFoundException('거점을 찾을 수 없습니다');
    }
  }

  private isExpired(value: unknown): boolean {
    const date = this.toDate(value);
    return !!date && date.getTime() <= Date.now();
  }

  private toIso(value: unknown): string | null {
    const date = this.toDate(value);
    return date ? date.toISOString() : null;
  }

  private toDate(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
      return value.toDate();
    }
    return null;
  }

  private buildInviteUrl(token: string): string {
    const baseUrl =
      process.env.SELLER_APP_URL ?? process.env.SELLER_URL ?? 'https://seller.greenlove.co.kr';
    return `${baseUrl.replace(/\/$/, '')}/staff-invite?token=${token}`;
  }
}
