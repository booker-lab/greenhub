# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `docs/memory_archive_20260425.md`

최종 수정: 2026-04-27

---

## ✅ 완료된 작업

| 항목 | 커밋 | 완료일 |
|------|------|--------|
| Consumer 디자인 시스템 (T0~T13) | `0ff8ada` | 2026-04-25 |
| Seller 디자인 시스템 (ST1~ST17) | `e2cccd8` | 2026-04-25 |
| Driver 디자인 시스템 (DT1~DT11) | `e64b629` | 2026-04-25 |
| next/image 전환 (1·2순위 최적화) | `b3d0625` | 2026-04-26 |
| HeroBanner CLS 스켈레톤 수정 | `bc25031` | 2026-04-26 |
| **HeroBanner SSR 전환 + products/[id] 분리 (3순위)** | `a1560c5` | 2026-04-27 |

---

## 🔜 다음 세션 — 5·6순위 성능 최적화

### 5순위: www 리디렉션 제거

**플랜**: `docs/specs/perf-redirect-optimization.md`

착수 순서:
1. T0: `curl -I https://www.greenlove.co.kr` 로 리디렉션 체인 진단
2. T1: Vercel 대시보드 → Domains → www 리디렉션 설정 최적화
3. T2: HSTS 헤더 추가 (T0 결과에서 HTTP→HTTPS 반복 확인 시만)
4. T3: 빌드 검증 (T2 적용 시)
5. T4: 재측정

**주의**: 주 작업이 Vercel 대시보드 설정 — 코드 변경 최소.

### 6순위: Mantine CSS Treeshaking

**플랜**: `docs/specs/perf-mantine-treeshaking.md`

착수 순서:
1. T0: 3앱 + @greenhub/ui 패키지에서 실제 사용 Mantine 컴포넌트 목록 추출 (필수)
2. T1: Consumer globals.css → 선택적 import 전환
3. T2: @greenhub/ui style.css Mantine import 중복 여부 확인
4. T3: Seller · Driver 동일 적용
5. T4: **시각적 회귀 검사 (생략 금지)**
6. T5: tsc + 빌드 + CSS 크기 비교
7. T6: Lighthouse 재측정

**주의**: T0 컴포넌트 목록 없이 진행 금지. 시각적 회귀 위험 있음.

---

## 성능 현황

| 지표 | 기준선(모바일) | 3순위 후(데스크탑) | 목표 |
|------|--------------|------------------|------|
| Performance | 53 | **99** | 80+ |
| LCP | 19.2s | **0.9s** | <3s |
| CLS | 0.204 | **0** | ~0 |
| TBT | 230ms | **0ms** | <150ms |

**주의**: 3순위 측정은 데스크탑 기준 (로컬 환경 모바일 PAGE_HUNG). 실사용자 모바일 수치는 Vercel Speed Insights 확인 필요.

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

- **shared 타입 변경 시**: `pnpm --filter @greenhub/shared build` 후 dist 커밋 필수
- **useStoreProducts firebaseReady 가드 금지**: 이중 인스턴스로 상품 목록 미표시
- **next/image 예외 3곳**: seller onboarding logoPreview, ImageUpload, consumer 상세 이미지 — blob URL이므로 `<img>` 유지
- **디자인 시스템 예외**: 카카오 버튼 `#FEE500/#000000` 유지, `themeColor="#2D6A4F"` 유지
- **Vercel 빌드**: lockfile 변경 시 `pnpm-lock.yaml` 반드시 함께 커밋
- **HeroBanner SSR 주의**: AbortController 3초 timeout 필수 — API 미구동 시 빌드 hang 방지
- **products/[id] 구조**: page.tsx(서버) + ProductImages/ProductInfo/ProductActions(_components/). useGroupProduct·useDailyCap은 onSnapshot 실시간이라 클라이언트 유지
- **Store 공개 API 없음**: useStore는 클라이언트 훅 유지 (서버 이전 불가)
