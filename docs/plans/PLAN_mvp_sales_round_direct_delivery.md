<!-- Language: ko -->

# Project Blueprint: 디어오키드 주간 판매 회차·직배송 MVP

## 문서 메타
- **작성일**: 2026-07-15
- **상태**: Task 6.2 완료, Task 6.3 착수 대기
- **Priority**: 1
- **Labels**: feature, refactor, payment, delivery, privacy
- **SSOT Check**: `docs/discussions/DISCUSS_mvp_sales_focus.md`, `docs/CRITICAL_LOGIC.md` #CL-57
- **Architectural Goal**: 기존 판매 방식을 보존하면서 디어오키드에만 회차 기반 직배송 주문 경로를 추가한다.
- **보정 결과**: `PLAN_mvp_sales_round_review_remediation.md` Task 0.1~4.6과 `PLAN_mvp_sales_round_build_gate_remediation.md` Task 0.1~3.3을 선행 완료했다. Task 2.10은 PortOne 테스트 채널의 실제 100원 결제, 중복 웹훅, timeout 후 예약 재확보, 한도 실패 전액 환불, 원격·로컬 상태 일치까지 staging에서 통과했다. Task 2.11은 고객 사유 첫 배송 실패의 재배송비 1회 생성, 같은 보류 재처리 멱등성, 재배송 실패 운영 예외 전환을 통과했다. Task 3.1은 알림톡 3회 재시도, 문자 대체, 키 누락 실패, 최종 실패 운영 예외의 테스트 계약을 고정했다. Task 3.2는 알림톡 최대 3회 시도, 동일 내용 문자 대체, 설정 누락 실패 처리를 구현했다. Task 3.3은 최종 실패 거래 알림의 멱등 `CUSTOMER_NOTICE_FAILED` 운영 예외를 구현했다. Task 3.4는 인증 사용자의 `alimtalk`, `sms` 마케팅 동의·철회만 엄격한 boolean으로 검증하고 기존 설정과 병합 저장하도록 구현했다. Task 3.5는 같은 `idempotencyKey`의 열린 예외 통합, 조치 직전 최신 상태 재검증, 성공·실패 조치의 안전한 `actions` 감사 기록 계약 6개를 테스트로 고정했다. Task 3.6은 결정적 문서 ID 기반 운영 예외 통합, 최신 상태 기반 환불·문자 조치, 성공·실패 감사 기록과 민감정보 배제를 구현했다. Task 3.7은 셀러·관리자 인증, 스토어 소유권 검증, 안전한 목록·상세·재조회 응답과 환불·문자 조치 API를 구현했다. Task 3.8은 운영 모듈과 런타임 라우트를 연결하고 알림·재배송 최종 실패 생성 경로를 공통 운영 서비스로 전환했다. Task 3.9는 배송 사진 90일, 마케팅 동의와 분쟁 기록 3년, 계약·결제·공급 기록 5년, 분쟁·법적 보존 연장과 멱등 파기 계약을 실패 테스트 8개로 고정했다. Task 3.10은 목적별 법정 기록 저장과 만료 쿼리, 분쟁·법적 보존 제외, 연결 사진과 Firestore 문서의 멱등 파기를 구현했다. Task 3.11은 `FirestoreModule`을 가져오는 `RetentionModule`에 보관 서비스를 provider로 등록하고 export했다. Task 3.12는 배송 사진의 서버 비공개 업로드, 주문 권한 확인 뒤 15분 V4 읽기 서명 URL, 보관 서비스용 삭제 어댑터를 구현했다. Task 3.13은 `StorageService`를 Firebase 인프라 모듈 provider/export에 등록하고 `RetentionService` 삭제 어댑터로 명시적으로 주입했다. Task 3.14는 이미 연결된 회차·운영 예외 모듈을 중복 등록하지 않고 누락된 `RetentionModule`만 `AppModule`에 추가했다. 현재 진입점은 Task 6.1이다.

- **현재 진입점**: 서버 전용 Firestore 컬렉션 차단, 공개 회차·회차 상품 제한 조회와 공개 품종 단건 조회를 Firestore Emulator로 검증했으며 다음 작업은 Task 6.3 Storage 보안 규칙이다.

## 업무 요약 (협업용)

### 개요
디어오키드는 매주 일요일 자정까지 주문을 받고 월요일 경매 후 화요일 오전 9시까지 이천시에 직접 배송한다. 당근 비즈니스는 고객 유입을 맡고, 상품 확인·결제·주문·배송 안내는 그린러브 한 곳에서 처리한다. 기존 택배·거점픽업·공동구매는 삭제하지 않고 디어오키드 소비자 화면에서만 숨긴다.

### 끝났을 때 확인할 것
- 대표자는 이전 회차를 복사해 이번 주 상품·가격·한도를 등록하고 당근용 링크를 얻는다.
- 고객은 현재 회차 상품만 장바구니에 담아 한 주문과 한 번의 결제로 구매한다.
- 이천시 밖 주소, 마감 회차, 한도 초과 주문은 결제 전에 차단된다.
- 월요일 매입부터 화요일 배송, 보류, 유료 재배송, 완료 사진까지 한 주문에서 추적된다.
- 결제·알림 실패는 자동 복구되고 최종 실패만 `확인 필요`에 남는다.
- 주문·분쟁·마케팅 동의 기록은 용도별 보관기간 후 자동 파기된다.

### 이번에 하지 않는 것
- 당근 앱 안 주문·결제와 그린러브 주문의 양방향 동기화
- 외부 셀러 입점·정산 중개와 지역별 배송기사 자동 배정
- 택배·거점픽업·공동구매 기존 데이터의 일괄 변환
- 대량 광고 캠페인 작성·발송 도구와 회원탈퇴 인증 흐름 전면 개편
- 목요일 소경매를 독립 정규 회차로 자동 생성하는 기능

## Origin Intent
- **출처**: `docs/discussions/DISCUSS_mvp_sales_focus.md`
- **원래 목적**: 준비되지 않은 판매 방식을 고객에게 동시에 약속하지 않고 이천시 주간 직배송 경험을 먼저 검증한다.
- **완료 관찰**: 당근 유입 고객은 그린러브에서 회차 상품을 결제하고 대표자는 하나의 운영 흐름으로 배송을 끝낸다.

## 운영 워크플로

### 1. 회차 개설과 당근 유입
```mermaid
flowchart LR
  A["대표자: 이전 회차 복사"] --> B["상품·회차 가격·한도 확인"]
  B --> C["판매 예정 공개"]
  C --> D["대표 링크와 상품 링크 복사"]
  D --> E["당근 비즈프로필·소식·광고 게시"]
  E --> F["그린러브 홈 또는 상품 상세 유입"]
```

- 대표 링크는 홈에 연결하고 현재 회차, 마감, 배송 조건, 지난 회차 순으로 보여준다.
- 상품 광고 링크는 `/products/{productId}?round={roundId}`에 당근 유입 값을 붙인다.
- 당근은 클릭·광고 성과를 확인하는 채널이며 주문·결제 결과는 그린러브 셀러앱에서 확인한다.

### 2. 고객 주문과 단일 결제
```mermaid
flowchart LR
  A["현재 회차 상품"] --> B["같은 회차 장바구니"]
  B --> C["서버 재검증"]
  C --> D["15분 한도 임시 확보"]
  D --> E["포트원 1회 결제"]
  E --> F["웹훅 금액·한도 검증"]
  F --> G["주문 확정·알림"]
```

- 주문은 배송지 1곳을 1건으로 세고 상품 수량 합계를 회차 수량에 반영한다.
- 전화번호와 이천시 주소는 필수이며 마케팅 동의는 기본 해제된 선택 항목이다.
- 서버가 회차 상태·가격·수량을 다시 확인하며 변경된 항목은 고객 재확인 전 결제하지 않는다.

### 3. 매입과 배송
```mermaid
flowchart LR
  A["일요일 24:00 마감"] --> B["월요일 경매 매입"]
  B --> C["검수·포장·배송 준비"]
  C --> D["화요일 00:00 순차 배송"]
  D --> E["완료 사진 업로드"]
  E --> F["화요일 09:00까지 완료"]
  F --> G["보류 주문 0건 확인 후 회차 완료"]
```

### 4. 배송 예외
```mermaid
flowchart TD
  A["배송 불가 발견"] --> B{"원인"}
  B -->|"기상"| C["배송 보류·즉시 안내·새 일정"]
  B -->|"출입·주소·연락"| D["배송 보류·야간 알림"]
  D --> E["다음 날 전화 확인"]
  E --> F["재배송비 결제"]
  F --> G["1회 재배송"]
  G -->|"성공"| H["배송 완료"]
  G -->|"재실패"| I["확인 필요·상품 상태·재판매 가능성 판단"]
```

## 데이터 계약

| 저장소 | 핵심 내용 | 접근 |
| :--- | :--- | :--- |
| `saleRounds` | 상태, 주문·경매·배송 시각, 이천시 지역, 배송지·수량 한도와 집계 | 공개 조회 API, 셀러 쓰기 API |
| `saleRoundItems` | 회차, 상품 원본, 회차 가격, 노출 순서 | 공개 조회 API, 셀러 쓰기 API |
| `checkoutReservations` | 15분 주소 1건·수량 임시 확보, 만료·소비·반환 상태 | 서버 전용 |
| `orders` | `schemaVersion: 2`, 회차, 주문 상품 스냅샷 배열, 배송·보류 상태 | 본인·내부 운영 조회 |
| `orderCharges` | 고객 사유 재배송비 결제와 시도 횟수 | 본인·내부 운영 조회 |
| `operationIssues` | 결제 조회·환불·문자·2차 배송 실패의 최종 수동 조치 | 내부 운영 전용 |
| `legalOrderRecords` | 계약·결제·공급 기록과 5년 파기 시각 | 서버·권한 관리자 전용 |
| `legalDisputeRecords` | 환불·분쟁·고객응대 기록과 3년 파기 시각 | 서버·권한 관리자 전용 |
| `marketingConsentLogs` | 동의 문구 버전, 채널, 동의·철회 시각과 3년 파기 시각 | 서버·권한 관리자 전용 |
| Firebase Storage | 비공개 `deliveryPhotos/{orderId}/{photoId}.jpg`, 기본 90일 | 서버 업로드·서명 URL 조회 |

### 상태 계약
- 회차: `DRAFT → SCHEDULED → OPEN → CLOSED → COMPLETED`, 대표자 취소는 `CANCELLED`.
- 신규 주문: `PENDING → ACCEPTED → PREPARING → DELIVERING → DELIVERED → REVIEWED`.
- 배송 보류: `PREPARING` 또는 `DELIVERING`에서 `DELIVERY_HELD`로 이동한 뒤 `PREPARING`, `DELIVERING`, `CANCELLED` 중 하나로 해소한다.
- 기존 주문 상태와 단일 상품 필드는 그대로 보존하고 조회 계층에서 주문 상품 1개로 정규화한다.
- `Store.salesMode`는 `legacy | round_direct`이며 값이 없으면 `legacy`로 처리한다.

## Edge Case Trace
| 엣지 케이스 | 처리 | Task-ID |
| :--- | :--- | :--- |
| 일요일 24:00 경계 결제 | 승인 완료 시각과 회차 마감 시각을 서버 KST 기준으로 비교 | 3.2, 4.2 |
| 15분 뒤 늦은 결제 | 포트원 재조회 후 한도 재확보, 불가하면 자동 전액 환불 | 4.1, 4.2 |
| 중복 웹훅 | 주문·한도·알림을 멱등 키로 한 번만 반영 | 4.1, 4.2 |
| 가격·수량 변경 장바구니 | 구매 불가 항목은 남기고 제외, 바뀐 값은 재확인 | 6.1, 6.8, 6.9 |
| 이천시 밖 주소 | 서버 주소 정책에서 주문 생성 차단 | 3.1, 3.4 |
| 기상 연기 | 판매자 책임 보류, 재배송비 없이 새 일정 통지 | 2.6, 5.9, 5.11 |
| 고객 사유 첫 실패 | 야간 알림 후 다음 날 연락, 재배송비 선결제 | 2.6, 2.11, 4.17 |
| 고객 사유 재배송 실패 | 자동 환불 판단 금지, 상태·재판매 기록을 확인 필요로 이관 | 3.6, 5.9 |
| 알림톡·문자 모두 실패 | 주문 상태 유지, 확인 필요 생성 | 5.1, 5.3 |
| 배송 사진 개인정보 | 서버 업로드, 본인·내부만 서명 URL, 90일 후 삭제 | 3.12, 5.12 |
| 과거 택배·거점·공구 주문 | 데이터 변환 없이 조회 시 단일 주문 상품으로 표시 | 3.5, 6.12 |
| 보류 주문이 남은 회차 | 회차 완료 거부 | 2.1, 2.3 |

