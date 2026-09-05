import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';
import { getAllowedTransitions } from './orders.helpers';
import type { OrderStatus } from './dto/update-status.dto';

type OrderRecord = Record<string, any>;

type DocumentSnapshotLike = {
  exists: boolean;
  id?: string;
  data(): OrderRecord | undefined;
};

type TransactionLike = {
  get(ref: unknown): Promise<DocumentSnapshotLike>;
};

export const DRIVER_VISIBLE_STATUSES = ['PREPARING', 'DELIVERING', 'DELIVERY_HELD'] as const;

export type DriverVisibleStatus = (typeof DRIVER_VISIBLE_STATUSES)[number];
export type DriverOrderMode = 'legacy' | 'round_direct';

export interface DriverAuthority {
  requesterId: string;
  role: 'driver';
  driverApproved: true;
}

export interface DriverOrderMutationInput {
  requesterId: string;
  requesterRole: string;
  storeId: string;
  order: OrderRecord;
  expectedStatus: string;
  nextStatus: string;
}

type ScopeEvaluation = {
  mode: DriverOrderMode | 'invalid';
  pilotBase: boolean;
};

@Injectable()
export class DriverOrderScopeService {
  constructor(private readonly firestore: FirestoreService) {}

  async assertDriverAuthority(
    requesterId: string,
    requesterRole = 'driver',
  ): Promise<DriverAuthority> {
    const snapshot = await this.firestore.doc(`users/${requesterId}`).get();
    return this.assertDriverAuthoritySnapshot(snapshot, requesterId, requesterRole);
  }

  async assertDriverAuthorityInTransaction(
    transaction: TransactionLike,
    requesterId: string,
    requesterRole = 'driver',
  ): Promise<DriverAuthority> {
    const snapshot = await transaction.get(this.firestore.doc(`users/${requesterId}`));
    return this.assertDriverAuthoritySnapshot(snapshot, requesterId, requesterRole);
  }

  async assertPilotBase(order: OrderRecord, targetStoreId: string): Promise<void> {
    const scope = await this.resolveScope(order, targetStoreId, (path) =>
      this.firestore.doc(path).get(),
    );
    this.assertPilotScope(scope);
  }

  async assertPilotBaseInTransaction(
    transaction: TransactionLike,
    order: OrderRecord,
    targetStoreId: string,
  ): Promise<void> {
    const scope = await this.resolveScope(order, targetStoreId, (path) =>
      transaction.get(this.firestore.doc(path)),
    );
    this.assertPilotScope(scope);
  }

  async isOrderVisible(
    order: OrderRecord,
    requesterId: string,
    authority?: DriverAuthority,
  ): Promise<boolean> {
    const verified = await this.authorityFor(requesterId, authority);
    const scope = await this.resolveScope(order, order['storeId'], (path) =>
      this.firestore.doc(path).get(),
    );
    if (!this.isUsableScope(scope)) return false;

    return (
      this.isDiscoveryEligibleForScope(scope, order) ||
      this.isAssignedVisibleForScope(scope, order, verified.requesterId)
    );
  }

  async isDiscoveryEligible(
    order: OrderRecord,
    requesterId: string,
    authority?: DriverAuthority,
  ): Promise<boolean> {
    await this.authorityFor(requesterId, authority);
    const scope = await this.resolveScope(order, order['storeId'], (path) =>
      this.firestore.doc(path).get(),
    );
    return this.isUsableScope(scope) && this.isDiscoveryEligibleForScope(scope, order);
  }

  async isAssignedVisible(
    order: OrderRecord,
    requesterId: string,
    authority?: DriverAuthority,
  ): Promise<boolean> {
    const verified = await this.authorityFor(requesterId, authority);
    const scope = await this.resolveScope(order, order['storeId'], (path) =>
      this.firestore.doc(path).get(),
    );
    return (
      this.isUsableScope(scope) &&
      this.isAssignedVisibleForScope(scope, order, verified.requesterId)
    );
  }

  async assertAssignedReadAccess(
    order: OrderRecord,
    requesterId: string,
    targetStoreId: unknown,
  ): Promise<DriverOrderMode> {
    const authority = await this.assertDriverAuthority(requesterId);
    const scope = await this.resolveScope(order, targetStoreId, (path) =>
      this.firestore.doc(path).get(),
    );
    if (
      !this.isUsableScope(scope) ||
      !this.isAssignedVisibleForScope(scope, order, authority.requesterId)
    ) {
      throw new ForbiddenException('파일럿 Driver 주문 조회 범위를 벗어났습니다.');
    }
    return scope.mode as DriverOrderMode;
  }

