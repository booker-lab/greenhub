# PWA 웹앱 설계 문서
> 소비자 / 판매자 / 배송기사 3자 연동 구조

작성일: 2026-03-18
최종 수정: 2026-03-20

---

## 목차

1. [프로젝트 개요](#1-프로젝트-개요)
2. [소비자 웹앱 설계](#2-소비자-웹앱-설계)
3. [판매자 웹앱 설계](#3-판매자-웹앱-설계)
4. [소비자 ↔ 판매자 연동 구조](#4-소비자--판매자-연동-구조)
5. [배송 구조](#5-배송-구조)
6. [배송기사 웹앱 설계](#6-배송기사-웹앱-설계)
7. [3자 전체 연동 흐름](#7-3자-전체-연동-흐름)
8. [전체 시스템 아키텍처](#8-전체-시스템-아키텍처)
9. [주문 상태 머신](#9-주문-상태-머신)
10. [개발 우선순위 (Phase)](#10-개발-우선순위-phase)
11. [보안 체크리스트](#11-보안-체크리스트)

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

## 5. 배송 구조

### 하이브리드 3모델 확정

| 모델 | 방식 | 대상 지역 | 특징 |
|------|------|----------|------|
| Model A: 꽃차 직배송 (direct) | 드라이버 앱 연동, 판매자 직접 이행 | 수도권 (서울/경기) | 신선 화훼 전용, 온도 관리 차량, 기상 무관 운영 |
| Model B: 거점 픽업 (hub) | 협력 업체(꽃집, 과일가게 등)에 배송 후 소비자 픽업 | 수도권 (서울/경기) | 물류비 절감, 소비자 수령 유연성 |
| Model C: 택배 (parcel) | 외부 택배사 연동 | 전국 | 포장 표준화 필요, 기상 조건 가변 운영 |

### 배송 수단 분기 — isMetropolitan 기반 자동 필터링

```
소비자가 배송지 입력 시 주소 API로 isMetropolitan 즉시 판별
  ↓
isMetropolitan = true  (서울/경기):  [꽃차 직배송] [거점 픽업] [택배] 중 선택
isMetropolitan = false (기타 지역):  [택배]만 표시

기상 제한 모드 활성 시 (판매자 앱에서 수동 제어):
  → [택배] 옵션 자동 비활성화
  → 안내 문구: "현재 기온 조건으로 인해 택배 배송이 일시 중단되었습니다"
  → 꽃차 직배송은 기상 무관 정상 운영
```

### 배송비 정책

**MVP 임시 단가 (판매자 앱에서 수정 가능)**

| 배송 유형 | 기본 배송비 | 무료 배송 기준 |
|----------|-----------|--------------|
| 꽃차 직배송 | 3,000원 | 50,000원 이상 |
| 거점 픽업 | 1,000원 | 30,000원 이상 |
| 택배 | 4,000원 | 50,000원 이상 |
| 공동구매 | 할인 배송비 (판매자 설정) | 이벤트 시 무료 설정 가능 |

**품목 사이즈별 배송비 차등 (deliverySize — 판매자가 상품 등록 시 설정)**

| 사이즈 | 추가 배송비 | 예시 품목 |
|--------|-----------|---------|
| small | 기본 배송비 | 꽃다발, 소형 화분 |
| medium | 기본 + 1,000원 | 꽃바구니, 중형 화분 |
| large | 기본 + 3,000원~ | 화환, 대형 식물 |

### 거점 픽업 인증 방식

```
MVP: 픽업 코드 (주문번호 6자리) 방식
  소비자:    앱에서 "픽업 코드 123456" 확인
  거점 업체: 코드 대조 후 상품 전달 (별도 앱 불필요)
  드라이버:  거점 도착 후 드라이버 앱에서 HUB_ARRIVED 상태 업데이트

Phase 2: QR 스캔 방식으로 고도화
  → 드라이버 앱 카메라 스캔 → Firestore 상태 자동 업데이트
```

### Daily Cap (일별 배송 수용량)

```
설정 주체: 판매자 (판매자 앱 → 배송 관리 → 일별 캐파 설정)
적용 범위: 직배송 + 거점 픽업 합산 (MVP 인력 부족 대응)

동작:
  1. 판매자가 날짜별 최대 수용량 설정 (예: 2026-03-25 → 30건)
  2. 소비자 Date Picker에서 날짜 선택 시 Firestore 잔여 슬롯 실시간 조회
  3. 잔여 슬롯 > 0 → 날짜 활성 / 잔여 슬롯 = 0 → Sold Out 비활성
  4. 결제 최종 확인 시 재검증 → 동시 주문 초과 시 결제 차단
```

---

## 6. 배송기사 웹앱 설계

### 정보 구조 (IA)

```
배송기사 앱
├── 인증 (기사 전용 계정)
├── 홈 (현재 상태: 대기중 / 배달중)
├── 배달 목록
│   ├── 오늘의 배달 주문 확인 (판매자가 직접 배정한 주문)
│   └── 주문 상세 (픽업지, 배달지, 배송 수단, 픽업 코드)
├── 현재 배달
│   ├── 픽업 이동 → 픽업 완료 처리 (→ status: DELIVERING)
│   ├── [직배송·택배] 배달 완료 처리 (→ status: DELIVERED)
│   └── [거점 픽업]  거점 도착 처리 (→ status: HUB_ARRIVED)
├── 배달 내역
│   └── 날짜별 완료 목록
├── 정산
│   ├── 오늘 수익
│   └── 기간별 정산
└── 내 정보
    ├── 차량 정보
    └── 계좌 정보
```

> **MVP**: 판매자가 드라이버 앱에서 주문 목록 확인 후 직접 배정. 자동 배차 알고리즘 없음.
> 이후 데이터 축적 → Phase 2에서 외부 드라이버 모집 시 자동 배차 시스템 도입.

### 배송기사 앱 핵심 PWA 기능

| 기능 | 사용 기술 | Phase |
|------|----------|-------|
| 배달 상태 업데이트 | Firestore 실시간 리스너 | MVP |
| 타임라인 피드 (상태 변경 이벤트) | Firestore onSnapshot | MVP |
| 픽업 코드 확인 | 주문 상세 화면 표시 | MVP |
| 배달 배정 알림 수신 | FCM 푸시 알림 | MVP |
| 실시간 위치 추적 | Geolocation API (백그라운드) | Phase 2 |
| 지도 네비게이션 | Kakao Map / Google Maps API | Phase 2 |
| QR 스캔 기반 거점 픽업 인증 | MediaDevices API (카메라) | Phase 2 |

---

## 7. 3자 전체 연동 흐름

### 일반 판매 — 직배송 / 택배

```
소비자                  백엔드/Firestore          판매자                배송기사
  │                      │                      │                      │
  ①──── 결제 완료 ────────▶│  status: ACCEPTED     │                      │
  │◀── Firestore 리스너 ───│──── 알림톡 발송 ────────▶│                      │
  │    (ACCEPTED 반영)    │  (신규 주문 접수)      │                      │
  │                      │                      │                      │
  │                      │                   ②상품 준비 처리
  │                      │◀── status: PREPARING ─│                      │
  │◀── Firestore 리스너 ───│                      │                      │
  │    (PREPARING 반영)   │                      │                      │
  │                      │                      │                      │
  │                      │              ③드라이버 배정 및 출발            │
  │                      │──── 배달 배정 FCM ──────────────────────────▶│
  │                      │◀─────────────── status: DELIVERING ───────────│
  │◀── Firestore 리스너 ───│                      │               ④배달 이동
  │    (DELIVERING 반영)  │──── 알림톡 발송 ────────▶│                      │
  │◀── 알림톡 수신 ─────────│                      │                      │
  │                      │                      │                ⑤배달완료
  │                      │◀─────────────── status: DELIVERED ────────────│
  │◀── Firestore 리스너 ───│──── 알림톡 발송 ────────▶│                      │
  │◀── 알림톡 수신 ─────────│                      │                      │
  │                      │                      │                      │
  ⑥구매확정/리뷰 작성       │                      │                      │
  │──── status: REVIEWED ▶│                      │                      │
```

### 일반 판매 — 거점 픽업 (Model B)

```
                        ... DELIVERING까지 위와 동일 ...
  │                      │                      │                ⑤거점 도착
  │                      │◀─────────────── status: HUB_ARRIVED ──────────│
  │◀── Firestore 리스너 ───│──── 알림톡 발송 ────────▶│                      │
  │◀── 알림톡 수신 ─────────│  픽업 코드 활성화     │                      │
  │   (픽업 코드 화면 표시) │                      │                      │
  │                      │                      │                      │
  ⑥소비자 픽업            │                      │                      │
  │──── status: PICKED_UP ▶│                      │                      │
  │                      │                      │                      │
  ⑦구매확정/리뷰           │                      │                      │
  │──── status: REVIEWED ▶│                      │                      │
```

### 공동구매

```
소비자                  백엔드/Firestore          판매자
  │                      │                      │
  ①── 동의 체크 후 결제 ───▶│  status: RECRUITING   │
  │   (GroupBuyOptionSheet│  currentParticipants +1
  │    동의 체크 필수)     │  groupBuyConsent 저장 │
  │◀── Firestore 리스너 ───│──── 알림톡(본인) ───────│
  │    (참여 인원 갱신)    │  "OO 모집 참여 완료"  │
  │                      │                      │
  [RECRUITING 중 개인 취소 시]
  │──── 취소 요청 ──────────▶│                      │
  │                      │  status: CANCELLED    │
  │                      │  currentParticipants -1 (트랜잭션)
  │                      │  Portone 환불 API 호출 │
  │◀── 알림톡(본인만) ─────│  다른 참여자 알림 없음 │
  │                      │                      │
  [최소 인원 달성 시]
  │                      │  status: CONFIRMED    │
  │◀── Firestore 리스너 ───│──── 알림톡(전체) ───────│
  │◀── 알림톡 수신 ─────────│  "주문이 확정됐습니다!" │
  │   ※ CONFIRMED 이후    │                      │
  │     취소 불가          │  status: PREPARING   │
  │◀── 알림톡(전체) ─────────│  "상품 준비 시작"     │
  │                      │  status: DELIVERING  │
  │◀── 알림톡(전체) ─────────│  "배송이 시작됐습니다"│
  │                      │                      │
  ... DELIVERED → REVIEWED ...

  [마감까지 미달 시]
  │                      │  status: CANCELLED    │
  │◀── Firestore 리스너 ───│──── 알림톡(전체) ───────│
  │◀── 알림톡 수신 ─────────│  "[목표 미달 취소]"    │
  │   (Portone 자동 환불)  │  + Portone 환불 API  │
```

---

## 8. 전체 시스템 아키텍처

```
┌──────────────────────────────────────────────────────────┐
│                      Frontend (PWA)                      │
│                                                          │
│  consumer.app.com   seller.app.com   driver.app.com      │
│  [소비자 PWA]        [판매자 PWA]      [배송기사 PWA]       │
└──────────────┬───────────┬───────────────┬───────────────┘
               │           │               │
               │         HTTPS             │
               │           │               │
┌──────────────▼───────────▼───────────────▼───────────────┐
│              Next.js API Routes (공통 서버)                │
│              (NextAuth.js 인증, Rate Limiting)             │
└──────────────────────────┬───────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────────┐
        │                  │                      │
┌───────▼──────────────┐  ┌▼────────────────────┐ │
│       Firestore      │  │  카카오 알림톡 API    │ │
│                      │  │  (알리고 / 솔라피)    │ │
│  stores              │  └─────────────────────┘ │
│  products            │                           │
│  groupProductConfig  │  ┌─────────────────────┐  │
│  orders              │  │  FCM                │  │
│  dailyCaps           │  │  (브라우저 푸시 알림) │  │
│  deliveryFeeConfig   │  └─────────────────────┘  │
│                      │                           │
│  ← 실시간 리스너으로  │  ┌─────────────────────┐  │
│    모든 앱에 즉시 반영 │  │  Portone SDK        │  │
└──────────────────────┘  │  (결제 / 환불)       ◀──┘
                          └─────────────────────┘
```

---

## 9. 주문 상태 머신

세 앱이 동일한 주문 상태를 공유한다. 판매자 수락/거절 단계 없음 — 결제 완료가 곧 주문 접수.

### 일반 판매 (saleType: normal)

```
PENDING      → [내부] 결제 처리 중 (Portone webhook 수신 전, 소비자 미노출, 15분 자동 삭제)
    ↓
ACCEPTED     → 결제 완료 (주문 첫 상태)
    ↓
PREPARING    → 판매자가 상품 준비 중
    ↓
DELIVERING   → 드라이버가 픽업 후 목적지로 이동 중
    ↓
[직배송·택배] DELIVERED  → 배송 완료
[거점 픽업]  HUB_ARRIVED → 거점 도착, 픽업 대기
                ↓
             PICKED_UP  → 소비자가 픽업 코드로 수령 완료
    ↓
REVIEWED     → 구매 확정 또는 리뷰 작성 완료

(어느 단계에서든) → CANCELLED
```

### 공동구매 (saleType: group)

```
PENDING      → [내부] 결제 처리 중 (Portone webhook 수신 전, 소비자 미노출, 15분 자동 삭제)
    ↓
RECRUITING   → 즉시 결제 완료, 최소 인원 모집 중 (공동구매 첫 상태)
    │              ※ 참여 전 동의 체크박스 필수 (GroupBuyOptionSheet)
    │              ※ groupBuyConsent Firestore 저장 (법적 증거)
    │
    ├─ [개인 취소 — RECRUITING 중만 가능]
    │      → status: CANCELLED (해당 주문만)
    │      → currentParticipants -1 (Firestore 트랜잭션)
    │      → Portone 환불 API 호출 (본인만 알림톡)
    │
    ├─ [최소 인원 달성] → CONFIRMED → 이후 취소 불가
    │
    └─ [마감까지 미달]  → CANCELLED → 전체 자동 취소 + Portone 자동 환불 (전체 알림톡)
    ↓
PREPARING    → 상품 준비 중 (전체 알림톡)
    ↓
DELIVERING   → 배송 이동 중 (전체 알림톡)
    ↓
DELIVERED    → 배송 완료 (공동구매는 직배송·택배만, 거점 픽업 미지원)
    ↓
REVIEWED     → 구매 확정 또는 리뷰 작성 완료
```

**공동구매 취소 정책 요약**

| 구간 | 취소 | 환불 | 비고 |
|------|------|------|------|
| RECRUITING | ✅ 가능 | Portone 즉시 처리 | 인원 -1, 타 참여자 알림 없음 |
| CONFIRMED 이후 | ❌ 불가 | 해당 없음 | 동의 체크박스로 사전 고지 완료 |

### 앱별 상태 표시

| 상태 코드 | 소비자 노출 명칭 | 판매자 | 배송기사 | 적용 방식 |
|-----------|----------------|--------|---------|----------|
| PENDING | (미노출) | (미노출) | - | 공통 — 내부 처리 상태, 15분 자동 삭제 |
| RECRUITING | 모집 중 | 모집 중 | - | 공동구매 |
| CONFIRMED | 주문 확정 | 주문 확정 | - | 공동구매 |
| ACCEPTED | 결제 완료 | 신규 주문 접수 | - | 일반 판매 |
| PREPARING | 상품 준비 중 | 준비 중 | - | 공통 |
| DELIVERING | 배송 중 | 배송 중 | 배달 이동 중 | 공통 |
| HUB_ARRIVED | 거점 도착 | 거점 도착 | 배달 완료 | 거점 픽업 |
| PICKED_UP | 픽업 완료 | 픽업 완료 | - | 거점 픽업 |
| DELIVERED | 배송 완료 | 배송 완료 | 완료! | 직배송·택배 |
| CANCELLED | 주문 취소 | 취소 | - | 공통 |
| REVIEWED | 구매 확정 | 구매 확정 | - | 공통 |

---

## 10. 개발 우선순위 (Phase)

### Phase 1 - MVP

**공통 인프라**
- [ ] Next.js 15 프로젝트 세팅 + Firestore 연결 + Vercel 배포
- [ ] NextAuth.js 인증 (카카오, 네이버, 이메일)
- [ ] Firestore 보안 규칙 설정 (role 기반 접근 제어)

**소비자 앱**
- [ ] 상품 탐색 → 상세 → 장바구니 → 결제 핵심 플로우
- [ ] 배송 수단 선택 + isMetropolitan 분기 + Daily Cap Date Picker
- [ ] Portone SDK 결제 연동 (카카오페이, 네이버페이, 카드)
- [ ] Firestore 실시간 리스너 기반 주문 현황 보드
- [ ] 공동구매 참여 흐름 (RECRUITING → CONFIRMED / CANCELLED + 자동 환불)
- [ ] 카카오 알림톡 연동 (주문 상태 변경 알림)
- [ ] PWA 설치 유도 (A2HS, manifest.json, Service Worker)

**판매자 앱**
- [ ] 주문 현황 확인 + 상태 업데이트 (ACCEPTED → PREPARING → DELIVERING)
- [ ] Daily Cap 설정 / 배송비 설정 / 기상 제한 모드
- [ ] 상품 등록 (saleType, deliverySize, 공동구매 설정)
- [ ] 드라이버 배정 (주문별 직접 배정)

**배송기사 앱**
- [ ] 오늘의 배달 목록 확인 (판매자 배정 주문)
- [ ] 픽업 완료 → DELIVERING 처리
- [ ] 직배송·택배: 배달 완료 → DELIVERED 처리
- [ ] 거점 픽업: 거점 도착 → HUB_ARRIVED 처리
- [ ] FCM 배달 배정 알림 수신

### Phase 2

- [ ] QR 스캔 기반 거점 픽업 인증 고도화 (픽업 코드 방식 → QR)
- [ ] 지도 기반 실시간 배송 위치 추적 (Kakao Map / Google Maps)
- [ ] 배송기사 자동 배차 알고리즘 (외부 드라이버 모집 시)
- [ ] PWA 브라우저 푸시 알림 전체 연동 (FCM + Service Worker)
- [ ] 정산 시스템 (판매자별 수익 집계)

### Phase 3

- [ ] 다중 판매자 마켓플레이스 전환 (stores 테이블 확장, 가게 목록 화면)
- [ ] 지역 기반 필터링 UI 활성화
- [ ] 리뷰/평점 집계 및 노출 시스템
- [ ] 통계 대시보드 (판매자 앱)
- [ ] 오프라인 지원 고도화

---

## 11. 보안 체크리스트

### 인증 & 세션 관리

**NextAuth.js 설계 원칙**
```
Session Token  → HttpOnly Cookie에 저장 (XSS 방어)
Firestore 접근 → 서버 측 Admin SDK 또는 Firestore 보안 규칙으로 제어

❌ localStorage에 토큰 저장 (XSS에 취약)
✅ HttpOnly Cookie + Secure 플래그 사용
```

**필수 구현 항목**
- 로그인 실패 5회 시 계정 잠금
- 로그아웃 시 서버에서 세션 무효화
- 비밀번호: bcrypt / argon2로 해싱 (평문 저장 금지)

---

### API 보안

**인증 & 권한**
```
모든 API 요청 → NextAuth.js 세션 검증
역할 확인      → consumer / seller / driver 분리
소유권 확인    → 자기 데이터만 접근 가능

// 주문 조회 시 반드시 소유권 확인
order.userId === session.user.id  ← 누락 시 타인 주문 조회 가능
```

**Rate Limiting** (과도한 요청 차단)
```
로그인 시도    → 분당 5회
주문 생성      → 분당 10회
일반 API       → 분당 100회
```

**입력값 검증**
```
모든 입력값 서버에서 재검증 (클라이언트 검증만 믿으면 안됨)
Firestore 보안 규칙으로 role 및 소유권 이중 검증
XSS → 입력값 Sanitize, CSP 헤더 설정
```

---

### 결제 보안

```
❌ 카드번호, CVV를 자체 서버에 저장/전송
✅ Portone SDK 사용 (PG사에서 직접 처리)

결제 금액 반드시 서버에서 재검증:
  - 클라이언트가 보낸 금액 신뢰 금지
  - 주문 ID로 Firestore 금액 조회 후 대조
```

---

### HTTPS & 통신 보안

```
✅ 모든 통신 HTTPS (HTTP → HTTPS 리다이렉트)
✅ HSTS 헤더 설정
✅ Firestore 보안 규칙 설정 (인증된 사용자만 자기 데이터 접근)
✅ TLS 1.2 이상만 허용
```

**필수 HTTP 보안 헤더**
```
Content-Security-Policy    → XSS 방어
X-Frame-Options: DENY      → Clickjacking 방어
X-Content-Type-Options     → MIME 스니핑 방어
Referrer-Policy            → 민감 URL 노출 방어
```

---

### 역할별 추가 보안

**판매자 앱**
```
가게 소유권 검증 필수
  → 자기 가게 상품/주문만 수정 가능
  → storeId 항상 서버에서 검증

파일 업로드 (상품 이미지)
  → 파일 타입 검증 (확장자 + MIME Type)
  → 용량 제한 (예: 5MB)
  → S3/CDN에 저장, 서버에 직접 저장 금지
```

**배송기사 앱**
```
배정된 주문만 접근 가능
위치 정보는 배달 진행중일 때만 수집/전송
배달 완료 사진 → 개인정보 마스킹 고려 (택배 라벨 등)
```

**소비자 앱**
```
개인정보 (주소, 전화번호) 마스킹 표시
  예: 서울시 강남구 **동 → 상세 조회 시에만 전체 노출
주문 내역 타인 접근 불가 철저히 검증
```

---

### 데이터 보안

```
개인정보 암호화 저장
  → 전화번호, 주소, 계좌번호 등

로그에 민감정보 출력 금지
  → 카드번호, 비밀번호, 토큰 절대 로그 출력 금지

Firestore 접근
  → 앱에서 직접 접근 시 보안 규칙으로 제어
  → 관리 작업은 Admin SDK (서버 측) 사용
```

---

### PWA 특화 보안

```
Service Worker
  → HTTPS에서만 동작 (기본 보장)
  → 캐시에 민감 데이터(토큰, 결제정보) 저장 금지

오프라인 캐시 범위
  → 공개 데이터(상품 목록)만 캐싱
  → 주문/결제/인증 정보는 캐싱 제외
```

---

### 우선순위 요약

**MVP부터 필수**
- [ ] HTTPS 적용 (Vercel 기본 제공)
- [ ] NextAuth.js 세션 Cookie 저장
- [ ] Firestore 보안 규칙 (role 기반 소유권 검증)
- [ ] 비밀번호 해싱 (bcrypt/argon2)
- [ ] Portone 결제 연동 (직접 카드 처리 금지)
- [ ] 입력값 서버 검증

**오픈 전 필수**
- [ ] Rate Limiting
- [ ] 보안 HTTP 헤더 (CSP, X-Frame-Options 등)
- [ ] 파일 업로드 검증
- [ ] 개인정보 암호화

**운영 후 지속**
- [ ] 의존성 취약점 정기 점검 (`npm audit`)
- [ ] 로그 모니터링 (비정상 접근, 대량 요청 감지)
- [ ] 정기 백업 및 복구 테스트

---

## 다음 단계

- 소비자 앱 화면 설계 (Wireframe → Mockup)
- 판매자 앱 상세 화면 설계
- 배송기사 앱 상세 화면 설계
- API 명세 설계 (엔드포인트 전체 정리)
- Firestore 보안 규칙 설계