## Diagnosis & Findings
- 현재 장바구니 결제는 상품마다 주문과 결제를 반복하므로 다중 상품이 한 주문으로 묶이지 않는다.
- 현재 `dailyCaps`는 배송지 수와 상품 수량을 분리하지 않고 수량만 차감한다.
- 현재 결제 타임아웃은 포트원 조회 없이 `PENDING` 주문을 취소해 늦은 결제와 충돌할 수 있다.
- 현재 알리고 키가 없으면 성공으로 기록되고 재시도·문자 대체가 구현되지 않았다.
- 현재 배송 사진은 거점 도착 전용이며 클라이언트가 Storage에 직접 올리지만 보안 규칙에는 허용 경로가 없다.
- 현재 소비자 홈·상품 상세·결제에는 공동구매, 택배, 거점픽업, 고객 선택 배송일이 함께 노출된다.

## Architectural Deepening
- **Seam**: 상품 원본, 판매 회차, 주문 스냅샷을 분리해 가격 변경이 과거 주문을 바꾸지 않게 한다.
- **Leverage**: 기존 `OrdersCreateService`, `PaymentsService`, `NotificationsService`를 유지하고 회차 주문 분기만 추가한다.
- **Compatibility**: 신규 주문만 `schemaVersion: 2`를 사용하며 기존 로직은 `salesMode: legacy`에서 그대로 동작한다.
- **Security**: 법정 보관 컬렉션과 배송 사진은 클라이언트 직접 접근을 계속 차단한다.
- **Release**: 디어오키드의 `salesMode`를 마지막에 전환해 단계별 구현 중 고객 화면 회귀를 막는다.

## Agent Completion Contract
- 각 Task는 선행 Task 완료 후 한 번에 하나씩 실행한다.
- 핵심 도메인 로직은 테스트 계약을 먼저 추가하고 구현 Task에서 통과시킨다.
- 각 Verify가 종료 코드 0인 경우에만 Conclusion을 실측 문장으로 바꾸고 다음 Task로 이동한다.
- 전체 구현 요청 후에는 Blueprint 구조를 고정하며 상태·Conclusion·Closeout만 갱신한다.
- 수정 코드 파일은 500줄 미만을 유지하고 `docs/memory.md`는 200줄 상한을 넘기지 않는다.

> **에이전트 스코프**: 사용자가 PLAN 전체 실행을 요청하면 아래 Dependency 순으로 진행한다. 각 Task는 표의 단일 Target만 수정하고 Verify 후 Conclusion과 Status를 닫는다.

## Execution Plan

### Phase 0. 명세와 공통 계약
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0.1 | 없음 | `docs/specs/mvp-sales-round-direct-delivery.md` | 이 문서의 API·화면·보관 계약을 구현 명세로 고정한다. | `git diff --check -- docs/specs/mvp-sales-round-direct-delivery.md` | 통과 — 구현 명세 파일의 공백 오류가 없음을 확인했다. | done |
| 0.2 | 0.1 | `packages/shared/src/sale-round.types.ts` | 회차·회차 상품·예약·재배송비·운영 예외 타입을 정의한다. | `pnpm --filter @greenhub/shared typecheck` | 통과 — shared 타입체크가 회차·예약·운영 타입을 오류 없이 수용했다. | done |
| 0.3 | 0.2 | `packages/shared/src/order.types.ts` | 다중 주문 상품, `DELIVERY_HELD`, 회차·유입·보류 스냅샷을 하위 호환으로 추가한다. | `pnpm --filter @greenhub/shared typecheck` | 통과 — shared 타입체크가 주문 상태와 optional 회차 스냅샷 확장을 오류 없이 수용했다. | done |
| 0.4 | 0.3 | `packages/shared/src/notification.types.ts` | 배송 보류·재배송·운영 실패 알림 코드를 추가한다. | `pnpm --filter @greenhub/shared typecheck` | 통과 — shared 타입체크가 문자 채널과 배송 보류·재배송·운영 실패 알림 코드를 오류 없이 수용했다. | done |
| 0.5 | 0.4 | `packages/shared/src/store.types.ts` | `salesMode`의 legacy 기본 호환 계약을 추가한다. | `pnpm --filter @greenhub/shared typecheck` | 통과 — shared 타입체크가 `salesMode`와 `legacy` 기본 정규화 계약을 오류 없이 수용했다. | done |
| 0.6 | 0.5 | `packages/shared/src/index.ts` | 신규 공통 계약을 패키지 공개 API로 내보낸다. | `pnpm --filter @greenhub/shared build` | 통과 — shared ESM/CJS 빌드가 신규 회차 계약 공개 API와 dist 산출물을 오류 없이 생성했다. | done |

