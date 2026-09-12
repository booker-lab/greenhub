import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { DeliveryPhotosService } from './delivery-photos.service';
import { DriverOrderScopeService } from './driver-order-scope.service';

type Data = Record<string, any>;

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);

function deterministicPhotoId(orderId: string, key: string): string {
  return createHash('sha256').update(`${orderId}:${key}`).digest('hex').slice(0, 32);
}

interface ContextOptions {
  storeId?: string;
  storeSalesMode?: string;
  orderId?: string;
  roundId?: string;
  driverId?: string;
  requesterId?: string;
  requesterRole?: string;
  idempotencyKey?: string;
  orderOverrides?: Data;
  round?: Data | null;
  userOverrides?: Data;
  preexistingStorage?: string[];
}

function makeContext(options: ContextOptions = {}) {
  const storeId = options.storeId ?? 'store-legacy';
  const orderId = options.orderId ?? 'order-post-stop';
  const roundId = options.roundId ?? 'round-ok';
  const driverId = options.driverId ?? 'driver-ok';
  const requesterId = options.requesterId ?? driverId;
  const requesterRole = (options.requesterRole ?? 'driver') as 'driver';
  const idempotencyKey = options.idempotencyKey ?? 'retry-key-12345678';
  const photoId = deterministicPhotoId(orderId, idempotencyKey);

  const docs = new Map<string, Data>();
  docs.set(`stores/${storeId}`, { id: storeId, salesMode: options.storeSalesMode ?? 'legacy' });
  const roundValue: Data | null =
    options.round === undefined ? { id: roundId, storeId } : options.round;
  if (roundValue !== null) {
    docs.set(`saleRounds/${roundId}`, { ...roundValue });
  }
  const order: Data = {
    id: orderId,
    storeId,
    userId: 'consumer-1',
    driverId,
    schemaVersion: 2,
    roundId,
    deliveryMethod: 'direct',
    status: 'DELIVERED',
    deliveryPhotoIds: [photoId],
    ...(options.orderOverrides ?? {}),
  };
  docs.set(`orders/${orderId}`, { ...order });
  docs.set(`users/${requesterId}`, {
    role: 'driver',
    driverApproved: true,
    ...(options.userOverrides ?? {}),
  });

  const storedPaths = new Set<string>(
    options.preexistingStorage ?? [`deliveryPhotos/${orderId}/${photoId}.jpg`],
  );

  const firestore = {
    doc: jest.fn((path: string) => ({
      path,
      get: jest.fn(async () => {
        const data = docs.get(path);
        return {
          exists: data !== undefined,
          data: () => (data === undefined ? undefined : { ...data }),
        };
      }),
    })),
    runTransaction: jest.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const transaction = {
        get: jest.fn(async (ref: any) => {
          const path = typeof ref === 'string' ? ref : ref?.path;
          const data = docs.get(path);
          return {
            exists: data !== undefined,
            data: () => (data === undefined ? undefined : { ...data }),
          };
        }),
        update: jest.fn((ref: any, changes: Data) => {
          const path = typeof ref === 'string' ? ref : ref?.path;
          const prev = docs.get(path) ?? {};
          docs.set(path, { ...prev, ...changes });
        }),
      };
      const result = await callback(transaction);
      (firestore as any).lastTransaction = transaction;
      return result;
    }),
    Timestamp: {
      now: jest.fn(() => ({
        toDate: () => new Date('2026-07-18T03:00:00.000Z'),
      })),
    },
  };

  const storage = {
    uploadDeliveryPhoto: jest.fn(async (input: Data) => {
      const path = `deliveryPhotos/${input.orderId}/${input.photoId}.jpg`;
      const created = !storedPaths.has(path);
      storedPaths.add(path);
      return { orderId: input.orderId, photoId: input.photoId, path, created };
    }),
    reconcileDeliveryPhoto: jest.fn(),
    createDeliveryPhotoReadUrl: jest.fn(),
    deleteObject: jest.fn(async (path: string) => {
      storedPaths.delete(path);
    }),
  };
  const retention = {
    saveRecord: jest.fn().mockResolvedValue({ id: 'record' }),
  };
  const lifecycle = {
    updateStatus: jest.fn(async (sId: string, oId: string) => {
      const prev = docs.get(`orders/${oId}`) ?? {};
      docs.set(`orders/${oId}`, { ...prev, status: 'DELIVERED' });
      return { orderId: oId, status: 'DELIVERED' };
    }),
    reconcileDeliveryCompletion: jest.fn(async (sId: string, oId: string) => ({
      orderId: oId,
      status: 'DELIVERED' as const,
    })),
  };
  const issueWriter = {
    createOrMergeIssue: jest.fn().mockResolvedValue({ id: 'issue' }),
  };

  const driverScope = new DriverOrderScopeService(firestore as never);
  const service = new DeliveryPhotosService(
    firestore as never,
    storage as never,
    retention as never,
    lifecycle as never,
    driverScope as never,
    issueWriter as never,
  );

  const input = {
    storeId,
    orderId,
    requesterId,
    requesterRole,
    idempotencyKey,
    content: jpeg,
    contentType: 'image/jpeg',
  };

  return {
    docs,
    driverScope,
    firestore,
    input,
    lifecycle,
    photoId,
    retention,
    service,
    storage,
    storedPaths,
  };
}

