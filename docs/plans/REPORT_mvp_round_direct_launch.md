<!-- Language: ko -->

# 회차 직배송 MVP 출시 보고서

## 보고서 메타

- **기준 계획**: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- **기준선 재조회일**: 2026-08-20 KST
- **현재 실행 상태**: consumer 법적 고지와 카카오 비즈니스 채널 승인 완료, 최신 main 로컬 통합·회귀 완료, 외부 변경 게이트 앞 중단
- **운영 변경**: 기존 Firebase 인덱스·Firestore 규칙·Storage 규칙 반영과 consumer 법적 고지 production 반영을 유지, 회차 출시 후보 배포·ALIGO 후속 설정·판매 모드 전환 미실행
- **비밀값·개인정보 기록**: 없음

## Task 0.1 — 출시 기준선

### Git·원격 상태

| 항목 | 읽기 전용 확인 결과 |
| :--- | :--- |
| 로컬 branch | `codex/mvp-sales-round-direct` |
| 로컬 HEAD | `534577b328bd8b8ea1a9fc58e5dbe353b76afb1a` |
| 원격 출시 branch | `origin/codex/mvp-sales-round-direct` |
| 원격 출시 branch SHA | `39fdb2c28c45b5c7658519181e41845bb24be2fd` |
| 원격 출시 branch 대비 | 로컬이 5개 commit 앞섬 |
| 원격 `main` SHA | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| 원격 `main`과 로컬 HEAD 관계 | `main`에만 1개, 로컬 HEAD에만 102개 commit이 있어 비파괴 통합 필요 |
| 열린 출시 PR | 없음 |
| 작업 트리 기준선 | 사용자 소유의 미추적 기준 계획 1개만 존재 |

### 원격 검증 상태

- 최근 `e2e-round-direct.yml` 성공 실행은 실행 번호 `30031472177`이다.
- 실행 SHA는 `39fdb2c28c45b5c7658519181e41845bb24be2fd`이며 상태는 `completed`, 결론은 `success`다.
- 성공 SHA는 원격 출시 branch와 일치하지만 현재 로컬 HEAD보다 5개 commit 이전이므로 현재 HEAD의 출시 검증 증거로 사용할 수 없다.

### 운영 배포 상태

| 서비스 | 현재 운영 판정 | 배포 SHA | 출시 기준선과의 차이 |
| :--- | :--- | :--- | :--- |
| Railway API | 최근 활성 성공 배포 | `110881aabfb5a87ce56f54c2714cfb2b6fc8244a` | 로컬 HEAD 및 원격 출시 branch와 다름 |
| Vercel consumer | `READY`, `production` | `164f65b77e317c41b7e0825377684f0a4db981d4` | 원격 `main`과 같고 로컬 HEAD와 다름 |
| Vercel seller | `READY`, `production` | `164f65b77e317c41b7e0825377684f0a4db981d4` | 원격 `main`과 같고 로컬 HEAD와 다름 |
| Vercel driver | `READY`, `production` | `164f65b77e317c41b7e0825377684f0a4db981d4` | 원격 `main`과 같고 로컬 HEAD와 다름 |

- Railway의 `164f65b…` 배포 이벤트는 `SKIPPED`이므로 활성 API SHA로 판정하지 않았다.
- API와 세 프런트가 동일 SHA가 아니므로 `salesMode` 전환 조건을 충족하지 않는다.

### 운영 환경 준비상태

| 범위 | 존재 여부만 확인한 결과 |
| :--- | :--- |
| Railway `PORTONE_V2_SECRET` | 있음 |
| Railway `PORTONE_WEBHOOK_SECRET` | 있음 |
| Railway `JWT_SECRET` | 있음 |
| Railway `FIREBASE_SERVICE_ACCOUNT_JSON` | 있음 |
| Railway ALIGO 필수 변수 4개 | 모두 없음 |
| Vercel consumer PortOne Store ID | 있음 |
| Vercel consumer 카카오페이 공개 채널 키 | 있음 |

- 환경 변수의 원문은 명령 출력이나 이 보고서에 기록하지 않았다.
- ALIGO 계정·발신 프로필·템플릿 승인은 별도 Task 1.1~1.3에서 확인해야 한다.

### 운영 Firebase 기준선

| 항목 | 읽기 전용 확인 결과 |
| :--- | :--- |
| Firebase 프로젝트 | `green-e4fe3` |
| 운영 복합 인덱스 | 33개 |
| 로컬 복합 인덱스 정의 | 32개 |
| 운영에 누락된 로컬 정의 | 8개 |
| 운영에만 있는 보존 후보 | 9개 |
| 운영 `saleRounds(storeId, status)` 인덱스 | 없음 |
| 운영 `saleRounds` 문서 | 0개 |

운영에 누락된 로컬 정의 8개:

- `orders(status, deliveryMethod, preparedAt)`
- `orders(userId, productId, saleType)`
- `payments(orderId, status)`
- `products(isActive, category)`
- `products(isActive, saleType)`
- `products(storeId, isActive, saleType)`
- `saleRounds(storeId, status)`
- `varieties(subCategory, name)`

운영 전용 보존 후보 9개:

- `invites(tokenPrefixes, createdAt DESC)`
- `orders(storeId, createdAt ASC)`
- `orders(storeId, status, createdAt ASC)`
- `orders(storeId, status, createdAt DESC)`
- `users(role, createdAt ASC)`
- `users(role, driverApproved, createdAt ASC)`
- `users(role, driverApproved, createdAt DESC)`
- `users(role, suspended, createdAt ASC)`
- `users(role, suspended, createdAt DESC)`

- 위 9개 인덱스는 Task 2.1~2.4에서 운영 정합화를 끝내기 전 삭제하거나 로컬 정의로 덮어쓰지 않는다.
- Firestore·Storage 규칙의 운영 차이는 Task 2.1에서 별도 감사한다.

### 판매 모드와 회차 상태

- 운영 대상 스토어는 정확히 1개이며 필수 식별·소유·활성 상태 검증을 통과했다.
- `salesMode` 원문은 미설정이고 호환 판정은 `legacy`다.
- 전환 dry-run은 `legacy → round_direct` 단일 변경 예정과 `legacy` 롤백 대상을 확인했다.
- dry-run은 읽기 전용으로 종료됐으며 운영 문서 변경은 없었다.
- 운영 `saleRounds` 문서는 0개이므로 첫 회차는 아직 준비되지 않았다.

## 출시 차단 요소 기준선

1. 원격 `main`의 선행 commit 1개와 로컬 미게시 commit 5개를 비파괴 방식으로 통합해 출시 후보 SHA를 확정해야 한다.
2. 확정 SHA를 원격 branch와 PR에 반영하고 같은 SHA에서 전체 원격 게이트를 다시 통과해야 한다.
3. ALIGO 필수 변수 4개와 provider 승인·격리 실제 발송 증거가 없다.
4. 운영 Firebase에 로컬 필수 인덱스 8개가 없고 운영 전용 인덱스 9개는 보존해야 한다.
5. API와 세 프런트의 운영 SHA가 서로 다르며 모두 현재 출시 후보보다 이전이다.
6. 첫 회차가 없고 운영 역할·전환 승인·공개 전 smoke 증거가 없다.
7. Phase 6 승인 전까지 `salesMode`를 `legacy`로 유지하며 당근 링크를 공개하지 않는다.

## 변경 금지와 롤백 기준

- 이번 기준선 작업은 Git fetch와 외부 상태 조회만 수행했으며 push·PR·배포·운영 변수·Firebase·회차·알림·판매 모드를 변경하지 않았다.
- 후속 전환 직후 검증이 실패하면 당근 링크를 공개하지 않고 `salesMode: legacy` 롤백을 우선한다.
- 롤백 과정에서 기존 회차 주문을 삭제하거나 legacy 주문으로 변환하지 않는다.

## Task 0.2 — `main` 통합과 출시 SHA 확정

### 실행 직전 Git 재조회

| 항목 | 확인 결과 |
| :--- | :--- |
| 실행 전 로컬 HEAD | `534577b328bd8b8ea1a9fc58e5dbe353b76afb1a` |
| 원격 `main` | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| 원격 출시 branch | `39fdb2c28c45b5c7658519181e41845bb24be2fd` |
| 실행 전 분기 관계 | 로컬에만 102개, `origin/main`에만 1개 commit |
| 실행 전 작업 트리 | Task 0.1 계획·보고서 2개만 미추적 상태 |

### 비파괴 통합과 충돌 해결

- `git merge --no-ff origin/main` 실행에서 `.github/workflows/e2e-round-direct.yml`의 `add/add` 충돌 1건이 발생했다.
- 두 파일의 실질 차이는 `PLAYWRIGHT_JSON_OUTPUT_FILE` 경로 1줄이었다.
- 현재 branch의 절대 경로는 commit `39fdb2c28c45b5c7658519181e41845bb24be2fd`에서 E2E 결과 경로를 작업공간에 고정하기 위해 도입된 수정이다.
- 위 수정의 회귀를 막기 위해 `${{ github.workspace }}/.artifacts/...` 값을 유지하고 충돌 표식만 제거했다.
- 다른 충돌이나 예상 밖 파일 변경은 없었다.

### 통합 검증

| 항목 | 결과 |
| :--- | :--- |
| merge commit | `fbc7776d397efa31450650f417a9acec6fbfa5d8` |
| 첫 번째 부모 | `534577b328bd8b8ea1a9fc58e5dbe353b76afb1a` |
| 두 번째 부모 | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| `origin/main` 조상 포함 검사 | 종료 코드 0 |
| 기존 branch 대비 workflow 내용 보존 검사 | 종료 코드 0 |
| `git diff --check` | 종료 코드 0 |

### 로컬 출시 후보

- Task 0.1 계획·보고서를 포함하는 Task 0.2 종결 commit을 현재 branch HEAD로 만들고 그 값을 단일 로컬 출시 후보 SHA로 사용한다.
- 최종 SHA는 종결 commit 직후 `git rev-parse HEAD`로 확정하며 Task 0.3의 push·PR 준비 기준으로 넘긴다.
- 이번 Task에서는 push·PR·배포·운영 변수·Firebase·회차·알림·판매 모드를 변경하지 않았다.

## Task 1.1 — ALIGO 알림 계약과 provider 준비상태 감사

### 판정

- **Task 상태**: 완료
- **provider 준비상태**: 준비되지 않음
- **출시 판정**: 차단
- **다음 승인 게이트**: Task 1.2 — ALIGO 계정·발신 프로필·템플릿 승인
- 이번 Task는 값 없는 읽기 전용 감사와 로컬 계약 테스트만 수행했다. 자격 증명 등록, provider 승인 요청, 실제 알림 발송, 운영 환경 변경은 수행하지 않았다.

### 계정·발신 자산·템플릿 승인 계약

ALIGO 공식 문서와 현재 구현을 교차 확인한 결과 실제 발송 전 다음 항목이 필요하다.

| 항목 | 필수 상태 | Task 1.1 확인 결과 |
| :--- | :--- | :--- |
| ALIGO 계정·API 인증 | 사용할 계정과 API Key가 유효하고 발송 잔액이 준비됨 | 자격 증명 없음, 미확인 |
| SMS 발신번호 | ALIGO에 사전 등록되고 정상 개통·문자 발신 가능한 번호 | 미확인 |
| 카카오채널·발신 프로필 | 카카오채널 인증 완료, 발신 프로필 정상, `senderkey` 발급 | 미확인 |
| 알림톡 템플릿 | 실제 본문과 변수 계약이 일치하고 상태 `A`, 승인상태 `APR` | 승인 식별자·상태 없음 |
| 격리 수신자 | Task 1.3에서 사용할 승인된 수신자 | 이번 Task 범위 밖 |

- ALIGO 알림톡 공식 계약은 카카오채널 인증, 발신 프로필 키, 승인된 템플릿 코드, 발신번호를 요구한다.
- ALIGO SMS 공식 계약은 사이트에 사전 등록된 발신번호만 허용한다.
- 공식 근거: `https://smartsms.aligo.in/alimapi.html`, `https://smartsms.aligo.in/smsapi.html`

### 환경별 변수 존재 여부

원문 값은 읽기 결과에 출력하거나 이 문서에 기록하지 않았다.

| 환경 | `ALIGO_API_KEY` | `ALIGO_USER_ID` | `ALIGO_SENDER_KEY` | `ALIGO_SENDER_PHONE` | 판정 |
| :--- | :---: | :---: | :---: | :---: | :--- |
| `apps/api/.env.example` 선언 | 있음 | 있음 | 있음 | 있음 | 이름 계약 존재 |
| 로컬 `apps/api/.env` | 없음 | 없음 | 없음 | 없음 | 실제 provider 사용 불가 |
| shared E2E | 불필요 | 불필요 | 불필요 | 불필요 | 비운영 `stub` 사용 |
| Railway `production` API | 없음 | 없음 | 없음 | 없음 | 운영 실제 발송 불가 |
| Vercel 프런트 | 해당 없음 | 해당 없음 | 해당 없음 | 해당 없음 | API 서버 전담 |

- Railway 조회는 `production`의 `api` service를 대상으로 네 변수의 속성 존재 여부와 비어 있지 않은지만 판정했다.
- shared E2E는 `ROUND_DIRECT_E2E_PROVIDER_MODE=stub`이며 운영 환경에서 stub 선택은 코드로 차단된다.
- `ConfigModule`에는 ALIGO 필수 변수의 시작 시점 검증이 없고, 현재는 발송 호출 시 누락 실패를 반환한다.

### 코드 계약 감사

확인한 정상 계약:

- 일반 실행은 `AligoClient`, 검증된 비운영 E2E만 `E2EAligoClient`를 선택한다.
- 운영 환경의 E2E provider 우회는 생성 전에 실패한다.
- 알림톡 요청은 최대 3회 시도하며 모두 실패하면 동일 렌더링 본문으로 SMS를 1회 요청한다.
- 네 필수 설정이 누락되면 외부 provider를 호출하지 않고 실패 처리한다.
- 알림톡·SMS 최종 실패는 주문 상태를 유지하고 `CUSTOMER_NOTICE_FAILED` 운영 예외로 연결한다.
- ALIGO 알림톡·SMS 요청 URL과 필수 요청 필드 이름은 공식 문서와 일치한다.

확인한 준비상태 차단 요소:

1. `NOTIFICATION_TEMPLATES`의 내부 논리 코드가 ALIGO의 `tpl_code`로 그대로 전달된다. ALIGO가 템플릿 등록 후 발급하는 provider 템플릿 코드와 내부 논리 코드 사이의 매핑 계층이 없다.
2. 회차 직배송 결제 확정 경로는 `ROUND_ORDER_CONFIRMED`가 아니라 `ORDER_ACCEPTED`를 호출한다. `ROUND_ORDER_CONFIRMED`는 정의와 테스트 외 실제 호출부가 없다.
3. 회차 직배송에서 실제 도달 가능한 논리 템플릿은 `ORDER_ACCEPTED`, `ORDER_PREPARING`, `ORDER_DELIVERING`, `ORDER_DELIVERY_HELD`, `ORDER_REDELIVERY_PAYMENT_REQUESTED`, `ORDER_REDELIVERY_SCHEDULED`, `ORDER_DELIVERED`, `ORDER_CANCELLED`의 8종이다.
4. `ORDER_ACCEPTED` 본문의 `name`, `ORDER_DELIVERY_HELD` 본문의 `reason`, `ORDER_CANCELLED` 본문의 `reason`은 현재 회차 호출부에서 전달되지 않아 빈 문자열로 렌더링된다.
5. 알림톡과 SMS 모두 provider의 요청 접수 응답만 성공으로 기록한다. 메시지 식별자를 보존하거나 최종 전달 결과를 재조회하는 계약은 없다.
6. 전체 registry 23종을 한 번에 승인 대상으로 삼기 전에 회차 MVP의 실제 8종과 의도된 `ROUND_ORDER_CONFIRMED` 사용 여부를 확정해야 한다.

### 검증

| 검증 | 결과 |
| :--- | :--- |
| Railway 운영 ALIGO 변수 이름·비어 있지 않음 검사 | 4개 모두 없음, 원문 미출력 |
| 로컬 환경 파일 변수 이름 검사 | 실제 로컬 값 없음, `.env.example` 선언만 존재 |
| API 알림 전달·provider 선택·E2E 대역 테스트 | 3개 suite, 18개 test 모두 통과 |
| 외부 provider 변경 | 없음 |
| 실제 알림 발송 | 없음 |

### Task 1.1 결론

Task 1.1의 감사 자체는 완료했다. 그러나 운영 ALIGO 필수 변수 4개, 승인된 발신번호·발신 프로필·템플릿 식별자와 상태가 모두 없거나 확인되지 않았고, provider 템플릿 코드 매핑과 일부 본문 변수 계약에도 차단 요소가 있다. 따라서 ALIGO provider는 실제 발송 준비 완료로 판정할 수 없으며 출시를 계속 차단한다.

## Task 1.2 — ALIGO 계정·발신 프로필·템플릿 승인

### 판정

- **Task 상태**: 부분 완료, 외부 승인 대기
- **provider 준비상태**: 준비되지 않음
- **출시 판정**: 차단
- **차단 조건**: 카카오 비즈니스 채널 심사 승인 전에는 ALIGO 발신 프로필 등록과 회차 알림 템플릿 심사를 진행할 수 없음
- **다음 확인 게이트**: 카카오 비즈니스 채널 심사 결과 확인 후 Task 1.2 재개
- 이번 Task는 ALIGO 계정·발신번호·카카오채널 발신 프로필·회차 알림 템플릿의 provider 승인 범위만 다뤘다. 운영 자격 증명 등록, 실제 알림 발송, Task 1.3 이후 작업과 운영 변경은 수행하지 않았다.

### provider 진행 상태

자격 증명 값, 발신번호 원문, 계정 개인정보와 카카오 관리자 개인정보는 조회 결과나 이 문서에 기록하지 않았다.

| 항목 | 확인·수행 결과 | 현재 상태 |
| :--- | :--- | :--- |
| ALIGO 계정 | 사업자 계정 로그인과 API 담당자 등록을 확인함 | 계정 준비됨 |
| API Key | 사용자 승인 후 provider에서 신규 발급함. 원문은 출력·기록·운영 등록하지 않음 | 발급됨, 운영 미등록 |
| SMS 발신번호 | 등록된 기본 발신번호 1건의 상태가 정상임을 확인함 | 승인됨 |
| API 발신 서버 IP | 등록된 항목 없음 | 운영 송신 인프라 확정 전 미등록 |
| 카카오채널 | 공개 채널 존재와 접근 가능 상태를 확인함 | 일반 채널에서 비즈니스 채널 심사 단계로 전환 |
| 카카오 비즈니스 심사 | 사용자가 2026-07-31에 신청을 완료함. provider 화면은 평균 영업일 3~7일 소요를 안내함 | 심사 중 |
| ALIGO 발신 프로필 | 비즈니스 채널 전환이 필요하다는 provider 차단 응답을 확인함 | 미등록, `senderkey` 없음 |
| 회차 알림 템플릿 8종 | 발신 프로필이 없어 등록·심사 요청을 시작하지 않음 | 미등록·미승인 |
| 발송 잔액 | 계정 조회 시 0P | 실제 발송 준비 안 됨 |

### 회차 알림 템플릿 승인 범위

Task 1.1에서 실제 도달 가능하다고 확정한 다음 8종만 Task 1.2의 provider 승인 대상으로 유지한다.

1. `ORDER_ACCEPTED`
2. `ORDER_PREPARING`
3. `ORDER_DELIVERING`
4. `ORDER_DELIVERY_HELD`
5. `ORDER_REDELIVERY_PAYMENT_REQUESTED`
6. `ORDER_REDELIVERY_SCHEDULED`
7. `ORDER_DELIVERED`
8. `ORDER_CANCELLED`

- 카카오 비즈니스 채널 심사 승인 후 ALIGO에서 발신 프로필을 다시 등록하고 `senderkey` 발급 여부를 값 없이 확인해야 한다.
- 발신 프로필 등록이 완료된 뒤 8종 템플릿을 등록하고 각 provider 템플릿 코드와 승인 상태를 값 없이 확인해야 한다.
- 템플릿 등록 전 `ORDER_ACCEPTED.name`, `ORDER_DELIVERY_HELD.reason`, `ORDER_CANCELLED.reason` 누락과 provider 템플릿 코드 매핑 부재를 해소할 별도 구현 승인이 필요하다.
- 현재 단계에서는 발신 프로필과 템플릿의 provider 승인 식별자가 발급되지 않았다.

### 수행한 외부 변경과 수행하지 않은 변경

수행한 provider 범위 변경:

- ALIGO API 담당자 등록
- 사용자 승인에 따른 ALIGO API Key 신규 발급
- 사용자의 카카오채널 인증·추가 시도
- 사용자의 카카오 비즈니스 채널 심사 신청

수행하지 않은 변경:

- API 발신 서버 IP 등록
- ALIGO 자격 증명의 로컬·Railway·기타 운영 환경 등록
- ALIGO 발신 프로필 등록 완료와 `senderkey` 운영 반영
- 회차 알림 템플릿 등록·심사 요청
- 실제 알림톡·SMS 발송
- Task 1.3 이후 작업
- production 배포, Firebase·회차·`salesMode` 및 기타 운영 변경
- commit, push, PR 수정·병합, workflow dispatch

### Task 1.2 결론

ALIGO 사업자 계정, 신규 API Key와 정상 상태의 SMS 기본 발신번호까지는 준비했다. 그러나 카카오채널의 비즈니스 심사가 진행 중이어서 ALIGO 발신 프로필을 등록할 수 없고 `senderkey`와 회차 알림 템플릿 8종의 provider 승인도 아직 존재하지 않는다. 따라서 Task 1.2는 완료가 아니라 외부 승인 대기 상태로 중단하며, 카카오 심사 승인 확인 전까지 출시를 계속 차단한다.

## Task 2.1 — 운영 인덱스·규칙 차이 감사

### 판정

- **Task 상태**: 완료
- **감사 판정**: 운영 보존 항목과 신규 반영 후보를 분리했고, 삭제 없는 반영 순서를 확정함
- **출시 판정**: 계속 차단
- **다음 승인 게이트**: Task 2.2 — 비운영 Firebase 규칙 회귀
- 이번 Task는 운영 Firebase 인덱스·Firestore 규칙·Storage 규칙의 읽기 전용 조회와 로컬 정의 비교만 수행했다.
- Firebase 배포·데이터 변경, 로컬 인덱스·규칙 수정, 에뮬레이터 테스트, workflow dispatch, commit, push와 PR 변경은 수행하지 않았다.
- 운영 조회에 사용된 자격 증명 원문, 사용자 정보와 Firebase 데이터는 출력하거나 기록하지 않았다.

### 실행 기준선

| 항목 | 확인 결과 |
| :--- | :--- |
| branch | `codex/mvp-sales-round-direct` |
| 로컬 HEAD | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 원격 `main` | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| 원격 출시 branch | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 실행 전 작업 트리 | 이 보고서 1개 수정, 145줄 추가 |
| 기존 변경 보존 | Task 1.1 76줄과 Task 1.2 69줄을 수정 없이 보존 |
| 운영 Firebase project | `green-e4fe3` |

### Firestore 인덱스 차이

운영 인덱스 조회 결과와 `firestore.indexes.json`을 `__name__` 자동 필드를 제외한 논리 정의로 비교했다.

| 구분 | 개수 |
| :--- | ---: |
| 운영 인덱스 | 33 |
| 로컬 인덱스 | 32 |
| 공통 | 24 |
| 운영에만 존재 | 9 |
| 로컬에만 존재 | 8 |
| 운영·로컬 필드 재정의 | 각각 0 |

운영 전용 보존 대상 9개:

1. `invites(tokenPrefixes ARRAY_CONTAINS, createdAt DESC)`
2. `orders(storeId, createdAt ASC)`
3. `orders(storeId, status, createdAt ASC)`
4. `orders(storeId, status, createdAt DESC)`
5. `users(role, createdAt ASC)`
6. `users(role, driverApproved, createdAt ASC)`
7. `users(role, driverApproved, createdAt DESC)`
8. `users(role, suspended, createdAt ASC)`
9. `users(role, suspended, createdAt DESC)`

로컬 전용 신규 반영 후보 8개:

1. `orders(status, deliveryMethod, preparedAt ASC)`
2. `orders(userId, productId, saleType)`
3. `payments(orderId, status)`
4. `products(isActive, category)`
5. `products(isActive, saleType)`
6. `products(storeId, isActive, saleType)`
7. `saleRounds(storeId, status)`
8. `varieties(subCategory, name)`

- 현재 로컬 정의에는 운영 전용 9개가 없으므로 그대로 인덱스를 배포하면 기존 운영 인덱스가 삭제 후보가 될 수 있다.
- Task 2.4에서 운영 전용 9개를 로컬 정의에 보존한 뒤 로컬 전용 8개를 추가하는 합집합 방식으로 정합화해야 한다.
- 운영 전용 인덱스의 삭제 승인은 없으며, 이번 감사의 삭제 허용 항목은 0개다.
- `saleRounds(storeId, status)`는 공개 회차 목록의 `storeId ==`와 `status in` 결합 쿼리에 대응하는 필수 복합 인덱스다.
- 운영에는 `saleRounds` 복합 인덱스가 없으므로 회차 공개 전 반영이 필요하다.

### Firestore 규칙 차이

| 구분 | 운영 | 로컬 |
| :--- | :--- | :--- |
| 규칙 줄 수 | 42 | 98 |
| SHA-256 | `9d84ad45389d3c926494f1f8e7ff86be8180a5e24015713a9f9fdb19daf45e69` | `13874e36dad2c980f1a484e82741633be107e938425f5019b7936402882b6283` |
| 동일 여부 | \- | 다름 |

운영 보존 계약:

- `orders`: 인증 사용자 중 같은 `storeId`, `admin`, `driver` 읽기 허용, 클라이언트 쓰기 차단
- `products`: 공개 읽기, 클라이언트 쓰기 차단
- `stores`: 공개 단건 읽기, 목록·쓰기 차단
- `dailyCaps`, `groupProductConfig`: 공개 읽기, 클라이언트 쓰기 차단
- 그 밖의 경로: 읽기·쓰기 차단

로컬 신규·명시화 항목:

- `varieties`: 공개 단건 읽기만 허용하고 목록·쓰기는 차단
- `saleRounds`: `SCHEDULED`, `OPEN`, `CLOSED`, `COMPLETED` 상태만 공개 읽기 허용
- `saleRoundItems`: 같은 `storeId`의 공개 상태 회차에 연결된 항목만 공개 읽기 허용
- `checkoutReservations`, `operationIssues`, `legalOrderRecords`, `legalDisputeRecords`, `marketingConsentLogs`, `deliveryPhotoRecords`, `notificationDeliveries`: 클라이언트 읽기·쓰기를 명시적으로 차단

호환·보안 판정:

- 로컬은 운영의 기존 다섯 경로 허용 조건과 최종 차단 조건을 그대로 유지하므로 확인된 기존 Firestore 클라이언트 접근을 축소하지 않는다.
- `varieties`, 공개 상태 `saleRounds`, 해당 `saleRoundItems`는 운영의 전면 차단 상태에서 공개 읽기로 바뀌므로 의도된 공개 필드만 포함하는지 Task 2.2에서 회귀 검증해야 한다.
- 신규 서버 전용 컬렉션은 운영의 최종 차단과 실효 권한이 같으며, 명시적 경계만 추가한다.
- Admin SDK 서버 접근은 보안 규칙 적용 대상이 아니므로 기존 API 서버 읽기·쓰기에 영향이 없다.

### Storage 규칙 차이

| 구분 | 운영 | 로컬 |
| :--- | :--- | :--- |
| 규칙 줄 수 | 22 | 126 |
| SHA-256 | `ff959b73dc2ff041f14594bf22fd8b24b34dd8bb7a885601c5a137b8739c48ac` | `03a49ced55db5eebdcac7076c7a9a917f1082a8159e35b31720e70e990444b01` |
| 동일 여부 | \- | 다름 |

경로별 차이:

| 경로 | 운영 | 로컬 | 호환 위험 |
| :--- | :--- | :--- | :--- |
| `products/{storeId}/...` | 공개 읽기, 모든 인증 사용자 쓰기 | 공개 읽기, 해당 스토어 판매자 또는 관리자만 5MiB 이하 허용 이미지 생성·수정, 소유자·관리자 삭제 | 권한·중첩 경로·파일 형식 축소 |
| `banners/...` | 공개 읽기, 모든 인증 사용자 쓰기 | `banners/main_hero/{fileName}`만 공개 읽기, 관리자만 5MiB 이하 허용 이미지 변경 | 경로·역할·파일 형식 축소 |
| `logos/...` | 공개 읽기, 모든 인증 사용자 쓰기 | 평면 경로에서 본인 UID 접두 이름을 쓰는 판매자만 2MiB 이하 JPEG·PNG·WebP 변경 | 경로·역할·이름·파일 형식 축소 |
| `deliveryPhotos/{fileName}` | 일치 규칙이 없어 접근 차단 | 배정된 거점 배송 기사만 규격화된 기존 JPEG 단건 읽기·배송 중 생성 허용 | 기존 기사 흐름을 새로 허용 |
| `deliveryPhotos/{orderId}/{fileName}` | 일치 규칙이 없어 접근 차단 | 클라이언트 접근 명시 차단, Admin SDK와 서명 URL만 사용 | 실효 권한 유지 |
| 그 밖의 경로 | 일치 허용 규칙이 없어 차단 | 최종 규칙으로 읽기·쓰기 명시 차단 | 실효 권한 유지 |

