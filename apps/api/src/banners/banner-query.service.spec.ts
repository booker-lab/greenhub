import { BannerQueryService } from './banner-query.service';

function doc(id: string, data: Record<string, unknown>) {
  return { id, data: () => data };
}

describe('BannerQueryService', () => {
  it('오늘 KST에 포함되는 기간 배너와 기본 배너를 반환한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-30T03:00:00.000Z'));
    const firestore = {
      collection: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({
          docs: [
            doc('old', { kind: 'scheduled', startDate: '2026-05-01', endDate: '2026-05-29' }),
            doc('active', {
              kind: 'scheduled',
              startDate: '2026-05-30',
              endDate: '2026-05-30',
              createdAt: { toMillis: () => 2 },
            }),
            doc('active-newer', {
              kind: 'scheduled',
              startDate: '2026-05-29',
              endDate: '2026-05-31',
              createdAt: { toMillis: () => 3 },
            }),
            doc('main_hero', { headline: '기본 배너' }),
          ],
        }),
      }),
    };
    const service = new BannerQueryService(firestore as never);

    await expect(service.getActiveBanners()).resolves.toMatchObject({
      scheduled: [
        { id: 'active-newer', kind: 'scheduled' },
        { id: 'active', kind: 'scheduled' },
      ],
      default: { id: 'main_hero', kind: 'default', headline: '기본 배너' },
    });
    jest.useRealTimers();
  });
});