function readStateConflictCode(error: unknown): string | undefined {
  const body =
    typeof (error as any)?.getResponse === 'function'
      ? (error as any).getResponse()
      : undefined;
  if (typeof body === 'object' && body !== null) {
    return (body as Data)?.code as string | undefined;
  }
  return undefined;
}

describe('post-stop identical photo retry (PILOT-STOP-COMPLETED-PHOTO-IDEMPOTENT-RETRY-27E)', () => {
  it('T1: legacy store identical retry ACKs without duplicate writes', async () => {
    const context = makeContext({ storeSalesMode: 'legacy' });
    const beforePhotoIds = [...(context.docs.get('orders/order-post-stop')?.deliveryPhotoIds ?? [])];
    const beforeStoredSize = context.storedPaths.size;

    const result = await context.service.uploadAndComplete({ ...context.input });

    expect(result).toEqual({
      orderId: 'order-post-stop',
      photoId: context.photoId,
      status: 'DELIVERED',
    });
    const uploadResult = await context.storage.uploadDeliveryPhoto.mock.results[0].value;
    expect(uploadResult.created).toBe(false);
    expect(context.storedPaths.size).toBe(beforeStoredSize);
    expect(context.docs.get('orders/order-post-stop')?.deliveryPhotoIds).toEqual(beforePhotoIds);
    expect(context.retention.saveRecord).not.toHaveBeenCalled();
    expect(context.lifecycle.updateStatus).not.toHaveBeenCalled();
    expect(context.lifecycle.reconcileDeliveryCompletion).toHaveBeenCalledWith(
      'store-legacy',
      'order-post-stop',
    );
    expect(context.storage.deleteObject).not.toHaveBeenCalled();
  });

  it('T2: legacy flipped + different key/photo stays state-conflict with zero writes', async () => {
    const context = makeContext({ storeSalesMode: 'legacy' });
    const beforePhotoIds = [...(context.docs.get('orders/order-post-stop')?.deliveryPhotoIds ?? [])];
    const beforeStoredSize = context.storedPaths.size;

    let changedError: unknown;
    try {
      await context.service.uploadAndComplete({
        ...context.input,
        idempotencyKey: 'different-key-87654321',
      });
    } catch (error) {
      changedError = error;
    }
    expect(changedError).toBeDefined();
    if (changedError instanceof ConflictException) {
      expect(changedError).toBeInstanceOf(ConflictException);
    } else {
      expect(changedError).toBeInstanceOf(ForbiddenException);
      expect(readStateConflictCode(changedError)).toBe('DRIVER_ORDER_STATE_CONFLICT');
    }

    expect(context.storage.uploadDeliveryPhoto).not.toHaveBeenCalled();
    expect(context.retention.saveRecord).not.toHaveBeenCalled();
    expect(context.docs.get('orders/order-post-stop')?.deliveryPhotoIds).toEqual(beforePhotoIds);
    expect(context.storedPaths.size).toBe(beforeStoredSize);
    expect(context.lifecycle.updateStatus).not.toHaveBeenCalled();
    expect(context.lifecycle.reconcileDeliveryCompletion).not.toHaveBeenCalled();
  });

  it('T3: legacy flipped + revoked/suspended driver stays 403 with zero writes', async () => {
    const suspended = makeContext({
      storeSalesMode: 'legacy',
      userOverrides: { suspended: true },
    });
    await expect(suspended.service.uploadAndComplete({ ...suspended.input })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(suspended.storage.uploadDeliveryPhoto).not.toHaveBeenCalled();
    expect(suspended.retention.saveRecord).not.toHaveBeenCalled();
    expect(suspended.lifecycle.reconcileDeliveryCompletion).not.toHaveBeenCalled();

    const unapproved = makeContext({
      storeSalesMode: 'legacy',
      userOverrides: { driverApproved: false },
    });
    await expect(
      unapproved.service.uploadAndComplete({ ...unapproved.input }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(unapproved.storage.uploadDeliveryPhoto).not.toHaveBeenCalled();
    expect(unapproved.retention.saveRecord).not.toHaveBeenCalled();
  });

  it('T4: legacy flipped + reassigned driver stays 403 with zero writes', async () => {
    const context = makeContext({
      storeSalesMode: 'legacy',
      driverId: 'driver-ok',
      requesterId: 'driver-other',
      userOverrides: { role: 'driver', driverApproved: true },
    });

    await expect(context.service.uploadAndComplete({ ...context.input })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(context.retention.saveRecord).not.toHaveBeenCalled();
    expect(context.lifecycle.reconcileDeliveryCompletion).not.toHaveBeenCalled();
    expect(context.docs.get('orders/order-post-stop')?.deliveryPhotoIds).toEqual([
      context.photoId,
    ]);
  });

  it('T5: round missing/store mismatch never invents historical pilot identity', async () => {
    const missing = makeContext({ storeSalesMode: 'legacy', round: null });
    await expect(missing.service.uploadAndComplete({ ...missing.input })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(missing.lifecycle.reconcileDeliveryCompletion).not.toHaveBeenCalled();
    expect(missing.retention.saveRecord).not.toHaveBeenCalled();

    const mismatched = makeContext({
      storeSalesMode: 'legacy',
      round: { id: 'round-ok', storeId: 'store-other' },
    });
    await expect(
      mismatched.service.uploadAndComplete({ ...mismatched.input }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mismatched.lifecycle.reconcileDeliveryCompletion).not.toHaveBeenCalled();
    expect(mismatched.retention.saveRecord).not.toHaveBeenCalled();
  });

  it('T6: pre-stop identical retry regression still passes', async () => {
    const orderId = 'order-pre-stop';
    const storeId = 'store-direct';
    const roundId = 'round-pre-stop';
    const idempotencyKey = 'pre-stop-key-12345678';
    const photoId = deterministicPhotoId(orderId, idempotencyKey);
    const context = makeContext({
      storeId,
      orderId,
      roundId,
      storeSalesMode: 'round_direct',
      idempotencyKey,
      orderOverrides: { status: 'DELIVERING', deliveryPhotoIds: [] },
      round: { id: roundId, storeId },
      preexistingStorage: [],
    });

    const first = await context.service.uploadAndComplete({ ...context.input });
    expect(first.photoId).toBe(photoId);
    expect(context.lifecycle.updateStatus).toHaveBeenCalledTimes(1);

    const second = await context.service.uploadAndComplete({ ...context.input });
    expect(second.photoId).toBe(first.photoId);
    expect(context.docs.get(`orders/${orderId}`)?.deliveryPhotoIds).toEqual([photoId]);
    expect(context.lifecycle.updateStatus).toHaveBeenCalledTimes(1);
    expect(context.lifecycle.reconcileDeliveryCompletion).toHaveBeenCalledWith(storeId, orderId);
    expect(context.retention.saveRecord).toHaveBeenCalledTimes(1);
  });
});
