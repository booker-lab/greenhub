# PWA 웹앱 설계 문서 part 01

> 원본: $Path에서 2026-06-29 문서 정리 시 분리.

---

## 1. 프로젝트 개요

PWA(Progressive Web App) 기반으로 세 가지 역할의 웹앱을 개발한다.

| 앱 | 도메인 예시 | 주요 사용자 |
|---|---|---|
| 소비자 앱 | consumer.app.com | 상품을 주문하는 고객 |
| 판매자 앱 | seller.app.com | 상품을 등록하고 주문을 처리하는 판매자 |
| 배송기사 앱 | driver.app.com | 픽업 후 배달을 수행하는 기사 |

세 앱은 **공통 Firestore DB와 NestJS API 서버를 공유**하며, NextAuth.js 기반 Role로 권한을 분리한다. 실시간 데이터(주문 상태·공동구매 참여 인원·Daily Cap)는 Firestore 직접 리스너를 사용하고, 결제 검증·환불·알림 등 신뢰가 필요한 비즈니스 로직은 NestJS가 전담한다.

**MVP 범위**: 단일 판매자(디어 오키드) 고정. 처음부터 storeId 구조를 설계해 다중 판매자 전환 비용을 최소화한다.

---

## 2. 소비자 웹앱 설계

### 설계 과정

| 단계 | 내용 | 상태 |
|------|------|------|
| 1단계 | 요구사항 정의 (사용자 스토리, 기능 목록) | ✅ 완료 |
| 2단계 | 정보 구조 설계 (IA) | ✅ 완료 |
| 3단계 | 화면 설계 (Wireframe → Mockup → Prototype) | 진행 예정 |
| 4단계 | API 계약 정의 | - |
| 5단계 | 개발 (PWA 기반 → 핵심 플로우 → 부가 기능 → 고도화) | - |
| 6단계 | 테스트 & 배포 | - |

### 정보 구조 (IA)

**Main Navigation (하단 탭 5개)**

```
소비자 앱
├── 홈 (Home)
│     주요 큐레이션, 실시간 시세 급변동 상품, 이벤트 배너
│
├── 카테고리 (Category)
│     품목별 체계적 분류 (대/중/소분류 계층 구조)
│
├── 검색 (Search)
│     상품 키워드 검색 (상품명, 꽃말 등)
│
├── 장바구니 (Cart)
│     구매 예정 상품 목록 및 수량 조절
│     (공동구매 상품 제외 — 상품 상세에서 바로 결제 진입)
│
└── 마이페이지 (My Page)
      내 정보, 주문 내역, 공동구매 참여 내역, 배송지 관리, 고객센터
      PWA 홈 화면 추가 버튼 (A2HS)
```

**Sub Screens (서브 화면)**

```
├── 로그인 (Login)                        ← 독립 탭 없음
│     진입 시점 A: 미로그인 상태에서 결제하기 클릭
│     진입 시점 B: 미로그인 상태에서 마이페이지 탭 클릭
│     옵션: 카카오 / 네이버 소셜 로그인
│           이메일 로그인 / 회원가입
│     비회원 구매 미지원
│
├── 상품 상세 (Product Detail)
│     상품명, 실시간 시세 기반 가격, 생산자 정보, 소싱 경로
│     [일반 판매] 구매하기 / 장바구니 담기 버튼
│     [공동구매] 실시간 참여 인원 현황 + 마감 타이머 + 참여하기 버튼
│
├── 결제 (Checkout)
│     배송지 입력 → isMetropolitan 즉시 판별
│     배송 수단 선택 (지역 기반 자동 필터링)
│     [일반 판매] 배송 희망일 Date Picker (Daily Cap 기반 비활성)
│     [공동구매] 배송 예정일 표시만 (변경 불가, 판매자 지정)
│     배송비 자동 계산 (수단 × deliverySize)
│     결제 수단 선택: 카카오페이 / 네이버페이 / 카드 (Portone SDK)
│     [공동구매] 약관 동의: "확정 이후 취소·환불 불가에 동의" 체크 필수
│               → 미체크 시 결제 버튼 비활성화
│
├── 주문 완료 (Order Success)
│     결제 성공 확인 + 주문 현황 이동 버튼
│     [공동구매] "모집이 완료되면 주문이 확정됩니다" 안내
│               목표 미달 시 자동 취소·전액 환불 안내
│
└── 주문 현황 보드 (Order Status)
      Firestore 실시간 리스너 기반 상태 피드 (당근마켓 스타일)
      [직배송·택배] 배송 완료까지 단계별 상태 바
      [거점 픽업]   HUB_ARRIVED 단계부터 픽업 코드 표시
      [공동구매 RECRUITING]  참여 인원 현황 바 + 마감 D-day (실시간)
      [공동구매 CONFIRMED]   "공동구매 확정 — 취소 불가" 안내 배너
      [공동구매 CANCELLED]   취소 사유 + 카카오 알림톡 환불 안내
```