호환·보안 판정:

- 현재 판매자 상품 이미지, 관리자 메인 배너, 판매자 로고 업로드 구현의 경로·파일 형식은 로컬 규칙 계약과 일치한다.
- Firebase 사용자 지정 토큰은 `role`과 `storeId`를 포함하므로 판매자·관리자 역할 판정 계약이 존재한다.
- 기존 거점 배송 사진 구현은 평면 `deliveryPhotos/{orderId}_{timestamp}.jpg`를 사용하므로 로컬 legacy 규칙 경로와 일치한다.
- 다만 운영의 광범위한 인증 사용자 쓰기를 로컬이 크게 축소하므로 코드 정적 감사만으로 기존 객체 변경·삭제와 모든 사용자 역할의 호환을 확정할 수 없다.
- Task 2.3의 비운영 에뮬레이터 회귀를 통과하기 전에는 운영 Storage 규칙을 반영하지 않는다.

### 삭제 없는 반영 목록

1. Task 2.2에서 로컬 Firestore 규칙의 기존 공개·인증 접근과 신규 회차 공개 경계를 비운영 에뮬레이터로 검증한다.
2. Task 2.3에서 상품·배너·로고·기존 거점 사진·신규 회차 사진 경계를 비운영 에뮬레이터로 검증한다.
3. Task 2.4에서 운영 전용 인덱스 9개와 로컬 인덱스 32개의 합집합을 `firestore.indexes.json`에 반영한다.
4. Task 2.5 별도 승인 전까지 인덱스를 배포하지 않는다.
5. Task 2.6 별도 승인 전까지 Firestore 규칙을 배포하지 않는다.
6. Task 2.7 별도 승인 전까지 Storage 규칙을 배포하지 않는다.

### Task 2.1 결론

운영 인덱스 33개와 로컬 인덱스 32개 중 공통은 24개다. 운영 전용 9개는 모두 보존하고 로컬 전용 8개는 신규 반영 후보로 유지해야 하며, 삭제를 승인한 인덱스는 없다. Firestore 규칙은 기존 운영 접근 계약을 보존하면서 회차 공개 경계를 추가하지만, Storage 규칙은 운영보다 권한과 경로를 크게 축소한다. 따라서 Task 2.1 감사는 완료하되 Task 2.2와 Task 2.3 회귀 및 Task 2.4 합집합 정합화 전까지 어떠한 운영 Firebase 반영도 금지한다.

## Task 2.2 — 비운영 Firebase 규칙 회귀

### 판정

- **Task 상태**: 완료
- **회귀 판정**: 통과
- **출시 판정**: 계속 차단
- **다음 승인 게이트**: Task 2.3 — Storage 규칙 회귀
- 이번 Task는 로컬 Firestore Emulator와 demo project ID `demo-greenhub`만 사용했다.
- 운영 Firebase 조회·배포·데이터 변경, Firestore 인덱스 변경, Storage 규칙 테스트·수정은 수행하지 않았다.
- `firestore.rules`와 `tests/firestore/firestore-rules.test.mjs`는 감사 결과 추가 수정이 필요하지 않아 그대로 유지했다.

### 실행 기준 상태

| 항목 | 확인 결과 |
| :--- | :--- |
| branch | `codex/mvp-sales-round-direct` |
| 로컬 HEAD | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 원격 `main` | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| 원격 출시 branch | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 실행 전 작업 트리 | 보고서 1개 수정, 281줄 추가 |
| 기존 변경 보존 | Task 1.1·1.2 145줄과 Task 2.1 136줄을 수정 없이 보존 |
| PR | `#11`, OPEN, non-draft, `CLEAN` |
| PR 검사 | API, consumer, seller, driver, Vercel Preview Comments 모두 성공 |

### 규칙 및 테스트 감사

기존 운영 계약과 동일하게 유지되는 경계:

- `orders`: 인증 판매자는 같은 `storeId` 주문만 읽을 수 있고 다른 매장 주문은 거부된다. `admin`과 `driver` 읽기는 허용되며 일반 인증 사용자의 읽기는 거부된다. 클라이언트 쓰기는 계속 차단된다.
- `products`: 비인증 공개 단건·목록 읽기를 유지하고 클라이언트 쓰기를 차단한다.
- `stores`: 비인증 공개 단건 읽기를 유지하고 목록·쓰기를 차단한다.
- `dailyCaps`, `groupProductConfig`: 비인증 공개 단건·목록 읽기를 유지하고 클라이언트 쓰기를 차단한다.
- 최종 재귀 규칙은 그 밖의 모든 직접 클라이언트 읽기·쓰기를 계속 차단한다.

신규 회차 계약:

- `varieties`: 비인증 공개 단건 읽기는 성공하고 목록 읽기는 거부된다. 비인증·일반 사용자·판매자·기사·관리자의 생성·수정·삭제는 모두 거부된다.
- `saleRounds`: `isPublicSaleRoundStatus`는 `SCHEDULED`, `OPEN`, `CLOSED`, `COMPLETED`만 공개 상태로 인정한다. `OPEN` 단건과 공개 상태 조건 목록 조회는 성공하고 `DRAFT` 단건과 무조건 목록 조회는 거부된다.
- `saleRoundItems`: 공개 회차와 같은 `storeId`에 연결된 단건 및 `roundId`·`storeId` 조건 목록 조회는 성공한다. `DRAFT` 회차 연결 항목, `storeId` 조건이 없는 목록, 무조건 목록은 거부된다.
- `saleRounds`, `saleRoundItems`: 비인증·일반 사용자·판매자·기사·관리자의 생성·수정·삭제는 모두 거부된다.

서버 전용 경계:

- `checkoutReservations`
- `operationIssues`
- `legalOrderRecords`
- `legalDisputeRecords`
- `marketingConsentLogs`
- `deliveryPhotoRecords`
- `notificationDeliveries`

위 7개 컬렉션은 비인증·일반 사용자·판매자·기사·관리자의 기존 문서 읽기와 생성·수정·삭제가 모두 거부됐다. Admin SDK를 사용하는 서버 접근에는 Firestore Security Rules가 적용되지 않으므로 서버 동작 계약은 변경되지 않는다.

### 에뮬레이터 검증

1. 최초 `pnpm test:firestore-rules` 실행은 `127.0.0.1:8080`에 Firestore Emulator가 실행 중이지 않아 `ECONNREFUSED`로 종료됐다. 규칙 판정 실패가 아니라 실행 환경 선결 조건 미충족이다.
2. 기본 Java 17로 `firebase emulators:exec`를 시도했으나 `firebase-tools 15.18.0`과 캐시된 Firestore Emulator `v1.21.0`이 Java 21 이상을 요구해 에뮬레이터 시작 전에 종료됐다.
3. 시스템 Java 설치를 변경하지 않고 임시 Temurin `21.0.12+8` 런타임의 `JAVA_HOME`만 해당 프로세스에 지정했다.
4. `firebase emulators:exec --only firestore --project demo-greenhub "pnpm test:firestore-rules"`로 Firestore Emulator를 실행하고 요구된 `pnpm test:firestore-rules`를 다시 수행했다.
5. 최종 결과는 **14개 통과, 0개 실패, 종료 코드 0**이다.

통과한 검증 묶음:

| 검증 묶음 | 결과 |
| :--- | ---: |
| 서버 전용 컬렉션 7종 직접 접근 차단 | 7/7 통과 |
| `saleRounds` 공개·비공개 읽기 경계 | 1/1 통과 |
| `saleRoundItems` 연결 회차 읽기 경계 | 1/1 통과 |
| 회차 컬렉션 2종 직접 쓰기 차단 | 2/2 통과 |
| 기존 공개 상품·매장·재고 조회 | 1/1 통과 |
| `varieties` 단건 읽기·목록 및 쓰기 차단 | 1/1 통과 |
| legacy 주문 읽기 권한 | 1/1 통과 |
| 합계 | 14/14 통과 |

### 변경 및 금지 범위 확인

- Task 2.2에서 규칙·테스트 소스 변경은 없다.
- 기존 Task 1.1·1.2·2.1 보고서 기록은 수정 없이 보존하고 이 절만 추가했다.
- 에뮬레이터 검증 지원용 Temurin 21 런타임과 압축 파일은 로컬 임시 경로 `C:\Users\tazan\AppData\Local\Temp\greenhub-task22-jre21` 및 `C:\Users\tazan\AppData\Local\Temp\greenhub-task22-jre21.zip`에 생성됐으며 저장소 작업 트리에는 포함되지 않는다.
- 기존 `.gitignore` 대상 `firestore-debug.log`에는 에뮬레이터 로그가 추가됐으며 추적 파일 변경에는 포함되지 않는다.
- PLAN의 기존 Status 표시는 출시 후보 SHA 보존을 위해 변경하지 않았다.
- commit, push, PR 생성·수정·병합, workflow dispatch를 수행하지 않았다.
- production 배포, 회차 생성·수정, `salesMode` 변경, 실제 알림 발송을 수행하지 않았다.
- ALIGO는 카카오 비즈니스 채널 심사 중이며, 발신 프로필 `senderkey`와 회차 알림 템플릿 8종의 provider 승인은 아직 없다.

### Task 2.2 결론

로컬 Firestore 규칙은 기존 공개 상품·매장·재고 및 legacy 주문 읽기 계약을 유지하면서 `varieties` 공개 단건 읽기, 공개 상태 회차와 연결 항목 읽기만 추가한다. 비공개 회차, 불충분한 회차 항목 목록 쿼리, 모든 회차 직접 쓰기, 서버 전용 7개 컬렉션의 모든 직접 클라이언트 접근은 Firestore Emulator에서 차단됨을 확인했다. 따라서 Task 2.2는 통과로 완료하되, Task 2.3 Storage 규칙 회귀 승인 전에는 후속 작업을 수행하지 않는다.

## Task 2.3 — Storage 규칙 회귀

### 판정

- **Task 상태**: 완료
- **회귀 판정**: 통과
- **출시 판정**: 계속 차단
- **다음 승인 게이트**: Task 2.4 — 운영 인덱스 정의 보존 정합화
- 이번 Task는 로컬 Firestore·Storage Emulator와 demo project ID `demo-greenhub`만 사용했다.
- 운영 Firebase 조회·배포·데이터 변경, Firestore 규칙·인덱스 변경, Task 2.4 이후 작업은 수행하지 않았다.
- `storage.rules`와 `tests/storage/storage-rules.test.mjs`는 감사와 회귀 결과 추가 수정이 필요하지 않아 그대로 유지했다.

### 실행 기준 상태

| 항목 | 확인 결과 |
| :--- | :--- |
| branch | `codex/mvp-sales-round-direct` |
| 로컬 HEAD | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 원격 `main` | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| 원격 출시 branch | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 실행 전 작업 트리 | 보고서 1개 수정, 371줄 추가 |
| 기존 변경 보존 | Task 1.1·1.2 145줄, Task 2.1 136줄, Task 2.2 90줄을 수정 없이 보존 |
| PR | `#11`, OPEN, 초안 아님, `CLEAN` |
| PR 검사 | API, consumer, seller, driver, Vercel Preview Comments 모두 성공 |

### 규칙 및 테스트 감사

공개 이미지 경로:

- `products/{storeId}/{fileName}`은 공개 단건 읽기를 유지한다. 생성·수정은 5MiB 이하 JPEG·PNG·WebP·GIF이면서 해당 `storeId` 판매자 또는 관리자일 때만 허용하고, 삭제도 해당 판매자 또는 관리자에게만 허용한다.
- 상품 이미지 테스트는 비인증·일반 사용자·다른 매장 판매자·기사의 쓰기, 5MiB 초과, SVG와 중첩 경로를 거부하고 해당 판매자와 관리자의 허용 동작을 확인한다. 확장자가 아니라 실제 `contentType`을 기준으로 판정하는 계약도 확인한다.
- `banners/main_hero/{fileName}`은 공개 단건 읽기를 유지한다. 5MiB 이하 JPEG·PNG·WebP·GIF 생성·수정과 삭제는 관리자에게만 허용한다.
- 배너 테스트는 판매자 쓰기, 5MiB 초과, SVG, `banners/other` 경로를 거부하고 관리자의 생성·수정·삭제를 확인한다.
- `logos/{fileName}`은 공개 단건 읽기를 유지한다. 판매자는 파일 이름이 본인 UID와 숫자 시각값의 평면 조합일 때만 2MiB 이하 JPEG·PNG·WebP 생성·수정·삭제가 가능하다.
- 로고 테스트는 다른 판매자와 관리자의 쓰기, 2MiB 초과, GIF, 중첩 경로를 거부하고 본인 판매자의 생성·수정·삭제를 확인한다.

배송 사진 경로:

- 기존 거점 배송 사진 `deliveryPhotos/{orderId}_{timestamp}.jpg`는 `driver` 역할이면서 Firestore 주문의 `driverId`가 본인이고 `deliveryMethod`가 `hub`인 기사만 단건 읽을 수 있다.
- 기존 거점 사진 생성은 위 배정 조건에 더해 주문 상태가 `DELIVERING`이고 파일이 5MiB 이하 JPEG일 때만 허용한다. 수정·삭제와 목록 조회는 모두 거부한다.
- legacy 테스트는 하이픈·밑줄이 포함된 주문 ID 모두에서 배정 기사의 단건 읽기와 생성을 확인하고 비인증·일반 사용자·판매자·다른 기사·관리자의 접근을 거부한다. 잘못된 이름·PNG·5MiB 초과·수정·삭제·목록 조회도 거부한다.
- 신규 회차 배송 사진 `deliveryPhotos/{orderId}/{fileName}`은 Admin SDK 서버 업로드와 서명 URL만 사용하도록 모든 클라이언트의 읽기·생성·수정·삭제를 명시적으로 거부한다.
- 신규 회차 사진 테스트는 비인증·일반 사용자·판매자 2종·기사 2종·관리자 전체에서 기존 객체 읽기와 생성·수정·삭제가 모두 실패함을 확인한다.
- 정의되지 않은 경로는 최종 재귀 규칙으로 모든 역할의 읽기·쓰기를 거부한다.

### 에뮬레이터 검증

1. 이전 Task 2.2에서 사용한 임시 JRE 디렉터리는 실행 시점에 존재하지 않았지만 압축 파일은 남아 있었다.
2. 시스템 Java 17을 변경하지 않고 기존 압축 파일을 `C:\Users\tazan\AppData\Local\Temp\greenhub-task22-jre21`에 다시 풀고, 해당 프로세스의 `JAVA_HOME`만 Temurin `21.0.12+8`로 지정했다.
3. `firebase emulators:exec --only firestore,storage --project demo-greenhub "pnpm test:storage-rules"`로 Firestore·Storage Emulator를 실행했다. Storage 규칙의 legacy 주문 배정 판정이 Firestore 문서를 조회하므로 두 Emulator를 함께 사용했다.
4. 요구된 `pnpm test:storage-rules` 최종 결과는 **12개 통과, 0개 실패, 종료 코드 0**이다.

