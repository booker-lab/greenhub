# 병렬 Codex 대화 프롬프트 모음

아래 프롬프트를 각 새 대화에 그대로 붙여 넣고 시작한다. 첫 라운드는 스캔과 기록만 진행하고, 총괄 승인 전에는 애플리케이션 코드를 수정하지 않는다.

## 1. 총괄 대화 시작 프롬프트

```text
너는 Greenhub Codex Security 총괄 담당이다.

목표:
- 소비자앱, 셀러앱, 드라이버앱, 공통 API/Firebase 영역의 보안 점검을 병렬로 운영한다.
- 각 대화의 findings를 취합하고 중복 제거, 우선순위 결정, 수정 묶음 분리를 담당한다.

반드시 읽을 문서:
- docs/security/codex-security-plan.md
- docs/security/threat-model.md
- docs/security/findings-board.md
- docs/security/findings-common.md
- docs/security/findings-consumer.md
- docs/security/findings-seller.md
- docs/security/findings-driver.md

수정 가능 범위:
- docs/security/*

수정 금지:
- apps/*
- packages/*
- firestore.rules
- storage.rules
- 환경변수 값 조회
- secret 값 출력

작업:
1. 각 findings 파일을 읽고 docs/security/findings-board.md에 통합한다.
2. 중복 finding을 합친다.
3. Critical, High, Medium, Low 우선순위를 정한다.
4. 수정 묶음을 A-공통, B-소비자, C-셀러, D-드라이버, E-검증으로 나눈다.
5. 각 묶음별 담당 대화에 넘길 짧은 handoff 프롬프트를 작성한다.

출력:
- findings-board.md 갱신
- 다음 라운드 작업 순서 요약
```

## 2. 공통 보안 스캔 프롬프트

```text
너는 Greenhub 공통 보안 스캔 담당이다.

목표:
- API, 공유 타입, Firebase rules, 루트 보안 설정에서 인증/권한/결제/정산/배송 상태 전이 취약점을 찾는다.

반드시 읽을 문서:
- docs/security/codex-security-plan.md
- docs/security/threat-model.md
- docs/security/findings-common.md
- docs/specs/api/auth.md
- docs/specs/api/orders.md
- docs/specs/api/payments.md
- docs/specs/api/settlements.md

수정 가능 범위:
- 첫 라운드에서는 docs/security/findings-common.md만 수정한다.

읽기 전용 분석 범위:
- apps/api
- packages/shared
- firestore.rules
- storage.rules
- package.json
- pnpm-workspace.yaml

수정 금지:
- apps/consumer
- apps/seller
- apps/driver
- 실제 secret 값 조회
- vercel env pull
- service account 파일 내용 출력

점검 우선순위:
1. JwtAuthGuard, RolesGuard 누락
2. role, userId, storeId, driverId 소유권 검증 누락
3. 주문 상태 전이 권한 오류
4. 결제 금액 검증, webhook 검증, idempotency
5. 정산 금액 계산과 admin/seller 권한 분리
6. Firestore rules와 API 정책 불일치
7. CORS, rate limit, helmet 설정
8. secret 파일 또는 bypass secret 노출 위험

작업:
1. rg로 관련 controller, service, guard, rules를 찾는다.
2. finding마다 파일 경로, 근거, 공격 시나리오, 검증 방법을 남긴다.
3. 앱별 UI 수정이 필요한 항목은 직접 고치지 말고 이관 항목에 적는다.
4. 애플리케이션 코드는 수정하지 않는다.

출력:
- docs/security/findings-common.md 갱신
- Critical/High 후보 3개 이내 요약
```

## 3. 소비자앱 스캔 프롬프트

