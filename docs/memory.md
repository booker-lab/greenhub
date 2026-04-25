# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `docs/memory_archive_20260425.md`

최종 수정: 2026-04-26

---

## ✅ 완료된 작업

| 항목 | 커밋 | 완료일 |
|------|------|--------|
| Consumer 디자인 시스템 (T0~T13) | `0ff8ada` | 2026-04-25 |
| Seller 디자인 시스템 (ST1~ST17) | `e2cccd8` | 2026-04-25 |
| Driver 디자인 시스템 (DT1~DT11) | `e64b629` | 2026-04-25 |
| next/image 전환 (1·2순위 최적화) | `b3d0625` | 2026-04-26 |
| HeroBanner CLS 스켈레톤 수정 | `bc25031` | 2026-04-26 |

---

## 🔜 다음 세션 — 3순위 성능 최적화

**플랜**: `docs/specs/perf-bundle-optimization.md`

**착수 순서 (정합성 검토 완료)**:
1. T0: ANALYZE=true 번들 분석으로 실제 큰 청크 파악 (필수 선행)
2. T1: HeroBanner SSR 전환 (`'use client'` 제거, async fetch) → LCP 직접 개선
3. T2: T0 결과 기반 dynamic import 확대
4. T3: products/[id]/page.tsx 서버/클라이언트 레이어 분리

**주의**: 원래 스펙의 "Firebase 함수별 import" 작업은 이미 적용된 상태 → 불필요.

---

## 성능 현황 (2026-04-26 Lighthouse 모바일)

| 지표 | 기준선 | 1차 최적화 후 | 목표 |
|------|--------|--------------|------|
| Performance | 53 | 53~57 | 80+ |
| LCP | 19.2s | 7~8s | <3s |
| CLS | 0.204 | 0.024 | ~0 |
| TBT | 230ms | 110~420ms(편차) | <150ms |

**next/image 결과가 기대보다 낮은 이유**: Vercel Edge 캐시 미스 + HeroBanner CSR 지연. 실사용자 체감은 Vercel Speed Insights로 확인 필요.

---

## 배포 현황

| 항목 | 값 |
|------|-----|
| Railway API | `https://api-production-13e7.up.railway.app` |
| Vercel Consumer | `https://greenlove.co.kr` |
| Vercel Seller | `https://seller.greenlove.co.kr` |
| Firebase | `green-e4fe3` · asia-northeast3 |

---

## 외부 조건 대기

| 항목 | 조건 |
|------|------|
| 네이버페이 채널키 | 승인 이메일 수신 후 Railway 환경변수 설정 |
| 알리고 ↔ 카카오 연동 | 그린러브 사업자등록증 발급 후 |

---

## 핵심 기술 특이사항

- **shared 타입 변경 시**: `pnpm --filter @greenhub/shared build` 후 dist 커밋 필수
- **useStoreProducts firebaseReady 가드 금지**: 이중 인스턴스로 상품 목록 미표시
- **next/image 예외 3곳**: seller onboarding logoPreview, ImageUpload, consumer 상세 이미지 — blob URL이므로 `<img>` 유지
- **디자인 시스템 예외**: 카카오 버튼 `#FEE500/#000000` 유지, `themeColor="#2D6A4F"` 유지
- **Vercel 빌드**: lockfile 변경 시 `pnpm-lock.yaml` 반드시 함께 커밋
