# 세션45 진입 문서 — 셀러 주문 탭 리팩토링 세션 D

> 작성: 2026-05-19 (세션44) · 선행: 세션 A(T1+T2)·B(T3+T4)·C(T5+T6) 완료
> 목표: T7 — 타입체크 + e2e 풀런 + 정합성 최종 검토 (구현 후 검증 세션)

---

## 컨텍스트

세션40 설계 → 41 정합성 검토 → 42(A) T1+T2 → 43(B) T3+T4 → 44(C) T5+T6 완료.
플랜 SSOT: `docs/specs/frontend/seller-orders-refactor-plan.md` (§T7)

세션 D는 **코드 변경 최소** — 검증·수정 위주. 회귀 발견 시에만 수정 커밋.

---

## 세션 D 태스크 (T7)

### 1. 타입체크 + e2e 풀런

```bash
pnpm --filter seller tsc --noEmit
pnpm --filter e2e exec playwright test --project=chromium
```

> e2e는 sync-preview 재배포 확인 후 실행 (stale preview 주의 — memory 참조).

### 2. 코드 정합성 체크리스트 (플랜 §T7)

- [ ] `useOrderActions.ts` 삭제 완료 — `grep -r useOrderActions apps/seller/src` = 0건
- [ ] `SUMMARY_BAR_ITEMS` 완전 제거 = 0건
- [ ] `STATUS_COLOR`가 `_constants.ts` 한 곳에만 존재
- [ ] `prompt(`/`alert(` seller 내 0건
- [ ] `fontSize: [0-9]` 인라인 하드코딩 orders 파일 잔여 없음
- [ ] `top: 57`/`top: 114` 매직넘버 잔여 없음

### 3. 브라우저 육안 검증

- T1 — 주문 상태 뱃지 색상 (목록·상세 일치)
- T4 — 주문 상세 sticky 액션 footer (BottomNav 비겹침)
- T5 — 날짜 범위 필터 칩 동작 (탭 전환 시 유지·custom from>to 경고)
- T6 — 날짜 그룹 헤더 (지연 최상단·날짜 미정 최하단·overdue/today 강조)

### e2e 기준

- 베이스라인 170 passed → T2에서 Summary Bar 2건 삭제 + 탭 뱃지 1건 신설
  = **169 passed / 0 failed** 예상.
- T5·T6은 신규 spec 없음 — 회귀 발견 시 `seller-orders.spec.ts` 보강 검토.
- 우선 확인 spec: `seller-orders.spec.ts`, `seller-order-detail.spec.ts`.

---

## 세션 D 완료 기준

- [ ] 타입체크 통과
- [ ] e2e 풀런 0 failed
- [ ] 정합성 체크리스트 6건 통과
- [ ] 육안 검증 4건 완료
- [ ] `seller-orders-refactor-plan.md` T5·T6·T7 체크박스 갱신 + 세션 종결 문서화

> 세션 D 종료 시 리팩토링 플랜 전체(T1~T7) 완료 — `docs/memory.md`·`docs/BACKLOG.md` 최신화.