### Phase 1. 판매 회차 API
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1.1 | 0.6 | `apps/api/src/sale-rounds/sale-rounds.service.spec.ts` | 상태 자동 전환·두 한도·보류 주문 완료 차단의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- --listTests` | 통과 — Jest가 `sale-rounds.service.spec.ts`를 포함한 5개 테스트 파일을 수집했다. | done |
| 1.2 | 1.1 | `apps/api/src/sale-rounds/dto/sale-round.dto.ts` | 회차 생성·수정·복사 입력을 검증한다. | `pnpm --filter api build` | 통과 — API 빌드가 회차 생성·수정·복사 DTO 계약을 오류 없이 컴파일했다. | done |
| 1.3 | 1.2 | `apps/api/src/sale-rounds/sale-rounds.service.ts` | 회차 CRUD·복사·공개 조회·스케줄 전환을 트랜잭션으로 구현한다. | `pnpm --filter api test -- sale-rounds.service.spec.ts --runInBand` | 통과 — 회차 서비스 테스트 4개가 상태 자동 전환·배송지 한도·보류 완료 차단 계약을 검증했다. | done |
| 1.4 | 1.3 | `apps/api/src/sale-rounds/sale-rounds.controller.ts` | 공개 회차 조회와 셀러 회차 관리 엔드포인트를 역할별로 노출한다. | `pnpm --filter api build` | 통과 — 공개 회차 조회와 셀러 관리 컨트롤러가 API 빌드에 포함되어 컴파일됐다. | done |
| 1.5 | 1.4 | `apps/api/src/sale-rounds/sale-rounds.module.ts` | 회차 서비스를 주문 모듈에서 재사용할 수 있게 내보낸다. | `pnpm --filter api build` | 통과 — 회차 모듈이 컨트롤러와 서비스를 묶고 `SaleRoundsService`를 export한 상태로 API 빌드에 통과했다. | done |

### Phase 2. 회차 주문과 결제 복구
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 2.1 | 1.5 | `apps/api/src/orders/mvp-order-flow.spec.ts` | 이천 주소·다중 상품·예약·취소·보류·재배송비의 실패 테스트를 먼저 고정한다. | `pnpm --filter api test -- --listTests` | 통과 — Jest가 `mvp-order-flow.spec.ts`를 포함한 6개 테스트 파일을 수집했다. | done |
| 2.2 | 2.1 | `apps/api/src/orders/dto/create-order.dto.ts` | 회차 상품 배열, 필수 전화번호, 선택 마케팅 동의, 유입 값을 받도록 확장한다. | `pnpm --filter api build` | 통과 — API 빌드가 회차 상품 배열, 배송 전화번호, 마케팅 동의, 유입 DTO 확장을 오류 없이 컴파일했다. | done |
| 2.3 | 2.2 | `apps/api/src/orders/order-capacity.service.ts` | 주소 1건·수량 합계 예약을 확보·소비·반환하는 멱등 트랜잭션을 구현한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 회차 주문 흐름 테스트 6개가 결제 예약 확보·소비·반환 서비스와 활성 주문 계약을 오류 없이 검증했다. | done |
| 2.4 | 2.3 | `apps/api/src/orders/orders-create.service.ts` | `round_direct`에서 한 주문·상품 스냅샷 배열·단일 결제 요청을 만들고 legacy 분기를 보존한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 회차 주문 흐름 테스트 6개가 이천 주소 차단, 다중 상품 주문 스냅샷, 단일 결제 금액을 오류 없이 검증했다. | done |
| 2.5 | 2.4 | `apps/api/src/orders/orders-query.service.ts` | 신규 다중 상품과 기존 단일 상품을 같은 조회 응답으로 정규화한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 회차 주문 흐름 테스트 6개와 API 빌드가 기존 단일 상품 주문의 `orderItems` 정규화와 `DELIVERY_HELD` 조회 상태를 오류 없이 수용했다. | done |
| 2.6 | 2.5 | `apps/api/src/orders/orders-lifecycle.service.ts` | 마감 전 취소·`DELIVERY_HELD`·회차 완료 가드·부분 환불 기록을 구현한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 회차 주문 흐름 테스트 6개가 마감 전 고객 취소의 환불·한도 반환과 배송 보류 카운터 기록을 오류 없이 검증했다. | done |
| 2.7 | 2.6 | `apps/api/src/orders/orders.controller.ts` | 장바구니 검증·고객 취소·보류·재배송비·완료 사진 API 경로를 연결한다. | `pnpm --filter api build` | 통과 — 주문 컨트롤러가 회차 장바구니 검증, 고객 취소, 배송 보류, 재배송비, 배송 사진 경로를 빌드 오류 없이 노출한다. | done |
| 2.8 | 2.7 | `apps/api/src/orders/orders.module.ts` | 용량·결제·재배송비 의존성을 주문 모듈에 연결한다. 보관 의존성은 생성 이후 Task 3.11·3.14에서 연결한다. | `pnpm --filter api build` | 통과 — `OrdersModule`이 `OrderCapacityModule`과 `PaymentsModule`을 가져오고 `OrderChargesService`를 provider로 등록한 상태에서 API 빌드에 성공했다. | done |
| 2.9 | 2.8 | `apps/api/src/payments/payments.service.spec.ts` | 늦은 결제·중복 웹훅·한도 재확보 실패 자동 환불 테스트를 먼저 고정한다. | `pnpm --filter api test -- --listTests` | 통과 — Jest가 `payments.service.spec.ts`를 포함한 8개 테스트 파일을 수집했다. | done |
| 2.10 | 2.9 | `apps/api/src/payments/payments.service.ts` | 타임아웃 포트원 재조회와 주문·재배송비 결제의 멱등 확정을 구현한다. | `pnpm --filter api test -- payments.service.spec.ts --runInBand` | 통과 — 2026-07-17 KST Railway staging deployment `187e2ba9-e589-4dff-bee9-21fff9e17f7c`와 Firebase `green-staging-74557`에서 실제 100원 `PAID`, 주문·결제 금액 일치, `PAID` 웹훅 재발송 멱등성, timeout 후 새 예약 `CONSUMED`와 주문 `ACCEPTED` 복구, 한도 재확보 실패 시 PortOne 100원 전액 환불, 로컬 결제 `CANCELLED`·환불액 100원 기록, `CANCELLED` 웹훅 HTTP 200, 재발송 후 환불 1건·수량 불변을 확인했다. 관련 4개 스위트 31개 테스트, API 빌드, Biome 오류 수준 검사와 `git diff --check`가 통과했다. 상세 증거는 `REPORT_task_2_10_portone_staging_e2e.md`에 기록했다. | done |
| 2.11 | 2.10 | `apps/api/src/orders/order-charges.service.ts` | 고객 사유 첫 실패에 재배송비 결제 1회를 만들고 재실패는 운영 예외로 전환한다. | `pnpm --filter api test -- mvp-order-flow.spec.ts --runInBand` | 통과 — 첫 고객 사유 보류에만 주문 문서와 원자적으로 재배송비 1건을 만들고, 같은 보류의 다른 멱등 키 재처리는 기존 결제를 반환하며, 새 고객 사유 보류는 추가 결제 없이 멱등 `REDELIVERY_FAILED` 운영 예외 1건과 운영 확인 표시로 전환했다. 권한·비고객 사유·legacy 회귀를 포함한 주문 흐름 14개 테스트, 일반 결제 16개 테스트, API 빌드, Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |

### Phase 3. 알림·운영 예외·보관
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 3.1 | 2.11 | `apps/api/src/notifications/notifications-delivery.spec.ts` | 알림톡 3회·문자 대체·키 누락·최종 실패 기록 테스트를 먼저 고정한다. | `pnpm --filter api test -- --listTests` | 통과 — Jest가 신규 알림 전달 계약 파일을 포함한 12개 테스트 파일을 수집했다. 신규 7개 테스트 중 현재 구현이 이미 만족하는 성공·일반 알림 회귀 2개는 통과했고, 재시도·문자 대체·키 누락 실패 처리·`CUSTOMER_NOTICE_FAILED` 멱등 운영 예외 5개는 후속 구현 부재로 예상 실패했다. API 빌드, Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 3.2 | 3.1 | `apps/api/src/notifications/aligo.client.ts` | 재시도와 문자 대체를 구현하고 키 누락 성공 오판을 제거한다. | `pnpm --filter api test -- notifications-delivery.spec.ts --runInBand` | 통과 — 알림톡 즉시 성공, 최대 3회 시도 후 성공 중단, 3회 실패 후 동일 내용 문자 대체, 필수 설정 누락 실패, 문자 성공 시 일반 알림 회귀의 5개 계약이 통과했다. 전체 7개 중 남은 2개 실패는 Task 3.3 대상인 `CUSTOMER_NOTICE_FAILED` 생성과 멱등성 미구현으로 한정됐다. API 빌드, 변경 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 3.3 | 3.2 | `apps/api/src/notifications/notifications.service.ts` | 거래 알림 실패를 기록하고 최종 실패만 운영 예외로 생성한다. | `pnpm --filter api test -- notifications-delivery.spec.ts --runInBand` | 통과 — 문자 대체 성공 시 일반 알림 1건만 유지하고, 최종 실패 시 주문·템플릿별 결정적 문서 ID와 `customer-notice-failed:{orderId}:{templateCode}` 멱등 키로 `CUSTOMER_NOTICE_FAILED` 운영 예외를 최대 1건 생성했다. 운영 예외에는 전화번호·본문·비밀값 없이 실패 단계와 주문 상태만 기록하며 주문 상태는 변경하지 않는다. 알림 전달 계약 7개 테스트, API 빌드, 변경 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 3.4 | 3.3 | `apps/api/src/notifications/notifications.controller.ts` | 마케팅 동의·철회를 검증된 채널 값으로 저장하게 한다. | `pnpm --filter api build` | 통과 — 기존 `PATCH /notifications/me/preferences`와 JWT 인증 흐름을 유지하고 `alimtalk`, `sms` 중 최소 한 채널의 엄격한 boolean만 허용했다. 알 수 없는 키와 잘못된 타입을 거부하고 인증 사용자 문서의 기존 설정과 병합해 요청하지 않은 채널을 보존하며 저장 완료 상태를 반환한다. 신규 설정 계약 12개와 기존 알림 전달 계약 7개, API 빌드, 변경 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 3.5 | 3.4 | `apps/api/src/operations/operations.service.spec.ts` | 중복 예외 통합·최신 상태 재검증·조치 감사 기록 테스트를 먼저 고정한다. | `pnpm --filter api test -- --listTests` | 통과 — Jest가 신규 운영 계약 파일을 포함한 14개 테스트 파일을 수집했다. 신규 6개 테스트는 같은 `idempotencyKey`의 열린 항목 통합과 다른 주문·결제·실패 유형 분리, 환불·문자 조치 직전 최신 주문·결제·운영 예외 재조회, 성공·실패 `actions` 감사 기록과 민감정보 배제를 고정했다. 현재 `apps/api/src/operations/operations.service.ts`가 없어 6개 모두 Task 3.6 구현 부재로 예상 실패했다. 알림 7개, 결제 16개, 회차 주문·재배송 14개 회귀와 API 빌드, Biome 오류 수준 검사, `git diff --check`는 통과했다. | done |
| 3.6 | 3.5 | `apps/api/src/operations/operations.service.ts` | 결제·환불·알림·재배송 최종 실패를 멱등 `확인 필요` 항목으로 관리한다. | `pnpm --filter api test -- operations.service.spec.ts --runInBand` | 통과 — `idempotencyKey`를 해시한 결정적 문서 ID로 같은 실패 원인과 업무 대상을 하나의 열린 항목으로 통합하고 다른 주문·결제·실패 유형은 분리했다. 조치 직전에 운영 예외와 최신 주문·결제 상태를 다시 읽어 이미 환불되었거나 해결된 항목의 외부 호출을 반복하지 않으며, 환불 재시도와 문자 재발송의 성공·실패를 기존 `actions`에 누적한다. 실패 사유는 안전한 오류 메시지만 제한적으로 저장하고 민감 키가 포함되면 일반화한다. 운영 계약 6개, 알림 7개, 결제 16개, 회차 주문·재배송 14개, API 빌드, Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 3.7 | 3.6 | `apps/api/src/operations/operations.controller.ts` | 셀러의 재조회·환불 재시도·문자 재발송·조치 기록 API를 노출한다. | `pnpm --filter api build` | 통과 — `GET /stores/:storeId/operation-issues`, 상세 조회, `POST .../:issueId/refresh`, `POST .../:issueId/actions`를 추가했다. JWT와 seller·admin 역할을 요구하고 seller는 서버가 조회한 `stores/{storeId}.ownerId`로 권한을 판정한다. 목록은 `storeId` Firestore 쿼리로 제한하고 상세·재조회·조치는 같은 스토어 경계를 재검증한다. 조치의 `actorId`는 인증 사용자 ID로 고정하며 허용 유형은 `RETRY_REFUND`, `RESEND_SMS`뿐이고 실행은 `OperationsService.executeAction`을 통과한다. 응답은 상태·식별자·안전한 스냅샷·감사 필드만 허용한다. 신규 컨트롤러 계약 9개, 운영 6개, 알림 7개, 결제 16개, 회차 주문·재배송 14개, API 빌드, 변경 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 3.8 | 3.7 | `apps/api/src/operations/operations.module.ts` | 운영 예외 서비스를 결제·알림·주문에서 재사용할 수 있게 내보낸다. | `pnpm --filter api build` | 통과 — `OperationsModule`이 결제·알림 의존성과 컨트롤러·서비스를 연결하고 서비스를 export했으며, `AppModule` 런타임 라우트 등록과 알림·재배송 최종 실패의 공통 `createOrMergeIssue` 전환을 완료했다. 신규 모듈 3개를 포함한 관련 67개 테스트, API 빌드, Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 3.9 | 3.8 | `apps/api/src/retention/retention.service.spec.ts` | 90일·3년·5년 만료와 분쟁 연장 파기 테스트를 먼저 고정한다. | `pnpm --filter api test -- --listTests` | 통과 — Jest가 신규 보관 계약 파일을 포함한 17개 테스트 파일을 수집했다. 신규 8개 테스트는 배송 사진 90일, 마케팅 동의·분쟁 기록 3년, 계약·결제·공급 기록 5년의 목적별 `expiresAt`, 진행 중 분쟁과 법적 보존 사유의 파기 제외, 미만료 제외, 목적별 쿼리 분리, 모의 Firestore 배치·Storage 삭제와 재실행 멱등성, 개인정보·비밀값 배제를 고정했다. 8개 모두 `apps/api/src/retention/retention.service.ts` 부재를 명시하는 예상 실패로 확인했다. 기존 운영 예외·알림·결제·주문 6개 스위트 55개 테스트, API 빌드, Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 3.10 | 3.9 | `apps/api/src/retention/retention.service.ts` | 법정 기록 분리 저장과 Firestore·Storage 정기 파기를 구현한다. | `pnpm --filter api test -- retention.service.spec.ts --runInBand` | 통과 — 배송 사진 90일, 마케팅 동의와 환불·분쟁·고객응대 기록 3년, 계약·결제·공급 기록 5년의 목적별 `expiresAt`과 분리 컬렉션 저장을 구현했다. 목적별 만료 쿼리에서 진행 중 분쟁과 `legalHold`를 제외하고, 연결 사진은 Storage 삭제 어댑터로 제거한 뒤 Firestore 문서를 단일 배치로 삭제하며 빈 대상에는 부작용을 만들지 않는다. 신규 8개와 기존 6개 스위트 55개 테스트, API 빌드, Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 3.11 | 3.10 | `apps/api/src/retention/retention.module.ts` | 보관 서비스를 주문·결제·알림에서 재사용할 수 있게 내보낸다. | `pnpm --filter api build` | 통과 — `RetentionModule`이 `FirestoreModule`을 가져오고 `RetentionService`를 provider로 등록해 export한다. Storage 구현·토큰, `AppModule`, 주문·결제·알림 호출 경로는 후속 Task 범위로 유지했다. 신규 모듈 계약 2개를 포함한 보관·운영 예외·알림·결제·주문 8개 스위트 68개 테스트, API 빌드, 변경 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 3.12 | 3.11 | `apps/api/src/firestore/storage.service.ts` | 배송 사진을 비공개 업로드하고 권한 확인 후 단기 서명 URL을 발급한다. | `pnpm --filter api build` | 통과 — `deliveryPhotos/{orderId}/{photoId}.jpg` 경로에 JPEG를 서버 업로드하고 private/no-store 메타데이터와 CRC32C 검증을 적용했다. 업로드는 관리자·스토어 소유 셀러·배정 기사, 읽기는 여기에 주문자 본인을 추가해 서버가 주문과 스토어 경계를 확인한 뒤에만 허용한다. 읽기 URL은 V4 읽기 전용 15분 만료로 발급하며 공개 ACL·공개 URL·클라이언트 직접 업로드 경로는 만들지 않았다. 보관 서비스가 재사용할 `deleteObject`는 배송 사진 경로만 받고 미존재 삭제를 멱등 처리한다. 신규 Storage 5개를 포함한 관련 13개 스위트 89개 테스트, API 빌드, 변경 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 3.13 | 3.12 | `apps/api/src/firestore/firestore.module.ts` | 서버 Storage 어댑터를 주입·내보내도록 Firebase 인프라 모듈을 확장한다. | `pnpm --filter api build` | 통과 — `StorageService`를 `FirestoreModule` provider/export에 등록해 기존 `FIREBASE_APP`과 `FirestoreService`를 재사용하도록 연결했다. Firebase Admin 초기화에는 `FIREBASE_STORAGE_BUCKET`을 우선 적용하고 미설정 시 기존 project ID의 기본 Appspot bucket을 사용하며, `.env.example`에 비밀값이 아닌 bucket 이름 계약을 추가했다. `RetentionService`의 삭제 어댑터는 `@Inject(StorageService)`로 명시했다. 신규 모듈 계약 3개를 포함한 관련 15개 스위트 98개 테스트, API 빌드, 변경 TypeScript 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다. `AppModule` 및 주문·드라이버 실제 호출 경로는 변경하지 않았다. | done |
| 3.14 | 3.13 | `apps/api/src/app.module.ts` | 회차·운영 예외·보관 모듈을 애플리케이션에 최종 연결한다. | `pnpm --filter api build` | 통과 — `SaleRoundsModule`과 `OperationsModule`은 기존 AppModule 등록을 유지하고, 실제 누락된 `RetentionModule`만 한 번 추가했다. 신규 AppModule 계약 테스트는 세 모듈의 단일 등록과 기능 provider 비중복을 고정한다. Firebase Admin 앱·Storage provider를 재등록하거나 새 `forwardRef`를 추가하지 않았고 주문·드라이버 배송 사진 호출 경로와 공개 Storage 경계도 변경하지 않았다. 관련 15개 스위트 94개 테스트, API 빌드, 변경 TypeScript 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |

### Phase 4. 소비자앱 단순화
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 4.1 | 3.14 | `apps/e2e/tests/consumer-round-direct.spec.ts` | 홈·상세·장바구니·결제·주문상세 계약을 먼저 수집한다. | `pnpm --filter e2e exec playwright test consumer-round-direct --list` | 통과 — 현재·지난 회차 홈, 회차 가격·마감·직배송 상세, 같은 회차 장바구니와 변경·마감 제외, 다중 상품 단일 결제와 필수·선택 동의·변경 재확인, 다중 상품·배송 보류·재배송비·완료 사진·마감 전 취소 주문 상세를 논리 계약 10개로 수집했다. 공개 4개와 기존 `AUTH_STATE_PATH`를 재사용한 인증 6개를 `test.fixme`로 고정해 Task 4.2~4.18 구현 전 외부 서비스나 실제 데이터 호출 없이 보존했다. chromium·mobile 20개 테스트와 기존 소비자 5개 파일 68개 테스트 목록 수집, 변경 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다. | done |
| 4.2 | 4.1 | `apps/consumer/src/hooks/useSaleRounds.ts` | 현재·지난 회차 공개 API 상태를 한 훅에서 제공한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 공개 회차 목록과 상세 API를 결합해 `loading`, `error`, `empty`, `success` 상태와 현재·지난 회차, 전체 회차, 재조회 기능을 제공했다. 늦은 응답의 상태 덮어쓰기를 차단했고 신규 Node 테스트 4개와 consumer 타입검사가 통과했다. | done |
| 4.3 | 4.2 | `apps/consumer/src/lib/acquisition.ts` | 당근 유입 값을 보관해 주문 요청에 스냅샷으로 전달한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 당근 UTM 유입의 캠페인·콘텐츠와 민감 쿼리를 제거한 도착 URL을 탭 세션에 보관하고, 공유 주문 계약의 다섯 필드만 재검증해 새 스냅샷으로 제공한다. SSR·저장소 접근 거부·잘못된 저장값을 안전하게 처리했으며 신규 Node 테스트 6개와 consumer 타입검사가 통과했다. | done |
| 4.4 | 4.3 | `apps/consumer/src/components/HomeProductList.tsx` | 현재 회차·마감·직배송 조건·지난 회차 순서로 홈을 재구성한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 공개 상품의 단일 `storeId`와 공개 스토어 `salesMode`를 사용해 `round_direct` 홈만 현재 회차·마감·이천 직접배송·화요일 배송 약속·지난 회차 순서로 구성했다. 회차 판정은 `useSaleRounds` 정본을 재사용하고 상품 링크에 `productId`와 `roundId`를 보존했으며, legacy 홈과 명시적 로딩·오류·빈 상태를 유지했다. 신규 Node 계약 테스트 4개와 consumer 타입검사가 통과했다. | done |
| 4.5 | 4.4 | `apps/consumer/src/app/category/page.tsx` | 현재·지난 회차의 호접란만 상품 목록으로 제공한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 공개 상품의 단일 `storeId`와 공개 스토어 `salesMode`로 분기하고 `round_direct`에서는 `useSaleRounds`의 현재·지난 회차 항목을 공개 상품과 `productId`로 결합해 활성 호접란만 노출했다. 회차 가격과 현재·지난 구분을 표시하고 링크에 `productId`와 `roundId`를 보존했으며, 명시적 로딩·오류·빈 상태와 legacy 카테고리 흐름을 유지했다. 신규 Node 계약 테스트 5개와 consumer 타입검사가 통과했다. | done |
| 4.6 | 4.5 | `apps/consumer/src/components/BottomNav.tsx` | 홈·상품·장바구니·MY 네 항목만 노출한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 공개 상품의 단일 `storeId`와 공개 스토어 `salesMode`로 분기해 `round_direct`에는 홈·상품·장바구니·MY 네 항목만 노출하고, 확인된 legacy에는 기존 다섯 항목과 경로를 보존했다. 판매 모드 판정 중이거나 공개 조회가 실패하면 내비게이션을 숨겨 기존 공동구매 항목의 순간 노출을 막았으며 신규 Node 계약 테스트 4개와 consumer 타입검사가 통과했다. | done |
| 4.7 | 4.6 | `apps/consumer/src/app/groupbuy/page.tsx` | `round_direct`에서 공동구매 직접 진입을 홈으로 돌린다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 공개 상품의 단일 `storeId`와 공개 스토어 `salesMode`로 분기해 `round_direct`의 `/groupbuy` 직접 진입을 내부 홈 `/`로 대체 이동했다. 판매 모드 판정 전·조회 오류·이동 중에는 legacy 공동구매 화면을 노출하지 않고, 확인된 legacy에는 기존 모집 중·완료·빈·오류 화면을 보존했다. 신규 Node 계약 테스트 4개와 consumer 타입검사가 통과했다. | done |
| 4.8 | 4.7 | `apps/consumer/src/app/products/[id]/page.tsx` | 회차 파라미터로 현재·마감 회차 상품을 구분해 내려준다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 단일 안전 `round` 값만 허용하고 공개 상품 `storeId`, 공개 스토어 `salesMode`, `useSaleRounds`의 현재·지난 회차 정본으로 상품·스토어·회차 항목 관계를 검증했다. 유효 항목은 현재·마감 상태와 구매 가능 여부로 구분해 상세 경계에 전달하고, 판정 전 상세 노출을 막으면서 legacy 상세 구성을 보존했다. 신규 Node 계약 5개와 consumer 타입검사가 통과했다. | done |
| 4.9 | 4.8 | `apps/consumer/src/app/products/[id]/_components/RoundPurchasePanel.tsx` | 회차 가격·마감·화요일 배송·이천·기상 원칙·구매 가능 상태를 표시한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — Task 4.8의 공개 회차 상품 정본을 그대로 받아 회차 가격·한국시간 마감·직배송·기상 연기·청약철회 제한과 현재·마감·구매 가능 상태를 표시했으며 전용 Node 테스트 6개와 consumer 타입검사가 통과했다. | done |
| 4.10 | 4.9 | `apps/consumer/src/app/products/[id]/_components/ProductActions.tsx` | 택배·거점·공구·날짜 선택을 제거하고 회차 패널에 구매 동작을 위임한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — Task 4.8이 검증한 회차 상품 계약으로 회차 가격·직배송·구매 가능 상태만 구매 동작에 연결하고 택배·거점·공동구매·배송 희망일 선택을 제거했다. legacy 선택·구매 흐름은 별도 구성요소로 보존했으며 전용 Node 테스트 5개와 consumer 타입검사가 통과했다. | done |
| 4.11 | 4.10 | `apps/consumer/src/hooks/useCart.ts` | 회차·회차 가격을 저장하고 같은 회차 상품만 하나의 장바구니로 묶는다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — Task 4.8의 검증된 `roundId`, 회차 상품 ID, 회차 가격만 회차 장바구니 계약으로 저장하고 같은 회차 항목만 함께 유지했다. 동일 항목은 회차 상품 식별자를 포함해 판정하며 다른 회차·legacy 혼합은 기존 장바구니를 보존한 실패 결과로 거부했다. 기존 CartItem 배열은 계속 읽고 불완전·손상 저장값은 회차 항목으로 승격하지 않았으며 전용 Node 테스트 9개와 consumer 타입검사가 통과했다. | done |
| 4.12 | 4.11 | `apps/consumer/src/app/cart/page.tsx` | 서버 재검증 결과로 변경·마감 상품을 남겨 표시하고 결제 대상만 선별한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 기존 인증 장바구니 검증 API로 회차 항목을 각각 재검증해 가격 변경·마감·수량·구매 불가 사유를 분리하고, 통과 후보는 다시 한 요청으로 묶어 회차 전체 수량·금액을 확인했다. 실패·손상 응답은 닫힌 상태로 제외하고 항목은 장바구니에 유지했으며 legacy CartItem 결제 흐름을 보존했다. 전용 Node 테스트 8개와 Task 4.8~4.11 계약을 합한 33개, consumer 타입검사와 전체 검증이 통과했다. | done |
| 4.13 | 4.12 | `apps/consumer/src/hooks/usePayment.ts` | 다중 상품 주문 하나와 포트원 결제 한 번을 처리하도록 결제 훅을 확장한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — Task 4.12가 선별한 같은 회차 `RoundCartItem[]`만 받아 `roundId`와 전체 `roundItems`를 주문 API 한 번에 전송하고, 단일 `orderId`·검증된 합계로 PortOne 결제를 한 번만 시작한다. 빈 배열·혼합 회차·손상 입력과 손상 응답은 SDK 호출 전에 거부하고 동시 클릭을 단일화했으며 네트워크 오류 재시도에는 같은 `clientOrderRequestId`를 재사용한다. 기존 단일 상품 계약을 보존했고 전용 Node 테스트 6개와 Task 4.8~4.12 회귀 33개, consumer 타입검사와 전체 검증이 통과했다. | done |
| 4.14 | 4.13 | `apps/consumer/src/app/checkout/page.tsx` | 장바구니 전체를 한 주문과 한 번의 포트원 결제로 처리한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — `checkout_cart`를 엄격히 복원해 빈 배열·손상 입력·다른 회차·legacy 혼합을 닫힌 방식으로 거부하고, 공개 회차 정본의 스토어·상품·가격 관계와 `Asia/Seoul` 배송 시작·종료일이 일치할 때만 `requestedDeliveryDate`를 결정했다. 검증된 `RoundCartItem[]` 전체를 Task 4.13 `usePayment`에 한 번 전달해 주문 API와 PortOne 결제를 각각 한 번만 실행하며, 단일 주문 ID 완료 후에만 `checkout_cart`를 삭제한다. legacy 장바구니와 단일 상품 흐름을 보존했고 전용 Node 테스트 5개와 Task 4.8~4.13 회귀 39개, consumer 타입검사와 전체 검증이 통과했다. | done |
| 4.15 | 4.14 | `apps/consumer/src/app/checkout/_components/CheckoutForm.tsx` | 전화번호·이천 주소·필수 고지·선택 마케팅 동의·변경 재확인을 제공한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 회차 checkout에 배송 연락처와 정보성 연락 목적, 주소 선두의 이천시 행정구역 경계 검증, 화요일 직접배송·기상 연기·청약철회 제한 필수 고지를 표시했다. 마케팅 동의는 기본 해제된 별도 선택값으로 주문에 전달하고, 상품·가격·회차 확인은 요약 변경 때 다시 해제하며 확인 전 결제를 막는다. 전용 Node 테스트 6개와 Task 4.8~4.14 회귀 44개, consumer 타입검사와 전체 검증이 통과했다. | done |
| 4.16 | 4.15 | `apps/consumer/src/app/order/success/page.tsx` | 회차 주문번호·상품 요약·화요일 배송 약속을 결제 완료 화면에 표시한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 안전한 단일 `orderId`와 인증된 서버 주문 응답의 식별자·상태·회차 주문번호·다중 상품·금액 정합성이 모두 일치할 때만 회차 주문 성공으로 판정했다. 서버 `orderItems`의 상품명·수량·소계·합계를 표시하고 화요일 오전 9시까지 문 앞 배송 약속을 고지했으며, legacy 주문번호 폴백과 공동구매 모집 안내를 보존했다. 전용 Node 테스트 5개와 Task 4.8~4.15 회귀 50개, consumer 타입검사와 전체 검증이 통과했다. | done |
| 4.17 | 4.16 | `apps/consumer/src/app/mypage/_client.tsx` | 다중 상품 대표명과 배송 보류를 주문 목록에 표시한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 서버가 정규화한 `orderItems`만으로 대표 상품명·추가 상품 수·상품 종류·총수량을 표시하고 손상 배열은 최상위 상품명으로 승격하지 않았다. `DELIVERY_HELD`를 배송 보류 배지와 위험 색상으로 명시했으며 단일 legacy 배송 방식·수량·금액 계약을 보존했다. 전용 Node 테스트 4개와 Task 4.8~4.16 회귀 55개, consumer 타입검사와 전체 검증이 통과했다. | done |
| 4.18 | 4.17 | `apps/consumer/src/app/mypage/orders/[id]/_client.tsx` | 다중 상품·보류·재배송비 결제·완료 사진·마감 전 취소를 표시한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 인증된 서버 주문 상세 응답을 회차 식별자·상태·다중 `orderItems`·소계·합계·보류 스냅샷·HTTPS 완료 사진까지 닫힌 방식으로 검증하고, 상품명·수량·금액과 배송 보류 사유·고객 책임·재배송비·다음 연락·배송 일정을 표시했다. 고객 책임의 양수 재배송비만 기존 서버 API 응답의 청구·주문·스토어·금액·PortOne 식별자가 모두 일치할 때 카카오페이로 요청하며, 취소는 서버가 회차 마감을 재검증하는 기존 API만 사용한다. legacy 단일 상품·공동구매·거점픽업 상세를 보존했고 전용 Node 테스트 5개와 Task 4.8~4.17 회귀 59개, consumer 타입검사와 전체 검증이 통과했다. | done |
| 4.19 | 4.18 | `apps/consumer/src/app/mypage/notifications/settings/page.tsx` | 카카오톡·문자 마케팅 동의 상태와 즉시 철회를 제공한다. | `pnpm --filter consumer exec tsc --noEmit` | 통과 — 인증된 `GET /auth/me` 응답의 `notificationPreferences.alimtalk`·`sms`가 모두 boolean일 때만 현재 상태를 표시하고, 동의 채널 하나만 `false`로 PATCH해 응답의 두 채널 boolean과 철회 결과를 검증한 뒤 화면을 갱신한다. 정보성 주문·결제·배송 연락을 선택 마케팅과 분리했으며 전용 Node 테스트 5개, Task 4.8~4.18 회귀 64개, consumer 타입검사와 전체 검증이 통과했다. | done |

### Phase 5. 셀러·드라이버 운영
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 5.1 | 4.19 | `apps/e2e/tests/seller-sale-rounds.spec.ts` | 회차 복사·예약·마감·완료·확인 필요 계약을 먼저 수집한다. | `pnpm --filter e2e exec playwright test seller-sale-rounds --list` | 통과 — 완료 회차 복사, 작성 중 회차 예약, 판매 중 회차 수동 마감, 보류 주문이 있는 완료 거부, 정상 완료, 확인 필요 주문 진입을 서로 다른 6개 fixture 식별자로 분리했다. 기존 셀러 인증 상태와 환경 변수 계약을 재사용하고 아직 없는 화면·seed를 통과한 것으로 기록하지 않도록 전부 `test.fixme`로 고정했으며 chromium·mobile 12개 목록 수집, 소비자 24개 회귀 목록, 전체 typecheck·build, Biome 오류 수준 검사와 diff 검사가 통과했다. | done |
| 5.2 | 5.1 | `apps/seller/src/hooks/useSaleRounds.ts` | 셀러 회차 목록·저장·복사·상태 변경 API를 캡슐화한다. | `pnpm --filter seller exec tsc --noEmit` | 통과 — `useSession`의 `storeId`·`accessToken`과 기존 `apiJson`을 재사용해 셀러 회차 목록·상세·생성·저장·복사·상태 변경·완료 API를 하나의 훅 경계로 캡슐화했다. 조회와 작업의 로딩·오류를 분리하고 늦은 목록 응답을 폐기하며, mutation 성공 응답을 검증해 즉시 반영한 뒤 서버 목록을 재조회한다. 인증 누락·손상 응답은 빈 회차나 성공으로 승격하지 않았고 seller 타입검사, 전체 typecheck·build, Biome 오류 수준 검사, 셀러 12개·소비자 24개 Playwright 목록 수집과 diff 검사가 통과했다. 별도 테스트 파일이나 Task 5.3 화면은 추가하지 않았다. | done |
| 5.3 | 5.2 | `apps/seller/src/app/sale-rounds/page.tsx` | 회차 상태·주문·수량·한도와 이전 회차 복사를 제공한다. | `pnpm --filter seller exec tsc --noEmit` | 통과 — Task 5.2 `useSaleRounds`만 API 경계로 사용해 작성 중·판매 예정·판매 중·주문 마감·배송 완료와 취소 상태, 주문 배송지·판매 수량·각 한도, 결제 진행 중 확보량, 배송 보류와 회차 취소 확인 필요를 서버 응답 범위에서 표시했다. 로딩·오류·빈 상태와 명시적 재조회, KST 주문 기간을 제공하고, 이전 회차 복사는 이름·주문 시작·마감만 받아 기존 경매·배송 간격과 상품·가격·한도를 보존하도록 훅에 위임했다. Task 5.1의 6개 fixture·12개 `test.fixme`는 변경하지 않았고 Task 5.4 편집 폼과 별도 인접 테스트는 추가하지 않았다. seller 타입검사, 전체 typecheck·build, 대상 Biome 오류 수준 검사, 셀러 12개·소비자 24개 Playwright 목록 수집과 diff 검사가 통과했으며 build 생성물 5개는 시작 상태로 되돌려 제외했다. | done |
| 5.4 | 5.3 | `apps/seller/src/app/sale-rounds/[id]/RoundForm.tsx` | 한 화면에서 일정·지역·한도·상품·가격·당근 링크를 편집한다. | `pnpm --filter seller exec tsc --noEmit` | 통과 — 검증된 회차·상품·당근 링크와 저장 callback만 props로 받는 `RoundForm` 경계를 구현했다. `Asia/Seoul` 로컬 입력을 ISO8601로 변환해 주문 시작 < 주문 마감 <= 경매 시각 <= 배송 시작 < 배송 종료를 검증하고, 배송 지역 활성 상태, 양의 배송지·판매 수량 한도, 중복 없는 상품, 양의 회차 가격·상품별 한도와 0 이상 노출 순서를 한 화면에서 편집한다. 새 상품의 회차 값은 빈 입력으로 두며 검증 전 기본 성공값으로 승격하지 않고, 유일한 검증 식별자에 대응하는 http(s) 당근 대표·상품 링크만 복사하며 성공·실패를 명시한다. 500줄 제한을 위해 순수 검증과 표시 섹션을 인접 모듈로 분리했고 핵심 검증 테스트 9개를 추가했다. seller 타입검사, 전체 typecheck·build, 대상 Biome 오류 수준 검사, 셀러 12개·소비자 24개 Playwright 목록 수집과 diff 검사가 통과했다. Task 5.5 라우트·조회·저장·상태 변경 연결은 시작하지 않았다. | done |
| 5.5 | 5.4 | `apps/seller/src/app/sale-rounds/[id]/page.tsx` | 회차 조회·저장·상태 변경을 RoundForm에 연결하는 라우트를 제공한다. | `pnpm --filter seller exec tsc --noEmit` | 통과 — Next.js 16 비동기 `params`를 `use()`로 읽고 안전한 단일 회차 ID만 `getRound`에 전달하며, 검증된 상세 회차와 현재 스토어 상품만 `RoundForm`에 연결했다. 저장은 `saveRound`의 검증 성공 뒤에만 완료되고, 작성 중 예약·판매 중 수동 마감·마감 회차 완료를 현재 상태에만 노출해 확인 모달 뒤 `changeStatus`·`completeRound`로 실행한다. 실패 시 기존 회차를 성공 상태로 바꾸지 않고 오류와 재조회를 제공하며 배송 보류·취소 실패 응답 범위에서만 확인 필요 건수를 계산한다. 당근 링크는 안전한 회차·상품 식별자와 `https://greenlove.co.kr` 기준으로만 구성하고 손상 URL·제어문자·중복 식별자를 거부한다. 이 경계를 검증하기 위해 `page.logic.ts`와 Vitest 15개를 최소 인접 추가했으며 seller 타입검사, 전체 typecheck·build, 변경 파일 Biome 오류 수준 검사, 셀러 12개·소비자 24개 Playwright 목록 수집과 `git diff --check`가 통과했다. build 생성물 5개는 시작 상태로 되돌려 제외했다. | done |
| 5.6 | 5.5 | `apps/seller/src/components/BottomNav.tsx` | 주문·회차·상품·준비·설정을 주요 메뉴로 둔다. | `pnpm --filter seller exec tsc --noEmit` | 통과 — 셀러 하단 메뉴를 주문·회차·상품·준비·설정 순서와 `/orders`, `/sale-rounds`, `/products`, `/prep`, `/settings` 경로로 고정하고 정산을 주요 메뉴에서만 제거했다. 경로 세그먼트 경계 판정으로 회차 목록과 상세에서 회차만 활성화하며 현재 페이지에 `aria-current`를 제공한다. 기존 `/login`·`/onboarding` 숨김, safe-area 포함 64px 높이와 480px 최대 폭은 그대로 보존했다. Task 5.1의 Playwright 화면 계약이 아직 `test.fixme`이므로 메뉴 순서·경로와 회차 목록·상세 활성 판정을 실행 가능한 인접 Vitest 4개로 최소 고정했다. seller 타입검사, 전체 typecheck·build, 변경 파일 Biome 오류 수준 검사, 셀러 12개·소비자 24개 Playwright 목록 수집과 `git diff --check`가 통과했으며 build 생성물 5개는 시작 상태로 되돌려 제외했다. 설정·주문·드라이버 화면과 기존 정산·배송·거점 기능은 변경하지 않았다. | done |
| 5.7 | 5.6 | `apps/seller/src/app/settings/page.tsx` | 정산·기존 배송·거점 관리 접근을 설정 화면에 유지한다. | `pnpm --filter seller exec tsc --noEmit` | 통과 — 설정 화면에 `/settlements` 정산 관리 접근을 추가하고 기존 `/settings/delivery`, `/settings/daily-caps`, `/hubs` 접근을 운영 메뉴 정본으로 함께 고정했다. 기존 계정·관리자·정보 섹션과 Task 5.6 하단 메뉴를 보존했으며, 최소 인접 Vitest 1개와 seller 타입검사, 전체 typecheck·build, 변경 파일 Biome 오류 수준 검사, 셀러 12개·소비자 24개 Playwright 목록 수집과 `git diff --check`가 통과했다. build 생성물 5개는 시작 상태로 되돌려 제외했다. | done |
| 5.8 | 5.7 | `apps/seller/src/app/orders/page.tsx` | 배송 보류와 확인 필요 건수를 업무 우선순위로 표시한다. | `pnpm --filter seller exec tsc --noEmit` | 통과 — 선택한 일반 주문·공동구매 범위에서 `DELIVERY_HELD`를 배송 보류로 별도 집계하고 기존 `STATUS_GROUP_MAP`의 `ACTION_REQUIRED` 전체를 확인 필요 건수로 표시했다. 두 우선순위 항목은 기존 확인 필요 탭으로 진입하며 날짜 필터·상태 탭·주문 카드 접근을 유지했다. `DELIVERY_HELD`가 `ACTION_REQUIRED`에도 포함되는 기존 중첩 의미와 다른 상태를 임의 승격하지 않는 계약을 인접 Vitest 2개로 최소 고정했다. seller 타입검사, 전체 typecheck·build, 변경 파일 Biome 오류 수준 검사, 셀러 12개·소비자 24개 Playwright 목록 수집과 `git diff --check`가 통과했으며 build 생성물 5개는 시작 상태로 되돌려 제외했다. Task 5.9 주문 상세 조치는 시작하지 않았다. | done |
| 5.9 | 5.8 | `apps/seller/src/app/orders/[id]/page.tsx` | 새 일정·재배송비·연락 기록·환불 재시도·분쟁 기록 조치를 제공한다. | `pnpm --filter seller exec tsc --noEmit` | 통과 — 주문 상세에 서버 `deliveryHold` 스냅샷의 보류 사유·고객 책임·재배송비·다음 연락·새 배송 일정을 표시하고, 인증된 `operationIssues` 목록을 현재 스토어·주문으로 검증해 연락·환불·재배송 분쟁 상태와 성공·실패 감사 기록을 제공했다. 열린 `AUTO_REFUND_FAILED`에는 `RETRY_REFUND`, 열린 `CUSTOMER_NOTICE_FAILED`에는 `RESEND_SMS`만 연결하고 실행 직전 `refresh`로 최신 주문·결제 상태와 허용 조치를 재확인한 뒤 서버 action API를 호출한다. 조치 실패 뒤 상세를 다시 읽어 서버 감사 기록을 반영하며 결제 조회·재배송 실패·해결 항목, 주문자 전용 재배송비 생성, 법정 분쟁 원문은 클라이언트 조치로 추정하지 않는다. 응답 판독과 허용 조치 경계를 테스트하기 위해 순수 로직·Vitest 3개와 API 상태를 캡슐화하는 훅·표시 구성요소를 최소 인접 추가했다. seller 타입검사, 전체 typecheck·build, 대상 Biome 오류 수준 검사, 인접 Vitest 5개, 셀러 12개·소비자 24개 Playwright 목록 수집과 `git diff --check`가 통과했으며 build 생성물 5개는 시작 상태로 되돌려 제외했다. 기존 준비·택배 발송·강제 취소·읽기 전용 흐름과 Task 5.8 목록 계약은 보존했다. | done |
| 5.10 | 5.9 | `apps/e2e/tests/driver-direct-delivery.spec.ts` | 배송 시작·보류·사진 완료 계약을 먼저 수집한다. | `pnpm --filter e2e exec playwright test driver-direct-delivery --list` | 통과 — 직접배송만 보드에 노출, 준비 주문의 배송 시작, 기상·출입·주소·연락 실패 보류와 고객 책임·재배송비·다음 연락·새 배송 일정, 사진 없는 직접 완료 차단과 촬영 전 완료 비활성화를 서로 분리된 주문 fixture 9개와 논리 계약 7개로 수집했다. 실제 seed와 Task 5.11·5.12 화면이 준비되지 않아 모두 `test.fixme`로 유지했으며 chromium·mobile 14개 목록, 기존 셀러 12개·소비자 24개 목록, 전체 typecheck·build, 대상 Biome 오류 수준 검사와 `git diff --check`가 통과했다. build 생성물 5개는 시작 상태로 되돌려 제외했고 드라이버·API·공유 타입 구현은 변경하지 않았다. | done |
| 5.11 | 5.10 | `apps/driver/src/app/board/[orderId]/page.tsx` | 직접배송 완료 전에 사진 촬영을 요구하고 보류 사유를 기록한다. | `pnpm --filter driver exec tsc --noEmit` | 통과 — `schemaVersion: 2` 회차 직배송 주문만 구분해 `PREPARING → DELIVERING` 시작과 `PREPARING\|DELIVERING → DELIVERY_HELD` 보류 저장을 연결했다. 기상·출입·주소·연락 실패를 서버 DTO 코드로 전송하고 책임·재배송비·다음 연락·새 배송 일정을 서버 Firestore 스냅샷 그대로 표시한다. 기상은 고객 책임 `false`·재배송비 `null`·새 배송 예정 필수로 고정했으며, 응답 주문 ID·상태를 검증하기 전 성공 처리하지 않는다. 회차 직배송의 사진 없는 완료 버튼과 아직 안전하지 않은 기존 사진 화면 진입은 제공하지 않았으며 사진 업로드 구현은 시작하지 않았다. 500줄 제한을 위해 보류 모달을 인접 구성요소로 분리했다. driver 타입검사, 전체 typecheck·build, 드라이버 14개·셀러 12개·소비자 24개 Playwright 목록, 변경 파일 Biome 오류 수준 검사와 diff 검사가 통과했다. | done |
| 5.12 | 5.11 | `apps/driver/src/app/board/[orderId]/photo/page.tsx` | 클라이언트 Storage 직접 업로드를 서버 비공개 업로드로 교체한다. | `pnpm --filter driver exec tsc --noEmit` | 통과 — JWT 인증 multipart API가 실제 JPEG와 5MB 제한, 회차 직배송·스토어·담당 기사·배송 중 상태를 서버에서 확인하고 요청 키 기반 단일 사진 ID를 비공개 경로에 저장한다. 업로드 성공 뒤 사진 ID와 90일 보관 기록을 주문 트랜잭션에 연결한 다음에만 기존 상태 수명주기로 배송을 완료하며, 같은 요청 재시도는 사진·완료를 중복 생성하지 않는다. 본인 주문자·스토어 소유자·담당 기사·관리자만 연결 사진의 15분 V4 서명 URL을 받을 수 있고 회차 주문에는 공개 URL을 저장하지 않는다. API 사진 계약 21개, driver 타입검사, API·전체 build, 전체 typecheck, Playwright 목록 50개, 대상 Biome 오류 수준 검사와 diff 검사가 통과했다. | done |

