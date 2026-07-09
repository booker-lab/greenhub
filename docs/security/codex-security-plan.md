# Codex Security 병렬 운영 계획

작성일: 2026-07-07
대상 저장소: `greenhub`

## 목적

소비자앱, 셀러앱, 드라이버앱, 공통 API/Firebase 영역에 Codex Security 기반 보안 점검을 적용한다. 여러 Codex 대화를 병렬로 띄우되, 각 대화가 맡은 범위를 넘지 않게 하여 충돌과 중복 수정을 줄인다.

## 기본 원칙

1. 스캔과 기록은 병렬로 진행한다.
2. 수정은 총괄 대화에서 승인된 finding만 진행한다.
3. 공통 영역 수정은 앱별 수정 전에 먼저 처리한다.
4. 각 대화는 자기 소유 파일만 수정한다.
5. 권한, 인증, 결제, 정산, 배송 상태 전이는 기능보다 보안을 우선한다.
6. secret 값 조회, `vercel env pull`, service account 출력은 금지한다.
7. 오탐 가능성이 있으면 바로 수정하지 말고 재현 조건과 증거를 남긴다.

## 대화 역할

| 대화 | 소유 범위 | 수정 가능 | 기록 파일 |
| --- | --- | --- | --- |
| 총괄 | 전체 계획, 우선순위, 중복 제거 | `docs/security/*`만 | `docs/security/findings-board.md` |
| 공통 보안 | `apps/api`, `packages/shared`, `firestore.rules`, `storage.rules`, 루트 보안 설정 | 공통 범위만 | `docs/security/findings-common.md` |
| 소비자앱 | `apps/consumer` | `apps/consumer`만 | `docs/security/findings-consumer.md` |
| 셀러앱 | `apps/seller` | `apps/seller`만 | `docs/security/findings-seller.md` |
| 드라이버앱 | `apps/driver` | `apps/driver`만 | `docs/security/findings-driver.md` |
| 통합 검증 | 테스트 실행, 회귀 확인 | 원칙적으로 수정 금지 | `docs/security/verification-log.md` |

## 진행 순서

### 0단계: 준비

- 이 문서와 `docs/security/threat-model.md`를 기준 문서로 사용한다.
- 각 작업 대화는 `docs/security/parallel-chat-prompts.md`에서 자기 역할 프롬프트를 붙여 넣고 시작한다.
- 첫 라운드에서는 애플리케이션 코드를 수정하지 않는다.

### 1단계: 병렬 스캔

동시에 시작한다.

- 공통 보안 스캔
- 소비자앱 스캔
- 셀러앱 스캔
- 드라이버앱 스캔

각 대화는 finding을 자기 기록 파일에만 적는다. 다른 영역에서 문제가 보이면 직접 수정하지 않고 이관 표시를 남긴다.

### 2단계: 총괄 취합

총괄 대화가 각 finding 파일을 읽고 `docs/security/findings-board.md`에 합친다.

중복 제거 기준:

- 같은 취약 경로
- 같은 원인
- 같은 검증 방법
- 같은 수정 대상

우선순위 기준:

1. 인증/권한 우회
2. `userId`, `storeId`, `driverId` 소유권 검증 누락
3. 주문 상태 전이 조작
4. 결제/정산 금액 변조
5. Firebase rules와 API 권한 정책 불일치
6. secret, bypass token, service account 노출
7. PWA cache와 클라이언트 저장소 민감 정보

### 3단계: 수정 승인

총괄 대화가 수정 묶음을 만든다.

권장 묶음:

- 묶음 A: 공통 인증/권한/API/Firebase rules
- 묶음 B: 소비자 주문/결제/개인정보
- 묶음 C: 셀러 상품/주문/정산/admin
- 묶음 D: 드라이버 배송/지도/인증 사진
- 묶음 E: 테스트와 문서 보강

각 묶음은 하나의 대화가 맡는다. 서로 같은 파일을 수정하지 않는다.

### 4단계: 공통 수정

먼저 공통 보안 대화가 승인된 finding만 수정한다.

검증 후보:

- `pnpm --filter api test`
- `pnpm --filter api build`
- `pnpm typecheck`
- `pnpm --filter e2e test`

### 5단계: 앱별 수정

공통 수정이 끝난 뒤 앱별 수정 대화를 다시 시작한다.

- 소비자앱
- 셀러앱
- 드라이버앱

앱별 대화는 공통 영역을 직접 고치지 않는다. 공통 수정이 필요하면 총괄 대화로 되돌린다.

### 6단계: 통합 검증

통합 검증 대화가 전체 회귀를 확인한다.

검증 후보:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test:e2e`
- 역할별 핵심 smoke 또는 load smoke

실패가 나오면 직접 수정하지 말고 실패 로그, 의심 범위, 담당 대화를 `docs/security/verification-log.md`에 기록한다.

## 충돌 방지 규칙

- 두 대화가 같은 파일을 수정하지 않는다.
- 앱별 대화는 `packages/shared` 타입 수정도 하지 않는다.
- `firestore.rules`, `storage.rules`, `apps/api`는 공통 보안 대화만 수정한다.
- 총괄 대화는 앱 코드 수정 금지다.
- 통합 검증 대화는 테스트 실패 원인 분석까지만 한다.
- 이미 다른 대화가 수정 중인 finding은 `상태: 진행 중`으로 표시한다.

## 완료 기준

- 모든 finding이 `수정 완료`, `오탐`, `보류`, `이관` 중 하나로 분류됨
- 승인된 critical/high finding 수정 완료
- 앱별 핵심 인증/권한/상태 전이 검증 통과
- `docs/security/verification-log.md`에 최종 검증 결과 기록
