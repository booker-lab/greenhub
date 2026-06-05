# 어드민 초대 만료기간 지정

> 작업 ID: `ADMIN-INVITE-F7-EXPIRY`
> 작성일: 2026-06-04

## 목적

기존 초대 토큰은 발급 시점부터 7일 고정 만료다. 운영자는 단기 테스트 초대와 장기 협력사 초대를 같은 기간으로 발급해야 하므로, 발급 전에 만료기간을 제한된 선택지에서 지정할 수 있게 한다.

## 결정

- API는 `POST /admin/invite` 본문에 선택 필드 `expiresInDays`를 받는다.
- 기본값은 기존 호환을 위해 7일이다.
- 허용 범위는 1일 이상 30일 이하 정수다.
- 프론트 UI는 임의 숫자 입력 대신 `3일`, `7일`, `14일`, `30일` Select를 제공한다.
- 응답은 기존 `{ token, expiresAt }` 형태를 유지한다.
- 기존 토큰의 만료일은 소급 변경하지 않는다.

## 범위

- `GenerateInviteDto` 추가.
- `AdminService.generateInvite(adminId, expiresInDays?)` 파라미터화.
- `/admin/invite` 발급 카드에 만료기간 Select 추가.
- 발급 요청 본문과 발급 직후 만료 안내를 E2E fixture로 검증한다.

## 제외

- 기존 초대 토큰 만료일 수정.
- 만료 토큰 재활성화.
- 초대 정책별 기본값 저장.
- 사용됨·만료 토큰 취소 정책 변경.

## 검증

- API 단위 테스트: 기본 7일, 지정 14일, 범위 밖 DTO 검증은 class-validator 계약으로 고정.
- E2E fixture: 14일 선택 후 발급 요청 본문과 발급 직후 만료일 표시.
- 정적 검증: 변경 파일 Biome, API·seller 타입체크와 빌드, `git diff --check`.
