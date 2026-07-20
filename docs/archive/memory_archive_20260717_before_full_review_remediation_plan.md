# Green Love 프로젝트 메모 (아카이브)

> **SSOT**: 세션 종료 시 최신 상태만 유지한다. 200라인 초과 시 아카이브하고 50라인 이내 요약으로 갱신한다.
> 최신 아카이브: `docs/archive/memory_archive_20260715_before_round_direct_task2.md`

최종 수정: 2026-07-17 (Task 4.1 소비자 회차 직배송 계약 수집 완료)

## 현재 진행

- 브랜치 `codex/mvp-sales-round-direct`, Task 4.1 로컬 변경 검증 완료.
- Task 2.10은 실제 100원 결제·웹훅·늦은 결제·전액 환불까지 완료해 `done`이다.
- Task 2.11은 재배송비 1회 생성과 재실패 운영 예외 전환까지 완료해 `done`이다.
- Task 3.1은 알림톡 재시도·문자 대체·최종 실패 운영 예외의 실패 테스트 계약을 고정해 `done`이다.
- Task 3.2는 알림톡 최대 3회 시도·문자 대체·설정 누락 실패 처리를 구현해 `done`이다.
- Task 3.3은 최종 실패 거래 알림의 멱등 `CUSTOMER_NOTICE_FAILED` 운영 예외를 구현해 `done`이다.
- Task 3.4는 인증 사용자의 `alimtalk`, `sms` 마케팅 동의·철회 검증과 부분 설정 보존 저장을 구현해 `done`이다.
- Task 3.5는 중복 운영 예외 통합·최신 상태 재검증·조치 감사 기록의 실패 테스트 계약을 고정해 `done`이다.
- Task 3.6은 멱등 운영 예외 통합과 최신 상태 기반 환불·문자 조치, 안전한 감사 기록을 구현해 `done`이다.
- Task 3.7은 권한 검증된 운영 예외 목록·상세·재조회와 환불·문자 조치 API를 구현해 `done`이다.
- Task 3.8은 운영 예외 모듈·런타임 라우트 연결과 알림·재배송 생성 경로의 공통 서비스 전환을 구현해 `done`이다.
- Task 3.9는 90일·3년·5년 만료, 분쟁·법적 보존 연장, 미만료 제외와 멱등 파기 실패 테스트 계약을 고정해 `done`이다.
- Task 3.10은 목적별 법정 기록 분리 저장과 Firestore·Storage 만료 파기를 구현해 `done`이다.
- Task 3.11은 `RetentionModule`에 보관 서비스를 등록하고 export해 `done`이다.
- Task 3.12는 비공개 배송 사진 Storage 서비스를 구현해 `done`이다.
- Task 3.13은 `StorageService` provider/export와 보관 삭제 어댑터 주입을 연결해 `done`이다.
- Task 3.14는 회차·운영 예외 등록을 보존하고 누락된 `RetentionModule`만 `AppModule`에 연결해 `done`이다.
- Task 4.1은 소비자 회차 직배송 화면 계약 10개를 외부 호출 없는 `test.fixme`로 수집해 `done`이다.
- 로컬 커밋은 push하지 않았다.

## 환경

- Railway staging API: `https://api-staging-94af.up.railway.app`
- 최종 staging deployment: `187e2ba9-e589-4dff-bee9-21fff9e17f7c`, `SUCCESS`, health 200
- Firebase staging: `green-staging-74557`
- Vercel consumer branch Preview: `dpl_8cyvKwafAaUbytqndvtJL2vKP2Tm`
- Preview callback은 staging 전용 Kakao 앱으로 로그인·세션 생성을 확인했다.
- Vercel Preview CORS 사전 요청은 branch alias origin에 204와 정확한 allow-origin을 반환한다.
- PortOne V2 테스트 채널과 staging webhook만 사용했다.
- 운영 Railway, Vercel Production, Firebase, PortOne, Kakao 설정은 변경하지 않았다.

## Task 2.10 결과

