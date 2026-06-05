# 어드민 콘솔 모바일 반응형 아토믹 플랜

> 작성: 2026-05-25 (세션86) · 출처: BACKLOG §1-8 `[어드민-반응형]` (세션83 M-PATH M5 #246/247 발견)
> 성격: **독립 세션 1건 또는 2건 분할** 가능한 중~대 규모. 멀티앱 리팩토링 로드맵 §3(어드민 트랙)의 첫 진입점.

---

## 1. 문제 정의 (정합성 검토 실측)

셀러 앱은 모바일(≤480px) 리팩토링됐으나 **어드민 콘솔(`apps/seller/src/app/admin`)은 데스크톱 `<table>` 그대로**라, 정산 테이블 마지막 2컬럼(**상태·지급처리버튼**)이 모바일 폭에서 화면 밖으로 잘리고 **가로 스크롤도 없어** 어드민이 모바일에서 "지급처리" 버튼에 접근 불가.

### 실측 근거 (세션86)

| 항목 | 상태 | 근거 |
|------|------|------|
| 정산 테이블 | 🔴 7컬럼 순수 `<table>`, 스크롤 컨테이너 없음 | [SettlementTable.tsx:48](../../../apps/seller/src/app/admin/settlements/_components/SettlementTable.tsx#L48) `component="table"` width:100% — 부모 래퍼에 `overflowX` 없음 |
| 지급처리 버튼 | 정상(로직 OK), 마지막 컬럼이라 잘림 | [SettlementTable.tsx:134](../../../apps/seller/src/app/admin/settlements/_components/SettlementTable.tsx#L134) confirmed 행만 노출 |
| 동일 결함 후보 | 🔴 점검 필요 | `<table>` 사용 5곳: settlements·orders·stores·invite·users (`_client.tsx`) |
| SDD 분리 | ✅ settlements만 `_components/` 분리됨 | 나머지는 `_client.tsx` 인라인 테이블 |

### 방향 (BACKLOG·로드맵 기준)

데스크톱 `<table>` → **모바일 카드형 전환** 또는 **가로 스크롤 컨테이너**. 셀러 공통 컴포넌트(`SegmentedTabs`·`ConfirmModal`·토큰) 재사용. 멀티앱 로드맵 §3 어드민 트랙의 첫 작업.

---

## 2. 설계 결정 — 카드형 vs 가로 스크롤 (착수 세션에서 사용자 확정 필요)

| 방식 | 장점 | 단점 |
|------|------|------|
| **A. 반응형 카드형** | 모바일 가독성 ↑, 버튼 접근 확실, 셀러 카드 패턴과 일관 | 컬럼→카드 매핑 작업량 ↑(테이블 수만큼) |
| **B. 가로 스크롤 컨테이너** | 최소 변경(`overflowX:auto` 래퍼만), 즉시 해소 | 모바일서 가로 스크롤 UX 열위, 버튼 도달에 스크롤 필요 |
| **C. 하이브리드** | 브레이크포인트로 데스크톱=테이블/모바일=카드 | 두 렌더 경로 유지 비용 |

> **권장**: 핵심 결함(지급처리 불가)만 빠르게 막으려면 **B를 1차**(전 테이블 일괄), 가독성까지 끌어올리려면 **C를 정산 테이블 우선 적용 후 확산**. 착수 세션 도입부에서 사용자 확정.

---

## 3. 아토믹 태스크 (B+C 하이브리드 기준 예시)

### Phase 1 — 즉시 결함 봉합 (모든 테이블)
- **T1**: `<table>` 5곳을 `overflowX: 'auto'` 컨테이너로 래핑(최소 변경). 모바일서 잘림 → 스크롤 가능으로 전환. 지급처리 버튼 도달 보장.
- **T2**: 정합성 — 5개 테이블 모바일 폭에서 마지막 컬럼·버튼 도달 가능 확인.

### Phase 2 — 정산 테이블 카드형 (가독성)
- **T3**: 정산 테이블에 브레이크포인트 분기 — 데스크톱=`<table>` 유지 / 모바일=카드 리스트. 셀러 `SettlementListItem` 패턴 참고.
- **T4**: 카드에 상태 Badge + 지급처리 버튼 포함(`confirmed`만). `STATUS_LABEL`/`STATUS_COLOR` SSOT 재사용.

### Phase 3 — 확산(선택, 후속 세션 분리 가능)
- **T5**: orders/stores/users/drivers/invite 테이블도 동일 카드형 패턴 확산. 규모상 별도 세션 권장.

### 공통 — 정합성 + 빌드
- **T6**: 셀러 `tsc --noEmit`·`next build` exit0, biome 신규 0, 인라인 fontSize/hex 0(토큰 SSOT).

### Phase 4 — 인증 모바일 자동 회귀 게이트
- **T7**: fixture 인증을 사용하는 Playwright `mobile` 프로젝트에서 settlements·orders·stores·invite·users 카드 전환, 데스크톱 테이블 숨김, 핵심 액션 버튼 접근, `375px` 가로 넘침 0을 검증한다.
- **T8**: 운영 Chrome의 뷰포트 강제 기능이 없는 동안 T7을 회귀 방지 근거로 사용한다. 실제 카드 간격·터치 감각·`768px` 전환 경계 육안 판정은 인증 가능한 모바일 브라우저 확보 후 별도로 종결한다.
- **T9**: fixture 인증 Playwright에서 settlements·orders·stores·invite·users 전 화면의 `767px` 카드 유지와 `768px` 테이블 전환을 검증한다. 실제 카드 간격과 터치 감각 육안 판정은 인증 가능한 모바일 브라우저 확보 후 별도로 종결한다.

---

## 4. 정합성 체크포인트 (착수 세션에서 검증)

- [ ] **C1** 모바일(≤480px)에서 정산 "지급처리" 버튼에 접근 가능한가 (핵심 결함 해소)
- [ ] **C2** 5개 테이블(settlements·orders·stores·invite·users) 전수 모바일 점검 — 잘림 잔존 0
- [ ] **C3** 데스크톱 레이아웃 시각 회귀 0 (브레이크포인트 분기 시)
- [ ] **C4** Badge/버튼이 SSOT(`STATUS_LABEL`·`STATUS_COLOR`)·공통 컴포넌트 재사용인가
- [ ] **C5** 인라인 fontSize/hex 0, biome 신규 0, tsc/build exit0
- [ ] **C6** 단일 파일 500라인 한도 — 카드형 추가 시 컴포넌트 분리(`_components/`)
- [x] **C7** fixture 인증 `mobile` 프로젝트에서 5개 화면 카드 전환·테이블 숨김·핵심 버튼 접근·가로 넘침 0 자동 회귀 통과
- [x] **C8** fixture 인증 Playwright에서 5개 화면 `767px` 카드 유지·`768px` 테이블 전환 자동 회귀 통과

---

## 5. 규모·리스크

- **규모**: 중~대. Phase 1만이면 소(래퍼만), Phase 2까지면 중, Phase 3 확산까지면 대(세션 분리 권장).
- **리스크**: 중. 데스크톱 회귀 방지가 관건(브레이크포인트 분기). 로직 불변(지급처리 hook `useAdminSettlements` 미수정).
- **세션 분할 권장**: ① Phase 1+2(정산 봉합·카드형) 1세션 → ② Phase 3 확산 별도 세션. 어드민 전반 반응형은 로드맵 §3 트랙으로 이어짐.
- **검증 환경 주의**: 어드민은 운영 단일 DB(green-e4fe3), 카카오 로그인만. 모바일 폭은 브라우저 DevTools 또는 실기기 PWA로 육안.
