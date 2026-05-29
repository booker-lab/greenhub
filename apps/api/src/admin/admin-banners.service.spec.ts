import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { AdminBannersService } from './admin-banners.service';

const deleteFile = jest.fn().mockResolvedValue(undefined);

jest.mock('firebase-admin', () => ({
  storage: () => ({
    bucket: jest.fn(() => ({
      file: jest.fn(() => ({
        delete: deleteFile,
      })),
    })),
  }),
}));

function createDoc(data: Record<string, unknown> | null) {
  return {
    get: jest.fn().mockResolvedValue({
      id: (data?.id as string | undefined) ?? 'banner-1',
      exists: data !== null,
      data: () => data,
    }),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
  };
}

function createService(data: Record<string, unknown> | null) {
  const doc = createDoc(data);
  const firestore = {
    doc: jest.fn().mockReturnValue(doc),
    collection: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ docs: [] }),
    }),
    Timestamp: {
      now: jest.fn(() => 'now'),
    },
  };
  const service = new AdminBannersService(firestore as never);
  return { service, firestore, doc };
}

describe('AdminBannersService', () => {
  beforeEach(() => {
    deleteFile.mockClear();
  });

  it('기간 배너는 시작일과 종료일이 모두 필요하다', async () => {
    const { service } = createService(null);

    await expect(
      service.createBanner({ kind: 'scheduled', headline: '기간 배너', startDate: '2026-05-30' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('종료일이 시작일보다 빠르면 거절한다', async () => {
    const { service } = createService(null);

    await expect(
      service.createBanner({
        kind: 'scheduled',
        headline: '기간 배너',
        startDate: '2026-05-31',
        endDate: '2026-05-30',
      }),
    ).rejects.toThrow('종료일은 시작일보다 빠를 수 없습니다.');
  });

  it('CTA 문구와 URL 중 하나만 있으면 저장을 거절한다', async () => {
    const { service } = createService(null);

    await expect(
      service.createBanner({
        kind: 'scheduled',
        startDate: '2026-05-30',
        endDate: '2026-05-31',
        cta1: { label: '보기' },
      }),
    ).rejects.toThrow('CTA 문구와 URL은 함께 입력해야 합니다.');
  });

  it('기본 배너 삭제를 차단한다', async () => {
    const { service } = createService({ id: 'main_hero', kind: 'default' });

    await expect(service.deleteBanner('main_hero')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('기간 배너 삭제 시 Storage 이미지도 정리한다', async () => {
    const imageUrl =
      'https://firebasestorage.googleapis.com/v0/b/greenhub.appspot.com/o/banners%2Fone.png?alt=media';
    const { service, doc } = createService({ id: 'banner-1', kind: 'scheduled', imageUrl });

    await expect(service.deleteBanner('banner-1')).resolves.toEqual({ ok: true, id: 'banner-1' });

    expect(doc.delete).toHaveBeenCalled();
    expect(deleteFile).toHaveBeenCalledWith({ ignoreNotFound: true });
  });
});