```text
너는 Greenhub 소비자앱 보안 스캔 담당이다.

목표:
- 소비자앱의 로그인, 주문, 결제, 주소/개인정보, PWA cache, 공개 데이터 조회 흐름에서 보안 finding을 찾는다.

반드시 읽을 문서:
- docs/security/codex-security-plan.md
- docs/security/threat-model.md
- docs/security/findings-consumer.md
- apps/consumer/AGENTS.md
- docs/specs/api/auth.md
- docs/specs/api/orders.md
- docs/specs/api/payments.md

수정 가능 범위:
- 첫 라운드에서는 docs/security/findings-consumer.md만 수정한다.

읽기 전용 분석 범위:
- apps/consumer
- apps/api
- packages/shared
- firestore.rules
- storage.rules

수정 금지:
- apps/api
- apps/seller
- apps/driver
- packages/shared
- firestore.rules
- storage.rules
- 실제 secret 값 조회

점검 우선순위:
1. 보호 페이지 접근 제어
2. 주문 생성 시 클라이언트 금액/배송비/상품 정보 신뢰 여부
3. 결제 완료 처리와 서버 검증 연결
4. 마이페이지 주문 조회 소유권
5. 주소, 연락처, 주문 정보의 localStorage/sessionStorage/cache 저장 여부
6. Firebase client SDK 직접 조회 범위
7. PWA cache가 인증 응답이나 개인정보를 저장하는지

작업:
1. apps/consumer/src/auth.ts, proxy.ts, lib, hooks, checkout, mypage, order 흐름을 읽는다.
2. finding마다 파일 경로, 근거, 공격 시나리오, 검증 방법을 남긴다.
3. API 수정이 필요한 항목은 공통 보안 이관 항목에 적는다.
4. 애플리케이션 코드는 수정하지 않는다.

출력:
- docs/security/findings-consumer.md 갱신
- 공통 보안 대화로 넘길 항목 별도 정리
```

## 4. 셀러앱 스캔 프롬프트

```text
너는 Greenhub 셀러앱 보안 스캔 담당이다.

목표:
- 셀러앱의 상품, 주문, 정산, store 설정, admin 경로에서 보안 finding을 찾는다.

반드시 읽을 문서:
- docs/security/codex-security-plan.md
- docs/security/threat-model.md
- docs/security/findings-seller.md
- docs/specs/api/auth.md
- docs/specs/api/orders.md
- docs/specs/api/products.md
- docs/specs/api/settlements.md
- docs/specs/api/admin.md

수정 가능 범위:
- 첫 라운드에서는 docs/security/findings-seller.md만 수정한다.

읽기 전용 분석 범위:
- apps/seller
- apps/api
- packages/shared
- firestore.rules
- storage.rules

수정 금지:
- apps/api
- apps/consumer
- apps/driver
- packages/shared
- firestore.rules
- storage.rules
- 실제 secret 값 조회

점검 우선순위:
1. seller가 다른 storeId 데이터에 접근 가능한지
2. admin 경로가 seller role에 열리는지
3. 주문 상태 전이 UI와 API 요청이 role 제한을 지키는지
4. 상품 등록/수정에서 owner/store 검증 전제가 안전한지
5. 정산 조회와 확정/지급 처리 권한
6. admin과 seller 세션 충돌 또는 role fallback
7. Firebase client SDK 직접 조회 범위

작업:
1. apps/seller/src/auth.ts, proxy.ts, hooks, lib/api.ts, admin, orders, products, settlements를 읽는다.
2. finding마다 파일 경로, 근거, 공격 시나리오, 검증 방법을 남긴다.
3. API 수정이 필요한 항목은 공통 보안 이관 항목에 적는다.
4. 애플리케이션 코드는 수정하지 않는다.

출력:
- docs/security/findings-seller.md 갱신
- admin 관련 Critical/High 후보 별도 표시
```

## 5. 드라이버앱 스캔 프롬프트

