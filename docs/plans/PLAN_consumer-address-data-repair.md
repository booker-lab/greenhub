# Project Blueprint: 소비자 운영주소 보정

## 문서 메타

- 작성일: 2026-06-23
- Priority: 1
- Labels: consumer, ops, firestore, data-repair
- SSOT Check: 주소 보정 계약은 `docs/specs/ops/seller-validation-data-cleanup.md`와 `docs/specs/frontend/consumer-app-visual-followup-plan.md`의 W11 운영 정리 계약을 따른다.
- Architectural Goal: 프론트 fallback이나 추정 치환 없이 운영 Firestore 원본 `stores/{storeId}.address`만 백업·dry-run·승인 기반으로 최소 보정한다.

## 업무 요약

소비자 홈과 `/stores`에서 보이는 깨진 주소 문자열은 UI 버그가 아니라 운영 데이터 보정 대상이다. 다음 새 대화에서는 주소 후보를 추정하지 않고, 읽기 전용 조회와 백업을 먼저 수행한 뒤 사용자의 명시적 승인 전까지 어떤 운영 쓰기도 하지 않는다.

## 금지 조건

- 백업 파일 생성 전 `--apply` 실행 금지
- dry-run 결과 공유 전 `--apply` 실행 금지
- 정상 주소 후보를 운영자가 명시적으로 승인하기 전 `--apply` 실행 금지
- `name`, `businessName`, `displayName` 등 주소 외 필드 변경 금지
- 기존 `scripts/ops/repair-mojibake-data.mjs`의 상호명·이름 allowlist 보정과 주소 보정을 한 실행에 섞기 금지

## 실행 계획

### W0. 대상 식별과 읽기 전용 조회

**목표**: 운영 화면에서 깨진 주소가 보이는 상점과 Firestore 문서를 매핑한다.

| Task-ID | 작업 | Target | Verify |
| --- | --- | --- | --- |
| 0.1 | 운영 홈과 `/stores`에서 깨진 주소가 보이는 상점명을 기록한다. | `https://greenlove.co.kr/`, `https://greenlove.co.kr/stores` | 브라우저 스모크 또는 읽기 전용 캡처 |
| 0.2 | 공개 API 또는 Firestore 읽기 전용 조회로 `storeId`, 상점명, 현재 `address`를 확인한다. | 운영 stores 데이터 | 조회 결과에 쓰기 작업이 없음을 확인 |
| 0.3 | 후보 목록을 문서화한다. | 이 문서 또는 세션 메모 | `git diff --check` |

**Conclusion**: [완료]

#### 2026-06-23 읽기 전용 식별 결과

- 운영 홈과 `/stores`에서 `테스트 상점` 주소가 `����� �׽�Ʈ�� �׽�Ʈ�� 1-1`로 표시된다.
- 공개 API `GET /public/stores`와 `GET /public/stores/9b2cb652-ff77-46b9-a773-e1efa78fb763`에서도 동일한 원본 주소가 확인됐다.
- 대상 문서는 `stores/9b2cb652-ff77-46b9-a773-e1efa78fb763`이며, 보정 대상 필드는 `address` 하나로 제한한다.
- 운영자가 제시한 정상 주소 후보는 `경기도 이천시`이다. 적용 전에는 백업과 dry-run 결과를 다시 제시하고, 별도 `--apply` 승인을 받는다.

### W1. 백업과 dry-run 스크립트 준비

**목표**: 주소 필드만 보정 가능한 최소 도구를 준비하고, 기본 실행은 반드시 dry-run으로 둔다.

| Task-ID | 작업 | Target | Verify |
| --- | --- | --- | --- |
| 1.1 | 대상 문서의 현재 값을 JSON 백업으로 저장한다. | `docs/archive/` 또는 안전한 백업 경로 | 백업 파일 존재와 대상 문서 수 확인 |
| 1.2 | 주소 전용 보정 옵션 또는 별도 스크립트를 만든다. | `scripts/ops/` | `node --check` |
| 1.3 | dry-run에서 `storeId`, 현재 주소, 정상 주소 후보, 변경 예정 여부만 출력한다. | 주소 보정 스크립트 | dry-run 출력 확인 |

**Conclusion**: [완료]

### W2. 승인 게이트

**목표**: 적용 전 사용자가 정확한 보정 내용을 승인한다.

| Task-ID | 작업 | Target | Verify |
| --- | --- | --- | --- |
| 2.1 | 백업 경로, 대상 `storeId`, 현재 주소, 정상 주소 후보, dry-run 결과를 사용자에게 제시한다. | 대화 응답 | 승인 전 쓰기 없음 |
| 2.2 | 사용자에게 `--apply` 실행 승인 여부를 명시적으로 확인한다. | 대화 응답 | 승인 문구 확인 |

**Conclusion**: [완료]

### W3. 적용과 운영 재검증

**목표**: 승인된 주소 필드만 적용하고 공개 화면에서 재확인한다.

| Task-ID | 작업 | Target | Verify |
| --- | --- | --- | --- |
| 3.1 | 승인된 대상만 `--apply`로 보정한다. | `stores/{storeId}.address` | 적용 로그 확인 |
| 3.2 | 적용 후 Firestore 또는 API로 주소 값을 재조회한다. | 운영 stores 데이터 | 보정값 일치 확인 |
| 3.3 | 운영 홈, `/stores`, 해당 `/stores/{storeId}`에서 주소 표시와 콘솔 오류를 확인한다. | `greenlove.co.kr` | 200 응답, 화면 표시, 콘솔 error 0 |
| 3.4 | 결과를 `docs/memory.md`와 관련 문서에 기록한다. | 문서 | 200라인 제한, `git diff --check` |

**Conclusion**: [완료]

#### 2026-06-23 적용 결과

- 사용자 승인 후 `scripts/ops/repair-store-address.mjs --apply --confirm-address "경기도 이천시"`를 실행했다.
- 적용 직전 백업은 `docs/archive/ops/store-address-repair-2026-06-23T14-52-39-764Z.json`에 저장했다.
- 변경 대상은 `stores/9b2cb652-ff77-46b9-a773-e1efa78fb763.address` 하나이며, 적용값은 `경기도 이천시`이다.
- 공개 API `GET /public/stores/9b2cb652-ff77-46b9-a773-e1efa78fb763`에서 `address: "경기도 이천시"`를 확인했다.
- 운영 홈, `/stores`, `/stores/9b2cb652-ff77-46b9-a773-e1efa78fb763`에서 `테스트 상점` 주소가 `경기도 이천시`로 표시됨을 확인했다.

## 종료 상태

1. 주소 보정 작업은 2026-06-23 완료됐다.
2. 추가 운영 쓰기 대상은 없다.
3. 같은 유형의 깨진 주소가 다시 발견되면 이 문서의 백업·dry-run·명시적 승인 절차를 새 대상 문서에 대해 반복한다.
4. 기존 백업 파일은 `docs/archive/ops/`에 보존한다.
