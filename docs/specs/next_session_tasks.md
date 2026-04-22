# 다음 세션 작업 목록

> 최종 수정: 2026-04-23 | 공동구매 수량 기반 전환 완료, Firestore 마이그레이션 대기 중

---

## [1순위] Firestore 마이그레이션 적용 — 즉시 실행 가능

**배경**: 공동구매 수량 기반 전환 코드는 Railway에 배포 완료.
기존 Firestore 문서(groupProductConfig, products.groupSummary)의 필드명이 아직 인원 기반이므로 마이그레이션 필요.

### 실행 순서

```bash
# 1. dry-run으로 변경 대상 확인
node scripts/migrate-groupbuy-quantity.mjs

# 2. 문제 없으면 실제 적용
node scripts/migrate-groupbuy-quantity.mjs --apply
```

**변환 내용**:
- `groupProductConfig`: `minParticipants → minQuantity`, `maxParticipants → targetQuantity + maxPerPerson`, `currentParticipants → currentQuantity`
- `products.groupSummary`: 동일 필드명 변환

### E2E 검증

1. Seller 앱에서 공동구매 상품 등록 → `minQuantity / targetQuantity / maxPerPerson` 입력 확인
2. Consumer 앱에서 수량 stepper (1~maxPerPerson 범위) 동작 확인
3. 주문 후 `currentQuantity` 증가 확인
4. `targetQuantity` 도달 시 자동 확정 알림 확인
5. 취소 시 `currentQuantity` 감소(`increment(-order.quantity)`) 확인

---

## [2순위] 네이버페이 채널키 연결 — 승인 이메일 수신 후

Railway 환경변수 2개 추가:
```
PORTONE_WEBHOOK_SECRET=whsec_...
NAVERPAY_CHANNEL_KEY=...
```

---

## [3순위] 알리고 ↔ 카카오 알림톡 연동 — 그린러브 사업자등록증 발급 후

1. `smartsms.aligo.in` → 카카오톡 → 발신프로필 등록 (채널 ID: `greenlove`)
2. 알림톡 템플릿 25개 심사 신청 (3~5 영업일)
3. 승인 후: `aligo.client.ts` `buildMessage()` 구현 + Railway 환경변수 4개 설정

---

## [4순위] SELLER_ORDER_BATCH 스케줄러 — 알림톡 연동 완료 후

- `notifications.service.ts`에 `@Cron('0 20 * * *')` 메서드 추가
- 매일 오후 8시 storeId별 당일 ACCEPTED 주문 집계 발송, 0건 미발송

---

## [5순위] GreenLoveBrandSection 브랜드 이미지 — 디자이너 이미지 수령 후

- 디자이너 이미지 파일 수령 후 교체
