# 세션49 진입 문서 — T3 구현 (API 슬롯 검증을 선택 배송일 기준으로)

> 작성: 2026-05-20 (세션48) · 선행: 세션48 T1+T2 완료 (`5281188`·`35cf229`·`e4c376c`)
> 목표: **T3 단독 세션** — API 슬롯 검증을 주문 당일 고정 → 소비자가 선택한 배송일 기준으로 변경
> SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (세션47 정정본, T1·T2 ✅)

---

## 컨텍스트

세션48이 소비자 측 배송일 선택 UI(T1)와 체크아웃·장바구니 전달(T2)을 완성했다.
이제 일반 주문이 `requestedDeliveryDate` 값을 들고 API에 도달하지만,
**`orders-create`는 여전히 `new Date()` 당일 기준으로 `capId`를 산출**하므로
선택 배송일이 슬롯 검증·차감에 반영되지 않는다. 세션49가 이 마지막 고리를 잇는다.

### 세션47 검토에서 확인된 변경 범위 (재확인)

- `orders-create.service.ts` `new Date()` 당일 고정은 **78~79줄 1쌍**
  (`dateStr`, `capId`)뿐. 84줄 트랜잭션 내 `dailyCaps/${capId}` 참조 외 다른
  사용처 없음. `payments.service` 등 타 모듈의 `dailyCaps` 참조도 없음 (grep 확인 끝).
- 슬롯 검증 분기는 84줄 `deliveryMethod !== 'parcel' && saleType !== 'group'`.
  **이 분기 조건이 배송일 필수화 분기와 정확히 일치해야 함.**
- 저장값(163줄 `dto.requestedDeliveryDate ?? null`) — 슬롯 검증 대상은 필수,
  그 외는 `null` 유지.

### T1·T2가 만든 사전조건

- 소비자 일반 주문(`saleType=normal`·택배 아님)은 picker 선택 없이는 주문 자체가
  불가능(`canBuy=false`) — 즉 API에 `requestedDeliveryDate`가 항상 도달.
- 택배·공동구매는 picker 미노출 → DTO에서도 옵셔널(필수 아님).

---

## 세션49 태스크

### T3 — API 슬롯 검증을 선택 배송일 기준으로

**변경 파일:** `apps/api/src/orders/orders-create.service.ts`,
`apps/api/src/orders/dto/create-order.dto.ts`

1. **DTO 필수화 분기** — `CreateOrderDto.requestedDeliveryDate`에
   `@ValidateIf(o => o.saleType === 'normal' && o.deliveryMethod !== 'parcel')`
   적용해 일반 주문(슬롯 검증 대상)에서만 필수. `@IsString()` +
   `@Matches(/^\d{4}-\d{2}-\d{2}$/)` 권장(YYYY-MM-DD 형식 검증).
2. **`capId` 산출 변경** — 78~79줄 `dateStr = new Date()...` →
   슬롯 검증 대상 분기 안에서 `dateStr = dto.requestedDeliveryDate!` 사용.
   `capId = ${storeId}_${dateStr}` 그대로.
3. **저장값** — 163줄 `dto.requestedDeliveryDate ?? null` 유지 (택배·공구는 null).
4. **회귀 점검** — 공동구매·택배 주문 분기 변경 없음 확인 (84줄 가드 유지).
5. **에러 메시지** — 슬롯 미설정 날짜에 주문 시 `ConflictException` 기존 메시지
   재사용 ("해당 날짜의 배송 슬롯이 설정되지 않았습니다" 등).
6. **트랜잭션 영향** — 슬롯 차감 날짜가 바뀌므로 `dailyCaps` 문서 read/write가
   선택 날짜로 향한다. 분기 조건이 일치하므로 추가 영향 없음.

**커밋 후:**
```bash
cd apps/api && npx tsc --noEmit
pnpm --filter api test 2>&1 | tail -30   # 기존 테스트 회귀 확인
```

---

## 정합성 확인 체크리스트 (커밋 전)

- [ ] 일반 주문 — 선택 배송일의 `dailyCaps/${storeId}_${date}` 문서로 검증·차감
- [ ] 공동구매·택배 주문 — 슬롯 미검증 분기 유지 (회귀 없음)
- [ ] 슬롯 미설정/마감 날짜 주문 시 `ConflictException` 발생
- [ ] `saleType=normal && deliveryMethod!=='parcel'`인데 배송일 누락 → 400
- [ ] API 타입체크 + 기존 단위/통합 테스트 통과

---

## 진행 규칙

- T3는 단독 커밋. 회귀 리스크가 가장 큰 태스크이므로 분기 조건 일치를 반복 점검.
- 설계 변경 #CL 등재 — D3(슬롯 검증 변경)는 정본 기록 권장 (`docs/CRITICAL_LOGIC.md`).
- T4·T5(셀러 주문 탭 IA)는 세션50으로 이연 — 세션49는 손대지 않음.
- 한글 파일 편집 시 PowerShell `Get-Content`/`Set-Content` 금지 — Edit/Python.

## 세션49 완료 기준

- [ ] T3 1커밋, API 타입체크·기존 테스트 통과
- [ ] `docs/CRITICAL_LOGIC.md`에 D3 #CL 등재 (슬롯 검증 정본)
- [ ] `docs/memory.md` 세션49 갱신 + `session50-prep.md` 작성 (T4+T5 지시서)

## 참조

- 플랜 SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (T3 섹션)
- 세션48 커밋: `5281188`(T1), `35cf229`(T2), `e4c376c`(checkout/page 500라인 한도 리팩터)
- 미해결 — e2e 시드 슬롯(T6 착수 시 확정)