- `1aa56c3`: `PAYMENT_NOT_FOUND` timeout 복구와 scheduler 주문별 오류 격리.
- `eb73250`: 결제 주문 배송 연락처 전달.
- `d9edf6e`: 늦은 결제 환불 문서 기록과 취소 웹훅 `cancellationId` 허용.
- 정상 결제 `6e9a1e92-5f1f-49fa-8469-df3af7fb6a36`: PortOne·Firestore 100원, `PAID`, 주문 `ACCEPTED`.
- 동일 `PAID` 웹훅 재발송 후 결제 문서 1건·수량 불변·환불 없음.
- 늦은 결제 성공 `c1e7e41f-dad5-42e7-ba66-ac4a390f2f27`: 기존 예약 `EXPIRED`, 새 예약 `CONSUMED`, 주문 `ACCEPTED`.
- 늦은 결제 환불 `37e66aba-c702-49aa-80bf-6c688ac031bc`: PortOne `CANCELLED`, 100원 전액 환불 1건.
- 환불 주문의 로컬 결제 문서는 `CANCELLED`, 결제액·환불액 100원, 거래 ID 존재.
- `PAID`·`CANCELLED` 웹훅 재발송 후 환불 1건·결제 문서 1건·확정 수량 1을 유지했다.
- 테스트 fixture 한도는 `maxDeliveryAddresses=10`, `maxItemQuantity=10`, `saleLimitQuantity=10`으로 복원했다.
- 상세 증거: `docs/plans/REPORT_task_2_10_portone_staging_e2e.md`.

## 검증

- PortOne client·payment service·회차 주문·웹훅 DTO 4개 스위트 31개 테스트 통과.
- API 빌드, Biome 오류 수준 검사, `git diff --check` 통과.
- Secret, 토큰, Authorization 헤더, 서비스 계정 JSON을 출력·문서화·커밋하지 않았다.

## 다음 진입

- Task 4.2에서 현재·지난 회차 공개 API 상태를 제공하는 `useSaleRounds` 훅을 구현한다.

## 세션 완료 인계 규칙

- 각 Task 완료 보고는 사용자와 합의한 15개 항목 형식을 유지한다.
- 완료 보고 15번에는 실제 변경 파일, 실제 테스트 결과, 실제 커밋 SHA, 잔여 위험, 다음 Task 범위를 반영한 후속 실행용 전체 프롬프트를 작성한다.
- 후속 프롬프트는 별도 편집 없이 새 세션에 그대로 복사해 실행할 수 있을 만큼 상세해야 한다.
- 후속 프롬프트 안에도 그다음 Task 완료 시 동일한 15개 항목 보고와 후속 실행용 전체 프롬프트를 다시 작성하라는 규칙을 반드시 포함한다.
- 아직 실행하지 않은 검증 결과나 존재하지 않는 커밋 SHA를 추정해서 기록하지 않는다.

## Task 2.11 결과

- 첫 고객 사유 배송 보류에만 `orderCharges` 재배송비 1건을 주문 문서와 같은 트랜잭션으로 생성한다.
- 같은 보류의 중복·다른 멱등 키 요청은 주문의 `redeliveryChargeId`를 통해 기존 결제를 반환한다.
- 새 고객 사유 보류는 추가 재배송비 없이 멱등 `REDELIVERY_FAILED` 운영 예외 1건과 `requiresOperationalReview`로 전환한다.
- 비고객 사유, 권한 없는 요청, legacy 주문은 재배송비 생성을 차단한다.
- 주문 흐름 14개, 결제 회귀 16개 테스트와 API 빌드, Biome 오류 수준 검사, `git diff --check`가 통과했다.

## Task 3.1 결과

- 알림톡 즉시 성공 시 추가 재시도와 문자 대체가 없음을 고정했다.
- 일시 오류 최대 3회 재시도, 3회 실패 후 동일 내용 문자 대체, 설정 키 누락 실패 계약을 고정했다.
- 문자 성공 시 일반 알림 기록만 유지하고, 최종 실패 시 멱등 `CUSTOMER_NOTICE_FAILED` 운영 예외를 만들며 주문 상태는 바꾸지 않는 계약을 고정했다.
- Jest가 신규 파일을 포함한 12개 테스트 파일을 수집했다. 신규 7개 중 기존 성공 흐름 2개 통과, 후속 구현 대상 5개 예상 실패를 확인했다.
- API 빌드, Biome 오류 수준 검사, `git diff --check`가 통과했다.

