# 드라이버 앱 리팩토링 SDD

> 작성: 2026-06-03
> 범위: `apps/driver` 1차 구조 정비
> 상위 진입점: `docs/specs/frontend/app-refactor-roadmap.md` §4

## 1. 문제

드라이버 앱은 `board`, `map`, `profile`, `login` 화면으로 구성되어 있으며, 아직 셀러·어드민에서 확립한 `_lib`·`_components` 분리 패턴이 적용되지 않았다. 현재 500라인 초과 파일은 없지만 화면 파일 안에 다음 책임이 함께 있다.

- Firestore 조회 조건
- 주문 타입 정의
- 배송수단 라벨·색상 매핑
- 날짜·시간 표시
- 경로 정렬과 카카오내비 URL 생성

## 2. 목표

1차 목표는 동작을 바꾸지 않고 `board`와 `map`의 순수 표현·계산 로직을 분리하는 것이다. 3차 목표는 사진 업로드 화면에서 브라우저 카메라·업로드 오케스트레이션과 순수 UI 레이아웃을 분리하는 것이다. 4차 목표는 남은 `login`·`profile` 페이지도 같은 조립 전용 구조로 맞추는 것이다.

- `board/_lib.ts`: 주문 타입, 탭 정의, 배송수단 배지, 시간·위치 표시 함수
- `map/_lib.ts`: 지도 주문 타입, 최근접 정렬, 내비 URL 생성, 상태 배지·주소 표시 함수
- `board/[orderId]/photo/_components/PhotoCaptureView.tsx`: 사진 화면의 헤더, 카메라 빈 상태, 촬영 화면, 미리보기, 하단 액션 UI
- `login/_components/LoginView.tsx`: 로그인 카드, 승인 대기 안내, 카카오 시작 버튼
- `profile/_lib.ts`: 세션 사용자 표시 이름·이니셜·이메일 정규화
- `profile/_components/ProfileView.tsx`: 프로필 카드, 계정 정보, 로그아웃 버튼
- 화면 컴포넌트는 구독·상태·렌더 조립에 집중한다.

## 3. 제외

이번 묶음에서는 다음을 변경하지 않는다.

- Firestore 쿼리 계약
- 주문 상태 전환 API
- 거점 사진 업로드와 카메라 플로우의 계약 변경
- Kakao Maps SDK 실제 지도 연동
- 로그인·권한·NextAuth 계약
- 카카오 로그인 provider, pending query, 로그아웃 redirect 계약

## 4. 구현 순서

- [x] T1. 현재 드라이버 앱 파일 크기와 책임 분포를 감사한다.
- [x] T2. `board` 순수 로직을 `_lib.ts`로 분리하고 `OrderCard`와 `_client`가 공유한다.
- [x] T3. `map` 경로 정렬·내비 URL·표시 로직을 `_lib.ts`로 분리한다.
- [x] T4. 2차 후보인 상세/사진 업로드 분리 범위를 `board/[orderId]/_lib.ts` 묶음으로 확정한다.
- [x] T5. `board/[orderId]` 상세 표시·CTA·연락처 판정과 `photo` 업로드 경로·payload 생성을 `_lib.ts`로 분리한다.
- [x] T6. `photo/page.tsx`의 시각 레이아웃을 `PhotoCaptureView`로 분리하고, 페이지는 카메라·업로드 상태 조립만 담당한다.
- [x] T7. `login/page.tsx`의 화면 레이아웃을 `LoginView`로 분리하고, 페이지는 `searchParams` 전달만 담당한다.
- [x] T8. `profile/page.tsx`의 사용자 표시 정규화와 화면 레이아웃을 `_lib`·`ProfileView`로 분리하고, 페이지는 `auth()`와 redirect만 담당한다.

## 5. 검증

- `pnpm --filter driver exec tsc --noEmit`
- `pnpm --filter driver build`
- `pnpm exec biome check`는 변경 파일 범위로 수행한다.
- 수정 파일 라인 수 500라인 미만 유지
