# 어드민 탭 개선 — 인덱스 (#CL-55)

> **세션92~98** 어드민 7개 탭 개선 진단을 한 문서에 누적해 오다, **세션99**에 탭별 SDD로 분할.
> 본 문서는 **인덱스·공통 기준·진행 현황**만 유지하고, 본문(진단·아토믹 태스크·정합성 검토 기준)은
> [`admin/`](./admin/) 폴더의 탭별 SDD에 있다.
>
> **현재 상태 기준:** 2026-10-23 main `e4d781db` 코드·테스트 대조. 각 탭 SDD 머리말의 "현재 상태" 절이
> 그 문서 본문(2026-05 진단 기록)보다 우선한다. 어드민 API 계약 정본은 [`../api/admin.md`](../api/admin.md)다.
> 어드민 화면은 별도 앱이 아니라 판매자 앱 안(`apps/seller/src/app/admin/`)에 있다.
>
> **진행 방식:** 한 태스크씩 PR로 완결하고, PR 검증은 로컬·CI에서 끝낸다(원격 E2E는 release train).
> **연계 작업 처리:** 어드민 탭 도메인(예: users=손님)이 셀러·드라이버 측 화면과 닿는 작업은
> 해당 탭 SDD의 끝 섹션(예: §E-11)에 "연계 작업" 부속 항으로 두고, 세부는 별도 계획서로 위임한다.

## 탭별 SDD (분할 본문)

> 상태 표기: ✅ 완료 · ⬜ 남은 구현(IMPLEMENTATION_GAP) · ❓ 사람 결정(SEMANTIC_CONFLICT).

