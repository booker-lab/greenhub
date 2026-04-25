# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 최신화. 200라인 초과 시 50라인 이내 요약 후 아카이브.
> 아카이브: `docs/memory_archive_20260425.md`

최종 수정: 2026-04-25

---

## ✅ Consumer + Seller 디자인 시스템 리팩토링 완료

| 앱 | 플랜 | 완료일 |
|----|------|--------|
| Consumer (T0~T13) | `docs/specs/design-system.md` | 2026-04-25 |
| Seller (ST1~ST17) | `docs/specs/seller-design-system-refactor-plan.md` | 2026-04-25 |

tsc --noEmit 양쪽 0 errors 검증 완료.

---

## ✅ 드라이버앱 디자인 시스템 리팩토링 완료

| 앱 | 플랜 | 완료일 |
|----|------|--------|
| Driver (DT1~DT11) | `docs/specs/driver-design-system-refactor-plan.md` | 2026-04-25 |

tsc --noEmit 0 errors, 구 변수/hex 잔존 0건 검증 완료.

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
- **Switch onChange 패턴**: updater 내부 `e.currentTarget` null — `setForm({...form, isActive})` 패턴 사용
- **디자인 시스템 예외**: 카카오 버튼 `#FEE500/#000000` 유지, `themeColor="#2D6A4F"` 유지
- **E2E**: `apps/e2e/` — `pnpm test:e2e`, 인증 테스트는 env var 세팅 시 활성화
- **Vercel 빌드**: lockfile 변경 시 `pnpm-lock.yaml` 반드시 함께 커밋