## Task 3.2 결과

- 필수 알리고 설정 4개 중 하나라도 누락되면 외부 요청 없이 실패를 반환한다.
- 알림톡은 최대 3회 시도하고 성공 즉시 중단하며, 모두 실패하면 같은 전화번호와 최종 메시지로 문자를 한 번 발송한다.
- Task 3.2 관련 5개 테스트는 통과했다. 전체 7개 중 남은 2개 실패는 Task 3.3의 운영 예외 생성·멱등성 미구현 때문이다.
- API 빌드, 변경 파일 Biome 오류 수준 검사, `git diff --check`가 통과했다.

## Task 3.3 결과

- 문자 대체 성공 시 기존 일반 알림 기록 1건만 유지하고 운영 예외를 만들지 않는다.
- 문자 대체까지 실패하면 `customer-notice-failed:{orderId}:{templateCode}` 멱등 키를 해시한 결정적 문서 ID로 `CUSTOMER_NOTICE_FAILED` 운영 예외를 최대 1건 생성한다.
- 운영 예외에는 주문 상태·템플릿 코드·실패 단계만 기록하고 전화번호·메시지 본문·비밀값은 기록하지 않는다.
- 주문 상태를 변경하지 않으며 `DELIVERY_HELD` 유지와 일반 알림 성공·실패 기록 흐름을 검증했다.
- 알림 전달 계약 7개 테스트, API 빌드, 변경 파일 Biome 오류 수준 검사, `git diff --check`가 통과했다.

## Task 3.4 결과

- 기존 `PATCH /notifications/me/preferences`와 JWT 인증 흐름을 유지하고 요청 본문의 사용자 식별자는 받지 않는다.
- 허용 채널은 shared 주문 계약과 일치하는 `alimtalk`, `sms`이며 최소 한 채널의 실제 boolean만 허용한다.
- 알 수 없는 키, 빈 입력, 문자열 boolean, 숫자 값을 거부한다.
- 기존 사용자 설정과 요청 값을 병합해 요청하지 않은 채널을 보존하고 저장 완료 상태를 반환한다.
- 신규 설정 계약 12개, 기존 알림 전달 계약 7개, API 빌드, 변경 파일 Biome 오류 수준 검사, `git diff --check`가 통과했다.

## Task 3.5 결과

- 기존 `operationIssues`의 `idempotencyKey`, `status: OPEN`, `latestSnapshot`, `actions` 저장 모델을 기준으로 테스트 계약을 고정했다.
- 같은 원인과 업무 대상은 열린 항목 하나로 통합하고 다른 주문·결제·실패 유형은 분리한다.
- 환불 재시도와 문자 재발송 직전에 운영 예외와 최신 주문·결제 상태를 다시 읽어 자동 복구·해결된 항목에 중복 조치를 적용하지 않는다.
- 성공·실패 조치 모두 수행자·유형·시각·결과를 `actions`에 기록하고 전화번호·주소·메시지 본문·토큰·비밀값은 제외한다.
- 신규 계약 6개는 `operations.service.ts`가 없는 Task 3.6 미구현으로 예상 실패했다. 테스트 수집, 알림 7개·결제 16개·회차 주문 14개 회귀, API 빌드, Biome 오류 수준 검사, `git diff --check`는 통과했다.

## Task 3.6 결과

- `idempotencyKey`의 SHA-256 해시를 결정적 문서 ID로 사용해 같은 실패 원인과 업무 대상을 하나의 열린 운영 예외로 통합한다.
- 환불 재시도와 문자 재발송 직전에 운영 예외·주문·결제 문서를 다시 읽고 이미 환불되었거나 해결된 항목에는 외부 조치를 반복하지 않는다.
- 성공·실패 조치는 수행자·유형·시각·결과를 기존 `actions`에 누적하고, 실패 사유는 길이를 제한하며 민감 키가 포함되면 일반화한다.
- 운영 계약 6개, 알림 7개, 결제 16개, 회차 주문·재배송 14개 테스트와 API 빌드, Biome 오류 수준 검사, `git diff --check`가 통과했다.
- 컨트롤러·권한 API·모듈 연결과 기존 생성 경로의 공통 서비스 전환은 Task 3.7~3.8 범위로 남겼다.