  async assertFirstClaimEligibility(input: DriverOrderMutationInput): Promise<DriverOrderMode> {
    const scope = await this.resolveScope(input.order, input.storeId, (path) =>
      this.firestore.doc(path).get(),
    );
    if (scope.mode === 'round_direct') {
      await this.assertDriverAuthority(input.requesterId, input.requesterRole);
    }
    this.assertUsableScope(scope);
    this.assertFirstClaimRules(input, scope);
    return scope.mode as DriverOrderMode;
  }

  async assertFirstClaimEligibilityInTransaction(
    transaction: TransactionLike,
    input: DriverOrderMutationInput,
  ): Promise<DriverOrderMode> {
    const scope = await this.resolveScope(input.order, input.storeId, (path) =>
      transaction.get(this.firestore.doc(path)),
    );
    if (scope.mode === 'round_direct') {
      await this.assertDriverAuthorityInTransaction(
        transaction,
        input.requesterId,
        input.requesterRole,
      );
    }
    this.assertUsableScope(scope);
    this.assertFirstClaimRules(input, scope, true);
    return scope.mode as DriverOrderMode;
  }

  async assertMutationEligibility(input: DriverOrderMutationInput): Promise<DriverOrderMode> {
    const scope = await this.resolveScope(input.order, input.storeId, (path) =>
      this.firestore.doc(path).get(),
    );
    if (scope.mode === 'round_direct') {
      await this.assertDriverAuthority(input.requesterId, input.requesterRole);
    }
    this.assertUsableScope(scope);
    this.assertMutationRules(input, scope);
    return scope.mode as DriverOrderMode;
  }

  async assertMutationEligibilityInTransaction(
    transaction: TransactionLike,
    input: DriverOrderMutationInput,
  ): Promise<DriverOrderMode> {
    const scope = await this.resolveScope(input.order, input.storeId, (path) =>
      transaction.get(this.firestore.doc(path)),
    );
    if (scope.mode === 'round_direct') {
      await this.assertDriverAuthorityInTransaction(
        transaction,
        input.requesterId,
        input.requesterRole,
      );
    }
    this.assertUsableScope(scope);
    this.assertMutationRules(input, scope, true);
    return scope.mode as DriverOrderMode;
  }

  private assertDriverAuthoritySnapshot(
    snapshot: DocumentSnapshotLike,
    requesterId: string,
    requesterRole: string,
  ): DriverAuthority {
    const user = snapshot.exists ? snapshot.data() : undefined;
    if (
      requesterRole !== 'driver' ||
      !snapshot.exists ||
      user?.['role'] !== 'driver' ||
      user['driverApproved'] !== true ||
      user['suspended'] === true
    ) {
      throw new ForbiddenException('현재 Driver 권한이 없습니다.');
    }
    return { requesterId, role: 'driver', driverApproved: true };
  }

  private async authorityFor(
    requesterId: string,
    authority?: DriverAuthority,
  ): Promise<DriverAuthority> {
    if (authority?.requesterId === requesterId) return authority;
    return this.assertDriverAuthority(requesterId);
  }

  private async resolveScope(
    order: OrderRecord,
    targetStoreId: unknown,
    getDocument: (path: string) => Promise<DocumentSnapshotLike>,
  ): Promise<ScopeEvaluation> {
    const orderStoreId = order['storeId'];
    if (!this.isNonEmptyString(orderStoreId)) {
      return { mode: 'legacy', pilotBase: false };
    }
    if (!this.isNonEmptyString(targetStoreId) || orderStoreId !== targetStoreId) {
      return { mode: 'invalid', pilotBase: false };
    }

    const storeSnapshot = await getDocument(`stores/${targetStoreId}`);
    if (!storeSnapshot.exists) return { mode: 'invalid', pilotBase: false };
    const store = storeSnapshot.data();
    if (store?.['salesMode'] !== 'round_direct') {
      return { mode: 'legacy', pilotBase: false };
    }

    if (
      order['schemaVersion'] !== 2 ||
      !this.isNonEmptyString(order['roundId']) ||
      order['deliveryMethod'] !== 'direct'
    ) {
      return { mode: 'round_direct', pilotBase: false };
    }

    const roundSnapshot = await getDocument(`saleRounds/${order['roundId']}`);
    if (!roundSnapshot.exists) return { mode: 'round_direct', pilotBase: false };
    const round = roundSnapshot.data();
    const pilotBase = round?.['id'] === order['roundId'] && round?.['storeId'] === orderStoreId;
    return { mode: 'round_direct', pilotBase };
  }