| 검증 묶음 | 결과 |
| :--- | ---: |
| 신규 회차 배송 사진 직접 접근 전면 차단 | 1/1 통과 |
| 상품 공개 읽기·역할·소유자·경로·크기·형식 | 3/3 통과 |
| 배너 공개 읽기·관리자 역할·경로·크기·형식 | 2/2 통과 |
| 로고 공개 읽기·소유자·역할·경로·크기·형식 | 2/2 통과 |
| legacy 거점 사진 배정 기사 호환·목록 및 변경 차단 | 3/3 통과 |
| 정의되지 않은 경로 차단 | 1/1 통과 |
| 합계 | 12/12 통과 |

### 변경 및 금지 범위 확인

- Task 2.3에서 규칙·테스트 소스 변경은 없고, 이 보고서 절만 추가했다.
- 기존 Task 1.1·1.2·2.1·2.2 보고서 기록은 수정 없이 보존했다.
- 임시 Temurin 21 런타임은 `C:\Users\tazan\AppData\Local\Temp\greenhub-task22-jre21\jdk-21.0.12+8-jre`에 다시 생성됐고, 기존 압축 파일 `C:\Users\tazan\AppData\Local\Temp\greenhub-task22-jre21.zip`은 그대로 유지했다. 두 경로 모두 저장소 작업 트리에 포함되지 않는다.
- 기존 `.gitignore` 대상 `firestore-debug.log`에는 Emulator 로그가 추가됐으며 추적 파일 변경에는 포함되지 않는다.
- PLAN의 기존 Status 표시는 출시 후보 SHA 보존을 위해 변경하지 않았다.
- 원격 추적 상태 확인을 위한 `fetch --prune` 외에 외부 변경은 수행하지 않았다.
- commit, push, PR 생성·수정·병합, workflow dispatch를 수행하지 않았다.
- production 배포, 운영 Firebase 조회·배포·데이터 변경, 회차 생성·수정, `salesMode` 변경, 실제 알림 발송을 수행하지 않았다.
- ALIGO는 기존 확인 기준 카카오 비즈니스 채널 심사 중이며, 이번 Task에서는 상태를 재조회하거나 후속 작업을 수행하지 않았다. 발신 프로필 `senderkey`와 회차 알림 템플릿 8종의 provider 승인은 여전히 확인되지 않은 상태로 유지한다.

### Task 2.3 결론

로컬 Storage 규칙은 기존 상품·메인 배너·판매자 로고의 공개 읽기 호환을 유지하면서 변경 권한을 의도한 소유자와 역할로 제한하고, 기존 거점 배송 사진은 배정 기사·거점 배송·배송 중·JPEG·크기 조건에서만 호환한다. 신규 회차 배송 사진 경로는 모든 직접 클라이언트 접근을 차단한다. 이 경계는 실제 Firestore·Storage Emulator의 12개 회귀 테스트에서 모두 통과했다. 따라서 Task 2.3은 통과로 완료하되, Task 2.4 — 운영 인덱스 정의 보존 정합화는 다음 대화에서 별도 승인을 받은 뒤 진행한다.

## Task 2.4 — 운영 인덱스 정의 보존 정합화

### 판정

- **Task 상태**: 완료
- **최종 판정**: 통과
- **인덱스 구성**: 공통 24개 + 운영 전용 보존 9개 + 로컬 전용 신규 반영 후보 8개 = 중복 없는 41개
- **운영 전용 인덱스 삭제**: 0개
- **다음 승인 게이트**: Task 2.5 — 운영 Firestore 인덱스 반영
- Task 2.5의 범위는 승인된 `firestore.indexes.json`만 `firebase deploy --only firestore:indexes --project green-e4fe3`로 운영에 반영하고 기존 운영 인덱스의 비의도 삭제 없이 신규 필수 인덱스가 반영됐는지 판정하는 것이다.
- Task 2.5와 이후 작업은 수행하지 않았으며, 다음 대화에서 정확히 `Task 2.5 승인`을 받은 뒤에만 진행한다.

### 실행 기준 상태

| 항목 | 확인 결과 |
| :--- | :--- |
| branch | `codex/mvp-sales-round-direct` |
| 로컬 HEAD | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| `origin/main` | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| `origin/codex/mvp-sales-round-direct` | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 시작 작업 트리 | `docs/plans/REPORT_mvp_round_direct_launch.md` 1개 수정, 449줄 추가 |
| 최종 작업 트리 | 보고서 549줄 추가(기존 449줄 + Task 2.4 100줄), 인덱스 78줄 추가, 총 2개 파일 627줄 추가 |
| Task 2.4 시작 직전 보고서 SHA-256 | `0cc30bed42c6be836c84f0490c64da5a61c4e048cbc2f2d482c052f564191bed` |
| 기존 보고서 보존 | Task 1.1·1.2 145줄, Task 2.1 136줄, Task 2.2 90줄, Task 2.3 78줄을 수정 없이 보존 |
| 인덱스 정의 시작 상태 | 중복 없는 로컬 32개, `fieldOverrides` 0개 |
| PR | #11, OPEN, draft 아님, CLEAN, head SHA 일치, 기존 검사 5개 모두 성공 |

### 합집합 정합화

기존 로컬 32개를 HEAD의 `firestore.indexes.json`과 구조적으로 비교해 내용과 순서가 모두 일치함을 확인한 뒤, Task 2.1에서 확인한 운영 전용 9개를 파일 끝에 추가했다. 기존 정의를 삭제하거나 필드·방향·범위를 변경하지 않았다.

| 구성 | 개수 | 처리 |
| :--- | ---: | :--- |
| 운영·로컬 공통 | 24 | 기존 로컬 정의 유지 |
| 운영 전용 | 9 | 삭제 없이 로컬 정의에 추가 |
| 로컬 전용 | 8 | 신규 운영 반영 후보로 유지 |
| 합계 | 41 | 중복 없음 |

운영 전용 보존 인덱스 9개:

1. `invites(tokenPrefixes ARRAY_CONTAINS, createdAt DESC)`
2. `orders(storeId, createdAt ASC)`
3. `orders(storeId, status, createdAt ASC)`
4. `orders(storeId, status, createdAt DESC)`
5. `users(role, createdAt ASC)`
6. `users(role, driverApproved, createdAt ASC)`
7. `users(role, driverApproved, createdAt DESC)`
8. `users(role, suspended, createdAt ASC)`
9. `users(role, suspended, createdAt DESC)`

로컬 전용 신규 반영 후보 8개:

1. `orders(status, deliveryMethod, preparedAt ASC)`
2. `orders(userId, productId, saleType)`
3. `payments(orderId, status)`
4. `products(isActive, category)`
5. `products(isActive, saleType)`
6. `products(storeId, isActive, saleType)`
7. `saleRounds(storeId, status)`
8. `varieties(subCategory, name)`

- 모든 41개 정의의 `queryScope`는 `COLLECTION`이다.
- 모든 필드는 `order` 또는 `arrayConfig` 중 정확히 하나만 가지며, `invites.tokenPrefixes`만 `arrayConfig: CONTAINS`를 사용한다.
- 필드 순서와 `ASCENDING`·`DESCENDING` 방향은 Task 2.1 비교 결과와 일치한다.
- 필수 `saleRounds(storeId ASCENDING, status ASCENDING)` 복합 인덱스는 정확히 1개 유지했다.
- 정합화 후 `firestore.indexes.json` SHA-256은 `c621adde082f17324161617d239122d3660d941d24aef29b1d2d87c9b8e3bfa6`이다.

### 비운영 검증

| 검사 | 결과 |
| :--- | :--- |
| JSON 파싱 | 성공, 종료 코드 0 |
| HEAD 원본 32개 완전 보존 비교 | 일치 |
| 운영 전용 9개 기대 정의 비교 | 일치 |
| 최종 개수·중복 검사 | 41개, 중복 0개 |
| 필드 설정·`queryScope` 검사 | 잘못된 필드 설정 0개, 잘못된 범위 0개 |
| `saleRounds(storeId, status)` 검사 | 정확히 1개 |
| `pnpm --filter api test -- firestore/firestore-indexes.spec.ts --runInBand` | 23개 통과, 0개 실패, 종료 코드 0 |
| `pnpm exec biome check firestore.indexes.json` | 1개 파일 통과, 수정 0개, 종료 코드 0 |
| `git diff --check -- firestore.indexes.json docs/plans/REPORT_mvp_round_direct_launch.md` | 출력 없음, 종료 코드 0 |

- 첫 사용자 정의 구조 감사 실행은 PowerShell 파이프에서 한글 JavaScript 식별자가 손상돼 구문 오류로 중단됐다. 같은 검사를 영문 식별자로 즉시 재실행해 모든 기대값 일치와 종료 코드 0을 확인했으며, 소스·인덱스 정의 문제는 아니었다.
- Firestore·Storage Emulator와 운영 Firebase는 이 정적 인덱스 정합화 검증에 사용하지 않았다.

### 변경 및 금지 범위 확인

- Task 2.4의 소스 변경은 `firestore.indexes.json`에 운영 전용 9개를 추가한 것뿐이며, 별도로 이 보고서 절을 추가했다.
- 기존 Task 1.1·1.2·2.1·2.2·2.3 보고서 기록은 수정 없이 보존했다.
- `firestore.rules`, `storage.rules`, 두 규칙 테스트 파일과 PLAN의 기존 Status 표시는 변경하지 않았다.
- 원격 추적 상태 확인을 위한 `fetch --prune`과 PR 읽기 전용 재조회 외에 외부 상태 작업은 수행하지 않았다.
- commit, push, PR 생성·수정·병합, workflow dispatch를 수행하지 않았다.
- 운영 Firebase 인덱스 조회·배포·삭제·변경과 Firestore·Storage 규칙 배포를 수행하지 않았다.
- production 배포, 회차 생성·수정, `salesMode` 변경, 실제 알림 발송을 수행하지 않았다.
- PR #11은 OPEN, draft 아님, CLEAN이며 head는 `codex/mvp-sales-round-direct`의 `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff`, base는 `main`이다. API, consumer, seller, driver, Vercel Preview Comments 검사는 모두 성공 상태이며 PR은 변경하지 않았다.
- ALIGO는 기존 확인 기준 카카오 비즈니스 채널 심사 중이며, 이번 Task에서는 상태를 재조회하거나 후속 작업을 수행하지 않았다. 발신 프로필 `senderkey`와 회차 알림 템플릿 8종의 provider 승인은 여전히 확인되지 않았다.

### Task 2.4 결론

운영 전용 인덱스 9개를 하나도 삭제하지 않고 기존 로컬 32개에 추가해, 공통 24개·운영 전용 보존 9개·로컬 전용 신규 반영 후보 8개로 구성된 중복 없는 41개 합집합을 완성했다. 기존 32개 정의와 필수 `saleRounds(storeId, status)` 인덱스는 그대로 유지했고, 구조 감사와 실제 쿼리 인덱스 계약 23개 및 Biome 검사를 모두 통과했다. 따라서 Task 2.4는 통과로 완료하되, 운영 변경인 Task 2.5 — 운영 Firestore 인덱스 반영은 다음 대화에서 `Task 2.5 승인`을 받은 뒤에만 진행한다.

## Task 2.5 — 운영 Firestore 인덱스 반영

### 판정

- **Task 상태**: 완료
- **최종 판정**: 통과
- **배포 판정**: 승인된 41개 합집합 정의가 운영 `(default)` 데이터베이스에 반영됐고 기존 운영 인덱스 삭제는 0개
- **최종 활성화 상태**: 41개 `READY`, `CREATING` 0개, `NEEDS_REPAIR` 0개
- **다음 승인 게이트**: Task 2.6 — 운영 Firestore 규칙 반영
- Task 2.6의 범위는 에뮬레이터 회귀를 통과한 `firestore.rules`만 `firebase deploy --only firestore:rules --project green-e4fe3`로 운영에 반영하고 신규 회차 접근 경계와 기존 legacy 접근 호환 규칙이 반영됐는지 판정하는 것이다.
- Task 2.6과 이후 작업은 수행하지 않았으며, 다음 대화에서 정확히 `Task 2.6 승인`을 받은 뒤에만 진행한다.

### 실행 기준 상태

| 항목 | 확인 결과 |
| :--- | :--- |
| branch | `codex/mvp-sales-round-direct` |
| 로컬 HEAD | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| `origin/main` | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| `origin/codex/mvp-sales-round-direct` | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 시작 작업 트리 | 보고서 549줄 추가, 인덱스 78줄 추가, 총 2개 파일 627줄 추가 |
| Task 2.5 시작 직전 보고서 | 708줄, SHA-256 `d2fc74999e87bb8e9b5b039563d82f6b1ae4f9e745720936aab2186e0f65e6a1` |
| 배포한 인덱스 파일 SHA-256 | `c621adde082f17324161617d239122d3660d941d24aef29b1d2d87c9b8e3bfa6` |
| 기존 보고서 보존 | Task 1.1·1.2·2.1·2.2·2.3·2.4의 기존 708줄을 수정 없이 보존 |
| PR | #11, OPEN, draft 아님, CLEAN, head SHA 일치, 기존 검사 5개 모두 성공 |

### 배포 전 재검증

`firestore.indexes.json`은 Task 2.4에서 승인된 합집합 정의와 동일한 SHA를 유지했다.

| 검사 | 결과 |
| :--- | :--- |
| JSON 파싱·구조 감사 | 성공, 종료 코드 0 |
| HEAD 원본 32개 완전 보존 비교 | 내용·순서 모두 일치 |
| 운영 전용 9개 기대 정의 비교 | 모두 일치하며 파일 끝에 보존 |
| 최종 개수·중복 검사 | 41개, 중복 0개 |
| 구성 | 공통 24개 + 운영 전용 보존 9개 + 로컬 전용 신규 반영 8개 |
| 필드 설정·`queryScope` 검사 | 잘못된 필드 설정 0개, 잘못된 범위 0개 |
| `saleRounds(storeId, status)` 검사 | 정확히 1개 |
| `fieldOverrides` | 0개 |
| `pnpm --filter api test -- firestore/firestore-indexes.spec.ts --runInBand` | 1개 suite, 23개 통과, 0개 실패, 종료 코드 0 |
| `pnpm exec biome check firestore.indexes.json` | 1개 파일 통과, 수정 0개, 종료 코드 0 |

배포 전 운영 인덱스를 다시 조회해 논리 정의를 비교한 결과:

| 구분 | 개수 |
| :--- | ---: |
| 운영 | 33 |
| 승인된 로컬 정의 | 41 |
| 운영 중 로컬 정의에 없는 삭제 후보 | 0 |
| 로컬 중 운영에 없는 신규 반영 대상 | 8 |

