<!-- Language: ko -->

# 회차 직배송 MVP 출시 보고서

## 보고서 메타

- **기준 계획**: `docs/plans/PLAN_mvp_round_direct_launch_blockers.md`
- **기준선 재조회일**: 2026-07-29 KST
- **현재 실행 Task**: Task 0.2
- **운영 변경**: 없음
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
