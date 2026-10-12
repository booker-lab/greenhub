<!-- Language: ko -->

# 결제·인증·규칙 재대조 보고서 (2026-10-10)

> 상태: 역사 증거(REPORT). 현재 상태는 `docs/memory.md`, 남은 일은 `docs/BACKLOG.md`, 계약은 각 current spec이 소유한다.

## 기준

- 대상: `main` `680a190` (오늘 병합된 결제·인증·규칙 PR 포함, #426·#404는 미병합)
- 판정 기준: `docs/DOCUMENT_CONSISTENCY.md` §7·§8
- 실행한 증거
  - `pnpm --filter api test`: 123 suites, 1768 tests 통과
  - `pnpm --filter api test:e2e`: 5 suites, 26 tests 통과
  - 결제 범위 jest 268건, 인증 범위 jest 153건과 seller·driver·consumer 인증 런타임 테스트 통과
  - Firebase Rules 에뮬레이터는 이 환경에서 내려받을 수 없어 실행하지 않았다. `main` `680a190`의 CI "Firebase rules (emulator)" 작업(run `38074518296`) 통과로 대신했다.
- 운영 상태(배포된 SHA `0bcceaea`, 운영 규칙 `197f84a4` 판)는 이 보고서로 바뀌지 않는다.

## 결제

| 항목 | 판정 | 근거 |
|---|---|---|
| PAYMENT-FINALIZATION-PAID-GUARD | `VERIFIED` | `payment-finalization.service.ts` 비PAID 조기 종료, `payments.service.spec.ts` PENDING/FAILED/CANCELLED it.each |
| PAYMENT-WEBHOOK-SIGNATURE-COVERAGE | `VERIFIED` | `portone-webhook-boundary.spec.ts` 실제 HMAC 통과·불일치·본문/id/timestamp 변조·±300초 경계·헤더 누락·side effect 0 |
| ORDER-REDELIVERY-PAID-RESUME-GATE | `VERIFIED` | `orders/redelivery-resume-gate.ts`, `redelivery-resume-gate.spec.ts` (레거시 판매자 경로는 직접 테스트 없음, 재배송비는 schemaVersion 2에서만 생성) |
| ADMIN-FORCE-REFUND-CONSISTENCY | `VERIFIED` | `admin.service.ts` 회차 위임·레거시 claim, `admin.service.spec.ts` |
| 금액 불일치·중복 웹훅·timeout 경합·늦은 결제 환불·만료 HELD 소비(#416)·취소 주문 늦은 PAID 환불·15분 정리 | `VERIFIED` | 각 spec (`payments.service.spec.ts`, `payment-finalization-refund-ownership.spec.ts`, `expired-hold-finalization.spec.ts`, `p0-002-race.spec.ts`) |
| 결제사 취소·분쟁 운영 기록, 웹훅 거절 로그 집계, 정리 cron 동시성(#430), PortOne 시간 상한(#425), 환불 claim UNKNOWN 유지, `RETRY_REFUND` 확인 후 해결(#436) | 코드·테스트 일치, 명세 갱신 | `docs/specs/api/payments.md` 2026-10-10 정합화 |
| 상점·통화·채널 확인 | 미구현(#426 미병합) | BACKLOG `PORTONE-CHANNEL-CHECK` |
| 재배송비 환불 불명확 기록 | `IMPLEMENTATION FINDING` | `storeId: ''`·`paymentId: chargeId`라 판매자 화면에 안 보이고 `RETRY_REFUND`가 늘 409. BACKLOG `CHARGE-REFUND-ISSUE-ROUTING` |
| 재배송비 환불 claim이 다른 시도에 걸린 채 취소 완료 | 확인 필요 | 복구가 결제사 웹훅 재전송에 달려 있음. 재전송 보장 여부 미확인 |

## 인증

| 항목 | 판정 | 근거 |
|---|---|---|
| 기사 승인 게이트(register·login·kakao·JWT) | `VERIFIED` | `auth.service.spec.ts`, `auth.controller.spec.ts`, `jwt.strategy.spec.ts` |
| refresh 회전·60초 유예, refresh 때 권한 재조회 | `VERIFIED` | `auth.service.spec.ts` |
| API logout, 세 앱 `events.signOut` → `POST /auth/logout`(#415·#429·#431) | 단위 `VERIFIED` / 런타임 미확인 | 각 앱 `auth-runtime` 테스트. 브라우저 증거는 오늘 PR 이전 SHA뿐 |
| 토큰 `typ`·`aud`, Firebase custom token, 카카오 첫 가입 단일화, 이메일 로그인 응답 균일화 | `VERIFIED` | `token-boundary.spec.ts`, `auth.kakao-signup-occ.spec.ts` 등 |
| 카카오 토큰 발급 앱 확인(#425) | `KAKAO_APP_ID` 설정 시 `VERIFIED`, 미설정 시 경고 후 통과 | `kakao.client.spec.ts` |
| 운영에서 테스트 전용 로그인 제외 | 판정 함수 `VERIFIED`, 등록 연결은 소스 확인 | 각 앱 `auth-runtime` 테스트 |
| 요청 한도 | `IMPLEMENTED / UNVERIFIED` | 직접 테스트 없음, 프록시 뒤 IP 집계는 #404 미병합. BACKLOG `RATE-LIMIT-CLIENT-IP` |
| 같은 계정 여러 기기 | `DECISION REQUIRED` | `refreshTokens/{sub}` 단일 문서로 두 번째 로그인이 첫 기기를 탈취로 끊음. BACKLOG `AUTH-MULTI-DEVICE-SESSION` |
| 공개 회원가입 API 차단 | 미완료 | `POST /auth/register` 공개 그대로. BACKLOG `ROUND-HOLD-ABUSE-LIMITS` 문구 정정 |

## Firebase 규칙 (#402)

| 규칙 | 판정 | 근거 |
|---|---|---|
| `orders`·`saleRounds`·`saleRoundItems` 원문 읽기·쓰기 전면 거부 | `VERIFIED` (CI) | `tests/firestore/firestore-rules.test.mjs` |
| `products`·`stores`·`groupProductConfig` 소유 판매자 읽기, `dailyCaps` 공개 읽기 유지 | `VERIFIED` (CI) | 같은 파일 |
| Storage 공개 경로 단건 조회만, 목록 거부 / 상품 이미지 쓰기 `stores.ownerId` 일치 / legacy 기사 사진 | `VERIFIED` (CI) | `tests/storage/storage-rules.test.mjs` |
| `cors.json` GET·HEAD 축소 | `IMPLEMENTED / UNVERIFIED` | 버킷 적용 절차·테스트 없음. BACKLOG `STORAGE-CORS-APPLY` |
| 배포 순서 | 위험 없음 | 운영 프런트(`0bcceaea`)와 `main` 프런트 모두 막힌 원문을 직접 읽지 않고 Storage 목록 조회도 없음. 남은 직접 조회(`dailyCaps`·`products`·`groupProductConfig`·Storage 단건)는 새 규칙에서도 허용 |

## 정정한 문서

- `docs/memory.md`: "규칙을 앱보다 먼저 내면 막힐 수 있다"(근거 없음) 정정, `firestore.rules` orders read 서술을 당시 기록으로 한정, #402 Storage·CORS 변경 추가
- `docs/specs/api/payments.md`, `docs/specs/api/auth.md`, `docs/specs/api/orders.md`: 오늘 병합분 기준 정합화
- `docs/BACKLOG.md`: `AUTH-LOGOUT-SERVER-REVOCATION`·`AUTH-SIGNOUT-SESSION-RESURRECTION-FLAKE`·`ROUND-HOLD-ABUSE-LIMITS` 상태 갱신, 새 항목 5개