### Phase 6. 보안 규칙·통합 검증·출시
| Task | Dependency | Target | Goal | Verify | Conclusion | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 6.1 | 5.12 | `firestore.indexes.json` | 회차 공개 조회·만료 예약·보관 파기·운영 예외 쿼리 인덱스를 추가한다. | `pnpm --filter api build` | 통과 — 앱 런타임의 실제 Firestore 쿼리를 전수 대조해 단일 필드·동등 조건 인덱스 병합으로 충족되는 회차·예약 직접 조회·보관 만료·운영 예외·주문 목록에는 새 복합 인덱스를 만들지 않았다. 실제 범위·정렬 쿼리에서 빠진 `users(role, createdAt DESC)`, `orders(status, createdAt DESC)`, `orders(status, deliveryMethod, preparedAt ASC)`, `varieties(subCategory, name ASC)` 4개만 추가했다. 호출부와 JSON을 함께 검사하고 누락·필드·방향·범위·중복을 검출하는 계약 23개, 관련 API 회귀 128개, API·전체 빌드, 타입 검사, JSON 파싱과 Biome 검사가 통과했다. Firebase CLI 15.18.0은 확인했지만 JDK 21 이상 요구에 비해 현재 JDK 17이라 에뮬레이터는 실행되지 않았다. | done |
| 6.2 | 6.1 | `firestore.rules` | 회차 쓰기·예약·법정 기록·운영 예외의 클라이언트 직접 접근을 차단한다. | `pnpm --filter api build` | 통과 — API와 클라이언트 호출부 감사 결과 `checkoutReservations`, `operationIssues`, 법정·마케팅·배송 사진 보관 기록 4종, `notificationDeliveries`는 Admin SDK 서버 경로만 사용하므로 직접 읽기·쓰기를 명시적으로 차단했다. `saleRounds`는 공개 상태로 제한하고 `saleRoundItems` 목록은 `roundId + storeId` 조건과 공개 부모 회차를 모두 요구하며 모든 클라이언트 쓰기를 차단했다. 소비자 상품 상세가 직접 조회하는 공개 `varieties`는 단건 `get`만 허용하고 목록과 쓰기를 거부했다. Temurin 21.0.11을 사용자 전용으로 적용한 실제 Firestore Emulator 계약 14개, 관련 API 90개, 전체 타입 검사와 build, Biome 및 공백 검사가 통과했다. | done |
| 6.3 | 6.2 | `storage.rules` | 배송 사진 직접 접근 차단과 기존 공개 상품 이미지 규칙을 함께 검증한다. | `pnpm --filter api build` | [판정 대기 — Storage 경계] | todo |
| 6.4 | 6.3 | `apps/api/test/mvp-sales-round.e2e-spec.ts` | 회차 개설부터 결제·보류·재배송·파기까지 서버 통합 계약을 검증한다. | `pnpm --filter api test:e2e -- mvp-sales-round.e2e-spec.ts --runInBand` | [판정 대기 — API 통합] | todo |
| 6.5 | 6.4 | `scripts/enable-dear-orchid-round-direct.mjs` | 대상 storeId·현재 모드·확인 플래그를 검사한 뒤 판매 모드를 전환한다. | `node scripts/enable-dear-orchid-round-direct.mjs --dry-run` | [판정 대기 — 전환 준비] | todo |
| 6.6 | 6.5 | `docs/specs/ops/mvp-sales-round-runbook.md` | 주간 운영·장애 대응·롤백·수동 환불 절차를 운영 문서로 고정한다. | `git diff --check -- docs/specs/ops/mvp-sales-round-runbook.md` | [판정 대기 — 운영 런북] | todo |
| 6.7 | 6.6 | `apps/e2e/tests/consumer-round-direct.spec.ts` | 소비자·셀러·드라이버 핵심 흐름을 실행해 화면 계약을 닫는다. | `pnpm --filter e2e exec playwright test consumer-round-direct seller-sale-rounds driver-direct-delivery --reporter=list` | [판정 대기 — 전체 사용자 흐름] | todo |
| 6.8 | 6.7 | `docs/plans/PLAN_mvp_sales_round_direct_delivery.md` | 전체 빌드·테스트 결과와 잔여 위험을 Closeout에 기록한다. | `pnpm build` | [판정 대기 — 최종 빌드] | todo |

