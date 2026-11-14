import { type ExecutionContext, type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { ApproveDriverDto, ArchiveStoreDto } from './dto/admin.dto';

// 본문이 선택인 관리자 요청(기사 승인·판매자 치우기)이 실제 전역 ValidationPipe를 거치는지 확인한다.
// `@Body() dto: Dto | undefined`는 design:paramtypes가 Object가 돼 파이프가 검증을 건너뛰었다(보안 검토 지적).
// 인증·역할 가드는 이 테스트의 대상이 아니므로 관리자 요청으로 통과시킨다.

const ADMIN = { sub: 'admin-1', role: 'admin' };

async function createApp() {
  const admin = {
    approveDriver: jest.fn().mockResolvedValue({ approved: true }),
    archiveStore: jest.fn().mockResolvedValue({ archived: true }),
  };
  const allowAdmin = {
    canActivate: (context: ExecutionContext) => {
      context.switchToHttp().getRequest<Record<string, unknown>>().user = ADMIN;
      return true;
    },
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [AdminController],
    providers: [{ provide: AdminService, useValue: admin }],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(allowAdmin)
    .overrideGuard(RolesGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = moduleRef.createNestApplication();
  // 운영(main.ts)과 같은 전역 파이프.
  app.useGlobalPipes(new ValidationPipe(sanitizedValidationPipeOptions()));
  await app.init();
  return { app, admin };
}

describe('관리자 선택 본문 DTO 검증(실제 ValidationPipe)', () => {
  let app: INestApplication<App>;
  let admin: Awaited<ReturnType<typeof createApp>>['admin'];

  beforeEach(async () => {
    ({ app, admin } = await createApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it('본문 파라미터 타입이 DTO 클래스라 파이프가 검증 대상으로 본다', () => {
    const approveTypes: unknown[] = Reflect.getMetadata(
      'design:paramtypes',
      AdminController.prototype,
      'approveDriver',
    );
    const archiveTypes: unknown[] = Reflect.getMetadata(
      'design:paramtypes',
      AdminController.prototype,
      'archiveStore',
    );
    expect(approveTypes[1]).toBe(ApproveDriverDto);
    expect(archiveTypes[1]).toBe(ArchiveStoreDto);
  });

  describe('PATCH /admin/drivers/:userId/approve', () => {
    it.each([
      ['문자열 회차', { expectedRevision: 'x' }],
      ['음수 회차', { expectedRevision: -1 }],
      ['소수 회차', { expectedRevision: 1.5 }],
      ['모르는 칸', { unknownField: true }],
      ['회차와 모르는 칸', { expectedRevision: 1, approved: true }],
    ])('%s는 400이고 승인하지 않는다', async (_label, body) => {
      const res = await request(app.getHttpServer())
        .patch('/admin/drivers/driver-1/approve')
        .send(body);
      expect(res.status).toBe(400);
      expect(admin.approveDriver).not.toHaveBeenCalled();
    });

    it('빈 본문({})은 회차 비교 없이 승인한다', async () => {
      const res = await request(app.getHttpServer())
        .patch('/admin/drivers/driver-1/approve')
        .send({});
      expect(res.status).toBe(200);
      expect(admin.approveDriver).toHaveBeenCalledWith('driver-1', 'admin-1', undefined);
    });

    it('본문 없는 이전 화면 요청도 회차 비교 없이 승인한다', async () => {
      const res = await request(app.getHttpServer()).patch('/admin/drivers/driver-1/approve');
      expect(res.status).toBe(200);
      expect(admin.approveDriver).toHaveBeenCalledWith('driver-1', 'admin-1', undefined);
    });

    it('올바른 회차는 그대로 넘긴다', async () => {
      const res = await request(app.getHttpServer())
        .patch('/admin/drivers/driver-1/approve')
        .send({ expectedRevision: 3 });
      expect(res.status).toBe(200);
      expect(admin.approveDriver).toHaveBeenCalledWith('driver-1', 'admin-1', 3);
    });
  });

  describe('PATCH /admin/stores/:storeId/archive', () => {
    it.each([
      ['문자열이 아닌 확인 값', { confirmStoreIdPrefix: 12345678 }],
      ['모르는 칸', { force: true }],
    ])('%s는 400이고 치우지 않는다', async (_label, body) => {
      const res = await request(app.getHttpServer())
        .patch('/admin/stores/store-1/archive')
        .send(body);
      expect(res.status).toBe(400);
      expect(admin.archiveStore).not.toHaveBeenCalled();
    });

    it('본문 없는 요청과 빈 본문은 확인 값 없이 넘긴다', async () => {
      await request(app.getHttpServer()).patch('/admin/stores/store-1/archive').expect(200);
      await request(app.getHttpServer()).patch('/admin/stores/store-1/archive').send({}).expect(200);
      expect(admin.archiveStore).toHaveBeenNthCalledWith(1, 'store-1', 'admin-1', undefined);
      expect(admin.archiveStore).toHaveBeenNthCalledWith(2, 'store-1', 'admin-1', undefined);
    });

    it('확인 값은 그대로 넘긴다', async () => {
      await request(app.getHttpServer())
        .patch('/admin/stores/store-1/archive')
        .send({ confirmStoreIdPrefix: 'store-1a' })
        .expect(200);
      expect(admin.archiveStore).toHaveBeenCalledWith('store-1', 'admin-1', 'store-1a');
    });
  });
});