## Task 3.7 결과

- `GET /stores/:storeId/operation-issues`, 상세 조회, 최신 상태 재조회, `RETRY_REFUND`·`RESEND_SMS` 조치 API를 구현했다.
- JWT와 seller·admin 역할을 요구하고 seller는 서버가 조회한 스토어 `ownerId`로 권한을 판정한다.
- 목록은 `storeId` Firestore 쿼리로 제한하며 상세·재조회·조치도 같은 스토어 경계를 재검증한다.
- 조치 `actorId`는 요청 본문이 아닌 인증 사용자 ID로 고정하고 기존 `OperationsService.executeAction`만 호출한다.
- 응답은 허용 필드만 구성해 전화번호·주소·메시지 본문·토큰·비밀값을 제외한다.
- 신규 컨트롤러 9개, 운영 6개, 알림 7개, 결제 16개, 회차 주문·재배송 14개 테스트와 API 빌드, Biome 오류 수준 검사, `git diff --check`가 통과했다.
- 모듈 생성과 `AppModule` 등록은 Task 3.8 범위로 남겼다.

## Task 3.8 결과

- `OperationsModule`에 컨트롤러와 서비스를 등록하고 `OperationsService`를 export했다.
- `AppModule`에 모듈을 등록해 운영 예외 API를 실제 런타임 라우트에 연결했다.
- 결제·알림 순환 의존성은 필요한 경계에만 `forwardRef`를 적용하고 중복 provider를 만들지 않았다.
- 알림 최종 실패와 재배송 최종 실패는 공통 `createOrMergeIssue`를 사용하며 기존 멱등 키를 유지한다.
- 재배송 최종 실패는 기존 Firestore 트랜잭션을 공통 서비스에 전달해 주문 갱신과 예외 생성을 원자적으로 유지한다.
- 신규 모듈 3개를 포함한 관련 67개 테스트, API 빌드, Biome 오류 수준 검사, `git diff --check`가 통과했다.

## Task 3.9 결과

- 배송 사진 90일, 마케팅 동의와 환불·분쟁·고객응대 기록 3년, 계약·결제·공급 기록 5년의 목적별 `expiresAt` 계약을 고정했다.
- 진행 중 분쟁과 `legalHold`는 일반 만료일 이후에도 파기하지 않고, 미만료 기록과 서로 다른 보관 목적은 분리한다.
- 만료 기록과 연결 사진은 모의 Firestore 배치·Storage 삭제 호출만 검증하며 같은 작업 재실행의 중복 부작용을 막는다.
- fixture와 결과에는 전화번호·주소·메시지 본문·토큰·Authorization·비밀값을 포함하지 않는다.
- Jest가 신규 파일을 포함한 17개 테스트 파일을 수집했고 신규 8개는 `RetentionService` 미구현으로 예상 실패했다. 기존 6개 스위트 55개 테스트, API 빌드, Biome 오류 수준 검사와 `git diff --check`가 통과했다.

## Task 3.10 결과

- `saveRecord`는 배송 사진, 마케팅 동의, 계약·결제·공급, 환불·분쟁·고객응대 기록을 네 컬렉션으로 분리하고 기준 시각에서 90일·3년·5년 뒤를 Firestore Timestamp `expiresAt`으로 저장한다.
- `purgeExpiredRecords`는 목적별 컬렉션을 각각 조회하고 `disputeStatus: OPEN` 또는 `legalHold: true`인 기록을 제외한다.
- 만료된 배송 사진은 주입된 Storage 삭제 어댑터로 제거하고 Firestore 문서는 단일 배치로 삭제하며, 빈 대상과 성공 후 재실행에는 추가 부작용을 만들지 않는다.
- 반환값은 목적별·전체 삭제 건수와 안전한 식별 정보만 포함하며 개인정보 본문과 비밀값을 추가하지 않는다.
- 신규 보관 계약 8개와 기존 6개 스위트 55개 테스트, API 빌드, Biome 오류 수준 검사와 `git diff --check`가 통과했다.

