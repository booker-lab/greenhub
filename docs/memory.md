# Green Love 프로젝트 메모

> **SSOT**: 세션 종료 시 최신 상태만 유지한다. 200라인 초과 시 아카이브하고 50라인 이내 요약으로 갱신한다.
> 최신 아카이브: `docs/archive/memory_archive_20260715_before_round_direct_task2.md`

최종 수정: 2026-07-17 (Task 2.11 재배송비 멱등 결제와 운영 예외 전환 완료)

## 현재 진행

- 브랜치 `codex/mvp-sales-round-direct`, Task 2.11 로컬 변경 검증 완료.
- Task 2.10은 실제 100원 결제·웹훅·늦은 결제·전액 환불까지 완료해 `done`이다.
- Task 2.11은 재배송비 1회 생성과 재실패 운영 예외 전환까지 완료해 `done`이다.
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

- Task 3.1 법정 기록 계약 테스트부터 시작할 수 있다. Task 3.6 운영 예외 수명주기는 아직 시작하지 않았다.

## Task 2.11 결과

- 첫 고객 사유 배송 보류에만 `orderCharges` 재배송비 1건을 주문 문서와 같은 트랜잭션으로 생성한다.
- 같은 보류의 중복·다른 멱등 키 요청은 주문의 `redeliveryChargeId`를 통해 기존 결제를 반환한다.
- 새 고객 사유 보류는 추가 재배송비 없이 멱등 `REDELIVERY_FAILED` 운영 예외 1건과 `requiresOperationalReview`로 전환한다.
- 비고객 사유, 권한 없는 요청, legacy 주문은 재배송비 생성을 차단한다.
- 주문 흐름 14개, 결제 회귀 16개 테스트와 API 빌드, Biome 오류 수준 검사, `git diff --check`가 통과했다.