## 출시 순서
1. `salesMode` 기본값을 `legacy`로 둔 채 회차 API와 셀러 화면을 배포한다.
2. 테스트 회차를 생성해 공개 조회, 예약, 결제, 보류, 사진, 파기를 비운영 데이터로 검증한다.
3. 디어오키드 회차를 `SCHEDULED`로 준비하고 당근 대표·상품 링크를 사전 확인한다.
4. 소비자·셀러·드라이버 통합 검증이 통과한 뒤에만 디어오키드 `salesMode`를 `round_direct`로 전환한다.
5. 첫 2개 회차는 배송지 15곳·호접란 30개 한도를 유지하며 확인 필요 목록을 매일 점검한다.

## 롤백
- 소비자 장애 시 디어오키드 `salesMode`를 `legacy`로 되돌려 신규 회차 주문 진입을 막는다.
- 이미 결제된 회차 주문은 모드와 무관하게 셀러·드라이버앱에서 계속 처리한다.
- 결제 상태가 불명확하면 주문을 임의 취소하지 않고 포트원 재조회와 `확인 필요` 절차를 따른다.
- 회차 데이터와 신규 주문은 삭제하지 않으며 원인 수정 후 다시 `round_direct`를 활성화한다.

## 완료 기준
- 모든 Task의 Status가 `done`이고 Conclusion에 실제 검증 결과가 기록되어 있다.
- 기존 주문 조회와 legacy 주문 생성 회귀 테스트가 통과한다.
- 회차 한도 경쟁, 늦은 결제, 중복 웹훅, 알림 실패, 배송 보류, 사진 권한 테스트가 통과한다.
- 디어오키드 고객 화면에서 택배·거점픽업·공동구매·외부 셀러 진입점이 보이지 않는다.
- 대표자는 월요일 매입과 화요일 배송을 셀러·드라이버앱만으로 마칠 수 있다.
- `docs/memory.md`, `docs/CRITICAL_LOGIC.md`, 구현 파일의 라인 제한을 준수한다.

