import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '../../src/common/audit/audit.service';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { StorageService } from '../../src/firestore/storage.service';
import { OperationIssueWriterService } from '../../src/operations/operation-issue-writer.service';
import { DeliveryPhotosController } from '../../src/orders/delivery-photos.controller';
import { DeliveryPhotosService } from '../../src/orders/delivery-photos.service';
import { OrderCapacityService } from '../../src/orders/order-capacity.service';
import { OrderChargesService } from '../../src/orders/order-charges.service';
import { OrdersController, OrdersPublicController } from '../../src/orders/orders.controller';
import { OrdersService } from '../../src/orders/orders.service';
import { OrdersCreateService } from '../../src/orders/orders-create.service';
import { OrdersLifecycleService } from '../../src/orders/orders-lifecycle.service';
import { OrdersQueryService } from '../../src/orders/orders-query.service';
import { RoundOrderCreateService } from '../../src/orders/round-order-create.service';
import { RoundOrderLifecycleService } from '../../src/orders/round-order-lifecycle.service';
import { OrderChargePaymentService } from '../../src/payments/order-charge-payment.service';
import { PaymentFinalizationService } from '../../src/payments/payment-finalization.service';
import { PaymentRefundService } from '../../src/payments/payment-refund.service';
import { PaymentsController, RefundController } from '../../src/payments/payments.controller';
import { PaymentsService } from '../../src/payments/payments.service';
import { PortoneClient } from '../../src/payments/portone.client';
import { RetentionService } from '../../src/retention/retention.service';
import { SaleRoundStateService } from '../../src/sale-rounds/sale-round-state.service';
import {
  PublicSaleRoundsController,
  SaleRoundsController,
} from '../../src/sale-rounds/sale-rounds.controller';
import { SaleRoundsService } from '../../src/sale-rounds/sale-rounds.service';
import { SettlementsService } from '../../src/settlements/settlements.service';
import { createInMemoryFirestore } from './in-memory-firestore';

type Data = Record<string, any>;

@Injectable()
class HeaderAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const userId = request.headers['x-test-user'];
    const role = request.headers['x-test-role'];
    if (typeof userId !== 'string' || typeof role !== 'string') {
      throw new UnauthorizedException('테스트 인증 정보가 필요합니다.');
    }
    request.user = { sub: userId, role };
    return true;
  }
}

function seedRecords(): Record<string, Data> {
  return {
    'stores/store-1': {
      id: 'store-1',
      ownerId: 'seller-1',
      salesMode: 'round_direct',
      phone: '031-000-0000',
    },
    'products/product-1': {
      id: 'product-1',
      storeId: 'store-1',
      name: '호접란',
      images: ['https://example.com/orchid.jpg'],
    },
    'users/seller-1': { id: 'seller-1', role: 'seller', storeId: 'store-1' },
    'users/seller-2': { id: 'seller-2', role: 'seller', storeId: 'store-2' },
    'users/consumer-1': {
      id: 'consumer-1',
      role: 'consumer',
      name: '구매자',
      phone: '010-1111-1111',
    },
    'users/consumer-2': {
      id: 'consumer-2',
      role: 'consumer',
      name: '다른 구매자',
      phone: '010-2222-2222',
    },
    'users/driver-1': { id: 'driver-1', role: 'driver' },
    'users/driver-2': { id: 'driver-2', role: 'driver' },
    'users/admin-1': { id: 'admin-1', role: 'admin' },
  };
}

