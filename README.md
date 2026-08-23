<!-- Language: ko -->

# Green Love

화훼·농산물 판매를 위한 멀티앱 커머스 플랫폼입니다. 소비자 구매, 판매자 운영, 드라이버 배송, 결제·알림·정산을 하나의 pnpm 모노레포에서 관리합니다.

## 저장소 구성

| 경로 | 역할 |
|---|---|
| `apps/consumer` | 소비자 Next.js PWA — 상품 탐색, 장바구니, 주문, 결제, 마이페이지 |
| `apps/seller` | 판매자·관리자 Next.js PWA — 상품, 주문, 회차, 정산, 운영 관리 |
| `apps/driver` | 드라이버 Next.js PWA — 배송 보드, 지도, 배송 상태·사진 처리 |
| `apps/api` | NestJS REST API — 인증, 상품, 주문, 결제, 알림, 정산 등 중앙 비즈니스 로직 |
| `apps/e2e` | Playwright 기반 consumer·seller·driver·API 통합 검증 |
| `packages/shared` | 앱 간 공유 도메인 타입과 순수 유틸리티 |
| `packages/ui` | 공통 Mantine 테마와 CSS 디자인 토큰 |
| `scripts` | 시드, 진단, 마이그레이션, E2E·운영 보조 도구 |
| `tests` | Firebase Rules 및 k6 검증 |

workspace 범위는 `pnpm-workspace.yaml`의 `apps/*`, `packages/*`, `scripts`입니다.

## 기술 스택

**Frontend** — Next.js 16 App Router · React 19 · Mantine 9 · PWA (`@ducanh2912/next-pwa`) · Firebase client

**Backend** — NestJS 11 · Firebase Admin · Firestore · Firebase Storage · Scheduler · Swagger

**인증** — NextAuth.js v5 · 카카오 OAuth. 자동화 테스트용 Credentials Provider는 `x-e2e-test-token` 헤더가 유효할 때만 허용되는 E2E 전용 경로입니다.

**결제** — PortOne v2. 결제 조회·최종화·환불과 주문 부가 청구 로직은 API가 소유합니다.

**알림** — API 알림 모듈이 템플릿·사용자 수신 설정·공급자 호출을 담당합니다. 외부 공급자의 현재 승인·운영 준비 상태는 `docs/memory.md`와 활성 HANDOFF에서 확인합니다.

**인프라** — pnpm 10 · Vercel(consumer/seller/driver) · Railway(API) · Firebase · GitHub Actions

## 핵심 도메인

### Legacy 판매

기존 상품은 일반 판매와 공동구매를 지원합니다.

- 일반 판매: 결제 후 주문 수락 → 준비 → 배송 → 완료
- 공동구매: 모집 수량과 마감 조건에 따라 확정 또는 취소·환불
- 배송 방식: `direct` · `hub` · `parcel`

공통 주문 상태와 DTO는 `packages/shared/src/order.types.ts`가 소유합니다.

### 회차 직배송

회차 판매는 `SaleRound`를 기준으로 판매 시간, 배송 지역, 주소·수량 한도, 회차 상품을 관리합니다.

주요 구성은 다음과 같습니다.

- `apps/api/src/sale-rounds` — 회차 생성·상태 관리
- `apps/api/src/orders` — 회차 주문 예약·생성·상태 전이
- `apps/api/src/payments` — 결제 최종화·환불·재배송비 청구
- `apps/api/src/operations` — 결제·환불·알림·재배송 등 운영 예외 기록과 조치
- `apps/api/src/retention` — 보존 기간 만료 데이터 정리
- seller 회차 화면, consumer 회차 구매 흐름, driver 직배송 흐름
- `apps/e2e`의 다역할 회차 직배송 시나리오

회차 도메인 공통 타입은 `packages/shared/src/sale-round.types.ts`에 있습니다.

## 아키텍처 원칙

- **서버 쓰기와 핵심 비즈니스 규칙은 `apps/api`가 소유**합니다.
- **공개 DTO·상태·공통 유틸리티는 `packages/shared`가 소유**합니다.
- 각 frontend는 화면 상태와 사용자 상호작용을 담당하고 API 및 허용된 Firebase client 읽기 경로를 사용합니다.
- Firebase 권한은 `firestore.rules`, `storage.rules`, 인덱스는 `firestore.indexes.json`에서 관리합니다.
- 다역할 사용자 흐름의 최종 회귀 검증은 `apps/e2e`가 담당합니다.
- 신규 기능 또는 공개 계약 변경은 관련 `docs/specs/`를 확인하고 구현과 함께 정합화합니다.

## 로컬 개발과 검증

요구사항: Node.js ≥ 20, pnpm ≥ 9

```bash
pnpm install

# 개발 서버
pnpm dev:consumer
pnpm dev:api

# 전체 production build 대상
pnpm build

# workspace typecheck
pnpm typecheck

# Firebase Rules
pnpm test:firestore-rules
pnpm test:storage-rules

# Playwright E2E
pnpm test:e2e
```

`pnpm lint`는 workspace별 lint를 재귀 실행하며 API lint는 수정형(`--fix`)이므로 읽기 전용 검증 용도로 사용하기 전에 실제 스크립트를 확인해야 합니다.

환경 변수는 저장소에 비밀값을 기록하지 않고 각 실행 환경에서 관리합니다.

## 문서 SSOT

문서가 충돌할 때는 현재 코드·설정·테스트와 직접 확인한 Git/GitHub 상태를 우선합니다.

| 문서 | 역할 |
|---|---|
| `AGENTS.md` | 저장소 작업 규칙과 승인 경계 |
| `docs/memory.md` | 현재 브랜치, 활성 작업, 차단 요인, 다음 작업의 현재 상태 SSOT |
| `docs/PROJECT_MAP.md` | 저장소 영역과 필요한 Context를 찾는 라우터 |
| `docs/BACKLOG.md` | 미완료·향후 작업 목록 |
| `docs/specs/` | API·도메인·운영 계약 |
| `docs/CRITICAL_LOGIC.md` | 되돌리기 어려운 설계 결정과 이유 |
| `docs/TROUBLESHOOTING.md` | 알려진 문제와 해결 기록 |
| `docs/URLS.md` | 환경별 URL |

현재 출시 상태, 활성 PR, 외부 서비스 승인 상태처럼 자주 변하는 정보는 README에 복제하지 않고 `docs/memory.md`와 그 문서가 지정한 활성 PLAN·HANDOFF를 따릅니다.
