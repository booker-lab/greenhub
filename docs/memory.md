# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `docs/memory_archive_20260425.md`

최종 수정: 2026-05-02 (세션3)

---

## ✅ 완료된 작업

| 항목 | 커밋 | 완료일 |
|------|------|--------|
| Consumer 디자인 시스템 (T0~T13) | `0ff8ada` | 2026-04-25 |
| Seller 디자인 시스템 (ST1~ST17) | `e2cccd8` | 2026-04-25 |
| Driver 디자인 시스템 (DT1~DT11) | `e64b629` | 2026-04-25 |
| next/image 전환 (1·2순위 최적화) | `b3d0625` | 2026-04-26 |
| HeroBanner SSR 전환 + products/[id] 분리 (3순위) | `a1560c5` | 2026-04-27 |
| Mantine CSS treeshaking + Pretendard self-hosting (6순위) | `d8e7d02` | 2026-04-28 |
| PWA RSC CORS 오류 수정 | `ccab465` | 2026-04-28 |
| 상품등록 플로우 버그 4건 수정 | `b9f35f4` | 2026-05-01 |
| DS 지침 준수 감사 + 아토믹 플랜 수립 | 문서만 | 2026-05-02 |
| DS 리팩토링 T0~T9 완료 (위반 18건 수정) | `9a5d45f` | 2026-05-02 |
| e2e DS 회귀 스펙 추가 (consumer-design-system.spec.ts) | `50acdbc` | 2026-05-02 |
| e2e 전체 suite 검증 + 스펙 버그 3건 수정 | `3d23fd6` | 2026-05-02 |

---

## 🔜 다음 세션 착수 작업

**e2e 전체 suite 113/138 통과 (24 skipped=인증필요, 1 flaky=네트워크)** — 모든 실제 검증 항목 green.

### 🔜 다음 세션 최우선

- 네이버페이 채널키 승인 이메일 수신 후 Vercel 환경변수 설정
- 알리고 ↔ 카카오 연동 (사업자등록증 발급 후)

---

## 성능 현황

| 지표 | 기준선(모바일) | 3순위 후(데스크탑) | 목표 |
|------|--------------|------------------|------|
| Performance | 53 | **99** | 80+ |
| LCP | 19.2s | **0.9s** | <3s |
| CLS | 0.204 | **0** | ~0 |

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
| 네이버페이 채널키 | 승인 이메일 수신 후 Vercel 환경변수 설정 |
| 알리고 ↔ 카카오 연동 | 그린러브 사업자등록증 발급 후 |

---

## 핵심 기술 특이사항

- **gemini-3-flash-preview**: 유효한 모델명 (2025-12 출시), 변경 금지
- **shared 타입 변경 시**: `pnpm --filter @greenhub/shared build` 후 dist 커밋 필수
- **useStoreProducts firebaseReady 가드 금지**: 이중 인스턴스로 상품 목록 미표시
- **next/image 예외 3곳**: seller onboarding logoPreview, ImageUpload, consumer 상세 이미지 — blob URL이므로 `<img>` 유지
- **Mantine CSS 선택적 import**: `aggressiveFrontEndNavCaching: false` 필수 유지
- **Pretendard 폰트**: `scripts/copy-fonts.cjs` postinstall 자동 실행, git에 woff2 미포함
- **DS 폰트 예외**: BottomNav/ProductTopBar 라벨(10px), 주문상태 뱃지(12px), 카운트다운(13px), Stepper 설명(12px) — `apps/consumer/CLAUDE.md` 등록 완료
