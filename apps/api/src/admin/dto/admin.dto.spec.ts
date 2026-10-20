// 관리자 요청 DTO 입력 검증을 class-validator 단위로 고정한다(전역 ValidationPipe가 같은 규칙으로 400을 낸다).

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ADMIN_REFUND_REASON_MAX_LENGTH,
  BANNER_HEADLINE_MAX_LENGTH,
  ForceRefundDto,
  QueryAdminDriversDto,
  QueryAdminOrdersDto,
  QueryAdminSettlementsDto,
  UpsertBannerDto,
} from './admin.dto';

function errorsOf<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  return validateSync(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('QueryAdminSettlementsDto 기간 필터', () => {
  it.each(['2026-08-25', '2024-02-29'])('달력 날짜 %p는 받는다', (date) => {
    expect(errorsOf(QueryAdminSettlementsDto, { from: date, to: date })).toHaveLength(0);
  });

  it.each(['2026/08/25', '2026-8-25', '20260825', '2026-02-30', '2025-02-29', '2026-08-25T00:00'])(
    '형식이나 날짜가 틀린 %p는 거부한다',
    (date) => {
      expect(errorsOf(QueryAdminSettlementsDto, { from: date })).not.toHaveLength(0);
      expect(errorsOf(QueryAdminSettlementsDto, { to: date })).not.toHaveLength(0);
    },
  );
});

describe('관리자 목록 status 필터', () => {
  it('주문 status는 주문 상태 값만 받는다', () => {
    expect(errorsOf(QueryAdminOrdersDto, { status: 'DELIVERED' })).toHaveLength(0);
    expect(errorsOf(QueryAdminOrdersDto, {})).toHaveLength(0);
    expect(errorsOf(QueryAdminOrdersDto, { status: 'delivered' })).not.toHaveLength(0);
    expect(errorsOf(QueryAdminOrdersDto, { status: 'UNKNOWN' })).not.toHaveLength(0);
  });

  it('기사 status는 pending·approved·suspended만 받는다', () => {
    for (const status of ['pending', 'approved', 'suspended']) {
      expect(errorsOf(QueryAdminDriversDto, { status })).toHaveLength(0);
    }
    expect(errorsOf(QueryAdminDriversDto, { status: 'all' })).not.toHaveLength(0);
  });
});

describe('ForceRefundDto 사유 길이', () => {
  it('한도까지는 받고 넘으면 거부한다', () => {
    const ok = 'a'.repeat(ADMIN_REFUND_REASON_MAX_LENGTH);
    expect(errorsOf(ForceRefundDto, { reason: ok })).toHaveLength(0);
    expect(errorsOf(ForceRefundDto, { reason: `${ok}a` })).not.toHaveLength(0);
  });
});

describe('UpsertBannerDto 배너 입력', () => {
  it('화면 기본값(빈 문자열)과 정상 값은 받는다', () => {
    expect(
      errorsOf(UpsertBannerDto, {
        imageUrl: '',
        headline: '봄맞이',
        cta1: { label: '', href: '' },
        cta2: { label: '보러 가기', href: '/products?category=orchid' },
        isActive: true,
      }),
    ).toHaveLength(0);
    expect(
      errorsOf(UpsertBannerDto, {
        imageUrl:
          'https://firebasestorage.googleapis.com/v0/b/green-e4fe3.appspot.com/o/banners%2Fmain_hero%2Fa.png?alt=media',
        cta1: { label: '안내', href: 'https://example.com/guide' },
      }),
    ).toHaveLength(0);
  });

  it.each(['http://example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '/a.png'])(
    '이미지 주소 %p는 https 주소가 아니라 거부한다',
    (imageUrl) => {
      expect(errorsOf(UpsertBannerDto, { imageUrl })).not.toHaveLength(0);
    },
  );

  it.each([
    '//evil.example.com',
    '/\\evil.example.com',
    'javascript:alert(1)',
    'http://example.com',
    'products',
    '/products list',
  ])('링크 %p는 사이트 안 경로나 https 주소가 아니라 거부한다', (href) => {
    expect(errorsOf(UpsertBannerDto, { cta1: { label: '보기', href } })).not.toHaveLength(0);
  });

  it('문구가 길이 한도를 넘으면 거부한다', () => {
    expect(
      errorsOf(UpsertBannerDto, { headline: 'a'.repeat(BANNER_HEADLINE_MAX_LENGTH + 1) }),
    ).not.toHaveLength(0);
  });
});
