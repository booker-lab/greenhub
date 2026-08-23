<!-- Language: ko -->

# Admin 판매자 아카이브 — 역사 계획 요약

> 상태: Historical / implemented
> 원 작성: 2026-05
> 최종 정합화: 2026-08-23 KST

## 현재 판단

이 문서는 판매자(store) 아카이브/복구 기능을 설계하던 당시 계획이다. 현재 구현 계약은 `docs/specs/api/admin.md`와 실제 `apps/api/src/admin`, `apps/seller/src/app/admin` 코드를 사용한다.

현재 구현에서 중요한 계약은 다음과 같다.

- store archive/restore는 admin 영역 기능이다.
- 주문 또는 정산 기록이 있는 store는 archive를 차단한다.
- archive는 영구 삭제가 아니라 상태 변경이며 과거 거래 기록을 보존한다.
- 현재 API·UI 세부 경로와 권한은 `docs/specs/api/admin.md`를 정본으로 삼는다.

## 과거 계획 범위

당시 계획은 다음 작업을 포함했다.

- admin service에 archive/restore와 기록 존재 가드 추가
- admin controller route 추가
- seller admin hook과 목록 UI에 archive/restore 동작 추가
- archived store 표시/필터 UI 추가
- admin E2E smoke 도입

이 세부 Task 번호·라인 번호·세션 번호는 역사 자료이며 현재 구현 지시가 아니다.

## 제거한 오래된 운영 지시

과거 원문에는 다음 내용이 포함돼 있었으나 현재 기준에 맞지 않아 제거했다.

- 테스트 계정 이메일과 평문 비밀번호
- production DB에 test admin 계정을 seed하는 절차
- 운영 DB를 직접 쓰는 visual/E2E 준비 단계
- 과거 seller/consumer 테스트 계정의 비밀번호 정책 비교

현재 E2E 인증·fixture는 `docs/specs/ops/mvp-sales-round-e2e-environment.md`와 실제 workflow를 따른다. 운영 데이터나 계정을 검증 목적으로 변경하는 작업은 별도 승인 없이는 실행하지 않는다.

## 현재 검증 경로

1. `docs/specs/api/admin.md`에서 current admin 계약 확인
2. `apps/api/src/admin`의 service/controller/spec 확인
3. `apps/seller/src/app/admin`과 관련 hook 확인
4. 현재 `apps/e2e/tests/admin-store-archive.spec.ts`가 필요한 검증을 제공하는지 확인
5. production write가 필요한 검증은 자동으로 수행하지 않음

## 보안 원칙

- 계정 비밀번호·session·bypass secret을 문서에 기록하지 않는다.
- 테스트 계정은 현재 E2E 환경 계약으로 관리하며 과거 문서의 계정을 재사용 전제로 삼지 않는다.
- Git history의 과거 자격정보가 실제로 사용 중인지 별도 확인 없이 유효하다고 가정하지 않는다.
