import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
// biome-ignore lint/style/useImportType: Nest DI가 생성자 메타데이터에서 클래스 값을 사용한다.
import { FirestoreService } from '../firestore/firestore.service';
import type { CreateHubDto, CreateHubStaffInviteDto, UpdateHubDto } from './dto/create-hub.dto';

type RequesterRole = JwtPayload['role'];
type HubData = Record<string, unknown> & {
  id?: string;
  storeId?: string;
  staffIds?: string[];
};
type HubStaffUserData = Record<string, unknown> & {
  id?: string;
  name?: string | null;
  email?: string | null;
  role?: string;
  storeId?: string | null;
  hubId?: string | null;
  hubIds?: string[];
  suspended?: boolean;
};
type HubRequesterScope = {
  storeId?: string | null;
  hubId?: string | null;
  hubIds?: string[];
};

const DEFAULT_STAFF_INVITE_EXPIRY_DAYS = 7;

@Injectable()
export class HubsService {
  constructor(private readonly firestore: FirestoreService) {}

  async getHubs(
    storeId: string,
    requesterId: string,
    role: RequesterRole,
    scope?: HubRequesterScope,
  ) {
    this.assertHubStaffScope(storeId, undefined, role, scope);
    if (role !== 'hub_staff') {
      await this.verifySellerOwnership(storeId, requesterId);
    }

    const snap = await (
      this.firestore
        .collection('hubs')
        .where('storeId', '==', storeId)
        .orderBy('createdAt', 'asc') as any
    ).get();

    const hubs = snap.docs.map((d: any) => d.data() as HubData);
    if (role === 'hub_staff') {
      return {
        hubs: hubs.filter(
          (hub) =>
            this.isAssignedHubStaff(hub, requesterId) &&
            (this.getScopedHubIds(scope).length === 0 ||
              this.hasScopedHub(scope, String(hub.id ?? ''))),
        ),
      };
    }
    return { hubs };
  }

  async getHub(
    storeId: string,
    hubId: string,
    requesterId: string,
    role: RequesterRole,
    scope?: HubRequesterScope,
  ) {
    this.assertHubStaffScope(storeId, hubId, role, scope);
    const hub = await this.verifyHubReadAccess(storeId, hubId, requesterId, role);
    return hub;
  }

