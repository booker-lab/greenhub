# 어드민 탭 개선 — 인덱스 (#CL-55)

> **세션92~98** 어드민 7개 탭 개선 진단을 한 문서에 누적해 오다, **세션99**에 탭별 SDD로 분할.
> 본 문서는 **인덱스·공통 기준·진행 현황**만 유지하고, 본문(진단·아토믹 태스크·정합성 검토 기준)은
> [`admin/`](./admin/) 폴더의 7개 탭별 SDD로 이전됐다.
>
> **진행 방식(사용자 확정):** 한 탭씩 한 태스크씩 완결 후 커밋(세션91 패턴).
> **연계 작업 처리:** 어드민 탭 도메인(예: users=손님)이 셀러·드라이버 측 화면과 닿는 작업은
> 해당 탭 SDD의 끝 섹션(예: §E-11)에 "연계 작업" 부속 항으로 두고, 세부는 별도 계획서로 위임한다.

## 탭별 SDD (분할 본문)
> 구현 열은 2026-10-04 코드 대조 기준이다. "PR #번호"는 열린 PR(병합 대기)로 처리 중인 항목이다.

| 탭 | 진단 | 구현 | SDD |
|----|------|------|------|
| stores(판매자) | ✅ 세션92 | ✅ T7·T8 외 완료(PR-A~E, e2e 포함) · 남음: T7 드릴다운·T8 기본 수수료(별도 SDD·사용자 결정) · 육안 위임 | [admin-tab-stores-plan.md](./admin/admin-tab-stores-plan.md) |
| orders(주문) | ✅ 세션93 / 🔄 셀러앱 연계 추가 | 🟡 T1 완료(#315)·환불 버튼 서버 규칙 정렬(#318)·T2·T3 폐기 · 남음: T4 스토어 Select·T5 새로고침/폴링·T6 모달·T7 e2e | [admin-tab-orders-plan.md](./admin/admin-tab-orders-plan.md) |
| drivers(기사) | ✅ 세션93 / 세션95 `/further` 확정 | ⏸ T1 서버 필터는 사람 결정(`suspended` 필드 없는 문서가 쿼리에서 빠짐 → 마이그레이션 또는 F5 결정 선결) · 남음: T1 화면 배선·T2 타입·S3 e2e·T3~T5 | [admin-tab-drivers-plan.md](./admin/admin-tab-drivers-plan.md) |
| settlements(정산) | ✅ 세션94 / 🔄 셀러 정산 교차 참조 | 🟡 T1 KST(#316)·T2 조회 실패 완료 · T4b status 필터 백엔드 PR #392 · 남음: F2 일괄 지급(사용자 결정)·T3·T5·T6·T7 | [admin-tab-settlements-plan.md](./admin/admin-tab-settlements-plan.md) |
| users(소비자) | ✅ 세션96 / ✅ 세션92 grill-me 종결 (S1~S6 플랜 확정) | 🟡 S1(D1)·S2(T1+T2 #317) 완료 · 남음: S3 검색·필터, S4 limit(사용자 결정), S5 e2e | [admin-tab-users-plan.md](./admin/admin-tab-users-plan.md) |
| invite(초대) | ✅ 세션97 / 세션98 Further 확장 | 🟡 T1·T3 완료(#319) · T0+T4 토큰 취소 백엔드 PR #390 · 남음: T2·T5~T12 | [admin-tab-invite-plan.md](./admin/admin-tab-invite-plan.md) |
| banner(배너) | ✅ 세션95 / 세션92 Further 다중 배너 모델 확정 | 🟡 T1·T3 완료(`21b93153`), D-G1 닫힘 · 남음: T2·T5a·T6, 다중 배너 SDD S4~S7 | [admin-tab-banner-plan.md](./admin/admin-tab-banner-plan.md) |

## 공통 정합성 검토 기준 (모든 어드민 탭 공통)

각 탭 SDD는 본 기준을 자체 §0에 그대로 포함한다(세션85~91 동일).

- **C1 tsc 0** — 어드민·셀러·소비자 3앱 전체. shared·api 변경 시 재검증.
- **C2 biome 0** — 신규 경고 0.
- **C3 `npm run build` 0** — ⚠️ `npx next build` 금지(Turbopack 충돌).
- **C4 500라인 한도** — 단일 파일 500라인 초과 시 즉시 분할(CLAUDE.md §1).
- **C5 SSOT 토큰** — 하드코딩 색·라벨 0, shared 재사용.
- **C6 가드 유지** — 로딩·빈결과에서도 필터·탭 UI 유지(세션86 선례).
- **C7 시각 회귀 0** — 시각 변경이 의도된 태스크는 단독 커밋·육안 격리.

## 진행 방식 (공통)

- 한 탭씩 진단·확정 → 한 태스크씩 완결 후 커밋(세션91 패턴).
- 코드 변경은 **사용자 확정 후** 착수.
- 백엔드·데이터모델 신설 규모(드릴다운·일괄 처리·다중 배너·세션 정책 등)는 **별도 SDD 선설계** 후 착수.
- 시각 변경이 큰 태스크(NumberInput·DatePickerInput·Modal·라이브 미리보기)는 **단독 커밋·육안 격리**.
- 다른 앱 화면과 닿는 연계 작업은 본 SDD의 부속 항으로 누적하고 별도 계획서로 위임한다.

## 외부 연계 계획서 (탭별 SDD가 위임하는 문서)

| 위임 출처 | 위임 대상 |
|-----------|-----------|
| orders §B-8 (셀러앱 주문 발송·추적 보강) | [`seller-orders-improve-plan.md`](./seller-orders-improve-plan.md) |
| users §E-11 (셀러앱 손님 정보·검색·전화) | [`seller-orders-customer-info-plan.md`](./seller-orders-customer-info-plan.md) |
| settlements §D-11 (셀러 정산 화면 기능 확장 #CL-56) | [`settlement-seller-feature-plan.md`](./settlement-seller-feature-plan.md) |
| drivers §C-9 (T1+T2 한 묶음 상세) | [`../../plans/admin-drivers-T1-T2-plan.md`](../../plans/admin-drivers-T1-T2-plan.md) |
| banner §G-11 (다중 배너 SDD) | [`admin/admin-banner-multi-sdd.md`](./admin/admin-banner-multi-sdd.md) |
| 전 탭 공통 (코드 완료 후 육안) | [`pending-visual-verify.md`](./pending-visual-verify.md) |

## 관련 문서
- 멀티앱 리팩토링 로드맵: [`app-refactor-roadmap.md`](./app-refactor-roadmap.md)
- 프로젝트 메모리: `c:\Users\tazan\.claude\projects\c--Develop-greenhub\memory\project_admin_tabs_improve.md`

## 변경 이력
- **세션99 (2026-05-26)**: 통합 본문(1019라인) → 7개 탭별 SDD로 분할. 본 문서는 인덱스로 축소.
- 세션92~98: 통합 본문에 §A~§G 누적(stores→orders→drivers→settlements→users→invite→banner).