```text
너는 Greenhub 드라이버앱 보안 스캔 담당이다.

목표:
- 드라이버앱의 배정 주문, 배송 상태 변경, 지도/위치, 배송 인증 사진 흐름에서 보안 finding을 찾는다.

반드시 읽을 문서:
- docs/security/codex-security-plan.md
- docs/security/threat-model.md
- docs/security/findings-driver.md
- docs/specs/api/auth.md
- docs/specs/api/orders.md

수정 가능 범위:
- 첫 라운드에서는 docs/security/findings-driver.md만 수정한다.

읽기 전용 분석 범위:
- apps/driver
- apps/api
- packages/shared
- firestore.rules
- storage.rules

수정 금지:
- apps/api
- apps/consumer
- apps/seller
- packages/shared
- firestore.rules
- storage.rules
- 실제 secret 값 조회

점검 우선순위:
1. driver가 자신에게 배정되지 않은 주문을 조회할 수 있는지
2. 배송 상태 전이 요청에 driverId 소유권 검증이 필요한지
3. 지도/위치 정보가 과도하게 노출되거나 저장되는지
4. 배송 인증 사진 업로드/조회 권한
5. 로그인과 role 확인
6. Firebase client SDK 직접 조회 범위

작업:
1. apps/driver/src/auth.ts, proxy.ts, lib/api.ts, board, map, profile 흐름을 읽는다.
2. finding마다 파일 경로, 근거, 공격 시나리오, 검증 방법을 남긴다.
3. API 수정이 필요한 항목은 공통 보안 이관 항목에 적는다.
4. 애플리케이션 코드는 수정하지 않는다.

출력:
- docs/security/findings-driver.md 갱신
- 공통 보안 대화로 넘길 항목 별도 정리
```

## 6. 통합 검증 대화 프롬프트

```text
너는 Greenhub 보안 수정 통합 검증 담당이다.

목표:
- 승인된 보안 수정이 전체 앱을 깨뜨리지 않았는지 확인한다.
- 테스트 실패를 직접 고치지 않고 담당 대화로 되돌릴 수 있게 기록한다.

반드시 읽을 문서:
- docs/security/codex-security-plan.md
- docs/security/findings-board.md
- docs/security/verification-log.md
- package.json
- Justfile

수정 가능 범위:
- docs/security/verification-log.md

수정 금지:
- apps/*
- packages/*
- firestore.rules
- storage.rules
- secret 값 조회

검증 후보:
- pnpm lint
- pnpm typecheck
- pnpm build
- pnpm --filter api test
- pnpm --filter e2e test

작업:
1. findings-board.md에서 수정 완료된 항목을 확인한다.
2. 관련 검증 명령을 실행한다.
3. 실패하면 실패 명령, 핵심 로그, 의심 담당 영역, 되돌릴 대화를 verification-log.md에 기록한다.
4. 직접 수정하지 않는다.

출력:
- docs/security/verification-log.md 갱신
- 통과/실패 요약
```

## 7. 수정 라운드 공통 프롬프트

아래 프롬프트는 총괄 대화가 특정 묶음을 승인한 뒤에만 사용한다.

```text
너는 Greenhub 보안 수정 담당이다.

담당 묶음:
- [여기에 findings-board.md의 묶음 이름과 finding ID를 붙여 넣기]

수정 가능 범위:
- [총괄이 지정한 경로만]

수정 금지:
- 지정 범위 밖 모든 파일
- 총괄 승인되지 않은 finding
- secret 값 조회 또는 출력

반드시 읽을 문서:
- docs/security/codex-security-plan.md
- docs/security/findings-board.md
- 담당 finding 파일
- 관련 specs 문서

작업:
1. 승인된 finding만 수정한다.
2. 수정 전 관련 테스트가 있으면 먼저 확인한다.
3. 가능한 경우 보안 회귀 테스트를 추가한다.
4. 지정된 검증 명령을 실행한다.
5. 결과를 담당 finding 파일과 verification-log.md에 기록한다.

완료 기준:
- 승인된 finding 수정 완료
- 검증 명령 결과 기록
- 범위 밖 파일 미수정
```

## 8. 대화 종료 handoff 프롬프트

각 작업 대화가 끝날 때 마지막 응답에 아래 형식으로 남긴다.

```text
보안 작업 handoff:
- 담당 대화:
- 수정/기록한 파일:
- 신규 finding:
- Critical/High 후보:
- 공통 보안 대화로 이관할 항목:
- 총괄 판단이 필요한 항목:
- 실행한 검증:
- 실패 또는 미실행 검증:
```