### 핵심 API

```
GET  /stores/:storeId/products?category=&page=
GET  /stores/:storeId/products/:id
POST /stores/:storeId/orders
GET  /stores/:storeId/orders/:id/tracking
```

### 기술 스택

| 항목 | 선택 | 비고 |
|------|------|------|
| 프론트엔드 | Next.js 15 | App Router + Server Components (소비자·판매자·드라이버 앱 공통) |
| 백엔드 API | NestJS (Layered Architecture) | 비즈니스 로직 전담 — 결제 검증·환불·알림·Daily Cap 동시성 처리 |
| 프로젝트 구조 | pnpm 모노레포 | apps/(consumer·seller·driver·api) + packages/shared |
| 공유 타입 | packages/shared | OrderStatus·Product·Store 등 3앱 공통 타입·상수 |
| 인증 | NextAuth.js | 카카오, 네이버, 이메일 Provider / NestJS JWT Guard 연동 |
| 실시간 DB | Firestore | 주문 상태·공동구매 참여 인원·Daily Cap 실시간 리스너 (WebSocket/Redis 불필요) |
| 결제 | Portone SDK | 카카오페이, 네이버페이, 카드 결제 |
| 알림 (공식) | 카카오 알림톡 | 알리고 또는 솔라피 API (건당 약 8~9원) |
| 알림 (브라우저) | FCM + Service Worker | PWA 푸시 알림 |
| PWA 도구 | Workbox | Service Worker 캐싱 전략 |
| 스타일 | Tailwind CSS | - |
| 배포 (프론트) | Vercel | 소비자·판매자·드라이버 앱 |
| 배포 (백엔드) | Railway | NestJS API 서버 (월 ~$5) |

> ⚠️ **MVP 완료 후 액션 필요**
> 카드 결제 활성화를 위해 PG사(KG이니시스 또는 NHN KCP) 계약 신청이 필요합니다.
> MVP 개발 완료 시점에 Portone 가입 + PG사 심사 진행 (심사 기간 약 2~5 영업일)

### 개발 순서

```
1. pnpm 모노레포 셋업 + packages/shared 타입 정의
   (OrderStatus, Product, Store, DeliveryMethod 등 공통 타입)
2. NestJS API 서버 셋업 (apps/api) — Layered Architecture
   (auth / orders / products / payments / notifications 모듈)
3. 소비자 앱 PWA 기반 구성 (apps/consumer)
   (manifest.json, Workbox Service Worker, 오프라인 캐싱 전략)
4. 인증 (NextAuth.js — 카카오, 네이버, 이메일 / NestJS JWT Guard 연동)
5. 핵심 플로우: 상품 목록 → 상세 → 장바구니 → 결제 → 주문 현황 보드
6. Firestore 실시간 리스너 연동 (주문 상태, 참여 인원, Daily Cap)
7. 공동구매 흐름 (RECRUITING → CONFIRMED / CANCELLED + Portone 자동 환불)
8. 배송 수단 분기 + isMetropolitan 판별 + Daily Cap Date Picker
9. 카카오 알림톡 연동 (주문 상태 변경 알림)
10. PWA 고도화: FCM 브라우저 푸시, A2HS 설치 유도, 오프라인 캐싱
11. 성능 최적화: next/image 최적화, LCP 1.5초 이내
```