- 기존 운영 33개가 승인된 로컬 41개에 모두 포함되므로 배포 전 삭제 후보는 없었다.
- 운영 조회를 Node의 Windows `spawnSync` 래퍼로 실행한 첫 시도는 `EINVAL`로 Firebase CLI 실행 전에 종료됐다. 같은 읽기 전용 조회를 PowerShell에서 Firebase CLI로 직접 재실행해 종료 코드 0과 위 결과를 확인했으며 운영 상태 변경은 없었다.

### 운영 배포와 결과

실행한 승인 명령:

```text
firebase deploy --only firestore:indexes --project green-e4fe3
```

| 항목 | 결과 |
| :--- | :--- |
| 명령 종료 코드 | 0 |
| 대상 project | `green-e4fe3` |
| 대상 database | `(default)` |
| 읽은 정의 | `firestore.indexes.json` |
| Firebase 결과 | `deployed indexes in firestore.indexes.json successfully` 및 `Deploy complete!` |
| 삭제 확인·삭제 실행 | 없음 |
| Firestore 규칙 배포 | 수행하지 않음 |
| Storage 규칙 배포 | 수행하지 않음 |

- 명령은 `firestore:indexes`만 대상으로 실행됐다.
- 출력 중 `firestore.rules` 컴파일 확인은 Firebase CLI가 인덱스 배포 과정에서 수행한 사전 검사이며 규칙 배포 결과는 출력되지 않았다.
- 배포 직후 운영 논리 정의는 41개로 늘었고 승인된 로컬 41개와 누락·초과 없이 완전히 일치했다.
- 운영 인덱스 중복은 0개이며 필수 `saleRounds(storeId ASCENDING, status ASCENDING)` 정의는 정확히 1개 존재한다.
- 기존 운영 33개는 모두 `READY`로 유지돼 비의도 삭제나 상태 저하가 없었다.
- 신규 8개는 배포 직후와 세 차례 후속 조회에서 `CREATING`이고 `NEEDS_REPAIR`는 0개였다.
- 마지막 재조회에서 신규 8개가 모두 `READY`로 전환돼 운영 전체가 41개 `READY`, `CREATING` 0개, `NEEDS_REPAIR` 0개가 됐다.
- 필수 `saleRounds(storeId ASCENDING, status ASCENDING)`도 최종 `READY` 상태를 확인했다.

운영에 신규 반영된 8개:

1. `orders(status, deliveryMethod, preparedAt ASC)`
2. `orders(userId, productId, saleType)`
3. `payments(orderId, status)`
4. `products(isActive, category)`
5. `products(isActive, saleType)`
6. `products(storeId, isActive, saleType)`
7. `saleRounds(storeId, status)`
8. `varieties(subCategory, name)`

기존 운영에서 보존한 9개:

1. `invites(tokenPrefixes ARRAY_CONTAINS, createdAt DESC)`
2. `orders(storeId, createdAt ASC)`
3. `orders(storeId, status, createdAt ASC)`
4. `orders(storeId, status, createdAt DESC)`
5. `users(role, createdAt ASC)`
6. `users(role, driverApproved, createdAt ASC)`
7. `users(role, driverApproved, createdAt DESC)`
8. `users(role, suspended, createdAt ASC)`
9. `users(role, suspended, createdAt DESC)`

### 변경 및 금지 범위 확인

- 외부 변경은 운영 Firebase `(default)` 데이터베이스에 신규 복합 인덱스 8개 생성을 접수한 것뿐이다. 기존 33개 인덱스는 삭제 없이 보존했다.
- 로컬 소스 정의는 수정하지 않았고 Task 2.5 결과를 기록하기 위해 이 보고서 절만 추가했다.
- 기존 Task 1.1·1.2·2.1·2.2·2.3·2.4 보고서 기록과 `firestore.indexes.json` 변경은 수정 없이 보존했다.
- `firestore.rules`, `storage.rules`, 두 규칙 테스트 파일과 PLAN의 기존 Status 표시는 변경하지 않았다.
- commit, push, PR 생성·수정·병합, workflow dispatch를 수행하지 않았다.
- Firestore·Storage 규칙 변경·배포, 운영 데이터 생성·수정·삭제, production 애플리케이션 배포를 수행하지 않았다.
- 회차 생성·수정, `salesMode` 변경, 실제 알림 발송을 수행하지 않았다.
- PR #11은 OPEN, draft 아님, CLEAN이며 head는 `codex/mvp-sales-round-direct`의 `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff`, base는 `main`이다. API, consumer, seller, driver, Vercel Preview Comments 검사는 모두 성공 상태이며 PR은 변경하지 않았다.
- ALIGO는 기존 확인 기준 카카오 비즈니스 채널 심사 중이며, 이번 Task에서는 상태를 재조회하거나 후속 작업을 수행하지 않았다. 발신 프로필 `senderkey`와 회차 알림 템플릿 8종의 provider 승인은 여전히 확인되지 않았다.
- `git diff --check -- firestore.indexes.json docs/plans/REPORT_mvp_round_direct_launch.md`는 출력 없이 종료 코드 0으로 통과했다.

### Task 2.5 결론

승인된 `firestore.indexes.json`만 `green-e4fe3` 운영 `(default)` 데이터베이스에 배포했고 공식 Verify는 종료 코드 0으로 통과했다. 배포 전 운영 33개가 모두 41개 합집합에 포함돼 삭제 후보가 0개였으며, 배포 후 운영 정의는 기존 33개를 그대로 보존한 중복 없는 41개로 로컬과 완전히 일치했다. 신규 필수 `saleRounds(storeId, status)`를 포함한 8개 정의는 오류 없이 생성됐고 최종 운영 상태는 41개 `READY`, `CREATING` 0개, `NEEDS_REPAIR` 0개다. 따라서 Task 2.5는 통과로 완료한다. 다음 작업인 Task 2.6 — 운영 Firestore 규칙 반영은 다음 대화에서 `Task 2.6 승인`을 받은 뒤에만 진행한다.

## Task 2.6 — 운영 Firestore 규칙 반영

### 판정

- **Task 상태**: 완료
- **최종 판정**: 통과
- **배포 판정**: Task 2.2 회귀를 다시 통과한 `firestore.rules`만 운영 `cloud.firestore` release에 반영
- **활성 규칙 일치**: 운영 활성 규칙과 로컬 배포 대상 SHA-256 완전 일치
- **신규 회차 접근 경계**: 의도한 공개 읽기만 허용하고 직접 클라이언트 쓰기와 서버 전용 컬렉션 접근을 차단
- **legacy 호환**: 기존 공개 상품·매장·재고와 legacy 주문 읽기 계약 유지
- **다음 승인 게이트**: Task 2.7 — 운영 Storage 규칙 반영
- Task 2.7의 범위는 에뮬레이터 회귀를 통과한 `storage.rules`만 `firebase deploy --only storage --project green-e4fe3`로 운영에 반영하고 비공개 회차 사진 경계와 기존 사진 호환 규칙이 반영됐는지 판정하는 것이다.
- Task 2.7과 이후 작업은 수행하지 않았으며, 다음 대화에서 정확히 `Task 2.7 승인`을 받은 뒤에만 진행한다.

### 실행 기준 상태

| 항목 | 확인 결과 |
| :--- | :--- |
| branch | `codex/mvp-sales-round-direct` |
| 로컬 HEAD | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| `origin/main` | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| `origin/codex/mvp-sales-round-direct` | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 시작 작업 트리 | 보고서 672줄 추가, 인덱스 78줄 추가, 총 2개 파일 750줄 추가 |
| 최종 작업 트리 | 보고서 815줄 추가, 인덱스 78줄 추가, 총 2개 파일 893줄 추가 |
| Task 2.6 시작 직전 보고서 | 831줄, SHA-256 `da7f1790d2e0f1485ac5d3c3d9979899179d680c610929c590412fdfddc38210` |
| 기존 인덱스 변경 | 78줄 추가, SHA-256 `c621adde082f17324161617d239122d3660d941d24aef29b1d2d87c9b8e3bfa6` |
| 기존 보고서 보존 | Task 1.1·1.2·2.1·2.2·2.3·2.4·2.5의 기존 831줄을 수정 없이 보존 |
| PR | #11, OPEN, draft 아님, CLEAN, head SHA 일치, 기존 검사 5개 모두 성공 |

- 승인 후 `git fetch --prune origin`으로 원격 추적 상태를 갱신했고 위 세 Git SHA가 시작 상태와 동일함을 확인했다.
- `firestore.rules`와 규칙 테스트는 작업 트리 변경이 없고 HEAD의 Git blob `dcf30305e9b8214fa981559524d87b743b4067b8`과 정확히 일치했다.
- PLAN의 기존 Status 표시는 출시 후보 SHA 보존을 위해 갱신하지 않았다.

### 배포 전 규칙·회귀 재검증

| 검사 | 결과 |
| :--- | :--- |
| 배포 대상 파일 | `firestore.rules` |
| SHA-256 | `13874e36dad2c980f1a484e82741633be107e938425f5019b7936402882b6283` |
| Git blob | `dcf30305e9b8214fa981559524d87b743b4067b8` |
| HEAD 동일 여부 | 동일 |
| 비운영 project ID | `demo-greenhub` |
| 실행 Java | 임시 Temurin `21.0.12+8` |
| `pnpm test:firestore-rules` | 14개 통과, 0개 실패 |
| 에뮬레이터 실행·테스트 종료 코드 | 0 |

실행 명령:

```text
firebase emulators:exec --only firestore --project demo-greenhub "pnpm test:firestore-rules"
```

회귀 묶음:

| 검증 묶음 | 결과 |
| :--- | ---: |
| 서버 전용 컬렉션 7종 직접 접근 차단 | 7/7 통과 |
| `saleRounds` 공개·비공개 읽기 경계 | 1/1 통과 |
| `saleRoundItems` 연결 회차 읽기 경계 | 1/1 통과 |
| 회차 컬렉션 2종 직접 쓰기 차단 | 2/2 통과 |
| 기존 공개 상품·매장·재고 조회 | 1/1 통과 |
| `varieties` 단건 읽기·목록 및 쓰기 차단 | 1/1 통과 |
| legacy 주문 읽기 권한 | 1/1 통과 |
| 합계 | 14/14 통과 |

### 운영 배포와 활성 규칙 재조회

실행한 승인 명령:

```text
firebase deploy --only firestore:rules --project green-e4fe3
```

| 항목 | 결과 |
| :--- | :--- |
| 명령 종료 코드 | 0 |
| 대상 project | `green-e4fe3` |
| 대상 database | `(default)` |
| 배포 범위 | `firestore:rules`만 |
| Firebase 컴파일 | 성공 |
| Firebase 업로드 | 성공 |
| Firebase release | `firestore.rules`를 `cloud.firestore`에 release |
| 활성 release | `projects/green-e4fe3/releases/cloud.firestore` |
| 활성 ruleset | `projects/green-e4fe3/rulesets/32837978-27e9-4076-a953-b42e1838e2fa` |
| ruleset 생성 시각 | `2026-07-31T05:53:35.746463Z` |
| release 갱신 시각 | `2026-07-31T05:53:37.033873Z` |
| 활성 규칙 SHA-256 | `13874e36dad2c980f1a484e82741633be107e938425f5019b7936402882b6283` |
| 로컬 배포 대상과 동일 여부 | 동일 |

- Firebase Rules API로 활성 `cloud.firestore` release와 연결 ruleset 소스를 읽기 전용 재조회했다.
- 활성 소스 파일명은 `firestore.rules`이며 SHA-256이 배포 직전 로컬 파일과 정확히 일치했다.
- 배포 명령은 인덱스 정의를 읽고 규칙 컴파일을 확인했지만 `--only firestore:rules` 범위로 실행돼 인덱스나 Storage 규칙을 배포하지 않았다.

### 신규 회차 접근 경계와 legacy 호환 판정

신규 회차 경계:

- `saleRounds`는 `SCHEDULED`, `OPEN`, `CLOSED`, `COMPLETED` 공개 상태 읽기만 허용하고 `DRAFT`와 모든 직접 클라이언트 쓰기를 차단한다.
- `saleRoundItems`는 같은 `storeId`의 공개 상태 회차에 연결된 항목만 읽을 수 있고 모든 직접 클라이언트 쓰기를 차단한다.
- `varieties`는 공개 단건 읽기만 허용하고 목록과 모든 직접 클라이언트 쓰기를 차단한다.
- `checkoutReservations`, `operationIssues`, `legalOrderRecords`, `legalDisputeRecords`, `marketingConsentLogs`, `deliveryPhotoRecords`, `notificationDeliveries` 7개 서버 전용 컬렉션은 모든 직접 클라이언트 읽기·쓰기를 차단한다.
- 나머지 정의되지 않은 경로도 최종 재귀 규칙으로 모든 직접 클라이언트 읽기·쓰기를 차단한다.

legacy 호환:

- `products`, `stores`, `dailyCaps`, `groupProductConfig`의 기존 공개 읽기 계약을 유지한다.
- 기존 `orders`는 같은 `storeId`의 인증 판매자와 `admin`, `driver` 읽기 계약을 유지하며 클라이언트 쓰기는 계속 차단한다.
- Admin SDK 서버 접근은 Firestore Security Rules 적용 대상이 아니므로 기존 서버 읽기·쓰기 계약을 변경하지 않는다.
- 위 경계와 호환 계약은 배포한 동일 SHA 규칙에 대한 실제 Firestore Emulator 회귀 14개와 운영 활성 규칙 SHA 재조회로 확인했다.

### 운영 인덱스 보존 확인

| 항목 | 결과 |
| :--- | ---: |
| 운영 복합 인덱스 | 41개 |
| `READY` | 41개 |
| `CREATING` | 0개 |
| `NEEDS_REPAIR` | 0개 |
| 로컬 대비 운영 누락 | 0개 |
| 로컬 대비 운영 초과 | 0개 |
| 운영 논리 정의 중복 | 0개 |
| `saleRounds(storeId, status)` | 정확히 1개, `READY` |

- `gcloud firestore indexes composite list` 읽기 전용 재조회와 `firestore.indexes.json` 논리 정의 비교를 수행했다.
- Task 2.5에서 확정한 공통 24개, 기존 운영 전용 보존 9개, 신규 반영 8개의 총 41개가 상태 저하나 정의 변경 없이 보존됐다.
- Task 2.6에서는 Firestore 인덱스 추가·수정·삭제를 수행하지 않았다.

### 변경 및 금지 범위 확인