  async createHub(storeId: string, requesterId: string, role: RequesterRole, dto: CreateHubDto) {
    await this.verifySellerOwnership(storeId, requesterId, role);

    const hubId = uuidv4();
    const now = this.firestore.Timestamp.now();

    await this.firestore.doc(`hubs/${hubId}`).set({
      id: hubId,
      storeId,
      name: dto.name,
      address: dto.address,
      addressDetail: dto.addressDetail ?? null,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      operatingHours: dto.operatingHours ?? null,
      staffIds: [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return { id: hubId };
  }

  async updateHub(
    storeId: string,
    hubId: string,
    requesterId: string,
    role: RequesterRole,
    dto: UpdateHubDto,
  ) {
    await this.verifySellerOwnership(storeId, requesterId, role);

    const snap = await this.firestore.doc(`hubs/${hubId}`).get();
    const hub = snap.data() as HubData | undefined;
    if (!snap.exists || hub?.storeId !== storeId) {
      throw new NotFoundException('거점을 찾을 수 없습니다');
    }

    const update: Record<string, unknown> = {
      updatedAt: this.firestore.FieldValue.serverTimestamp(),
    };

    if (dto.name !== undefined) update.name = dto.name;
    if (dto.address !== undefined) update.address = dto.address;
    if (dto.addressDetail !== undefined) update.addressDetail = dto.addressDetail;
    if (dto.lat !== undefined) update.lat = dto.lat;
    if (dto.lng !== undefined) update.lng = dto.lng;
    if (dto.operatingHours !== undefined) update.operatingHours = dto.operatingHours;
    if (dto.isActive !== undefined) update.isActive = dto.isActive;

    await this.firestore.doc(`hubs/${hubId}`).update(update);

    return { id: hubId };
  }

  async getHubOrders(
    storeId: string,
    hubId: string,
    requesterId: string,
    role: RequesterRole,
    status?: string,
    scope?: HubRequesterScope,
  ) {
    this.assertHubStaffScope(storeId, hubId, role, scope);
    await this.verifyHubReadAccess(storeId, hubId, requesterId, role);

    // hubId 단일 필드 쿼리 (자동 인덱스) — status는 앱 레이어 필터 (복합 인덱스 불필요)
    const snap = await (
      this.firestore.collection('orders').where('hubId', '==', hubId) as any
    ).get();

    let orders = snap.docs.map((d: any) => d.data());
    if (status) {
      orders = orders.filter((o: any) => o.status === status);
    }

    return { orders };
  }

  async createHubStaffInvite(
    storeId: string,
    hubId: string,
    requesterId: string,
    role: RequesterRole,
    dto: CreateHubStaffInviteDto,
  ) {
    await this.verifySellerOwnership(storeId, requesterId, role);

    const hubSnap = await this.firestore.doc(`hubs/${hubId}`).get();
    const hub = hubSnap.data() as HubData | undefined;
    if (!hubSnap.exists || hub?.storeId !== storeId) {
      throw new NotFoundException('거점을 찾을 수 없습니다');
    }

    const token = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
    const now = this.firestore.Timestamp.now();
    const expiresAt = typeof now.toDate === 'function' ? now.toDate() : new Date();
    expiresAt.setDate(
      expiresAt.getDate() + (dto.expiresInDays ?? DEFAULT_STAFF_INVITE_EXPIRY_DAYS),
    );

    await this.firestore.doc(`hubStaffInvites/${token}`).set({
      token,
      storeId,
      hubId,
      createdBy: requesterId,
      usedAt: null,
      usedBy: null,
      expiresAt: this.firestore.Timestamp.fromDate(expiresAt),
      createdAt: now,
    });

    const baseUrl =
      process.env.SELLER_APP_URL ?? process.env.SELLER_URL ?? 'https://seller.greenlove.co.kr';
    return {
      token,
      inviteUrl: `${baseUrl.replace(/\/$/, '')}/staff-invite?token=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getHubStaff(storeId: string, hubId: string, requesterId: string, role: RequesterRole) {
    await this.verifySellerOwnership(storeId, requesterId, role);
    const hub = await this.getOwnedHub(storeId, hubId);
    const staffIds = Array.isArray(hub.staffIds) ? hub.staffIds : [];

    const staff = await Promise.all(
      staffIds.map(async (staffId) => {
        const snap = await this.firestore.doc(`users/${staffId}`).get();
        const user = snap.data() as HubStaffUserData | undefined;
        if (
          !snap.exists ||
          user?.role !== 'hub_staff' ||
          user.storeId !== storeId ||
          !this.userHasHub(user, hubId)
        ) {
          return null;
        }
        return {
          id: staffId,
          name: user.name ?? null,
          email: user.email ?? null,
          suspended: user.suspended === true,
        };
      }),
    );

    return { staff: staff.filter((item) => item !== null) };
  }

  async getHubStaffCandidates(
    storeId: string,
    hubId: string,
    requesterId: string,
    role: RequesterRole,
  ) {
    await this.verifySellerOwnership(storeId, requesterId, role);
    const hub = await this.getOwnedHub(storeId, hubId);
    const assignedStaffIds = new Set(Array.isArray(hub.staffIds) ? hub.staffIds : []);
    const snap = await (
      this.firestore.collection('users').where('role', '==', 'hub_staff') as any
    ).get();

    const staff = snap.docs
      .map((doc: any) => doc.data() as HubStaffUserData)
      .filter((user) => {
        const id = String(user.id ?? '');
        return (
          id && user.storeId === storeId && user.suspended !== true && !assignedStaffIds.has(id)
        );
      })
      .map((user) => ({
        id: String(user.id),
        name: user.name ?? null,
        email: user.email ?? null,
        hubIds: this.getUserHubIds(user),
      }));

    return { staff };
  }

  async assignHubStaff(
    storeId: string,
    hubId: string,
    staffId: string,
    requesterId: string,
    role: RequesterRole,
  ) {
    await this.verifySellerOwnership(storeId, requesterId, role);
    const hub = await this.getOwnedHub(storeId, hubId);
    if (this.isAssignedHubStaff(hub, staffId)) {
      return { id: staffId };
    }

    const userSnap = await this.firestore.doc(`users/${staffId}`).get();
    const user = userSnap.data() as HubStaffUserData | undefined;
    if (
      !userSnap.exists ||
      user?.role !== 'hub_staff' ||
      user.storeId !== storeId ||
      user.suspended === true
    ) {
      throw new NotFoundException('諛곗젙 媛?ν븳 ?ㅽ깭?꾨? 李얠쓣 ???놁뒿?덈떎');
    }

    const hubIds = this.getUserHubIds(user);
    const nextHubIds = Array.from(new Set([...hubIds, hubId]));
    const now = this.firestore.Timestamp.now();

    await this.firestore.doc(`hubs/${hubId}`).update({
      staffIds: this.firestore.FieldValue.arrayUnion(staffId),
      updatedAt: now,
    });
    await this.firestore.doc(`users/${staffId}`).update({
      hubId: nextHubIds[0] ?? hubId,
      hubIds: nextHubIds,
      updatedAt: now,
    });

    return { id: staffId };
  }

  async revokeHubStaff(
    storeId: string,
    hubId: string,
    staffId: string,
    requesterId: string,
    role: RequesterRole,
  ) {
    await this.verifySellerOwnership(storeId, requesterId, role);
    const hub = await this.getOwnedHub(storeId, hubId);
    if (!this.isAssignedHubStaff(hub, staffId)) {
      throw new NotFoundException('배정된 스태프를 찾을 수 없습니다');
    }

    const userSnap = await this.firestore.doc(`users/${staffId}`).get();
    const user = userSnap.data() as HubStaffUserData | undefined;
    if (
      !userSnap.exists ||
      user?.role !== 'hub_staff' ||
      user.storeId !== storeId ||
      !this.userHasHub(user, hubId)
    ) {
      throw new NotFoundException('배정된 스태프를 찾을 수 없습니다');
    }

    const now = this.firestore.Timestamp.now();
    const remainingHubIds = this.getUserHubIds(user).filter((id) => id !== hubId);
    await this.firestore.doc(`hubs/${hubId}`).update({
      staffIds: this.firestore.FieldValue.arrayRemove(staffId),
      updatedAt: now,
    });
    await this.firestore.doc(`users/${staffId}`).update({
      hubId: remainingHubIds[0] ?? null,
      hubIds: remainingHubIds,
      ...(remainingHubIds.length === 0
        ? {
            suspended: true,
            hubStaffRevokedAt: now,
            hubStaffRevokedBy: requesterId,
          }
        : {}),
      updatedAt: now,
    });
    if (remainingHubIds.length === 0) {
      await this.firestore.doc(`refreshTokens/${staffId}`).delete();
    }
  }

  async deleteHub(storeId: string, hubId: string, requesterId: string, role: RequesterRole) {
    await this.verifySellerOwnership(storeId, requesterId, role);

    const snap = await this.firestore.doc(`hubs/${hubId}`).get();
    const hub = snap.data() as HubData | undefined;
    if (!snap.exists || hub?.storeId !== storeId) {
      throw new NotFoundException('거점을 찾을 수 없습니다');
    }

    await this.firestore.doc(`hubs/${hubId}`).delete();
  }

  private async verifySellerOwnership(storeId: string, requesterId: string, role?: RequesterRole) {
    if (role && role !== 'seller') {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    }

    const storeSnap = await this.firestore.doc(`stores/${storeId}`).get();
    const store = storeSnap.data() as { ownerId?: string } | undefined;
    if (!storeSnap.exists || store?.ownerId !== requesterId) {
      throw new ForbiddenException('해당 스토어에 대한 권한이 없습니다');
    }
  }

  private async verifyHubReadAccess(
    storeId: string,
    hubId: string,
    requesterId: string,
    role: RequesterRole,
  ) {
    const snap = await this.firestore.doc(`hubs/${hubId}`).get();
    const hub = snap.data() as HubData | undefined;
    if (!snap.exists || hub?.storeId !== storeId) {
      throw new NotFoundException('거점을 찾을 수 없습니다');
    }

    if (role === 'hub_staff') {
      if (!this.isAssignedHubStaff(hub, requesterId)) {
        throw new ForbiddenException('해당 거점에 대한 권한이 없습니다');
      }
      return hub;
    }

    await this.verifySellerOwnership(storeId, requesterId, role);
    return hub;
  }

  private isAssignedHubStaff(hub: HubData, requesterId: string): boolean {
    return Array.isArray(hub.staffIds) && hub.staffIds.includes(requesterId);
  }

  private assertHubStaffScope(
    storeId: string,
    hubId: string | undefined,
    role: RequesterRole,
    scope?: HubRequesterScope,
  ) {
    if (role !== 'hub_staff') return;
    if (!scope) return;
    if (scope?.storeId !== storeId) {
      throw new ForbiddenException('?대떦 ?ㅽ넗?댁뿉 ???沅뚰븳???놁뒿?덈떎');
    }
    if (hubId && !this.hasScopedHub(scope, hubId)) {
      throw new ForbiddenException('?대떦 嫄곗젏?????沅뚰븳???놁뒿?덈떎');
    }
  }

  private getScopedHubIds(scope?: HubRequesterScope): string[] {
    if (Array.isArray(scope?.hubIds) && scope.hubIds.length > 0) {
      return scope.hubIds.filter((id): id is string => typeof id === 'string' && !!id);
    }
    return scope?.hubId ? [scope.hubId] : [];
  }

  private hasScopedHub(scope: HubRequesterScope | undefined, hubId: string): boolean {
    return this.getScopedHubIds(scope).includes(hubId);
  }

  private getUserHubIds(user: HubStaffUserData): string[] {
    if (Array.isArray(user.hubIds) && user.hubIds.length > 0) {
      return user.hubIds.filter((id): id is string => typeof id === 'string' && !!id);
    }
    return user.hubId ? [user.hubId] : [];
  }

  private userHasHub(user: HubStaffUserData, hubId: string): boolean {
    return this.getUserHubIds(user).includes(hubId);
  }

  private async getOwnedHub(storeId: string, hubId: string) {
    const snap = await this.firestore.doc(`hubs/${hubId}`).get();
    const hub = snap.data() as HubData | undefined;
    if (!snap.exists || hub?.storeId !== storeId) {
      throw new NotFoundException('거점을 찾을 수 없습니다');
    }
    return hub;
  }
}
