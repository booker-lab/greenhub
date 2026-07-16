# Green Love 프로젝트 메모

> **SSOT**: 세션 종료 시 최신 상태만 유지한다. 200라인 초과 시 아카이브하고 50라인 이내 요약으로 갱신한다.
> 최신 아카이브: `docs/archive/memory_archive_20260715_before_round_direct_task2.md`

최종 수정: 2026-07-16 (PAYMENT_NOT_FOUND timeout 복구 실측 완료, 실제 결제 게이트 대기)

## 현재 진행

- 브랜치 `codex/mvp-sales-round-direct`, 기준 커밋 `bd16a40`.
- Task 2.10의 timeout 미생성 복구와 staging 실측은 완료됐지만 실제 PortOne 테스트 결제 게이트는 아직 `todo`다.
- Task 2.11은 시작하지 않았으며 Task 2.10 실결제 게이트 통과 전 진입 금지다.

## staging 환경 결과

- Railway staging API: `https://api-staging-94af.up.railway.app`, health 200.
- Railway staging은 `green-staging-74557`를 사용하며 `PORTONE_V2_SECRET`, `PORTONE_WEBHOOK_SECRET` 환경 변수는 존재한다. 비밀값은 문서나 변경 파일에 기록하지 않았다.
- Firebase staging Web App `greenhub-consumer-staging`을 생성했다.
- Firestore rules와 `firestore.indexes.json`을 `green-staging-74557`에만 배포했다.
- Vercel consumer Preview `dpl_3Y4G59T2pgXW8J43nVA3AjDaqMBa`는 커밋 `bd16a40`을 사용한다.
- branch Preview의 API URL과 Firebase 공개 설정을 staging으로만 override했다. Production Vercel 환경은 변경하지 않았다.
- PortOne 콘솔에서 V2 `테스트` 탭, `카카오페이_테스트`, 테스트 CID를 확인했다.
- 웹훅 경로는 `POST /payments/webhook/portone`; 기존 호출 테스트 200·서명 검증 통과 상태를 유지했다.

## 최소 fixture

- seed: `scripts/seed-staging-payment.mjs`; `--apply`, 정확한 staging project ID, staging 서비스 계정을 모두 요구한다.
- 2회 실행 성공으로 멱등성을 확인했다. 비밀번호는 환경 변수로만 전달했다.
- 사용자: `staging-payment-consumer`, `staging-payment-seller`.
- Preview 상품: `staging-payment-store`, `staging-payment-product`(100원).
- 회차 계약: `staging-round-direct-store`, `staging-round-direct-product`, `staging-round-direct-open`, `staging-round-direct-item`.
- API 주문: legacy `ce923abb-d34e-4bd5-b7a2-4c07838dc525`; round `292cdd33-0da3-4309-8c2d-286a09a5b80e`.
- 회차 예약: `af5c5e49ce6b41d42dee41f57bc1512c`.

## 검증 결과와 차단점

- `/products` 상품 1건, 공개 회차, staging 사용자 로그인, 100원 legacy 주문, 100원 회차 주문·예약 생성 통과.
- Preview에서 상품 목록·상세·배송 한도·결제 버튼 활성화와 checkout callback 진입을 확인했고 콘솔 오류는 없었다.
- CORS는 GreenHub 프로젝트와 Vercel 팀으로 제한하면서 branch alias·immutable Preview URL을 모두 허용한다. 무관한 origin은 차단된다.
- staging V2 Secret 인증 200, 지정 결제 `292cdd33-0da3-4309-8c2d-286a09a5b80e` 조회 `404 PAYMENT_NOT_FOUND`를 확인했다.
- `PLAN_portone_payment_not_found_timeout_remediation.md`에서 `PortoneError`, 정확한 `404 + PAYMENT_NOT_FOUND` 분기, 주문별 오류 격리, legacy `requestedDeliveryDate` 반환을 구현했다.
- 단위 테스트 2개 스위트 21개, API 빌드, `git diff --check`가 통과했다.
- Railway staging 최종 deployment `00851584-79a3-419e-8097-d7ba1b08cfb5`는 `SUCCESS`, health 200이다.
- scheduler 실측 후 legacy·회차 주문은 `CANCELLED/timeout`, 예약은 `EXPIRED`, 회차 `reservedDeliveryAddresses`·`reservedItemQuantity`와 상품 `reservedQuantity`는 0, `orderedQuantity`는 0이다.
- 두 주문의 결제 문서는 생성되지 않았고 최종 deployment 로그에는 `getPayment` 401·404 오류가 없다.
- 실제 결제는 수행하지 못했다. Preview 카카오 로그인이 callback URI 미등록으로 `KOE006`이고, 이메일 credentials는 E2E 전용 헤더가 있어 일반 브라우저 제출로 로그인할 수 없다.
- 임시 결제 페이지는 브라우저 보안 정책상 열 수 없어 우회하지 않았다.
- 따라서 `PAID`·실결제액 재조회, 웹훅 중복 멱등성, 만료 예약 재확보, 실패 시 전액 환불, 환불 후 원격·로컬 상태 일치는 미검증이다.

## 다음 진입

- staging 전용 Kakao 앱/자격 증명을 Preview branch에 연결하고 branch alias callback URI를 등록한다. 공유 운영 Kakao 앱 수정은 별도 승인 없이는 금지한다.
- Preview에서 staging 사용자로 로그인한 뒤 100원 테스트 채널 결제를 완료한다.
- Railway webhook 로그와 Firestore 주문·예약·결제·알림을 확인하고 동일 웹훅을 재전송한다.
- 타임아웃 성공/한도 실패 두 회차 fixture로 늦은 결제와 전액 환불을 실측한다.
- 일곱 계약이 모두 통과한 경우에만 Task 2.10을 `done`으로 변경하고 Task 2.11에 진입한다.
