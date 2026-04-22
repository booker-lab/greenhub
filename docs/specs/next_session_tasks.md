# 다음 세션 작업 목록

> 최종 수정: 2026-04-23 | 카카오 채널 개설 완료, 공동구매 수량 전환 설계 완료

---

## [1순위] 공동구매 수량 기반 모델 전환 — 즉시 착수 가능

**배경**: 현재 인원 기반(minParticipants/currentParticipants) → 수량 기반(minQuantity/currentQuantity)으로 전환 필요.
화훼/농산물 도매 특성상 "몇 명"이 아닌 "몇 개/단/박스"가 모여야 발주 가능.

**변경 범위**: shared 타입 → API 5개 파일 → Seller UI → Consumer UI → Firestore 마이그레이션

### Phase 0 — 스펙 선 업데이트
- `docs/specs/products.md` — GroupProductConfig 스키마 필드명 교체, `maxPerPerson` 추가
- `docs/specs/orders.md` — CreateOrderRequest에 `quantity: number` 추가

### Phase 1 — Shared 타입 변경
- `packages/shared/src/product.types.ts` — GroupProductConfig 인터페이스 교체
  ```typescript
  minQuantity: number      // 최소 수량 (미달 시 자동 취소)
  targetQuantity: number   // 목표 수량 (선착순 확정 기준)
  maxPerPerson: number     // 1인 최대 구매 수량
  currentQuantity: number  // 현재 누적 수량
  ```
- `packages/shared/src/order.types.ts` — CreateOrderRequest에 `quantity: number` 추가
- **빌드**: `pnpm --filter @greenhub/shared build`

### Phase 2 — API 변경
- `apps/api/src/products/dto/create-product.dto.ts` — GroupConfig DTO 필드 교체
- `apps/api/src/orders/dto/create-order.dto.ts` — `quantity: number` 추가 (기본값 1)
- `apps/api/src/orders/orders-create.service.ts`
  - maxPerPerson 초과 검증 추가
  - currentParticipants + 1 → currentQuantity + dto.quantity
  - 조기 확정: currentQuantity >= targetQuantity
- `apps/api/src/orders/orders-lifecycle.service.ts`
  - 취소 시 FieldValue.increment(-1) → increment(-order.quantity)
- `apps/api/src/notifications/notifications.service.ts`
  - processGroupBuyDeadlines: currentQuantity >= minQuantity 비교
  - notifyDeadlineSoon: 변수명 교체
  - confirmGroupBuy / cancelGroupBuyLack: 변수명 교체

### Phase 3 — Seller 앱
- `apps/seller/src/app/products/_components/GroupConfigSection.tsx`
  - minParticipants → minQuantity (라벨: "최소 수량")
  - maxParticipants → targetQuantity (라벨: "목표 수량")
  - maxPerPerson 입력 필드 추가 (라벨: "1인 최대 구매 수량")
- `apps/seller/src/app/products/_components/ProductForm.tsx` — 유효성 검증 업데이트

### Phase 4 — Consumer 앱
- `apps/consumer/src/hooks/useGroupProduct.ts` — 필드명 변경
- `apps/consumer/src/app/products/[id]/page.tsx`
  - N/M명 → N/M개
  - isFull: currentQuantity >= targetQuantity
  - 프로그레스바: (currentQuantity / minQuantity) * 100
- `apps/consumer/src/components/ProductCard.tsx` — groupSummary 텍스트 변경
- 주문 생성 시 `quantity` 필드 전송 추가

### Phase 5 — Firestore 마이그레이션
- `scripts/migrate-groupbuy-quantity.mjs` 신규 작성
  - minParticipants → minQuantity
  - maxParticipants → targetQuantity
  - currentParticipants → currentQuantity
  - maxPerPerson: 기존 maxParticipants 값으로 초기화
  - --apply 플래그로 실제 적용

### Phase 6 — 배포 및 E2E 검증
- shared/dist 커밋 → Railway 자동 배포
- Seller·Consumer Vercel 배포
- E2E: 수량 입력 → currentQuantity 증가 → 목표 달성 시 확정

---

## [대기] 네이버페이 채널키 연결
- 승인 이메일 수신 후 Railway 환경변수 추가:
  - `PORTONE_WEBHOOK_SECRET=whsec_...`
  - `NAVERPAY_CHANNEL_KEY=...`

---

## [대기] 카카오 알림톡 실제 연동
- 그린러브 사업자등록증 발급 후 진행
- 알리고(`smartsms.aligo.in`) → 카카오톡 → 발신프로필 등록 (채널 ID: greenlove)
- 템플릿 25개 심사 신청 (3~5 영업일)
- 승인 후: `aligo.client.ts` buildMessage() 구현 + Railway 환경변수 4개 설정

---

## [대기] SELLER_ORDER_BATCH 스케줄러
- 알림톡 연동 완료 후 착수
- `notifications.service.ts`에 `@Cron('0 20 * * *')` 메서드 추가
- 매일 오후 8시 storeId별 당일 ACCEPTED 주문 집계 발송, 0건 미발송

---

## [대기] GreenLoveBrandSection 브랜드 이미지
- 디자이너 이미지 파일 수령 후 교체