---

## 3. 판매자 웹앱 설계

### 정보 구조 (IA)

```
판매자 앱
├── 인증 (판매자 전용 계정)
├── 대시보드 (오늘 주문수, 매출, 처리 대기)
├── 상품 관리
│   ├── 상품 목록
│   ├── 상품 등록/수정
│   │   ├── saleType 선택: normal(일반 판매) / group(공동구매)
│   │   ├── deliverySize 설정: small / medium / large (배송비 차등 기준)
│   │   └── [공동구매] 최소/최대 인원, 모집 마감일, 배송 예정일, 배송 수단 지정
│   └── 공동구매 현황 (모집 중 / 확정 / 취소 상태별 확인)
├── 주문 관리
│   ├── 신규 주문 (ACCEPTED → PREPARING 처리)
│   ├── 배송 요청 (PREPARING → DELIVERING 처리, 드라이버 배정)
│   └── 완료 / 취소
├── 배송 관리
│   ├── 일별 캐파 설정 (Daily Cap — 직배송 + 거점 픽업 합산 수용량)
│   ├── 배송비 설정 (직배송 / 거점 픽업 / 택배 기본 배송비 + 무료 배송 기준)
│   └── 기상 제한 모드 (활성화 시 소비자 결제 화면 택배 옵션 자동 비활성)
├── 정산 관리
│   ├── 매출 현황
│   └── 정산 내역
└── 가게 설정
    └── 공지사항
```

---

## 4. 소비자 ↔ 판매자 연동 구조

### 아키텍처

```
┌─────────────────┐         ┌─────────────────┐
│   소비자 앱      │         │   판매자 앱      │
│  (consumer PWA) │         │  (seller PWA)   │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │      HTTPS (REST API)     │
         └──────────┬────────────────┘
                    │
         ┌──────────▼────────────┐
         │      Backend API      │
         │  (NestJS — Railway)   │
         └──────────┬────────────┘
                    │
         ┌──────────▼────────────┐
         │       Firestore       │
         │  users / products /   │
         │  orders / stores /    │
         │  dailyCaps (실시간)    │
         └───────────────────────┘
```

### 실시간 연동 방법

Firestore 실시간 리스너를 단일 실시간 채널로 사용한다. WebSocket / SSE / Redis 별도 구성 없음.

```
주문 상태 변경   → Firestore 실시간 리스너 (클라이언트 자동 반영)
공동구매 참여 수 → Firestore 실시간 리스너 (currentParticipants 필드)
Daily Cap 잔여량 → Firestore 실시간 리스너 (usedSlots 필드)
주문 알림        → 카카오 알림톡 (공식) + FCM (브라우저 푸시)
```

### 역할 분리 (NextAuth.js)

```json
// 소비자 토큰
{ "userId": "123", "role": "consumer" }

// 판매자 토큰
{ "userId": "456", "role": "seller", "storeId": "789" }

// 배송기사 토큰
{ "userId": "789", "role": "driver" }
```

API 접근 제어:
```
GET  /stores/:storeId/products          → 누구나
POST /stores/:storeId/products          → seller만 (자기 storeId)
PATCH /stores/:storeId/orders/:id       → seller (자기 가게 주문만)
GET  /stores/:storeId/orders/:id        → consumer (자기 주문만) or seller
```

### 앱 분리 전략

| 방법 | 설명 | 장점 | 단점 |
|------|------|------|------|
| 완전 분리 (권장) | consumer.app.com / seller.app.com | 번들 작음, 독립 배포 | 초기 설정 비용 |
| 단일 앱 + 역할 분기 | yourapp.com / yourapp.com/seller | 코드 공유 쉬움 | 번들 커짐 |

---