- 외부 변경은 운영 Firebase `(default)` 데이터베이스의 활성 `cloud.firestore` release를 승인된 `firestore.rules`로 갱신한 것뿐이다.
- 로컬 규칙·테스트·인덱스 소스는 수정하지 않았고 Task 2.6 결과를 기록하기 위해 이 보고서 절만 추가했다.
- 기존 Task 1.1·1.2·2.1·2.2·2.3·2.4·2.5 보고서 기록과 `firestore.indexes.json` 변경은 수정 없이 보존했다.
- Storage 규칙 변경·배포, 운영 데이터 생성·수정·삭제, ALIGO 후속 작업, workflow dispatch를 수행하지 않았다.
- production 애플리케이션 배포, 회차 생성·수정, `salesMode` 변경, 실제 알림 발송을 수행하지 않았다.
- commit, push, PR 생성·수정·병합을 수행하지 않았다.
- PR #11은 OPEN, draft 아님, CLEAN이며 head는 `codex/mvp-sales-round-direct`의 `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff`, base는 `main`이다. API, consumer, seller, driver, Vercel Preview Comments 검사는 모두 성공 상태이며 PR은 변경하지 않았다.
- ALIGO는 기존 확인 기준 카카오 비즈니스 채널 심사 중이며, 이번 Task에서는 상태를 재조회하거나 후속 작업을 수행하지 않았다. 발신 프로필 `senderkey`와 회차 알림 템플릿 8종의 provider 승인은 여전히 확인되지 않았다.
- `git diff --check -- firestore.rules firestore.indexes.json docs/plans/REPORT_mvp_round_direct_launch.md`는 출력 없이 종료 코드 0으로 통과했다.

### Task 2.6 결론

Task 2.2 회귀를 동일 조건에서 다시 수행해 14개 모두 통과한 SHA-256 `13874e36dad2c980f1a484e82741633be107e938425f5019b7936402882b6283`의 `firestore.rules`만 `green-e4fe3` 운영 Firestore에 배포했다. 공식 Verify는 종료 코드 0으로 컴파일·업로드·release를 완료했고, 활성 Rules API 재조회에서도 같은 SHA를 확인했다. 공개 상태 회차와 연결 항목의 제한된 읽기, 회차 직접 쓰기 및 서버 전용 컬렉션 접근 차단이 반영됐으며 기존 공개 상품·매장·재고와 legacy 주문 읽기 계약은 유지된다. 운영 인덱스 41개도 모두 `READY`로 보존됐다. 따라서 Task 2.6은 통과로 완료한다. 다음 작업인 Task 2.7 — 운영 Storage 규칙 반영은 다음 대화에서 `Task 2.7 승인`을 받은 뒤에만 진행한다.

## Task 2.7 — 운영 Storage 규칙 반영

### 판정

- **Task 상태**: 완료
- **최종 판정**: 통과
- **배포 판정**: Task 2.3 회귀를 다시 통과한 `storage.rules`만 운영 `firebase.storage/green-e4fe3.firebasestorage.app` release에 반영
- **비공개 회차 사진 경계**: 반영 확인
- **기존 사진 호환**: 반영 확인
- **다음 승인 게이트**: Task 2.8 — 운영 Firebase 반영 증거 재조회
- Task 2.8의 범위는 운영 인덱스 재조회 결과와 Firestore·Storage 두 규칙 배포 성공 증거를 비밀값 없이 이 보고서에 고정하고, `firebase firestore:indexes --project green-e4fe3 --json`으로 검증하는 것이다.
- Task 2.8과 이후 작업은 수행하지 않았으며, 다음 대화에서 정확히 `Task 2.8 승인`을 받은 뒤에만 진행한다.

### 실행 기준 상태

| 항목 | 확인 결과 |
| :--- | :--- |
| branch | `codex/mvp-sales-round-direct` |
| 로컬 HEAD | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| `origin/main` | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| `origin/codex/mvp-sales-round-direct` | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 원격 branch 대비 로컬 ahead/behind | `0/0` |
| 시작 작업 트리 | 보고서 815줄 추가, 인덱스 78줄 추가, 총 2개 파일 893줄 추가 |
| 최종 작업 트리 | 보고서 959줄 추가, 인덱스 78줄 추가, 총 2개 파일 1,037줄 추가 |
| Task 2.7 시작 직전 보고서 | 974줄, SHA-256 `70923d7baf050e8d688c19b7ac8ec7d1769f9b39db6861320a04bdb1e0b60db8` |
| 최종 보고서 전체 줄 수 | 1,118줄 |
| 기존 인덱스 변경 | 78줄 추가, SHA-256 `c621adde082f17324161617d239122d3660d941d24aef29b1d2d87c9b8e3bfa6` |
| 기존 보고서 보존 | Task 1.1·1.2·2.1·2.2·2.3·2.4·2.5·2.6의 기존 974줄을 수정 없이 보존 |
| PR | #11, OPEN, draft 아님, CLEAN, head SHA 일치, 기존 검사 5개 모두 성공 |

- 승인 후 `git fetch origin --prune`으로 원격 추적 상태를 갱신했고 위 세 Git SHA와 ahead/behind가 시작 상태와 동일함을 확인했다.
- `storage.rules`와 Storage 규칙 테스트는 작업 트리 변경이 없고 `storage.rules`는 HEAD의 Git blob `bd67e5f5ef484900e11db7039fe8fc55ef2e1248`과 정확히 일치했다.
- 기존 미커밋 보고서와 `firestore.indexes.json` 변경을 보존했고 PLAN의 기존 Status 표시는 출시 후보 SHA 보존을 위해 갱신하지 않았다.

### 배포 전 규칙·회귀 재검증

| 검사 | 결과 |
| :--- | :--- |
| 배포 대상 파일 | `storage.rules` |
| SHA-256 | `03a49ced55db5eebdcac7076c7a9a917f1082a8159e35b31720e70e990444b01` |
| Git blob | `bd67e5f5ef484900e11db7039fe8fc55ef2e1248` |
| HEAD 동일 여부 | 동일 |
| 비운영 project ID | `demo-greenhub` |
| 실행 Java | 임시 Temurin `21.0.12+8` |
| `pnpm test:storage-rules` | 12개 통과, 0개 실패 |
| 에뮬레이터 실행·테스트 종료 코드 | 0 |

실행 명령:

```text
firebase emulators:exec --only firestore,storage --project demo-greenhub "pnpm test:storage-rules"
```

Storage 규칙이 legacy 주문의 기사 배정과 배송 방식을 Firestore 문서에서 판정하므로 Task 2.3과 동일하게 Firestore·Storage Emulator를 함께 실행했다.

| 검증 묶음 | 결과 |
| :--- | ---: |
| 신규 회차 배송 사진 직접 접근 전면 차단 | 1/1 통과 |
| 상품 공개 읽기·역할·소유자·경로·크기·형식 | 3/3 통과 |
| 배너 공개 읽기·관리자 역할·경로·크기·형식 | 2/2 통과 |
| 로고 공개 읽기·소유자·역할·경로·크기·형식 | 2/2 통과 |
| legacy 거점 사진 배정 기사 호환·목록 및 변경 차단 | 3/3 통과 |
| 정의되지 않은 경로 차단 | 1/1 통과 |
| 합계 | 12/12 통과 |

### 운영 배포와 활성 규칙 재조회

실행한 승인 명령:

```text
firebase deploy --only storage --project green-e4fe3
```

| 항목 | 결과 |
| :--- | :--- |
| 명령 종료 코드 | 0 |
| 대상 project | `green-e4fe3` |
| 대상 bucket | `green-e4fe3.firebasestorage.app` |
| 배포 범위 | `storage`만 |
| 필수 API 확인 | `firebasestorage.googleapis.com` 활성 확인 |
| Firebase 컴파일 | 성공 |
| Firebase 업로드 | 성공 |
| Firebase release | `storage.rules`를 `firebase.storage`에 release |
| 활성 release | `projects/green-e4fe3/releases/firebase.storage/green-e4fe3.firebasestorage.app` |
| 활성 ruleset | `projects/green-e4fe3/rulesets/798bd8ce-8f20-46a9-b8f3-648f3e2afe45` |
| ruleset 생성 시각 | `2026-07-31T06:07:08.711999Z` |
| release 갱신 시각 | `2026-07-31T06:07:09.962409Z` |
| 활성 규칙 SHA-256 | `03a49ced55db5eebdcac7076c7a9a917f1082a8159e35b31720e70e990444b01` |
| 로컬 배포 대상과 동일 여부 | 동일 |

- 배포 후 Firebase CLI와 동일한 인증 경로로 Rules API의 활성 `firebase.storage/green-e4fe3.firebasestorage.app` release와 연결 ruleset 소스를 읽기 전용 재조회했다.
- 활성 소스 파일명은 `storage.rules`이며 SHA-256이 배포 직전 로컬 파일과 정확히 일치했다.
- 최초 `gcloud auth print-access-token` 기반 직접 Rules API 재조회는 해당 `gcloud` 계정의 권한 부족으로 HTTP 403이 발생했다. 배포에 사용한 Firebase CLI 인증 경로로 즉시 전환해 활성 release·ruleset·소스 SHA를 성공적으로 확인했으며 추가 배포는 수행하지 않았다.
- 배포 명령은 `--only storage` 범위로 실행돼 Firestore 규칙·인덱스나 애플리케이션을 배포하지 않았다.

### 비공개 회차 사진 경계와 기존 사진 호환 판정

비공개 회차 사진 경계:

- 신규 회차 배송 사진 경로 `deliveryPhotos/{orderId}/{fileName}`은 Admin SDK 서버 업로드와 서명 URL만 사용하도록 비인증 사용자, 일반 사용자, 판매자, 기사, 관리자의 직접 읽기·생성·수정·삭제를 모두 차단한다.
- 해당 경계는 동일 SHA 규칙에 대한 실제 Emulator 회귀에서 모든 역할의 기존 객체 읽기와 생성·수정·삭제가 거부됨을 확인했다.
- 정의되지 않은 경로도 최종 재귀 규칙으로 모든 직접 클라이언트 접근을 차단한다.

기존 사진 호환:

- `products/{storeId}/{fileName}`의 공개 읽기를 유지하고 5MiB 이하 JPEG·PNG·WebP·GIF 변경은 해당 매장 판매자 또는 관리자에게만 허용한다.
- `banners/main_hero/{fileName}`의 공개 읽기를 유지하고 5MiB 이하 허용 이미지 변경은 관리자에게만 허용한다.
- `logos/{fileName}`의 공개 읽기를 유지하고 2MiB 이하 JPEG·PNG·WebP 변경은 파일명 소유자인 판매자 본인에게만 허용한다.
- legacy 거점 사진 `deliveryPhotos/{orderId}_{timestamp}.jpg`는 주문에 배정된 기사이면서 `deliveryMethod`가 `hub`인 경우 단건 읽기를 허용하고, `DELIVERING` 상태·5MiB 이하 JPEG 조건에서 생성만 허용한다. 수정·삭제와 목록 조회는 계속 차단한다.
- 위 경계와 호환 계약은 배포한 동일 SHA 규칙에 대한 Firestore·Storage Emulator 회귀 12개와 운영 활성 Storage 규칙 SHA 재조회로 확인했다.

### Firestore 규칙과 운영 인덱스 보존 확인

| 항목 | 결과 |
| :--- | :--- |
| Firestore 활성 release | `projects/green-e4fe3/releases/cloud.firestore` |
| Firestore 활성 ruleset | `projects/green-e4fe3/rulesets/32837978-27e9-4076-a953-b42e1838e2fa` |
| Firestore release 갱신 시각 | `2026-07-31T05:53:37.033873Z` |
| Firestore 활성 규칙 SHA-256 | `13874e36dad2c980f1a484e82741633be107e938425f5019b7936402882b6283` |
| 로컬 `firestore.rules`와 동일 여부 | 동일 |
| 운영 복합 인덱스 | 41개 |
| `READY` | 41개 |
| `CREATING`·`NEEDS_REPAIR` | 0개 |

- Firebase CLI 인증 경로의 Rules API 읽기 전용 재조회에서 Firestore 활성 release·ruleset·갱신 시각·SHA가 Task 2.6 완료 값과 모두 일치했다.
- `gcloud firestore indexes composite list` 읽기 전용 재조회에서 운영 인덱스 41개가 모두 `READY`임을 확인했다.
- Task 2.7에서는 Firestore 규칙 재배포와 인덱스 추가·수정·삭제를 수행하지 않았다.

### 변경 및 금지 범위 확인

- 외부 변경은 운영 Firebase Storage bucket `green-e4fe3.firebasestorage.app`의 활성 `firebase.storage` release를 승인된 `storage.rules`로 갱신한 것뿐이다.
- 로컬 규칙·테스트·인덱스 소스는 수정하지 않았고 Task 2.7 결과를 기록하기 위해 이 보고서 절만 추가했다.
- 기존 Task 1.1·1.2·2.1·2.2·2.3·2.4·2.5·2.6 보고서 974줄과 `firestore.indexes.json` 78줄 변경은 수정 없이 보존했다.
- Firestore 인덱스 추가·수정·삭제, Firestore 규칙 변경·재배포, 운영 데이터 생성·수정·삭제를 수행하지 않았다.
- ALIGO 후속 작업, workflow dispatch, production 애플리케이션 배포, 회차 생성·수정, `salesMode` 변경, 실제 알림 발송을 수행하지 않았다.
- commit, push, PR 생성·수정·병합을 수행하지 않았다.
- PR #11은 OPEN, draft 아님, CLEAN이며 head는 `codex/mvp-sales-round-direct`의 `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff`, base는 `main`이다. API, consumer, seller, driver, Vercel Preview Comments 검사는 모두 성공 상태이며 PR은 변경하지 않았다.
- ALIGO는 기존 확인 기준 카카오 비즈니스 채널 심사 중이며, 이번 Task에서는 상태를 재조회하거나 후속 작업을 수행하지 않았다. 발신 프로필 `senderkey`와 회차 알림 템플릿 8종의 provider 승인은 여전히 확인되지 않았다.
- `git diff --check -- storage.rules firestore.rules firestore.indexes.json docs/plans/REPORT_mvp_round_direct_launch.md`는 출력 없이 종료 코드 0으로 통과했다.

### Task 2.7 결론

Task 2.3 회귀를 동일 조건에서 다시 수행해 12개 모두 통과한 SHA-256 `03a49ced55db5eebdcac7076c7a9a917f1082a8159e35b31720e70e990444b01`의 `storage.rules`만 `green-e4fe3` 운영 Storage에 배포했다. 공식 Verify는 종료 코드 0으로 컴파일·업로드·release를 완료했고 활성 Rules API 재조회에서도 같은 SHA를 확인했다. 신규 회차 배송 사진의 모든 직접 클라이언트 접근 차단이 반영됐으며 기존 상품·배너·로고의 공개 읽기와 제한된 변경, legacy 거점 사진의 배정 기사 호환은 유지된다. Firestore 활성 규칙 SHA는 Task 2.6 값과 일치하고 운영 인덱스 41개도 모두 `READY`로 보존됐다. 따라서 Task 2.7은 통과로 완료한다. 다음 작업인 Task 2.8 — 운영 Firebase 반영 증거 재조회는 다음 대화에서 `Task 2.8 승인`을 받은 뒤에만 진행한다.

