import { ValidationPipe } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { AuditService } from '../common/audit/audit.service';
import { sanitizedValidationPipeOptions } from '../common/validation/sanitized-validation';
import type { FirestoreService } from '../firestore/firestore.service';
import { AdminService } from './admin.service';
import { UpsertBannerDto } from './dto/admin.dto';

// 전역 ValidationPipe를 거친 배너 본문에는 보내지 않은 칸이 undefined 값으로 남아요.
// 그 값이 Firestore에 닿으면 500이 나던 회귀를 막아요. 쓰기 값은 실제 Firestore SDK의
// 동기 검증(WriteBatch.set)을 거쳐요. 네트워크는 쓰지 않아요.

type Data = Record<string, unknown>;

describe('배너 저장 Firestore 값 검증', () => {
  let app: admin.app.App;
  let db: admin.firestore.Firestore;

  beforeAll(() => {
    app = admin.initializeApp(
      { projectId: 'demo-banner-write-spec' },
      `banner-write-${Date.now()}`,
    );
    db = app.firestore();
  });

  afterAll(async () => {
    await app.delete();
  });

  /** 저장 전에 실제 SDK로 값을 검증하는 메모리 Firestore. undefined가 있으면 운영처럼 예외가 나요. */
  function makeFirestore(initial: Record<string, Data>) {
    const records = new Map(Object.entries(initial));
    const doc = (path: string) => ({
      path,
      get: async () => ({ exists: records.has(path), data: () => records.get(path) }),
      set: async (data: Data, options?: { merge?: boolean }) => {
        if (options) db.batch().set(db.doc(path), data, options);
        else db.batch().set(db.doc(path), data);
        records.set(path, options?.merge ? { ...(records.get(path) ?? {}), ...data } : data);
      },
    });
    const firestore = { doc, Timestamp: admin.firestore.Timestamp } as unknown as FirestoreService;
    const config = { get: () => undefined } as unknown as ConfigService;
    const service = new AdminService(
      firestore,
      {} as never,
      {} as never,
      {} as never,
      new AuditService(firestore, config),
    );
    return { service, records };
  }

  it('보낸 칸만 저장하고 보내지 않은 칸은 기존 값을 그대로 둬요', async () => {
    const { service, records } = makeFirestore({
      'banners/main_hero': {
        headline: '옛 문구',
        imageUrl: 'https://img.example.com/old.jpg',
        isActive: true,
      },
    });
    const pipe = new ValidationPipe(sanitizedValidationPipeOptions());
    const dto = (await pipe.transform(
      { headline: '새 문구', cta1: { label: '보러 가기' } },
      { type: 'body', metatype: UpsertBannerDto },
    )) as UpsertBannerDto;
    // 전제: 보내지 않은 칸이 최상위·중첩 모두 undefined 값의 자체 속성으로 남아 있어요.
    expect(Object.hasOwn(dto, 'imageUrl')).toBe(true);
    expect(Object.hasOwn(dto.cta1!, 'href')).toBe(true);

    await service.upsertBanner(dto, 'admin-1');

    const banner = records.get('banners/main_hero')!;
    expect(banner).toMatchObject({
      headline: '새 문구',
      imageUrl: 'https://img.example.com/old.jpg',
      isActive: true,
      cta1: { label: '보러 가기' },
    });
    expect(banner['cta1']).not.toHaveProperty('href');

    // 바꾼 칸만 이전 값과 함께 어드민 기록에 남아요.
    const auditLog = [...records].find(([path]) => path.startsWith('adminAuditLogs/'))?.[1];
    expect(auditLog).toMatchObject({
      action: 'admin.banner.updated',
      before: { headline: '옛 문구', cta1: null },
      after: { headline: '새 문구', cta1: { label: '보러 가기' } },
    });
    expect(Object.keys(auditLog!['before'] as Data).sort()).toEqual(['cta1', 'headline']);
  });
});
