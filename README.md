# Green Love

화훼·농산물 직거래 플랫폼. 소비자·판매자·드라이버 3개 앱과 REST API 서버로 구성된 pnpm 모노레포입니다.

---

## 앱 구성

| 앱 | 역할 | URL |
|----|------|-----|
| `apps/consumer` | 소비자 PWA — 상품 탐색·주문·결제 | [greenlove.co.kr](https://greenlove.co.kr) |
| `apps/seller` | 판매자 대시보드 — 상품 등록·주문 관리·정산 | [seller.greenlove.co.kr](https://seller.greenlove.co.kr) |
| `apps/driver` | 드라이버 앱 — 배송 보드·실시간 지도 | [driver.greenlove.co.kr](https://driver.greenlove.co.kr) |
| `apps/api` | NestJS REST API — 비즈니스 로직 전담 | [Railway](https://api-production-13e7.up.railway.app) |
| `apps/shared` | 도메인 엔티티·타입 공유 패키지 | — |

---

## 기술 스택

**Frontend** — Next.js 16 (App Router) · React 19 · Tailwind CSS v4 · PWA (`@ducanh2912/next-pwa`)

**Backend** — NestJS · Firestore (실시간 리스너) · Firebase Auth (Custom Token) · Firebase Storage

**인증** — NextAuth.js v5 · 카카오 OAuth · 네이버 OAuth

**결제** — Portone v2 · HMAC 웹훅 검증 · 네이버페이 (연동 예정)

**인프라** — pnpm 모노레포 · Railway (API) · Vercel (3개 프론트) · Firebase `green-e4fe3` (asia-northeast3)

---

## 핵심 도메인

### 판매 방식

- **일반 판매** — 즉시 결제 후 `ACCEPTED → PREPARING → DELIVERING → DELIVERED → REVIEWED`
- **공동구매** — `RECRUITING` 기간 내 최소 참여 인원 달성 시 `CONFIRMED`로 전환, 미달 시 자동 환불

### 주문 상태 전체

```
PENDING → ACCEPTED → PREPARING → DELIVERING → DELIVERED → REVIEWED
                                            ↘ HUB_ARRIVED → PICKED_UP

PENDING → RECRUITING → CONFIRMED → PREPARING → ...
                     ↘ CANCELLED (마감 미달 자동 환불)

모든 상태 → CANCELLED (판매자 강제 취소 / 소비자 RECRUITING 구간 취소)
```

### 배송 방식

- 직배송 · 택배 · **거점 픽업** (`HUB_ARRIVED → PICKED_UP`)

---

## 로컬 개발 환경

**요구사항**: Node.js ≥ 20, pnpm ≥ 9

```bash
# 의존성 설치
pnpm install

# 개발 서버 (각각 별도 터미널)
pnpm dev:consumer       # consumer 앱
pnpm dev:api            # NestJS API

# 전체 빌드
pnpm build

# 타입 검사
pnpm typecheck
```

환경 변수는 각 앱 디렉터리의 `.env.local` (프론트) / `.env` (API)에 설정합니다.

---

## 프로젝트 문서

| 문서 | 내용 |
|------|------|
| [docs/memory.md](docs/memory.md) | 세션 진행 상태 · 배포 현황 · 기술 특이사항 SSOT |
| [docs/CRITICAL_LOGIC.md](docs/CRITICAL_LOGIC.md) | 되돌리기 어려운 설계 결정 이력 |
| [docs/BACKLOG.md](docs/BACKLOG.md) | 기능 백로그 |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | 알려진 이슈 및 해결법 |
| [docs/specs/](docs/specs/) | 도메인별 상세 스펙 |

---

## 아키텍처 원칙

- **SDD (Spec-Driven Design)** — 신규 기능은 `docs/specs/`에 선(先) 설계 후 구현
- **레이어 분리** — 비즈니스 로직은 NestJS API 서버에만 위치. 프론트는 Firestore 리스너로 상태 수신
- **단일 파일 500라인 제한** — 초과 시 즉시 하위 모듈로 분리 (예: `orders.service.ts` → create/query/lifecycle 3개 서비스)
- **storeId UUID 기반** — 다중 판매자 전환을 고려한 구조로 설계