## Closeout Roll-up
- **Status**: Task 6.2 `done`, Task 6.3 `todo`
- **Task 4.2 복귀 조건**: 충족. 결제·예약·환불, 주문·웹훅 권한, 주문·회차 취소, 주문 생성 멱등, 재배송비, 알림, 운영 예외, 보관·Storage 입력 계약을 Unit 1~9에서 보정했고 Unit 10에서 실제 도메인 서비스 통합 E2E와 전체 회귀 검증으로 확정했다.
- **Task 4.2 결과**: 공개 목록과 회차별 상세를 병렬 조회해 회차 상품을 포함한 전체 회차, 현재 회차 하나, 최신순 지난 회차를 제공한다. 기존 소비자 데이터 접근 방식의 문자열 오류와 `loading` 불리언을 유지하면서 명시적 `error`, `empty`, `success` 상태와 재조회를 추가했고 요청 식별자로 스토어 전환·재조회 경쟁의 늦은 응답을 폐기한다.
- **Task 4.3 결과**: `utm_source=carrot|daangn|당근` 유입만 탭 세션에 보관하고 새 당근 유입 전까지 유지한다. 캠페인·콘텐츠는 길이와 안전 문자 집합을 제한하며 도착 URL은 `http(s)`와 `round` 쿼리만 허용한다. 주문용 조회는 저장값을 다시 검증해 `source`, `campaign`, `content`, `landingUrl`, `capturedAt`만 새 객체로 반환하고 잘못된 값은 폐기한다. 화면·주문 호출부 연결은 후속 Task로 남겼다.
- **Task 4.4 결과**: 공개 상품 응답의 단일 `storeId`로 대상 스토어를 발견하고 공개 스토어 문서의 `salesMode`가 `round_direct`일 때만 회차 홈을 표시한다. 현재·지난 회차는 `useSaleRounds` 결과를 그대로 사용하고 현재 회차, 주문 마감, 경기도 이천시 직접배송, 화요일 오전 9시 배송 약속, 지난 회차 순서와 회차 가격 카드를 제공한다. 상품 링크는 `productId`와 `roundId`를 함께 보존하며 홈 진입의 `captureAcquisition`은 client effect에서 실행한다. legacy·여러 스토어·판매 모드 조회 실패는 기존 UI 보존 또는 명시적 상태로 닫는다.
- **Task 4.5 결과**: 공개 상품에서 단일 스토어를 발견한 뒤 공개 `salesMode`가 `round_direct`일 때만 회차 상품 화면을 사용한다. `useSaleRounds`가 판정한 현재 회차와 최신순 지난 회차의 항목을 공개 상품과 결합해 `category: orchid`, 활성 상태, 같은 스토어 조건을 만족하고 회차에서 숨김 처리되지 않은 상품만 표시한다. 카드에는 회차 구분과 회차 가격을 표시하고 `/products/{productId}?round={roundId}` 링크를 사용한다. 판매 모드·회차의 로딩·오류·빈 상태를 명시하며 legacy 탭·색상·상품 목록 흐름은 보존한다.
- **Task 4.6 결과**: 공개 상품의 단일 `storeId`와 공개 스토어 `salesMode`로 하단 내비게이션을 분기한다. `round_direct`에는 홈·상품·장바구니·MY 네 항목만 표시하고 상품은 `/category`로 연결한다. 확인된 legacy에는 기존 홈·카테고리·공구·장바구니·MY와 장바구니 배지·숨김 경로를 보존하며, 공개 상품·판매 모드 판정 중이나 조회 오류에는 내비게이션을 숨긴다.
- **Task 4.7 결과**: 전체 공개 상품의 단일 `storeId`와 공개 스토어 `salesMode`를 판정해 `round_direct`의 `/groupbuy` 직접 진입을 `router.replace('/')`로 홈에 돌린다. 판정 로딩·조회 오류·홈 이동 중에는 공동구매 화면을 렌더링하지 않으며, 확인된 legacy에서만 기존 공동구매 상품 조회와 모집 중·완료·빈·오류 화면을 그대로 표시한다.
- **Task 4.8 결과**: Next.js Client Page의 Promise `params`·`searchParams`를 `use()`로 읽고 `round`가 단일 문자열이며 공백·제어문자·경로 문자가 없고 128자 이하일 때만 사용한다. 공개 상품 API의 상품과 `storeId`, 공개 스토어 `salesMode`, `useSaleRounds`의 현재·지난 회차를 순서대로 확인하고 회차·항목·상품·스토어 관계가 하나로 일치할 때만 현재 또는 마감 `RoundProduct`와 구매 가능 여부를 상세 경계에 전달한다. 판매 모드와 회차 판정 전에는 로딩 경계를 유지하고 잘못되거나 다른 스토어인 회차에는 임의 기본값·외부 이동을 만들지 않으며, 확인된 legacy에는 기존 이미지·정보·구매 동작을 보존한다.
- **Task 4.9 결과**: `RoundPurchasePanel`은 Task 4.8이 검증한 `round`, `item`, `state`, `isPurchasable`만 받아 별도 조회나 임의 기본 회차 없이 표시한다. `SaleRoundItem.roundPrice`를 결제 기준 회차 가격으로, `schedule.orderCloseAt`을 `Asia/Seoul` 한국시간 주문 마감으로 표시하고 경기도 이천시 직접배송·화요일 오전 9시 문 앞 배송·기상 연기 시 재배송비 없는 새 일정·주문 마감 후 생화 가치 감소 조건과 계약 불이행 예외를 포함한 청약철회 제한을 고지한다. 현재·마감은 제목·배지·테두리로 구분하고 구매 불가 상태에는 판매 마감 또는 판매 예정만 표시한다.
- **Task 4.10 결과**: `ProductActions`는 검증된 `roundProduct.item`, `state`, `isPurchasable`을 받는 회차 전용 구성요소와 기존 legacy 구성요소를 명시적으로 분리한다. 회차 전용 동작은 `SaleRoundItem.roundPrice`, `deliveryMethod: direct`, 일반 판매 의미만 사용하고 택배·거점픽업·공동구매·배송 희망일 선택을 렌더링하지 않는다. 장바구니 담기와 바로 구매는 `isPurchasable`이 거짓이면 버튼·핸들러 양쪽에서 차단하며 현재·마감 문구는 Task 4.9 패널의 계약을 유지한다. Task 4.11의 `roundId`·회차 상품 ID 장바구니 모델과 후속 결제·주문 요청 연결은 추가하지 않았다.
- **Task 4.11 결과**: `useCart`는 기존 CartItem 필드를 보존하면서 회차 항목에만 `roundId`, `roundItemId`, `roundPrice`를 저장한다. 세 회차 필드와 기존 `price`의 일치를 런타임에서 확인하고 완전한 계약만 회차 항목으로 복원하며, 동일 항목은 `roundId + roundItemId + productId`로 판정한다. 같은 회차 항목만 함께 담고 다른 회차 또는 legacy/회차 혼합은 기존 배열을 유지한 실패 결과로 거부한다. 회차 구매 호출부는 Task 4.8의 검증된 `SaleRoundItem`을 그대로 전달하고 충돌 사유를 사용자에게 알리며, `isPurchasable=false` 차단과 legacy 저장값 호환을 유지한다.
- **Task 4.12 결과**: `cart/page.tsx`는 Task 4.11의 `CartItem`, `RoundCartItem`, `isRoundCartItem`을 그대로 사용한다. 인증된 기존 `validate-cart` API에 각 회차 항목을 보내 서버 회차 상태·가격·상품 수량을 확인하고, 개별 통과 후보가 여러 개면 다시 함께 검증해 회차 전체 수량 한도와 합계를 확인한다. 가격 변경·마감·품절·구매 불가·응답 손상·네트워크 실패 항목은 장바구니에서 삭제하지 않고 사유와 결제 제외 상태를 표시한다. 서버 가격·식별자·수량·합계가 모두 일치한 같은 회차 항목만 `checkout_cart`에 저장하며 legacy CartItem은 기존 결제 흐름을 유지한다.
- **Task 4.13 결과**: `usePayment`는 기존 `CreateOrderRequest` 단일 상품 호출과 별도로 Task 4.12의 검증 통과 `RoundCartItem[]` 입력을 받는다. 회차 입력은 같은 `roundId`·스토어·직배송·일반 판매 관계, 양의 수량·안전한 금액과 중복 회차 상품 부재를 확인하고 `roundId`와 전체 `roundItems`를 주문 API 한 번에 전송한다. 주문 응답의 `orderId`를 유일한 PortOne `paymentId`로 사용하고 응답 이름·금액·식별자 및 회차 합계를 검증한 뒤 SDK를 한 번만 호출한다. 동시 클릭은 즉시 차단하며 네트워크 오류 재시도에는 훅 수명 동안 같은 `clientOrderRequestId`를 재사용한다.
- **Task 4.14 결과**: `checkout/page.tsx`는 Task 4.12가 저장한 `checkout_cart`를 `parseCartSnapshot`과 `isRoundCartItem`으로 다시 확인하고 빈 배열·손상 값·불완전 회차 metadata·다른 회차·다른 스토어·legacy 혼합을 결제 입력으로 승격하지 않는다. 공개 회차 정본에서 같은 `roundId`·스토어·회차 상품·상품·회차 가격 관계를 확인하고 `schedule.timezone`이 `Asia/Seoul`이며 배송 시작·종료가 같은 한국 날짜일 때만 서버 DTO 필수 `requestedDeliveryDate`를 만든다. 이 배열 전체를 Task 4.13 `usePayment`에 전달해 주문 API 한 번과 PortOne 결제 한 번으로 처리하고, `done`과 단일 `orderId` 확인 후에만 `checkout_cart`를 삭제해 성공 화면으로 이동한다. 단일 상품과 legacy 장바구니 결제 계약은 분리 보존했다.
- **Task 4.15 결과**: `CheckoutForm.tsx`는 회차 항목을 기존 단일 상품·legacy checkout과 분리해 배송 연락처와 정보성 주문 안내 목적을 표시하고, 서버와 같은 주소 선두 행정구역 경계로 경기도 이천시 주소만 결제 가능하게 한다. 경기도 이천시 직접배송·화요일 오전 9시·기상 연기 시 무상 새 일정·상품 가치 감소에 따른 청약철회 제한과 계약 불이행 예외를 필수 고지한다. 카카오톡·문자 마케팅 동의는 기본 해제된 별도 선택값이며, 동의한 경우에만 고정된 동의 시각·문구 버전·채널을 회차 주문에 전달한다. 상품·수량·회차 가격 요약이 바뀌면 결제 직전 확인을 다시 해제하고, 이천 주소와 변경 확인이 모두 충족되기 전에는 결제 호출을 막는다. Task 4.14의 한 주문·한 PortOne 결제와 완료 후 `checkout_cart` 삭제 계약, 기존 단일 상품과 legacy 장바구니 계약은 유지했다.
- **Task 4.16 결과**: `order/success/page.tsx`는 URL의 `orderId`를 단일 안전 식별자로 제한하고, 서버 주문 응답의 `id`·성공 상태·`schemaVersion: 2`·`roundId`·회차 주문번호·직배송·다중 `orderItems`·소계와 주문 합계가 모두 일치할 때만 회차 성공 화면을 표시한다. 상품명·수량·항목 소계·총수량·결제 금액은 인증된 `/orders/:orderId` 응답만 사용하며 화요일 오전 9시까지 이천시 문 앞 배송 약속을 함께 고지한다. 누락·중복·위험한 `orderId`, 요청 ID와 다른 응답, 빈 상품·중복 회차 상품·금액 불일치는 오류 상태로 닫고, 기존 단일 상품·legacy 주문번호 폴백과 공동구매 모집 안내는 유지했다.
- **Task 4.17 결과**: `mypage/_client.tsx`는 인증된 주문 목록 응답의 정규화된 `orderItems`를 검사해 첫 상품명을 대표명으로, 나머지 항목 수를 `외 N개`로 표시하고 같은 배열에서 상품 종류와 총수량을 계산한다. 빈 배열·잘못된 상품 식별자·상품명·수량·중복 항목은 요약으로 승격하지 않으며 최상위 `productName`을 폴백으로 사용하지 않는다. 단일 legacy 정규화 배열은 상품명과 기존 배송 방식·수량·금액을 함께 유지하고, `DELIVERY_HELD`는 `배송 보류` 위험 배지와 강조선으로 명확히 표시한다.
- **Task 4.18 결과**: `mypage/orders/[id]/_client.tsx`는 안전한 주문 ID와 인증된 주문 상세 응답을 페이지 전용 판독기로 검증한다. 회차 주문은 `schemaVersion: 2`·회차 주문번호·직배송·다중 `orderItems`의 식별자·수량·항목 소계·주문 합계가 모두 일치해야 하며, 손상 응답은 임의 상품·상태·동작으로 승격하지 않는다. 배송 보류는 `DELIVERY_HELD`일 때의 서버 `deliveryHold`만 표시하고 고객 책임의 양수 재배송비만 서버 청구 응답 검증 뒤 PortOne 카카오페이로 요청한다. 배송 완료 사진은 인증·소유권 검증을 거친 주문 응답의 HTTPS `deliveryPhotoUrl`만 사용하며 Firebase Storage 직접 접근과 업로드를 추가하지 않았다. 마감 전 취소는 서버가 회차 마감을 최종 재검증하는 기존 취소 API만 호출하고, legacy 단일 상품·공동구매·거점픽업·구매 확정 흐름은 유지했다.
- **Task 4.19 결과**: `mypage/notifications/settings/page.tsx`는 소비자 세션 값을 동의 상태로 사용하지 않고 인증된 `GET /auth/me`의 `notificationPreferences`를 새로 조회한다. `alimtalk`와 `sms`가 모두 엄격한 boolean일 때만 서버 현재 상태를 표시하며, 동의된 채널의 즉시 철회는 확인된 `PATCH /notifications/me/preferences`에 해당 채널의 `false`만 전송한다. 성공 응답의 두 채널 boolean과 요청 채널의 `false`를 모두 검증한 뒤에만 화면을 서버 상태로 바꾸고, 실패·손상 응답에서는 기존 상태를 유지한다. 주문·결제·배송 정보성 연락은 선택 마케팅과 분리해 안내하며 클라이언트가 동의 증거·보관 기록이나 저장소에 직접 접근하지 않는다.
- **검증 결과**: Task 4.19 전용 Node 테스트 5개와 Task 4.8 상세 5개, Task 4.9 패널 6개, Task 4.10 구매 동작 5개, Task 4.11 장바구니 9개, Task 4.12 서버 재검증 8개, Task 4.13 결제 훅 6개, Task 4.14 checkout 5개, Task 4.15 CheckoutForm 6개, Task 4.16 주문 완료 5개, Task 4.17 MY 목록 4개, Task 4.18 MY 상세 5개 등 Node 테스트 69개, consumer 타입검사, 전체 typecheck와 build, Playwright chromium·mobile 24개 목록 수집, 변경 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다. 전체 build가 갱신한 tracked 생성물 5개는 시작 HEAD 상태로 복원해 범위에서 제외했다.
- **Task 5.1 결과**: 셀러 회차 복사·예약·마감·완료 거부·정상 완료·확인 필요 진입을 상호 배타적인 6개 fixture로 분리하고, 실제 `/sale-rounds` 화면과 seed가 아직 없으므로 모두 `test.fixme`로 수집했다. chromium·mobile 12개 셀러 목록과 기존 소비자 24개 목록, 전체 typecheck·build, 대상 Biome 오류 수준 검사와 `git diff --check`가 통과했으며 build 생성물 5개는 시작 상태와 비교해 범위에서 제외했다.
- **Task 5.2 결과**: 셀러 세션의 스토어·토큰과 `apiJson`을 사용해 목록·상세·생성·저장·복사·상태 변경·완료를 한 훅에 모았다. 목록과 작업 상태를 분리하고 요청 경쟁을 막으며 mutation 응답의 스토어·회차·일정·한도·항목 계약을 확인한 뒤 즉시 반영하고 재조회한다. seller 타입검사, 전체 typecheck·build, 대상 Biome 검사, 셀러 12개·소비자 24개 Playwright 목록 수집과 diff 검사가 통과했고 build 생성물 5개는 시작 상태로 되돌려 제외했다.
- **Task 5.3 결과**: 셀러 회차 목록은 Task 5.2 훅이 검증한 회차만 사용해 상태·KST 주문 기간·배송 지역·주문 배송지·판매 수량·한도·임시 확보·배송 보류를 표시한다. 서버가 제공한 보류·취소 실패에만 확인 필요 진입을 노출하고, 로딩·오류·빈 상태·재조회를 분리했다. 이전 회차 복사는 이름과 주문 시작·마감만 입력받고 기존 마감 이후 경매·배송 간격을 유지해 `copyRound`에 전달하며 Task 5.4 전체 편집은 시작하지 않았다. 별도 인접 테스트는 Task 5.1의 기존 12개 `test.fixme` 화면 계약과 중복돼 추가하지 않았다.
- **Task 5.4 결과**: `RoundForm`은 검증된 회차·상품·당근 링크와 저장 callback만 받고 API·raw fetch·라우트 조회를 수행하지 않는다. Asia/Seoul 일정 순서, 배송 지역 활성 상태, 양의 회차·상품 한도, 중복 없는 상품과 노출 순서를 저장 전에 검증하며 새 상품 값은 사용자가 명시할 때까지 빈 상태로 유지한다. 유일한 상품 식별자에 연결된 http(s) 링크만 복사하고 성공·실패를 알리며, 핵심 검증 9개와 필수 전체 검증이 통과했다. 500줄 제한과 검증 가능성을 위해 `RoundForm.logic.ts`, `RoundForm.sections.tsx`, `RoundForm.test.ts`를 최소 인접 범위로 추가했다.
- **Task 5.5 결과**: Next.js 16 비동기 동적 `params`에서 안전한 회차 ID만 읽고 `getRound` 상세와 `useStoreProducts` 현재 스토어 상품을 검증해 `RoundForm`에 전달한다. 저장은 `saveRound` 검증 성공 뒤에만 완료되며 작성 중 예약, 판매 중 수동 마감, 마감 회차 완료는 현재 상태에서만 확인 모달을 거쳐 `changeStatus`·`completeRound`로 실행한다. 실패 상태 보존, 명시적 재조회·빈 상태, 서버 응답 범위의 확인 필요 진입을 제공한다. 당근 대표·상품 링크는 안전한 식별자와 `https://greenlove.co.kr` 범위에서만 구성하며 손상 URL·제어문자·중복 상품을 거부한다. 최소 인접 순수 로직 테스트 15개와 필수 전체 검증이 통과했다.
- **Task 5.6 결과**: 셀러 하단 메뉴를 주문·회차·상품·준비·설정 순서로 고정하고 정산을 주요 메뉴에서만 제거했다. `/sale-rounds`와 그 상세 하위 경로는 세그먼트 경계 기반으로 회차만 활성화하며 현재 페이지 접근성 상태를 표시한다. 기존 인증 화면 숨김과 safe-area·높이·모바일 최대 폭은 유지했고, 설정·주문·드라이버 화면과 정산·배송·거점 기능은 변경하지 않았다. 인접 Vitest 4개와 필수 전체 검증이 통과했다.
- **Task 5.7 결과**: 설정 화면에 정산 관리 섹션과 `/settlements` 링크를 추가하고 기존 배송비·기상 제한, 배송 슬롯, 거점 관리 링크를 운영 메뉴 정본으로 묶었다. 계정·관리자·정보 섹션과 하단 메뉴는 변경하지 않았으며 인접 Vitest 1개와 필수 전체 검증이 통과했다.
- **Task 5.8 결과**: 셀러 주문 화면 상단에 선택한 판매 유형 기준 업무 우선순위를 추가했다. `DELIVERY_HELD`는 배송 보류 건수로 별도 강조하면서 기존 `ACTION_REQUIRED` 확인 필요 건수에도 포함하고, 두 항목 모두 기존 확인 필요 탭으로 진입한다. 일반 주문·공동구매 토글, 날짜 필터, 상태 탭, 날짜 그룹과 주문 카드 상세 접근은 유지했다. 기존 상태 중첩 의미를 인접 Vitest 2개로 고정했고 필수 전체 검증이 통과했다.
- **Task 5.9 결과**: 주문 상세는 `deliveryHold`에 기록된 보류 사유·책임·재배송비·다음 연락·새 배송 일정을 그대로 표시하고, 스토어 운영 예외 API의 안전한 응답에서 현재 주문의 연락·환불·재배송 분쟁 상태와 감사 기록만 읽는다. 조치는 열린 자동 환불 실패의 환불 재시도와 열린 고객 안내 실패의 문자 재발송으로 제한하며, 실행 직전 서버 재조회 후 허용 조치가 유지될 때만 action API를 호출한다. 결제 조회·재배송 실패·해결 항목과 법정 분쟁 원문을 임의 조치로 승격하지 않고, 주문자 전용 재배송비 생성도 셀러에서 호출하지 않는다. 판독·허용 조치 순수 로직 Vitest 3개를 최소 추가했고 필수 전체 검증이 통과했다.
- **Task 5.10 결과**: 드라이버 보드의 직접배송 주문 한정 노출, 준비 주문의 배송 시작, 기상·출입·주소·연락 실패별 보류 입력과 책임·비용·후속 일정 표시, 사진 없는 직접 완료 차단을 독립 fixture 9개와 `test.fixme` 논리 계약 7개로 고정했다. 아직 없는 사진 업로드 성공은 추정하지 않고 촬영 전 완료 비활성화까지만 수집했으며 chromium·mobile 14개와 기존 셀러 12개·소비자 24개 목록 및 필수 전체 검증이 통과했다.
- **Task 5.11 결과**: `schemaVersion: 2` 회차 직배송 주문에만 배송 시작·보류 입력을 제공하고 기상·출입·주소·연락 실패를 서버 DTO 정본으로 저장한다. 기상은 판매자 책임·재배송비 없음·새 배송 일정 계약을 강제하고, 서버 응답 검증과 Firestore 스냅샷 반영 전에는 상태를 성공으로 추정하지 않는다. 사진 없는 직접 완료와 아직 안전하지 않은 기존 사진 화면 진입을 모두 제공하지 않았으며 Task 5.12 업로드는 시작하지 않았다. 필수 타입검사·전체 빌드·Playwright 50개 목록·Biome 오류 수준·diff 검사가 통과했다.
- **Task 5.12 결과**: `POST /stores/:storeId/orders/:orderId/delivery-photos`는 JWT 인증과 multipart 5MB 제한을 적용하고 실제 JPEG, `schemaVersion: 2`, 회차·직배송, 스토어, 담당 기사, `DELIVERING` 상태를 서버에서 재검증한다. 요청 키를 해시한 단일 사진 ID를 `deliveryPhotos/{orderId}/{photoId}.jpg`에 비공개 저장하고, 성공 뒤 같은 트랜잭션으로 `deliveryPhotoIds`와 90일 보관 기록을 연결한 다음 기존 주문 수명주기로만 `DELIVERED`를 확정한다. 사진 없는 직접 완료와 공개 URL 연결은 서버에서 거부하며 동일 요청 재시도는 중복 사진·중복 완료를 만들지 않는다. 연결 사진 조회는 주문자 본인·스토어 소유자·담당 기사·관리자에게만 15분 V4 서명 URL을 반환한다. 드라이버 회차 직배송 화면은 `FormData` 서버 업로드 응답의 주문 ID·사진 ID·완료 상태를 검증하고, 기존 거점 흐름은 별도 legacy helper로 의미를 유지했다. API 사진 계약 21개와 필수 전체 검증이 통과했고 build 생성물 5개는 시작 상태로 되돌려 제외했다.
- **Task 6.1 결과**: 실제 앱 쿼리와 공식 Firestore 자동 인덱스·인덱스 병합 규칙을 대조해 범위·정렬 조합에 필요한 복합 인덱스 4개만 추가했다. `saleRounds(storeId + status in)`, 예약 문서 직접 조회, 보관 컬렉션별 `expiresAt` 단일 범위, `operationIssues(storeId)`, 주문 목록 동등 조건, 결제 `orderId` 단일 조건은 자동 인덱스로 충분하다고 판정했다. 실제 호출부와 JSON 정의를 함께 검사하고 누락·필드 누락·방향·queryScope·중복을 검출하는 계약 23개와 관련 회귀 128개, 타입 검사와 전체 build가 통과했다. Firebase 에뮬레이터는 JDK 21 미충족으로 실행하지 못했다.
- **Task 6.2 결과**: 서버 Admin SDK만 사용하는 예약·운영 예외·법정 및 보관 기록·알림 전달 컬렉션 7개의 클라이언트 직접 접근을 명시적으로 차단했다. 공개 상태 회차와 `roundId + storeId`로 제한한 공개 부모 회차 상품만 읽도록 허용하고, 공개 품종은 소비자 상품 상세에 필요한 단건 조회만 허용했다. 인증 없음·일반 사용자·판매자·기사·관리자의 서버 전용 읽기 및 생성·수정·삭제 거부, 공개·비공개 회차 경계, 제한 목록, 품종 단건·목록·쓰기 경계, 기존 공개 데이터와 역할별 주문 읽기를 실제 Firestore Emulator 계약 14개로 검증했다. Temurin 21.0.11을 사용자 전용 경로에서 명령 단위로 적용해 14개가 모두 통과했으며 시스템 기본 JDK 17은 변경하지 않았다.
- **다음 진입점**: Task 6.3 `storage.rules`만 시작할 수 있다. Storage Emulator는 사용자 전용 `C:\Users\tazan\.jdks\temurin-21`을 명령 단위로 사용한다.
- **명시적 후속 위험**: 드라이버 화면 계약 14개, 소비자 화면 계약 24개와 셀러 화면 계약 12개는 실행 데이터와 화면 준비 전이라 계속 `test.fixme`다. 기존 거점 사진은 legacy 경로를 유지하므로 Task 5.12의 회차 비공개 사진 계약으로 승격하지 않았다. Storage 보안 규칙은 Task 6.3, 서버 전체 흐름과 사용자 화면 실행 검증은 Task 6.4·6.7에 남아 있으며 `salesMode` 전환과 운영 배포는 Task 6.5 이후 별도 승인 전에는 수행하지 않는다.