export async function createMvpSalesRoundFixture() {
  const memory = createInMemoryFirestore(seedRecords());
  const firestore = memory.firestore as never;
  const storedObjects = new Map<string, { content: Buffer; metadata: Data }>();

  const bucket = {
    file: (path: string) => ({
      save: async (content: Buffer, options: Data) => {
        if (storedObjects.has(path))
          throw Object.assign(new Error('이미 존재합니다.'), { code: 412 });
        storedObjects.set(path, { content: Buffer.from(content), metadata: options.metadata });
      },
      getMetadata: async () => [storedObjects.get(path)?.metadata ?? {}],
      getSignedUrl: async () => [`https://signed.example/${path}`],
      delete: async () => {
        storedObjects.delete(path);
      },
    }),
  };
  const firebaseApp = { storage: () => ({ bucket: () => bucket }) };
  const storage = new StorageService(firebaseApp as never, firestore);
  const issueWriter = new OperationIssueWriterService(firestore);
  const retention = new RetentionService(firestore, storage, issueWriter);
  const capacity = new OrderCapacityService(firestore);

  const deliveredNotificationKeys = new Set<string>();
  const notifications = {
    sendToUser: jest.fn(async (...args: unknown[]) => {
      const idempotencyKey = args[4];
      if (typeof idempotencyKey === 'string') deliveredNotificationKeys.add(idempotencyKey);
    }),
    sendToGroupParticipants: jest.fn().mockResolvedValue(undefined),
    processGroupBuyEarlyConfirm: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const portone = {
    verifyWebhookSignature: jest.fn(),
    getPayment: jest.fn(async (paymentId: string) => {
      const data = paymentId.startsWith('order-charge-')
        ? memory.read(`orderCharges/${paymentId.slice('order-charge-'.length)}`)
        : memory.read(`orders/${paymentId}`);
      return {
        status: 'PAID',
        amount: { total: data?.amount ?? data?.totalAmount ?? 0 },
        method: { type: 'CARD' },
        transactionId: `transaction-${paymentId}`,
      };
    }),
    refund: jest.fn().mockResolvedValue(undefined),
  };
  const settlements = new SettlementsService(firestore, {
    get: (key: string) => (key === 'PLATFORM_FEE_RATE' ? '0.05' : '1'),
  } as never);
  const chargePayments = new OrderChargePaymentService(firestore, portone as never);
  const refunds = new PaymentRefundService(firestore, portone as never, issueWriter, retention);
  const finalization = new PaymentFinalizationService(
    firestore,
    portone as never,
    notifications as never,
    audit as never,
    capacity,
    issueWriter,
    retention,
  );
  const payments = new PaymentsService(
    firestore,
    portone as never,
    finalization,
    refunds,
    chargePayments,
  );
  const roundLifecycle = new RoundOrderLifecycleService(firestore, payments, settlements, capacity);
  const lifecycle = new OrdersLifecycleService(
    firestore,
    notifications as never,
    payments,
    settlements,
    capacity,
    roundLifecycle,
  );
  const roundState = new SaleRoundStateService(firestore, roundLifecycle);
  const saleRounds = new SaleRoundsService(firestore, roundState);
  const roundCreate = new RoundOrderCreateService(firestore, capacity, retention);
  const create = new OrdersCreateService(firestore, notifications as never, capacity, roundCreate);
  const query = new OrdersQueryService(firestore, storage);
  const orders = new OrdersService(create, query, lifecycle);
  const charges = new OrderChargesService(firestore, issueWriter);
  const deliveryPhotos = new DeliveryPhotosService(firestore, storage, retention, lifecycle);

  const module = await Test.createTestingModule({
    controllers: [
      PublicSaleRoundsController,
      SaleRoundsController,
      OrdersPublicController,
      OrdersController,
      PaymentsController,
      RefundController,
      DeliveryPhotosController,
    ],
    providers: [
      RolesGuard,
      { provide: SaleRoundsService, useValue: saleRounds },
      { provide: OrdersService, useValue: orders },
      { provide: OrderChargesService, useValue: charges },
      { provide: PaymentsService, useValue: payments },
      { provide: PortoneClient, useValue: portone },
      { provide: AuditService, useValue: audit },
      { provide: DeliveryPhotosService, useValue: deliveryPhotos },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useClass(HeaderAuthGuard)
    .compile();

  const app = module.createNestApplication({ rawBody: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();

  return {
    app,
    records: memory.records,
    read: memory.read,
    storedObjects,
    retention,
    finalization,
    portone,
    notifications,
    deliveredNotificationKeys,
    reset() {
      memory.records.clear();
      Object.entries(seedRecords()).forEach(([path, data]) => {
        memory.records.set(path, data);
      });
      storedObjects.clear();
      deliveredNotificationKeys.clear();
      jest.clearAllMocks();
    },
  };
}