## Task 2.8 — 운영 Firebase 반영 증거 재조회

### 판정

- **Task 상태**: 완료
- **최종 판정**: 통과
- **공식 Verify 판정**: 종료 코드 0, `status: success`
- **운영 인덱스 판정**: 41개 모두 `READY`, 로컬 합집합과 완전 일치
- **필수 인덱스 판정**: `saleRounds(storeId ASCENDING, status ASCENDING)` 정확히 1개, `READY`
- **Firestore 규칙 판정**: 활성 release·ruleset 소스 SHA가 로컬 `firestore.rules`와 일치
- **Storage 규칙 판정**: 활성 release·ruleset 소스 SHA가 로컬 `storage.rules`와 일치
- **다음 승인 게이트**: Task 3.1 — API 운영 배포 [승인 게이트]
- Task 3.1의 범위는 승인된 출시 SHA를 Railway production API에 배포하고 health와 commit SHA를 확인하는 것이다.
- Task 3.1의 PLAN 의존성은 Task 0.4, Task 1.4, Task 2.8이며, 이번 Task에서는 Task 3.1과 이후 작업을 수행하지 않았다.
- 다음 대화에서 정확히 `Task 3.1 승인`을 받은 뒤에만 Task 3.1 범위를 진행한다.

### 실행 기준 상태

| 항목 | 확인 결과 |
| :--- | :--- |
| 확인 시각 | `2026-07-31 15:18:14 +09:00` |
| branch | `codex/mvp-sales-round-direct` |
| 로컬 HEAD | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 원격 `main` | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| 원격 `codex/mvp-sales-round-direct` | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 원격 작업 branch 대비 ahead/behind | `0/0` |
| Task 2.8 시작 직전 작업 트리 | 보고서 959줄, `firestore.indexes.json` 78줄, 총 2개 파일 1,037줄 추가 |
| Task 2.8 시작 직전 보고서 | 1,118줄, SHA-256 `4adfc6d535cda1e5b6c06fffe126ccbeb763f7be8a8ad802f610045d57b8f31c` |
| `firestore.indexes.json` | SHA-256 `c621adde082f17324161617d239122d3660d941d24aef29b1d2d87c9b8e3bfa6` |
| `firestore.rules` | SHA-256 `13874e36dad2c980f1a484e82741633be107e938425f5019b7936402882b6283` |
| `storage.rules` | SHA-256 `03a49ced55db5eebdcac7076c7a9a917f1082a8159e35b31720e70e990444b01` |

- 승인 후 `git fetch --prune origin`으로 원격 추적 상태를 갱신했고 세 Git SHA와 ahead/behind가 시작 상태와 동일함을 확인했다.
- 기존 미커밋 보고서 1,118줄과 `firestore.indexes.json` 78줄 변경은 수정·복원·정리하지 않고 보존했다.
- PLAN의 기존 Status 표시는 출시 후보 SHA 보존 방침에 따라 갱신하지 않았다.

### 공식 Verify와 운영 인덱스 판정

실행한 공식 Verify:

```text
firebase firestore:indexes --project green-e4fe3 --json
```

| 항목 | 결과 |
| :--- | ---: |
| 명령 종료 코드 | 0 |
| 응답 `status` | `success` |
| 운영 복합 인덱스 논리 정의 | 41개 |
| field override | 0개 |
| `saleRounds(storeId, status)` | 정확히 1개 |

- 공식 Verify 결과에는 승인된 41개 운영 논리 정의가 모두 포함됐고 필수 `saleRounds(storeId ASCENDING, status ASCENDING)`가 정확히 1개 존재했다.
- 공식 Verify 응답은 인덱스 상태 필드를 제공하지 않으므로 `gcloud firestore indexes composite list --project=green-e4fe3 --database='(default)' --format=json` 읽기 전용 재조회로 활성 상태를 교차 검증했다.

| 상태 및 정합성 항목 | 결과 |
| :--- | ---: |
| 운영 인덱스 | 41개 |
| `READY` | 41개 |
| `CREATING` | 0개 |
| `NEEDS_REPAIR` | 0개 |
| 운영 논리 정의 중복 | 0개 |
| 로컬 `firestore.indexes.json` 정의 | 41개 |
| 로컬 논리 정의 중복 | 0개 |
| 로컬 대비 운영 누락 | 0개 |
| 로컬 대비 운영 초과 | 0개 |
| `saleRounds(storeId, status)` | 정확히 1개, `READY` |

- 필수 인덱스 리소스는 `projects/green-e4fe3/databases/(default)/collectionGroups/saleRounds/indexes/CICAgJiHgokK`이며 상태는 `READY`다.
- 운영 41개와 로컬 41개를 `collectionGroup`, `queryScope`, 사용자 정의 field·order·arrayConfig 기준으로 비교했으며 누락·초과·중복이 모두 0개였다.
- Task 2.8에서는 Firestore 인덱스 추가·수정·삭제나 재배포를 수행하지 않았다.

### Firestore·Storage 배포 성공 증거 재조회

두 규칙의 기존 배포 성공 기록:

| 규칙 | 기존 배포 명령 | 종료 코드 | 배포 결과 |
| :--- | :--- | ---: | :--- |
| Firestore | `firebase deploy --only firestore:rules --project green-e4fe3` | 0 | 컴파일·업로드·`cloud.firestore` release 성공 |
| Storage | `firebase deploy --only storage --project green-e4fe3` | 0 | 컴파일·업로드·`firebase.storage` release 성공 |

Firebase CLI와 동일한 인증 경로로 Rules API의 활성 release와 연결 ruleset 소스를 읽기 전용 재조회한 결과:

| 항목 | Firestore | Storage |
| :--- | :--- | :--- |
| 활성 release | `projects/green-e4fe3/releases/cloud.firestore` | `projects/green-e4fe3/releases/firebase.storage/green-e4fe3.firebasestorage.app` |
| 활성 ruleset | `projects/green-e4fe3/rulesets/32837978-27e9-4076-a953-b42e1838e2fa` | `projects/green-e4fe3/rulesets/798bd8ce-8f20-46a9-b8f3-648f3e2afe45` |
| ruleset 생성 시각 | `2026-07-31T05:53:35.746463Z` | `2026-07-31T06:07:08.711999Z` |
| release 갱신 시각 | `2026-07-31T05:53:37.033873Z` | `2026-07-31T06:07:09.962409Z` |
| 활성 소스 파일 | `firestore.rules` | `storage.rules` |
| 운영 활성 규칙 SHA-256 | `13874e36dad2c980f1a484e82741633be107e938425f5019b7936402882b6283` | `03a49ced55db5eebdcac7076c7a9a917f1082a8159e35b31720e70e990444b01` |
| 로컬 규칙 SHA-256 | `13874e36dad2c980f1a484e82741633be107e938425f5019b7936402882b6283` | `03a49ced55db5eebdcac7076c7a9a917f1082a8159e35b31720e70e990444b01` |
| SHA 판정 | 동일 | 동일 |

- 두 활성 release와 ruleset 식별자는 Task 2.6·2.7 완료 값과 동일하고, 연결된 소스 SHA도 각 로컬 배포 대상과 정확히 일치했다.
- 이 재조회에는 access token, refresh token, 계정 원문, 규칙 소스 본문 등 비밀값이나 불필요한 원문을 출력·기록하지 않았다.
- Task 2.8에서는 Firestore·Storage 규칙을 변경하거나 재배포하지 않았다.

### 변경 및 금지 범위 확인

- 로컬 변경은 기존 보고서 끝에 이 Task 2.8 증거 절을 추가한 것뿐이며 `firestore.indexes.json`, `firestore.rules`, `storage.rules`는 수정하지 않았다.
- 기존 Task 1.1·1.2·2.1·2.2·2.3·2.4·2.5·2.6·2.7 보고서 1,118줄과 `firestore.indexes.json` 78줄 변경은 수정 없이 보존했다.
- 로컬 원격 추적 상태는 `git fetch --prune origin`으로 갱신했으며, 운영 Firebase와 PR을 포함한 외부 상태 변경은 없다.
- Firestore 인덱스 추가·수정·삭제, Firestore·Storage 규칙 변경·재배포, 운영 데이터 생성·수정·삭제를 수행하지 않았다.
- ALIGO 후속 작업, workflow dispatch, production 애플리케이션 배포, 회차 생성·수정, `salesMode` 변경, 실제 알림 발송을 수행하지 않았다.
- Task 3.1과 이후 작업을 수행하지 않았다.
- commit, push, PR 생성·수정·병합을 수행하지 않았다.
- PR #11은 OPEN, draft 아님, CLEAN이며 head는 `codex/mvp-sales-round-direct`의 `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff`, base는 `main`이다. API, consumer, seller, driver, Vercel Preview Comments 검사는 모두 성공 상태이며 PR은 변경하지 않았다.
- ALIGO는 기존 확인 기준 카카오 비즈니스 채널 심사 중이며, 이번 Task에서는 상태를 재조회하거나 후속 작업을 수행하지 않았다. 발신 프로필 `senderkey`와 회차 알림 템플릿 8종의 provider 승인은 여전히 확인되지 않았다.

### Task 2.8 결론

공식 Verify `firebase firestore:indexes --project green-e4fe3 --json`은 종료 코드 0과 `status: success`로 완료됐고, 운영 논리 정의 41개와 필수 `saleRounds(storeId, status)` 인덱스 1개를 확인했다. 상태 API 교차 검증에서도 운영 인덱스 41개가 모두 `READY`이며 로컬 합집합과 누락·초과·중복 없이 정확히 일치했다. Firestore 활성 `cloud.firestore` release와 Storage 활성 `firebase.storage/green-e4fe3.firebasestorage.app` release의 연결 ruleset 소스 SHA는 각각 로컬 `firestore.rules`, `storage.rules` SHA와 완전히 일치했다. 기존 두 배포 명령의 종료 코드 0 기록과 현재 활성 release·ruleset·SHA를 함께 고정했으므로 `saleRounds` 필수 인덱스와 두 규칙의 운영 반영 증거를 비밀값 없이 확보했다. 따라서 Task 2.8은 통과로 완료한다. 다음 작업은 PLAN의 Task 3.1 — API 운영 배포 [승인 게이트]이며, 다음 대화에서 `Task 3.1 승인`을 받은 뒤에만 진행한다.

## Task 3.1 — API 운영 배포

### 판정

- **Task 상태**: 중단, 의존성 미충족
- **최종 판정**: 차단
- **Task 0.4**: 충족
- **Task 1.4**: 미충족
- **Task 2.8**: 충족
- **production API 배포**: 수행하지 않음
- **재개 조건**: Task 1.2 외부 승인 완료, Task 1.3 격리 실제 발송 검증 통과, Task 1.4 운영 ALIGO 필수 변수 4개 반영 및 공식 Verify 종료 코드 0
- 사용자에게 정확히 `Task 3.1 승인`을 받은 뒤 의존성부터 확인했다.
- Task 1.4가 충족되지 않아 승인 조건에 따라 Railway production 배포 명령을 실행하지 않았다.

### 실행 기준 상태

| 항목 | 확인 결과 |
| :--- | :--- |
| 확인 시각 | `2026-07-31 15:25:50 +09:00` |
| branch | `codex/mvp-sales-round-direct` |
| 로컬 HEAD | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 원격 `main` | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| 원격 `codex/mvp-sales-round-direct` | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| 원격 작업 branch 대비 ahead/behind | `0/0` |
| Task 3.1 시작 직전 작업 트리 | 보고서 1,073줄, `firestore.indexes.json` 78줄, 총 2개 파일 1,151줄 추가 |
| Task 3.1 시작 직전 보고서 | 1,232줄, SHA-256 `e23adf1b7ab93635d1c59ca7eb590fcf744e5641357764578a7412c8c815e147` |
| `firestore.indexes.json` | SHA-256 `c621adde082f17324161617d239122d3660d941d24aef29b1d2d87c9b8e3bfa6` |
| `firestore.rules` | SHA-256 `13874e36dad2c980f1a484e82741633be107e938425f5019b7936402882b6283` |
| `storage.rules` | SHA-256 `03a49ced55db5eebdcac7076c7a9a917f1082a8159e35b31720e70e990444b01` |

- 승인 후 `git fetch --prune origin`으로 원격 추적 상태를 갱신했으며 세 Git SHA와 ahead/behind는 시작 상태와 동일하다.
- 기존 미커밋 보고서와 `firestore.indexes.json` 변경은 수정·복원·정리하지 않고 보존했다.
- PLAN의 기존 Status 표시는 출시 후보 SHA 보존 방침에 따라 갱신하지 않았다.

### Task 0.4 동일 SHA 전체 원격 게이트

| 항목 | 확인 결과 |
| :--- | :--- |
| 출시 SHA | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| workflow | `e2e-round-direct.yml` |
| 실행 번호 | `30458616061` |
| 상태 | `completed` |
| 결론 | `success` |
| 실행 URL | `https://github.com/booker-lab/greenhub/actions/runs/30458616061` |
| 52건 실행 | 성공 |
| 무건너뜀 판정 | 성공 |
| chromium fixture cleanup | 성공 |
| mobile fixture cleanup | 성공 |

- 공식 Verify인 `gh run list --workflow e2e-round-direct.yml --limit 1 --json headSha,status,conclusion,url`의 최신 출시 branch 실행은 현재 출시 SHA와 일치하고 `completed`, `success`다.
- PR #11의 API, consumer, seller, driver, Vercel Preview Comments 상태도 모두 성공이며 PR head SHA는 출시 SHA와 일치한다.
- 따라서 Task 0.4 의존성은 충족으로 판정했다.

### Task 1.4 운영 ALIGO 변수

값 원문은 조회 출력이나 이 보고서에 기록하지 않았다.

| 필수 변수 | 값 비공개 존재 판정 |
| :--- | :---: |
| `ALIGO_API_KEY` | 없음 |
| `ALIGO_USER_ID` | 없음 |
| `ALIGO_SENDER_KEY` | 없음 |
| `ALIGO_SENDER_PHONE` | 없음 |

- Task 1.4 공식 Verify는 종료 코드 1로 실패했다.
- Task 1.2는 카카오 비즈니스 채널 심사 중으로 부분 완료 상태이며 ALIGO 발신 프로필과 `senderkey`, 회차 알림 템플릿 8종 승인이 없다.
- Task 1.2가 완료되지 않아 의존하는 Task 1.3 격리 실제 발송 검증도 수행되지 않았고, Task 1.4 운영 변수 반영으로 진행할 수 없다.
- 따라서 Task 1.4 의존성은 미충족이며 이것이 Task 3.1의 정확한 차단 사유다.

### Task 2.8 운영 Firebase 증거

