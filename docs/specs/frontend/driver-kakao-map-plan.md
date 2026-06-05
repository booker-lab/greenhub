# 드라이버 Kakao 지도 SDK 연동 계획

> 작업 ID: `DRIVER-KAKAO-MAP-SDK`
> 작성일: 2026-06-03

## 1. 문제

`apps/driver/src/app/map/page.tsx`는 배송 경로 목록과 카카오내비 딥링크를 제공하지만 지도 영역은 플레이스홀더다. 드라이버는 당일 배송 위치를 한눈에 확인할 수 없고, `NEXT_PUBLIC_KAKAO_MAP_KEY`가 있어도 화면이 이를 활용하지 않는다.

## 2. 결정

- 지도 SDK는 Kakao Maps JavaScript SDK를 런타임에 로드한다.
- 환경 변수는 기존 플레이스홀더 문구와 맞춰 `NEXT_PUBLIC_KAKAO_MAP_KEY`를 사용한다.
- 주문 문서에 이미 저장된 `lat`·`lng`가 있는 주문만 지도 마커와 경로선에 표시한다.
- 좌표가 없거나 키가 없거나 SDK 로드에 실패하면 기존 플레이스홀더와 경유지 목록을 유지한다.
- 지도 중심은 좌표가 있는 첫 주문을 기준으로 하며, 여러 좌표가 있으면 bounds로 전체 마커를 수납한다.

## 3. 제외

- 주소 지오코딩
- 실제 도로 기반 경로 계산
- Kakao REST API 호출
- 주문 배정 알고리즘 변경
- Firestore 주문 스키마 변경

## 4. 구현

- `map/_components/KakaoRouteMap.tsx`를 추가해 SDK 로드, 지도 생성, 마커·선 표시를 담당한다.
- `map/_lib.ts`에 좌표 유효성, 지도 표시 주문 필터, 중심 좌표 계산을 추가한다.
- `map/page.tsx`는 기존 Firestore 구독과 정렬·목록 조립을 유지하고 지도 컴포넌트만 교체한다.

## 5. 완료 기준

- 키와 좌표가 있으면 지도 컨테이너가 렌더되고 마커·경로선이 생성된다.
- 키가 없거나 좌표가 없으면 안내 플레이스홀더가 표시된다.
- `pnpm --filter driver exec tsc --noEmit`
- `pnpm --filter driver build`
- 변경 파일 Biome 통과