| 탭 | 현재 상태 (2026-10-23) | SDD |
|----|------|------|
| stores(판매자) | ✅ 검색·필터·정렬·URL·e2e, 수수료 % 입력·정산 반영(#592), 치움=손님 화면 숨김·새 주문 차단·복구·연락처 칸(#593) · ⬜ T7 상세 드릴다운·T8 기본 수수료 설정·e2e 8번 사례 % 단위로 수정 · ❓ 판매자 정지 기능·기본 수수료 기준 | [admin-tab-stores-plan.md](./admin/admin-tab-stores-plan.md) |
| orders(주문) | ✅ 타입·가게 이름 Select·커서 더 보기·목록 칸(#593)·환불 확인창(#583)·배송 후 환불(#598) · ⬜ T5 새로고침·T7 e2e·주문 상세 · ❓ 환불 실패 재시도 버튼·일반 주문 배송 후 환불 | [admin-tab-orders-plan.md](./admin/admin-tab-orders-plan.md) |
| drivers(기사) | ✅ 커서 더 보기·가입일·전화(#593) · ⬜ T2 타입·T4 검색·T5 새로고침·e2e · ❓ T1 서버 status 필터를 화면에 연결할지 | [admin-tab-drivers-plan.md](./admin/admin-tab-drivers-plan.md) |
| settlements(정산) | ✅ KST·조회 실패·status 필터·가게 이름·커서 더 보기·서버 합계·수수료율 반영·정산 계좌·회수/보류 배지(#592) · ⬜ T7 새로고침·T6 DatePicker·A1 입금일·e2e · ❓ F2 일괄 지급 방식·일반 주문 배송비 수수료 | [admin-tab-settlements-plan.md](./admin/admin-tab-settlements-plan.md) |
| users(소비자) | ✅ 정지 계정 세션 차단·가입일·전화·새로고침·응답 필드 축소·정지 대상 제한·변경 기록 · ⬜ S3 검색·필터·S5 e2e · ❓ S4 건수 상한 vs 커서 더 보기 | [admin-tab-users-plan.md](./admin/admin-tab-users-plan.md) |
| invite(초대) | ✅ T0~T7(링크 복사·시각 열·취소)·초대 링크 → 카카오 가입(#589) · ⬜ T8'·T9' 토큰 검색·T10 e2e | [admin-tab-invite-plan.md](./admin/admin-tab-invite-plan.md) |
| banner(배너) | ✅ T1·T3·T5a 업로드 검사(EXIF 제거, #590)·링크 형식 서버 검증(#578) · ⬜ T2 CTA 짝 검증·T6 CTA 1열·T5b 옛 파일 정리 · ❓ 다중 배너(D-G1) 착수·`isActive` 제거 | [admin-tab-banner-plan.md](./admin/admin-tab-banner-plan.md) · [다중 배너 SDD](./admin/admin-banner-multi-sdd.md) |

## 2026-10-21 결정 8건 반영

| # | 결정 | PR |
|---|------|----|
| ① | 새 판매자 = 초대 링크 → 카카오 로그인 | #589 |
| ② | 판매자별 수수료율을 정산에 반영(기존 정산 불변, 미설정 5%) | #592 |
| ③ | 치운 판매자 = 손님 화면 숨김 + 새 주문 차단(로그인 허용) | #593 |
| ④ | 지급 뒤 환불 = 환불 진행 + 정산 회수 표시·운영 기록 | #592 |
| ⑤ | 정산 계좌 = 별도 컬렉션(판매자 입력, 관리자·본인만) | #592 |
| ⑥ | 어드민 변경 기록(`adminAuditLogs`, "기록" 탭) | #576 |
| ⑦ | 긴 목록 = 커서 "더 보기" + 서버 합계 | #593·#592 |
| ⑧ | 목록 칸·가게 이름 선택·판매자 연락처 | #593 |

함께 들어간 보강: 관리자 API 입력 검증·응답 최소화(#578), 강제환불 확인창·대상 표시·조회 실패(#583), 배너 위치정보 제거·숨긴 후기·입점 문의 삭제·순수 관리자 경로(#590). 상세 계약은 [`../api/admin.md`](../api/admin.md)·[`../api/settlements.md`](../api/settlements.md)·[`../api/auth.md`](../api/auth.md).

## 사람 결정 대기 (SEMANTIC_CONFLICT)

| 결정 | 탭 | 지금 동작 |
|------|----|-----------|
| 일반 주문 배송비를 수수료 대상에 넣을지 | settlements | 일반 주문은 배송비 포함 금액에, 회차 주문은 상품 소계에 수수료가 붙음 |
| 판매자 정지 기능을 따로 둘지 | stores | 정지 없음. '치움'이 숨김·주문 차단 역할 |
| 다중 배너(D-G1) 착수·2026-05 결정 재확인 | banner | 배너 한 장(`banners/main_hero`), 운영은 `isActive`로 꺼 둠 |
| F2 일괄 지급 방식 | settlements | 건별 지급만 |
| 기사 status 서버 필터를 화면에 연결할지 | drivers | 받은 쪽 안에서 화면이 거름 |
| 소비자 목록 건수 상한 vs 커서 더 보기 | users | 전량 로드 |
| 기본 수수료의 정본(환경변수 vs 화면 상수)·설정 화면 | stores | 서버 `PLATFORM_FEE_RATE`, 화면 안내 5% 상수 |
| 환불 실패 주문 재환불 버튼·일반 주문 배송 후 환불 | orders | 버튼 없음(배지만)·회차 주문만 배송 후 환불 |

## SDD가 없는 탭 — 현재 동작 요약

후기·입점 문의·기록 탭은 계획 SDD가 없다. 새 문서를 만들 만큼 남은 계획이 없어 현재 동작만 적는다.
탭 순서(`apps/seller/src/app/admin/layout.tsx`): 판매자·소비자·드라이버·주문·정산·초대·배너·입점 문의(토글)·후기(토글)·기록.

- **후기** (`/admin/reviews`, 기능 토글 `reviews`가 꺼지면 404) — 판매자·관리자가 숨긴 후기만 보여 주고(가게·상품·별점·내용·사진·숨긴 사유·처리자·시각), 할 수 있는 일은 확인창을 거친 "숨김 해제"(사유 선택 입력)뿐이다. API `GET /admin/reviews/hidden`·`POST /admin/reviews/:reviewId/unhide`. 숨긴 시각 최신순 최대 200건, 더 보기 없음. 조회 실패는 빈 목록과 구분해 "다시 조회"를 보여 준다. 단위·API 테스트는 있고 Playwright e2e는 없다.
- **입점 문의** (`/admin/partner-inquiries`, 토글 `partner-inquiry`) — 소비자 앱에서 들어온 문의(농가명·지역·연락처 `tel:`/`mailto:`·내용·받은 날짜 KST·연락 여부)를 보여 준다. "연락함으로 표시/되돌리기"와 확인창을 거친 "삭제"(#590)가 있다. API `GET /admin/partner-inquiries`·`PUT …/:inquiryId/contacted`·`DELETE …/:inquiryId`. 건수 상한·더 보기 없이 전량을 읽어 최신순 정렬한다. 조회 실패 구분 표시 있음. 단위·API 테스트는 있고 e2e는 없다.
- **기록** (`/admin/audit`) — 어드민 변경 기록 최근 100건 읽기 전용(#576). 계약은 [`../api/admin.md`](../api/admin.md) §10.

## 공통 정합성 검토 기준 (모든 어드민 탭 공통)

각 탭 SDD는 본 기준을 자체 §0에 그대로 포함한다(세션85~91 동일). C1~C4는 지금 PR CI가 대신 확인한다.

- **C1 tsc 0** — 어드민(판매자 앱)·소비자·기사 앱. shared·api 변경 시 재검증.
- **C2 biome 0** — 신규 경고 0.
- **C3 `npm run build` 0** — ⚠️ `npx next build` 금지(Turbopack 충돌).
- **C4 500라인 한도** — 단일 파일 500라인 초과 시 즉시 분할(CLAUDE.md §1).
- **C5 SSOT 토큰** — 하드코딩 색·라벨 0, shared 재사용.
- **C6 가드 유지** — 로딩·빈결과에서도 필터·탭 UI 유지(세션86 선례).
- **C7 시각 회귀 0** — 시각 변경이 의도된 태스크는 단독 커밋·육안 격리.

## 진행 방식 (공통)

- 한 탭씩 진단·확정 → 한 태스크씩 완결 후 커밋(세션91 패턴).
- 코드 변경은 **사용자 확정 후** 착수. 위 "사람 결정 대기" 항목은 결정 전 코드를 바꾸지 않는다.
- 백엔드·데이터모델 신설 규모(드릴다운·일괄 처리·다중 배너 등)는 **별도 SDD 선설계** 후 착수.
- 시각 변경이 큰 태스크(DatePickerInput·라이브 미리보기 등)는 **단독 커밋·육안 격리**.
- 어드민 e2e는 `apps/e2e/tests/admin-*.spec.ts`에 둔다(세션90 인프라). 다른 앱 화면과 닿는 연계 작업은 탭 SDD 부속 항으로 누적하고 별도 계획서로 위임한다.

## 외부 연계 계획서 (탭별 SDD가 위임하는 문서)

| 위임 출처 | 위임 대상 |
|-----------|-----------|
| orders §B-8 (셀러앱 주문 발송·추적 보강) | [`seller-orders-improve-plan.md`](./seller-orders-improve-plan.md) |
| users §E-11 (셀러앱 손님 정보·검색·전화) | [`seller-orders-customer-info-plan.md`](./seller-orders-customer-info-plan.md) |
| settlements §D-11 (셀러 정산 화면 기능 확장 #CL-56) | [`settlement-seller-feature-plan.md`](./settlement-seller-feature-plan.md) |
| drivers §C-9 (T1+T2 한 묶음 상세) | [`../../plans/admin-drivers-T1-T2-plan.md`](../../plans/admin-drivers-T1-T2-plan.md) |
| banner §G-11 (다중 배너 SDD) | [`admin/admin-banner-multi-sdd.md`](./admin/admin-banner-multi-sdd.md) |
| 과거 육안 위임(역사 기록, 현재 체크리스트 아님) | [`pending-visual-verify.md`](./pending-visual-verify.md) |

## 관련 문서
- 어드민 API 계약: [`../api/admin.md`](../api/admin.md)
- 멀티앱 리팩토링 로드맵: [`app-refactor-roadmap.md`](./app-refactor-roadmap.md)

## 변경 이력
- **2026-10-23**: main `e4d781db` 코드 대조로 탭별 진행표·SDD 머리말을 현재 상태로 정합화(2026-10-21 결정 8건·#576~#598 반영, 남은 구현과 사람 결정 분리, 후기·입점 문의·기록 탭 요약 추가).
- **세션99 (2026-05-26)**: 통합 본문(1019라인) → 7개 탭별 SDD로 분할. 본 문서는 인덱스로 축소.
- 세션92~98: 통합 본문에 §A~§G 누적(stores→orders→drivers→settlements→users→invite→banner).
