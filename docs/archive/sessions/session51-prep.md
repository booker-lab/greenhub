# 세션51 진입 문서 — T6 (e2e 시드 슬롯 정비 + 토글·공구 조인 회귀 가드)

> 작성: 2026-05-20 (세션50) · 선행: 세션50 T4(`2c6c89d`) + T5(`bffce2a`) 완료
> 목표: **e2e 회귀 가드** — 일반 배송일 선택 시드 슬롯 정비 + 셀러 주문 탭 토글/공구 조인 spec 보강
> SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (T1·T2·T3·T4·T5 ✅, T6 진입)

---

## 컨텍스트

세션46~50로 소비자 배송일 선택부터 API 슬롯 검증, 셀러 주문 탭 IA 재구성까지 풀스택이 닫혔다. e2e는 아직 신규 IA를 모름:
- 소비자 일반 주문 e2e는 `requestedDeliveryDate` 시드 슬롯이 없거나 부정합일 가능성(세션46~48 후 미점검).
- 셀러 주문 탭 spec은 `SaleTypeToggle`을 모름 — `data-testid="sale-type-toggle-{normal|group}"` 미사용.
- 공구 주문 표시 spec은 `groupProductConfig` 시드와 `groupDeliveryDate` 그룹핑 검증이 없음.

T6에서 이 세 영역을 한 번에 정비한다.

---

## 세션51 태스크

### T6-A — 소비자 일반 주문 e2e 시드 슬롯 정비

**점검 파일:** `apps/e2e/global-setup.ts`, `apps/e2e/tests/_helpers/*`, `apps/e2e/tests/consumer-*.spec.ts`

1. 일반 주문 e2e가 의존하는 `dailyCaps` 시드 확인 — `${storeId}_${YYYY-MM-DD}` 문서가 **테스트 실행 시점 기준 가까운 미래 일자**로 충분히 존재하는가? 부재 시 globalSetup 또는 dedicated helper에서 시드 추가.
2. `DeliveryDatePicker`는 잔여 `totalCap - (usedSlots ?? 0) > 0`만 활성. 시드 슬롯에 `totalCap` 적절히 설정(예: 10).
3. 주문 생성 spec에 배송일 선택 단계 추가 — `getByTestId('delivery-date-picker')` 또는 적절한 셀렉터로 첫 활성 날짜 클릭. 기존 spec이 picker를 건너뛰면 `canBuy=false`로 막힐 가능성.

**정합성 확인:**
- [ ] e2e 풀런에서 일반 주문 신규 spec 통과
- [ ] 슬롯 차감 후 잔여 0이 되는 시나리오 별도 시드 (capacity boundary 테스트)
- [ ] 시드 정리 — 테스트 종료 후 dailyCaps 잔여 슬롯 원복(또는 의도적 누적 허용 명시)

### T6-B — 셀러 주문 탭 토글 spec 신설/보강

**점검 파일:** `apps/e2e/tests/seller-orders-*.spec.ts`

1. 토글 기본값 `normal` 확인 — 일반 주문만 보이고 공구는 보이지 않음.
2. `sale-type-toggle-group` 클릭 → 공구 주문만 보임, 날짜 필터 칩 미노출 검증(`DATE_PRESETS` UI 부재).
3. 토글 전환 시 날짜 필터가 `week`로 초기화되는지 확인(`customFrom/To` 비움).
4. 상태 탭은 토글 전환에도 유지되는지 확인.

### T6-C — 공구 주문 `groupDeliveryDate` 그룹핑 시드/spec

1. 시드 — 공구 상품 `groupProductConfig` 문서에 `groupDeliveryDate` ISO 일자 설정.
2. spec — 공구 토글 활성 시 해당 일자 헤더(예: "X월 X일") 아래에 공구 주문이 묶이는지 확인.
3. `groupProductConfig` 미존재 시 "날짜 미정" 그룹으로 떨어지는지 fallback 확인(별도 시드 케이스).

**커밋 후:**
```bash
cd apps/e2e && pnpm playwright test
```

---

## 진행 규칙

- T6-A·B·C는 각 1커밋(또는 e2e 영역에 한해 묶어 1커밋 — 의존성 있을 시 사용자 확인).
- 신규 spec 추가 시 e2e 풀런 통과 베이스라인 갱신(현재 170 passed).
- e2e CI는 `.github/workflows/e2e.yml`. main push → preview 동기화 후 실행이라 sync-preview 직후 stale preview 주의([[reference_e2e_preview_race]] 참조).
- 한글 파일 편집 시 PowerShell `Get-Content`/`Set-Content` 금지 — Edit/Python.

## 세션51 완료 기준

- [ ] T6-A 일반 주문 시드 + 신규 spec 통과
- [ ] T6-B 셀러 토글 spec 통과
- [ ] T6-C 공구 조인 spec 통과
- [ ] e2e 풀런 전체 passed (베이스라인 갱신값 명시)
- [ ] `docs/memory.md` 세션51 갱신 + 다음 세션 진입 문서 작성(잔여 백로그 정리)

## 참조

- 플랜 SSOT: `docs/specs/frontend/delivery-date-selection-plan.md` (T6 섹션)
- 세션50 커밋: `2c6c89d`(T4), `bffce2a`(T5)
- #CL-35(`CRITICAL_LOGIC.md`) — 셀러 주문 탭 토글 + 공구 조인 정본
- e2e 인증 패턴 — `apps/e2e/tests/_helpers/auth.ts` + globalSetup storageState
- 잔여 백로그 — P3 Driver Kakao Maps SDK, P4 준비 물량 공동구매·픽업 코드 fontSize 토큰화, BUG-16 택배 주문 상태 전환 갭