  private isDiscoveryEligibleForScope(scope: ScopeEvaluation, order: OrderRecord): boolean {
    if (order['status'] !== 'PREPARING' || order['driverId'] != null) return false;
    if (scope.mode === 'round_direct')
      return scope.pilotBase && order['deliveryMethod'] === 'direct';
    return ['direct', 'hub'].includes(String(order['deliveryMethod']));
  }

  private isAssignedVisibleForScope(
    scope: ScopeEvaluation,
    order: OrderRecord,
    requesterId: string,
  ): boolean {
    return (
      (scope.pilotBase || scope.mode === 'legacy') &&
      order['driverId'] === requesterId &&
      DRIVER_VISIBLE_STATUSES.includes(order['status'] as DriverVisibleStatus)
    );
  }

  private assertFirstClaimRules(
    input: DriverOrderMutationInput,
    scope: ScopeEvaluation,
    inTransaction = false,
  ) {
    if (
      input.expectedStatus !== 'PREPARING' ||
      input.nextStatus !== 'DELIVERING' ||
      input.order['status'] !== 'PREPARING'
    ) {
      throw inTransaction
        ? new ConflictException('주문 상태가 변경되었습니다.')
        : new ForbiddenException('Driver first claim 조건을 만족하지 않습니다.');
    }
    if (input.order['driverId'] != null) {
      throw inTransaction
        ? new ConflictException('이미 다른 기사에게 배정된 주문입니다.')
        : new ForbiddenException('이미 배정된 주문입니다.');
    }
    if (
      scope.mode === 'round_direct'
        ? input.order['deliveryMethod'] !== 'direct'
        : !['direct', 'hub'].includes(String(input.order['deliveryMethod']))
    ) {
      throw new ForbiddenException('Driver first claim 대상 주문이 아닙니다.');
    }
  }

  private assertMutationRules(
    input: DriverOrderMutationInput,
    scope: ScopeEvaluation,
    inTransaction = false,
  ) {
    if (input.order['status'] !== input.expectedStatus) {
      throw inTransaction
        ? new ConflictException('주문 상태가 변경되었습니다.')
        : new ForbiddenException('주문 상태가 변경되었습니다.');
    }

    const allowed = getAllowedTransitions('driver', input.order['status'] as OrderStatus);
    if (!allowed.includes(input.nextStatus as OrderStatus)) {
      throw new ForbiddenException(
        `${input.expectedStatus} → ${input.nextStatus} 전환은 허용되지 않습니다.`,
      );
    }

    if (input.order['driverId'] === input.requesterId) return;
    if (input.order['driverId'] != null) {
      throw inTransaction
        ? new ConflictException('이미 다른 기사에게 배정된 주문입니다.')
        : new ForbiddenException('담당 기사만 배송 상태를 변경할 수 있습니다.');
    }

    if (
      input.expectedStatus === 'PREPARING' &&
      input.nextStatus === 'DELIVERING' &&
      (scope.mode === 'round_direct'
        ? input.order['deliveryMethod'] === 'direct'
        : ['direct', 'hub'].includes(String(input.order['deliveryMethod'])))
    ) {
      return;
    }
    throw new ForbiddenException('미배정 주문은 first claim으로만 배송을 시작할 수 있습니다.');
  }

  private assertPilotScope(scope: ScopeEvaluation) {
    if (scope.mode !== 'round_direct' || !scope.pilotBase) {
      throw new ForbiddenException('유효한 round_direct Pilot 주문이 아닙니다.');
    }
  }

  private assertUsableScope(scope: ScopeEvaluation) {
    if (scope.mode === 'invalid' || (scope.mode === 'round_direct' && !scope.pilotBase)) {
      throw new ForbiddenException('유효한 Driver 주문 범위가 아닙니다.');
    }
  }

  private isUsableScope(scope: ScopeEvaluation) {
    return scope.mode !== 'invalid' && (scope.mode === 'legacy' || scope.pilotBase);
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
