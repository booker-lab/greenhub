# 셀러 이미지 미리보기 next/image 전환 SDD

## 배경

`PERF-01`은 셀러 앱에 남은 `@next/next/no-img-element` 경고 2건을 정리하는 작업이다. 대상은 온보딩 로고 미리보기와 상품 이미지 업로드 썸네일이며, 둘 다 Firebase Storage 다운로드 URL을 표시하는 고정 크기 미리보기다.

## 결정

- `apps/seller/next.config.ts`에는 이미 `firebasestorage.googleapis.com` remote pattern이 있으므로 설정을 추가하지 않는다.
- 온보딩 로고 미리보기는 기존 80px 원형 컨테이너를 유지하고 `Image fill sizes="80px"`로 전환한다.
- 상품 이미지 업로드 썸네일은 기존 80px 정사각 컨테이너와 오버레이 버튼 배치를 유지하고 `Image fill sizes="80px"`로 전환한다.
- 이미지 URL은 사용자가 업로드한 Firebase Storage URL이므로 도메인 제한은 Next 설정에 위임하고, 업무 로직에는 새 검증을 추가하지 않는다.

## 제외

- 이미지 업로드 정책, 용량 제한, 파일 형식 검증 변경.
- placeholder blur, CDN 캐시 정책, Firebase Storage 보안 규칙 변경.
- 상품 목록 카드와 배너 화면의 기존 `next/image` 사용 방식 변경.

## 검증

- 변경 파일 Biome.
- seller 타입체크.
- seller 빌드.
- `rg "<img" apps/seller/src`로 잔여 태그 확인.
