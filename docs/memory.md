# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `docs/memory_archive_20260425.md`

최종 수정: 2026-04-28

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
| **5순위: www 리디렉션 제거** (Vercel 대시보드) | 코드 변경 없음 | 2026-04-28 |
| **6순위: Mantine CSS treeshaking + Pretendard self-hosting** | `d8e7d02` | 2026-04-28 |
| **PWA RSC CORS 오류 수정** (aggressiveFrontEndNavCaching 비활성화) | `ccab465` | 2026-04-28 |

---

## 🔜 다음 세션 착수 작업

### 1. e2e 검증 실행

배포 완료 후 e2e 실행:
```bash
pnpm --filter e2e exec playwright test perf-css-regression --reporter=list
pnpm test:e2e
```

### 2. 홈 상품 Skeleton 고정 확인

- **증상**: `greenlove.co.kr` 홈에서 공동구매·전체상품 섹션이 Skeleton 고정
- **유력 원인**: Railway API cold start (배포 직후 일시적) 또는 클라이언트 Firebase 연결
- **확인 방법**: 탭 줄인 후 새로고침 → 지속되면 Vercel 환경변수 `NEXT_PUBLIC_API_URL` 확인
- **관련 훅**: `apps/consumer/src/hooks/useProducts.ts` — `NEXT_PUBLIC_API_URL/products` 호출

### 3. 브라우저 서비스워커 강제 초기화 (첫 방문 시 권장)

개발자도구 → Application → Service Workers → Unregister 후 새로고침

---

## 성능 현황

| 지표 | 기준선(모바일) | 3순위 후(데스크탑) | 목표 |
|------|--------------|------------------|------|
| Performance | 53 | **99** | 80+ |
| LCP | 19.2s | **0.9s** | <3s |
| CLS | 0.204 | **0** | ~0 |
| TBT | 230ms | **0ms** | <150ms |

**모바일 실측 미완료** — Vercel Speed Insights에서 확인 필요.

---

## 6순위 작업 결과 (2026-04-28)

| 항목 | 결과 |
|------|------|
| Mantine CSS | 239KB → Consumer 72KB / Seller 79KB / Driver 50KB (raw) |
| Pretendard | jsdelivr CDN 제거 → `public/fonts/` self-hosting |
| 폰트 복사 | `scripts/copy-fonts.cjs` + `postinstall` 자동 실행 |
| Mantine v9 주의 | `TextInput.css` / `Select.css` / `Textarea.css` 없음 — `Input.css` + `Combobox.css`로 대체 |
| Driver import | 더블쿼트(`"`) 사용 — 싱글쿼트 grep 불가, 스펙 수정 완료 |
| PWA 버그 | `aggressiveFrontEndNavCaching: true` → RSC 요청 서비스워커 캐시 실패로 CORS 오류. `false`로 수정 |

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
- **Mantine CSS 선택적 import**: `aggressiveFrontEndNavCaching: false` 필수 유지 — true 복원 시 RSC CORS 재발
- **Pretendard 폰트**: pnpm install 시 `scripts/copy-fonts.cjs`가 자동 실행되어 각 앱 `public/fonts/`에 복사됨. git에 woff2 미포함
