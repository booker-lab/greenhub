# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `docs/memory_archive_20260425.md`

최종 수정: 2026-05-03 (세션5)

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
| DS 리팩토링 T0~T9 완료 (위반 18건 수정) | `9a5d45f` | 2026-05-02 |
| e2e DS 회귀 스펙 추가 + 전체 suite 검증 | `50acdbc` `3d23fd6` | 2026-05-02 |
| 툴체인 도입 (TruffleHog + Just + Biome) | `0c77aca`~`0a6faa0` | 2026-05-03 |
| a11y 접근성 38건 수정 (biome error 승격) | `30a21f7`~`988a43f` | 2026-05-03 |

---

## 🔜 다음 세션 착수 작업

### 최우선 — e2e DS 회귀 검증

a11y 수정으로 변경된 파일이 다수 → DS 회귀 확인 필요.

```bash
pnpm --filter e2e exec playwright test consumer-design-system --reporter=list
```

실패 시: `docs/specs/` 내 해당 스펙 파일 확인 후 수정.

### 외부 조건 대기

- 네이버페이 채널키 승인 이메일 수신 후 Vercel 환경변수 설정
- 알리고 ↔ 카카오 연동 (사업자등록증 발급 후)

---

## 툴체인 현황 (2026-05-03 기준)

| 도구 | 상태 | 역할 |
|------|------|------|
| TruffleHog 3.95.2 | ✅ | git 히스토리 시크릿 스캔 |
| Just 1.50.0 | ✅ | 태스크 러너 (Justfile) |
| Biome 2.4.14 | ✅ | consumer/seller/driver 린터+포매터, api 포매터 |

**biome.json 주요 설정**:
- `unsafeParameterDecoratorsEnabled: true` — NestJS 파라미터 데코레이터 파싱
- CSS `@import` 순서 규칙 off — Mantine CSS 패턴 false positive
- a11y 규칙 3종 전부 수정 완료 → `recommended` 기본 error로 복귀

---

## 성능 현황

| 지표 | 기준선(모바일) | 최적화 후 | 목표 |
|------|--------------|----------|------|
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

## 핵심 기술 특이사항

- **gemini-3-flash-preview**: 유효한 모델명 (2025-12 출시), 변경 금지
- **shared 타입 변경 시**: `pnpm --filter @greenhub/shared build` 후 dist 커밋 필수
- **useStoreProducts firebaseReady 가드 금지**: 이중 인스턴스로 상품 목록 미표시
- **`<img>` 예외 3곳**: seller onboarding logoPreview, ImageUpload, consumer 상세 이미지 — blob URL이므로 biome `noImgElement` warn 유지
- **Mantine CSS 선택적 import**: `aggressiveFrontEndNavCaching: false` 필수 유지
- **Pretendard 폰트**: `scripts/copy-fonts.cjs` postinstall 자동 실행, git에 woff2 미포함
- **DS 폰트 예외**: BottomNav/ProductTopBar 라벨(10px), 주문상태 뱃지(12px), 카운트다운(13px), Stepper 설명(12px)
