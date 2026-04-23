# 다음 세션 작업 목록

> 최종 수정: 2026-04-23 | 소비자앱 상품 상세 UX 2차 개선 완료 (케어 아이콘 카드 + 썸네일 스트립)

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

---

## ✅ [6순위] 소비자앱 상품 상세 UX 2차 개선 — 2026-04-23 완료

### ✅ 6-1. 케어 아이콘 카드 — 2026-04-23 완료

| 아이콘 | 라벨 | 데이터 소스 |
|--------|------|------------|
| 🌸 | 개화 상태 | `product.selection.bloomCondition` |
| 💨 | 향기 | `product.selection.fragrance` |
| ⭐ | 관리 난이도 | `product.selection.careLevel` (신규 셀러 설정 필드) |

- `CareLevel` 타입을 `product.types.ts`로 이동 (순환의존 해소)
- `Selection` 인터페이스에 `careLevel?: CareLevel` 추가
- `TouchSelector`에 관리 난이도 셀렉터 UI 추가
- 기존 상품은 셀러 수정 저장 시 값 기록

### ✅ 6-2. 이미지 썸네일 스트립 — 2026-04-23 완료

- dot 인디케이터 제거 → 캐러셀 하단 `56×56` 가로 스크롤 썸네일
- 선택 썸네일 `brand.6` 보더 강조, 클릭 시 메인 캐러셀 연동
- 이미지 1개 상품 미표시

### ✅ 6-3. 공동구매 전용 CTA — 2026-04-23 완료

CTABar 구현 시 이미 포함됨:
```typescript
const ctaLabel = isFull ? '모집 완료' : isGroup ? '공구 참여하기' : '바로 결제'
```

---

## [향후 과제] 소비자앱 UX — 미래 구현 항목

> 2026-04-23 레퍼런스 디자인 검토 후 정합성 문제로 보류된 항목.
> 백엔드 엔티티 또는 꽃/난 도메인 적합성 확인 후 착수.

### 별점 / 후기 시스템
- `reviews` Firestore 컬렉션 + API 엔티티 신규 설계 필요
- 소비자 앱: 상품 상세 탭에 "후기 N개" 표시 + 작성 플로우
- 셀러 앱: 후기 모아보기 화면
- **조건**: 주문 완료 후 후기 작성 가능 (orderId 연결 필수)

### 케어 가이드 탭 (꽃/난 버전)
- 식물 앱의 "키우기 가이드" 개념을 화훼 도메인으로 전환
- 예: 절화 → 물올림 방법, 꽃병 관리 / 난 → 분갈이 주기, 햇빛 조건
- variety DB의 `careLevel`, `bloomDuration` 데이터 재활용 가능
- **조건**: variety 데이터 충분히 쌓인 후 (현재 30종 완료)

### Q&A 탭
- `questions` 컬렉션 + 셀러 답변 기능
- 소비자: 질문 작성 / 셀러: 답변 (셀러 앱 연동)
- **조건**: 알림톡 연동 완료 후 (답변 알림 필수)
