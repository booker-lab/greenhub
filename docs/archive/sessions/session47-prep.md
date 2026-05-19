# 세션47 진입 문서 — 배송일 선택 기능 플랜 정합성 검토

> 작성: 2026-05-19 (세션46) · 선행: 세션46 진단 + 플랜 수립 완료
> 목표: `delivery-date-selection-plan.md` **구현 전 정합성 검토** — 코드 변경 없음
> 성격: 세션41(주문 탭 리팩토링 검토)과 동일한 **검토 전용 세션**

---

## 컨텍스트

세션45에서 셀러 주문 탭 리팩토링(T1~T7)을 종결했으나, 세션46 실서비스
검증에서 **주문이 전부 "날짜 미정" 그룹으로 떨어지는** 현상이 발견됐다.

진단 결과 — 소비자 앱에 일반 상품 배송일 선택 기능이 처음부터 없어
`order.requestedDeliveryDate`가 항상 `null`. 세션40~45 주문 탭 T5·T6은
채워질 수 없는 필드를 전제로 설계됐다.

세션46은 이 공백을 메우는 플랜을 수립했다:
**플랜 SSOT — `docs/specs/frontend/delivery-date-selection-plan.md`** (T1~T6)

세션47은 **구현 착수 전** 이 플랜이 실제 코드와 정합한지 검토한다.

---

## 세션47 태스크 — 플랜 정합성 검토

플랜의 각 설계 결정·태스크를 현 코드와 대조하고, 불일치·누락·리스크를
발견하면 **플랜 문서를 직접 수정**한다. 코드는 건드리지 않는다.

### 검토 체크리스트

**D1 — 소비자 배송일 picker (상품 상세)**
- [ ] `useDailyCap.ts` 월 범위 확장 vs 신규 훅 — 어느 쪽이 기존 구조와 정합한지 확정
- [ ] `daily-caps?from=&to=` API 응답 형태 확인 (`apps/api` 컨트롤러) — `caps` 배열 구조·`usedSlots` 포함 여부
- [ ] `ProductActions.tsx`의 기존 `useDailyCap` 호출(line 42)·"오늘 잔여" 표시(line 218)와 신규 picker 공존 방식

**D2 — 공동구매 배송일 현행 유지**
- [ ] `groupProductConfig` 문서 구조 재확인 — `groupDeliveryDate` 타입(Timestamp vs string 혼재 가능성: 세션46 진단에서 둘 다 발견)

**D3 — API 슬롯 검증 변경**
- [ ] `orders-create.service.ts`의 `dateStr`/`capId` 사용처 전수 — `new Date()` 당일 고정이 다른 곳에도 있는지
- [ ] `CreateOrderDto.requestedDeliveryDate` 현재 검증 데코레이터 확인 (`@IsOptional` → 조건부 필수 전환 방법)
- [ ] 슬롯 트랜잭션 외 `dailyCaps` 참조 코드 (payments.service 등) 영향

**D4 — 셀러 주문 탭 일반/공구 토글**
- [ ] `getOrderDate(order, tab)` 시그니처 확장이 호출처(`page.tsx`)와 정합한지
- [ ] `groupOrdersByDate` 동반 수정 범위
- [ ] saleType 토글 신설이 기존 e2e `seller-orders.spec.ts` 셀렉터에 미치는 영향

**전체**
- [ ] 태스크 의존 순서(T1→T2→T3, T4→T5)가 실제로 맞는지
- [ ] 세션 분배(48~51)가 각 태스크 규모와 정합한지
- [ ] 플랜 "미해결 항목" 4건 — 세션47에서 확정 가능한 건 확정

---

## 착수 전 확인

- [ ] `delivery-date-selection-plan.md` 정독 (T1~T6 + 설계 결정 D1~D4)
- [ ] `docs/memory.md`·`CRITICAL_LOGIC.md` 한도 여유 확인
- [ ] gh CLI: `C:\Program Files\GitHub CLI\gh.exe` (PATH 미등록 — `&` 호출)
- [ ] Firebase 진단 필요 시 — `scripts/` 기존 패턴 참조 (admin SDK 키 `apps/api/firebase-adminsdk.json`, 일회용 스크립트는 검토 후 삭제)

## 세션47 완료 기준

- [ ] 검토 체크리스트 전 항목 점검 완료
- [ ] 발견한 불일치·리스크를 플랜 문서에 직접 반영
- [ ] 플랜 "미해결 항목" 확정 가능분 처리
- [ ] 설계 변경 시 `CRITICAL_LOGIC.md` #CL 등재
- [ ] `docs/memory.md` 세션47 갱신 + `session48-prep.md` 작성 (T1+T2 구현 지시서)

---

## 참조

- 플랜 SSOT: `docs/specs/frontend/delivery-date-selection-plan.md`
- 세션46 핫픽스: 커밋 `5a2b993` (`useOrders` Timestamp 정규화 — 본 플랜과 독립)
- 검토 선례: `session41-prep.md` (주문 탭 리팩토링 검토 세션 — 동일 성격)
- 육안 검증 문서: `specs/frontend/seller-refactor-visual-verify.md` (본 기능 완료 시 섹션 추가)
- 재사용 인프라: `settings/daily-caps/page.tsx`(셀러 슬롯 캘린더)·`GroupConfigSection.tsx`(공구 배송일 등록)