## Task 3.11 결과

- `RetentionModule`은 `FirestoreModule`을 가져오고 `RetentionService`를 provider로 등록해 export한다.
- 실제 Storage 구현·주입 연결, `AppModule`, 주문·결제·알림 호출 경로는 후속 Task 범위로 남겼다.
- 신규 모듈 계약 2개를 포함한 보관·운영 예외·알림·결제·주문 8개 스위트 68개 테스트, API 빌드, 변경 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다.

## Task 3.12 결과

- `StorageService`는 배송 사진 JPEG를 `deliveryPhotos/{orderId}/{photoId}.jpg`에 서버 업로드하고 공개 ACL 없이 private/no-store 메타데이터와 CRC32C 검증을 적용한다.
- 업로드는 관리자·스토어 소유 셀러·배정 기사, 읽기는 여기에 주문자 본인을 추가해 주문과 스토어 경계를 확인한 뒤 허용한다.
- 읽기 URL은 V4 읽기 전용 15분 만료로 발급하고, 삭제 어댑터는 배송 사진 경로만 허용하며 미존재 객체 삭제를 멱등 처리한다.
- `FirestoreModule` provider/export, `RetentionService` 주입 연결, `AppModule`, 주문·드라이버 실제 호출 경로는 후속 Task 범위로 남겼다.
- 신규 Storage 5개를 포함한 관련 13개 스위트 89개 테스트, API 빌드, 변경 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다.

## Task 3.13 결과

- `FirestoreModule`은 `StorageService`를 provider로 등록하고 export해 다른 모듈에서 재사용할 수 있게 했다.
- Storage는 중복 Firebase Admin 앱을 만들지 않고 기존 `FIREBASE_APP`과 `FirestoreService`를 재사용한다.
- Firebase Admin 초기화는 `FIREBASE_STORAGE_BUCKET`을 우선 사용하고, 미설정 시 `FIREBASE_PROJECT_ID` 기반 Appspot bucket을 기본값으로 사용한다.
- `RetentionService`의 삭제 어댑터는 `@Inject(StorageService)`로 명시해 인터페이스 타입의 런타임 주입 토큰을 고정했다.
- 신규 모듈 계약 3개를 포함한 관련 15개 스위트 98개 테스트, API 빌드, 변경 TypeScript 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다.
- `AppModule`, 주문·드라이버 실제 호출 경로, 공개 URL·클라이언트 직접 업로드·공개 Storage 권한은 변경하지 않았다.

## Task 3.14 결과

- `SaleRoundsModule`과 `OperationsModule`은 기존 AppModule 등록을 그대로 유지하고 누락된 `RetentionModule`만 추가했다.
- 신규 AppModule 계약 테스트는 회차·운영 예외·보관 모듈이 각각 한 번만 등록되고 기능 provider가 AppModule에 중복 등록되지 않는지 확인한다.
- Firebase Admin 앱·Storage provider를 재등록하거나 새 `forwardRef`를 추가하지 않았고 주문·드라이버 배송 사진 호출 경로와 공개 Storage 경계도 변경하지 않았다.
- 관련 15개 스위트 94개 테스트, API 빌드, 변경 TypeScript 파일 Biome 오류 수준 검사와 `git diff --check`가 통과했다.

## Task 4.1 결과

- 홈·상품 상세·장바구니·결제·주문 상세의 회차 직배송 논리 계약 10개를 공개 4개·인증 6개 `test.fixme`로 수집했다.
- chromium·mobile 20개 신규 테스트와 기존 소비자 5개 파일 68개 테스트 목록 수집, Biome 오류 수준 검사와 `git diff --check`가 통과했다.
- 기존 `AUTH_STATE_PATH`를 재사용했고 별도 fixture, 실제 결제·Firebase·Storage·외부 서비스 호출, 소비자 화면 구현은 추가하지 않았다.
