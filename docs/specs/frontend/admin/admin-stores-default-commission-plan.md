# 관리자 플랫폼 기본 수수료율 설정 계획

> 작업 ID: `ADMIN-STORES-T8`
> 작성일: 2026-06-03

## 목표

관리자가 신규 판매자에 적용할 플랫폼 기본 수수료율을 `/admin/stores`에서 설정할 수 있게 한다. 기존 판매자별 override는 유지하고, 기본값 변경이 운영 데이터에 예기치 않게 소급되지 않도록 한다.

## 결정

- 전역 설정 문서는 Firestore `platform/config` 단건 문서로 둔다.
- 필드는 `defaultCommissionRate`만 1차 범위에 포함한다.
- 스토어별 `commissionRate`가 있으면 override로 우선한다.
- 스토어별 `commissionRate`가 없으면 목록·상세 화면에서 전역 기본값을 표시 기준으로 사용한다.
- 신규 스토어 생성 시점에는 당시 전역 기본값을 `commissionRate`에 복사해 정산 계산 입력을 명시화한다.
- 기본값 변경은 기존 스토어 문서를 일괄 변경하지 않는다. 소급 적용은 별도 운영 승인과 배치 설계가 필요하다.

## API 계약

```ts
type AdminPlatformConfig = {
  defaultCommissionRate: number;
};

GET /admin/platform-config
PATCH /admin/platform-config/default-commission
body: { rate: number }
```

## UI 계약

- `/admin/stores` 상단에 기본 수수료율 설정 패널을 둔다.
- 입력 검증은 기존 `parseRate(input, { min: 0, max: 1 })`을 사용한다.
- 저장 성공 시 설정 패널과 판매자 목록을 다시 조회한다.
- 판매자 목록의 미설정 수수료율은 `기본 5.0%`처럼 표시한다.

## 검증

- API 단위 테스트로 설정 문서 기본값 fallback, 저장, DTO 범위를 검증한다.
- 신규 스토어 생성 테스트로 기본 수수료율 복사를 검증한다.
- seller `_lib` 단위 테스트로 `parseRate` 옵션과 기본 수수료 표시를 검증한다.
- API·seller 타입체크와 빌드, 변경 파일 Biome을 통과한다.