- Task 2.8은 공식 Verify 종료 코드 0과 `status: success`로 완료됐다.
- 운영 인덱스 41개는 모두 `READY`이고 로컬과 누락·초과·중복 없이 일치한다.
- Firestore·Storage 활성 ruleset 소스 SHA는 각각 로컬 `firestore.rules`, `storage.rules` SHA와 일치한다.
- 따라서 Task 2.8 의존성은 충족으로 판정했다.

### Railway production 읽기 전용 확인

| 항목 | 확인 결과 |
| :--- | :--- |
| 공식 Verify `railway status --json` | 종료 코드 0 |
| production service | `api` |
| 기존 활성 deployment | `c59bfad1-52e8-4ca7-aaab-4dd4b60e0fc1` |
| 기존 활성 상태 | `SUCCESS` |
| 기존 활성 commit SHA | `110881aabfb5a87ce56f54c2714cfb2b6fc8244a` |
| 출시 SHA | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| SHA 일치 여부 | 불일치 |
| 기존 production `/health` | HTTP 200, `{"status":"ok"}` |

- `/health`의 HTTP 200은 기존 활성 배포의 상태이며 출시 SHA 배포 성공 증거가 아니다.
- Task 1.4가 미충족이므로 `railway up`, `railway deployment redeploy` 또는 그 밖의 production 배포 명령을 실행하지 않았다.
- production 활성 deployment와 commit SHA는 Task 3.1 시작 전 상태에서 변경되지 않았다.

### 변경 및 금지 범위 확인

- 로컬 변경은 기존 보고서 끝에 이 Task 3.1 차단 증거 절을 추가한 것뿐이다.
- 기존 보고서 1,232줄과 `firestore.indexes.json` 78줄 변경은 보존했다.
- Task 3.2 이후 작업, workflow dispatch, production 배포, Railway 변수 등록·변경을 수행하지 않았다.
- Firebase 인덱스·규칙·데이터 변경, 회차 생성·수정, `salesMode` 변경, 실제 알림 발송을 수행하지 않았다.
- commit, push, PR 생성·수정·병합을 수행하지 않았다.

### Task 3.1 결론

Task 0.4는 출시 SHA `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff`에서 원격 E2E 52건 무건너뜀과 양쪽 cleanup을 포함해 성공했고 Task 2.8도 통과했으므로 두 의존성은 충족됐다. 그러나 Task 1.2가 카카오 비즈니스 채널 심사 중이라 발신 프로필 `senderkey`와 회차 알림 템플릿 8종 승인이 없고, Task 1.3 실제 발송 검증도 진행되지 않았으며, Task 1.4 공식 Verify는 ALIGO 필수 변수 4개가 모두 없어 종료 코드 1로 실패했다. 이에 따라 Railway production API 배포는 수행하지 않았다. 기존 활성 API는 HTTP 200이지만 commit SHA `110881aabfb5a87ce56f54c2714cfb2b6fc8244a`로 출시 SHA와 다르다. 따라서 Task 3.1은 완료가 아니라 의존성 미충족으로 차단된 상태이며, Task 1.2~1.4를 별도 승인 게이트에 따라 완료한 뒤 새 `Task 3.1 승인`을 받아 재개해야 한다.

## 계획 중단 및 인계 — ALIGO 심사 대기

### 결정

- **결정일**: 2026-07-31 KST
- **계획 상태**: 외부 심사 대기로 중단
- **직접 차단점**: 카카오 비즈니스 채널 심사 진행 중
- **재개 시작점**: 심사 승인 확인 후 Task 1.2의 ALIGO 발신 프로필 등록부터
- **인계 정본**: `docs/plans/HANDOFF_mvp_round_direct_aligo_review_pause.md`

사용자 결정에 따라 심사 결과가 나오기 전에는 원계획의 남은 작업을 더 진행하지 않는다. 현재까지 완료한 Firebase 운영 반영은 유지하고, ALIGO 후속 설정과 실제 발송, Railway·Vercel 애플리케이션 배포, 첫 회차 생성, 판매 모드 전환, 당근 링크 공개는 모두 보류한다.

### 중단 시점 상태

| 구분 | 상태 |
| :--- | :--- |
| Git branch | `codex/mvp-sales-round-direct` |
| 중단 정리 전 기준 HEAD | `9fcee7e9eb2fa99c139da003e90bc7ad9fe39fff` |
| PR | #11, 심사 대기를 나타내도록 초안 전환 예정 |
| ALIGO | 계정·API Key 발급·SMS 발신번호 승인 완료, 운영 변수 미등록 |
| 카카오 | 비즈니스 채널 심사 중 |
| ALIGO 발신 프로필·템플릿 | `senderkey` 없음, 회차 템플릿 8종 미등록·미승인 |
| 운영 Firebase | 인덱스 41개 `READY`, Firestore·Storage 활성 규칙과 로컬 SHA 일치 |
| 운영 API | 기존 배포 유지, 출시 후보 SHA 미배포 |
| 운영 프런트 | 출시 후보 SHA 미배포 |
| 판매 모드·첫 회차 | `legacy` 유지, 회차 생성·전환 미실행 |

### 중단 중 금지 범위

- ALIGO 발신 프로필·템플릿 등록과 실제 알림톡·SMS 발송
- ALIGO 자격 증명의 로컬·Railway 환경 반영
- Railway·Vercel production 배포와 재배포
- Firebase 인덱스·규칙의 추가 변경 또는 재배포
- 운영 회차·주문·결제·환불 데이터 변경
- `salesMode` 변경과 당근 링크 공개
- PR #11 병합

### 재개 게이트

1. 카카오 비즈니스 채널 심사 승인 상태를 확인한다.
2. ALIGO 발신 프로필을 등록하고 `senderkey` 발급 여부를 값 없이 확인한다.
3. 내부 템플릿 코드와 provider 템플릿 코드 매핑, 누락 본문 변수 3종의 구현 방침을 확정한다.
4. 회차 알림 템플릿 8종을 등록·승인받는다.
5. 승인된 격리 수신자로 알림톡 성공과 SMS 대체 발송을 검증한다.
6. 운영 ALIGO 필수 변수 4개를 값 비공개 방식으로 반영하고 공식 Verify를 통과시킨다.
7. 재개 시점 branch HEAD와 PR 검사를 다시 확인하고, 별도의 `Task 3.1 승인`을 받은 뒤에만 운영 API 배포로 진행한다.

### 중단 결론

원계획은 실패로 종료한 것이 아니라 외부 승인 의존성을 명시한 채 일시 중단한다. 재개 전까지의 안전 상태는 기존 운영 애플리케이션과 `legacy` 판매 모드를 유지하는 것이며, 완료된 Firebase 인프라 반영은 재조회 증거가 확보되어 있다. 이 절과 인계 문서, 정리 커밋을 중단 시점의 기준으로 사용한다.

## 2026-08-20 재개 — consumer 법적 고지·카카오 승인과 최신 main 로컬 통합

### 판정

- **consumer 개인정보처리방침·이용약관**: main·production 반영과 운영 검증 완료
- **카카오 비즈니스 채널**: 최종 승인 완료
- **최신 main 로컬 통합**: 완료
- **로컬 통합 회귀**: 통과
- **원격 push·PR 재검증**: 미실행
- **ALIGO·운영 배포·첫 회차·판매 모드 전환**: 계속 미실행
- 기존 PLAN의 완료 Task 상태는 소급 변경하지 않고, 이번 작업은 2026-08-20의 별도 재개 이력으로 기록한다.

### 완료된 외부 선행 사실

- `https://greenlove.co.kr/privacy`와 `https://greenlove.co.kr/terms`는 비로그인 HTTP 200, 데스크톱·375×812 모바일 접근성, 문서 상호 이동, 가로 넘침·하단 가림 없음, console/page 오류 0건 검증을 통과했다.
- 법적 고지와 카카오 재심사 접수 기록의 main 병합 SHA는 `26d7f49bf1a2618f792641cb95b93802a062ebe4`다.
- PR #29는 `MERGED`이고 GitHub consumer production deployment `5979132065`는 성공했다.
- consumer 운영 도메인은 `greenlove.co.kr`이며 seller·driver는 법적 고지 변경 대상이 아니었다. Railway API는 기존 활성 배포를 유지했다.
- 2026년 8월 20일 오전 9시 55분 카카오비즈니스 파트너센터 알림에서 `그린러브가 비즈니스 채널로 전환되었습니다. 매장이 있다면 매장정보 관리를 위한 기능도 사용할 수 있습니다.` 문구를 확인해 카카오 비즈니스 채널 최종 승인으로 판정했다.

카카오 승인으로 2026년 7월 31일의 외부 차단 조건 하나가 해소됐지만 ALIGO 발신 프로필·템플릿 준비와 회차 직배송 출시는 자동 재개되지 않는다.

### 최신 main 통합 기준선

| 항목 | 확인 결과 |
| :--- | :--- |
| branch | `codex/mvp-sales-round-direct` |
| 통합 전 HEAD | `674b59cda5212ff37cbf283b1a9871ff0da2c1c2` |
| 통합 대상 `origin/main` | `26d7f49bf1a2618f792641cb95b93802a062ebe4` |
| 통합 전 공통 조상 | `164f65b77e317c41b7e0825377684f0a4db981d4` |
| 통합 전 분기 | `origin/main` 전용 46개, branch 전용 106개 commit |
| 로컬 merge commit | `e855d6cb1a787ff89c57abf3c352edda1beeca29` |
| 첫 번째 부모 | `674b59cda5212ff37cbf283b1a9871ff0da2c1c2` |
| 두 번째 부모 | `26d7f49bf1a2618f792641cb95b93802a062ebe4` |
| `origin/main` 조상 포함 검사 | 종료 코드 0 |
| 통합 후 분기 | `origin/main` 전용 0개, 로컬 branch 전용 107개 commit |

- 시작 전 사용자 소유 변경인 이 인계 문서 수정과 기존 미추적 카카오 계획 파일은 이름 있는 stash에 원문을 보존했다.
- 미추적 계획 파일보다 main의 추적 버전이 더 최신 실행 이력을 포함하므로 통합 결과에는 main 버전을 유지했고, 기존 미추적 원문은 stash에서 삭제하지 않았다.
- `git merge --no-ff --no-commit origin/main`으로 통합했으며 최신 main을 덮어쓰거나 회차 branch의 기존 이력을 재작성하지 않았다.

### 충돌 해결

총 9개 충돌을 다음 원칙으로 해소했다.

- consumer 홈과 공동구매 목록은 회차 `salesMode` 분기·`Suspense` 경계를 유지하면서 최신 main의 운영 관계 안내·사업자 footer·`getGroupBuyStatus`·이미지 복구를 함께 보존했다.
- 상품 상세은 `round_direct`와 legacy 구매 구성요소 분리를 유지하면서 최신 main의 만료·모집 완료 차단, 공개 사업자 주소·전화번호, 스토어 로고 복구와 CTA 비활성 계약을 양쪽 경로에 반영했다.
- 회차 장바구니의 식별자·혼합 차단·저장 데이터 정규화 계약을 유지했다.
- shared export에는 회차 `sale-round.types`와 최신 main `group-buy`를 모두 보존했고, 충돌한 source map은 shared build로 재생성했다.
- 정적 테스트는 분리된 실제 구현 파일을 검사하도록 갱신하고, 과거 직접 수량 비교 기대는 공통 `getGroupBuyStatus` 판정 계약으로 교체했다.

### 로컬 검증

| 검증 | 결과 |
| :--- | :--- |
| `git diff --check` | 통과 |
| workspace 빌드 선택 검사 | 통과 |
| shared 테스트 | 2개 파일, 9건 통과 |
| shared typecheck·build | 통과 |
| API 단위 테스트 | 33개 suite, 253건 통과 |
| API E2E | 4개 suite, 10건 통과 |
| consumer Node 테스트 | 106건 통과 |
| consumer TypeScript 검사 | 통과 |
| seller 테스트 | 7개 파일, 43건 통과 |
| driver Node 테스트 | 11건 통과 |
| 회차 안전·fixture·seed 스크립트 테스트 | 29건 통과 |
| API·consumer·seller·driver 전체 production build | 통과 |

- consumer 전체 lint는 종료 코드 0이었으며 기존 코드의 경고·정보만 보고했고 파일을 수정하지 않았다.
- 통합 대상 TSX 파일의 Biome check는 오류 없이 통과했고, 기존 정적 skeleton의 index key 경고만 남았다.
- production build가 재생성한 seller 서비스 워커의 비본질적 작업 트리 변경은 검증 전 상태로 복원했다.
- Firebase 규칙 emulator와 원격 회차 E2E 52건은 로컬 통합 commit의 push·원격 SHA 고정 이후 게이트에서 다시 실행한다.

### 외부 변경 게이트와 현재 차단 상태

| 항목 | 상태 |
| :--- | :--- |
| PR #11 | `OPEN`·초안·`CONFLICTING`, `mergeStateStatus: DIRTY` |
| PR #11 원격 head | 통합 전 SHA `674b59cda5212ff37cbf283b1a9871ff0da2c1c2` |
| 로컬 통합 commit push | 미실행 |
| 원격 동일 SHA 검증 | 미실행 |
| ALIGO 발신 프로필 | 미등록 |
| `senderkey` | 미발급 |
| 회차 알림 템플릿 8종 | 미등록·미승인 |
| 실제 알림톡·SMS fallback 검증 | 미실행 |
| 운영 ALIGO 변수 4개 | 미등록 |
| 회차 출시 후보 운영 배포 | 미실행 |
| 첫 회차 | 미생성 |
| `salesMode` | `legacy` 유지 |

이번 작업에서 push, PR 변경·병합·Ready 전환, workflow dispatch, ALIGO 로그인·등록·실제 발송, 환경변수 등록, Railway·Vercel·Firebase 변경, 운영 회차·주문·결제·배송 변경을 수행하지 않았다.

### 다음 재개 게이트

1. 사용자 승인 후 로컬 통합 commit과 문서 종결 commit을 원격 branch에 push한다.
2. PR #11의 충돌·검사 상태를 다시 확인하고 동일 원격 SHA에서 회차 E2E 52건과 양쪽 cleanup을 검증한다.
3. 별도 외부 변경 승인 후 ALIGO 발신 프로필을 등록하고 `senderkey` 발급 여부만 비밀값 없이 기록한다.
4. 템플릿 매핑과 누락 변수 차단점을 확정한 뒤 회차 템플릿 8종 승인, 격리 실제 알림톡·SMS fallback, 운영 ALIGO 변수 4개 존재 검사를 순서대로 완료한다.
5. 모든 선행 조건이 충족된 뒤 새 `Task 3.1 승인`을 받아야만 운영 배포를 재개한다.

현재 승인 요청 대상은 첫 번째 외부 변경 게이트인 원격 branch push와 PR #11 재검증이다. 승인 전에는 ALIGO와 회차 직배송 출시 작업을 진행하지 않는다.
