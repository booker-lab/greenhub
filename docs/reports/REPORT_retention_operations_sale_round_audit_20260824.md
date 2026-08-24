<!-- Language: ko -->

# REPORT — Retention / Operations / Sale-round 정합성 감사

> 날짜: 2026-08-24 KST
> 기준 `main`: `29ffca1aaebac6aa4045457bb88de3b31c2bc608`
> 범위: retention → operationIssues → sale-rounds Spec·Code·Test 삼각 검증
> 판정 기준: `docs/DOCUMENT_CONSISTENCY.md`

## 요약 판정

| 영역 | 판정 | 결과 |
|---|---|---|
| Retention generic policy/purge | `VERIFIED` | 목적별 기간, metadata whitelist, legalHold/dispute 보존, 450 batch, Storage 3회 retry, 재실행 멱등을 직접 테스트 |
| Marketing consent retention semantics | 기존 P0 확대 | 현재 동의 시점+3년 만료이며 철회 증거/철회 기준 보관과 불일치 |
| Retention delete failure routing | LATER `IMPLEMENTATION FINDING` | 배송사진 파기 실패 issue가 store-scoped 운영 API에 안정적으로 노출되지 않음 |
| Operations 기본 계약 | `VERIFIED` 범위 존재 | store ownership, safe response, issue merge/reopen, 허용 action, 정상 동시 claim 직접 테스트 |
| Operations claim lease fencing | LATER `IMPLEMENTATION FINDING` | lease 만료 뒤 stale worker completion이 새 claim/fresh issue를 fencing하지 않음 |
| Sale-round 기본 상태 계약 | 직접 검증 다수 | ownership, 순차 상태, 자동 OPEN/CLOSE, CAPACITY reopen, 완료 blocker, caught cancellation failure retry |
| Sale-round live-state integrity | P0 `IMPLEMENTATION FINDING` | 조기 OPEN, live edit race, cancellation orphan 가능성 |

## 1. Retention — 직접 검증된 범위

`RetentionService`와 `retention.service.spec.ts`는 다음을 직접 고정한다.

- `DELIVERY_PHOTO`: basis + 90일
- `MARKETING_CONSENT`: basis + 3년
- `LEGAL_ORDER`: basis + 5년
- `LEGAL_DISPUTE`: basis + 3년
- 목적별 허용 metadata whitelist, 민감 필드 거부
- `disputeStatus=OPEN` 또는 `legalHold=true` 파기 보류
- 만료 record만 조회
- 450건 이하 batch 분할
- Storage 객체 삭제 후 Firestore record 삭제
- Storage 삭제 최대 3회
- Storage 최종 실패 시 retention record 유지 + `RETENTION_DELETE_FAILED`
- 재실행 시 이미 삭제된 객체/record에 부작용 반복 없음

`StorageService.deleteObject()`는 `ignoreNotFound: true`를 사용한다. 따라서 Storage 삭제 성공 뒤 Firestore batch commit이 실패해 다음 purge에서 객체가 이미 없더라도 해당 상황 자체는 멱등 재시도가 가능하다.

### 판정

위 generic retention mechanism은 현재 직접 테스트 근거가 있으므로 해당 범위는 `VERIFIED`로 유지한다.

## 2. Marketing consent retention — 기존 P0 확대

의도된 Current contract는 마케팅 동의·철회 증거를 철회 후 3년 보관하는 것이다.

현재 구현은:

- `MARKETING_CONSENT`의 `expiresAt = basisAt + 3년`
- round checkout consent 저장 시 `basisAt = consent.agreedAt` 또는 주문 생성 시각
- 철회 endpoint는 `users.notificationPreferences`만 갱신
- 철회 시 새 retention record 생성 또는 기존 consent record의 보관 기준 갱신 없음

따라서 동의를 3년 넘게 유지하면 아직 유효한 consent evidence가 자동 purge 대상이 될 수 있고, 실제 철회 후 3년 보관도 보장되지 않는다.

이는 기존 `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY` P0에 흡수한다.

추가 완료 조건:

- 실제 마케팅 기능을 유지한다면 active consent evidence가 단순 `agreedAt + 3년` 때문에 사라지지 않음
- withdrawal event를 감사 가능한 retention record로 남김
- 철회 후 보관 기간의 기준 시각을 명시적으로 고정
- user preference / checkout consent / retention evidence가 동일한 authoritative lifecycle로 수렴
- purge test가 장기 active consent와 withdrawal retention을 직접 구분

마케팅 기능을 MVP에서 제거한다면 consent UI·저장·retention contract를 함께 정리한다.

## 3. Retention delete failure routing

배송사진 retention record 생성 시 metadata는 현재 `{ orderId, photoId }`만 저장하며 `storeId`는 없다.

`RetentionService.deleteStorageObject()` 최종 실패 시:

```text
storeId = String(data.storeId ?? '')
```

으로 `RETENTION_DELETE_FAILED`를 생성한다.

현재 `OperationsController`는 `/stores/:storeId/operation-issues`만 제공하고 `OperationsService`의 목록/상세는 issue `storeId`를 해당 store와 일치시킨다. Seller parser도 non-empty 안전한 `storeId`를 요구한다.

따라서 배송사진 파기 실패 issue는 `storeId=''`로 생성되어 현재 store-scoped 운영 UI/API에 정상 노출되지 않을 수 있다.

Runbook은 일부 retention issue가 store 목록에 안 보일 수 있다고 이미 경고하지만, current API에는 global admin retention issue list가 확인되지 않았고 `RetentionService` 자체도 해당 실패를 별도 logger로 남기지 않는다.

### 판정

`RETENTION-DELETE-ISSUE-ROUTING` = LATER `IMPLEMENTATION FINDING`.

첫 production 배송사진의 일반 만료는 배송 완료 후 90일이므로 현재 출시 직전 P0로 승격하지 않는다. 다만 운영 전에 다음 중 하나로 닫아야 한다.

- delivery photo retention metadata에 non-PII `storeId`를 안전하게 보존해 store issue로 route
- 또는 admin/technical global retention issue queue를 별도 제공
- retry/resolve 절차와 direct test 추가

## 4. Operations — 직접 검증된 범위

현재 direct tests는 다음을 고정한다.

- 같은 idempotencyKey issue 단일 문서 수렴
- 해결된 같은 원인 재발 시 OPEN 재개방
- 최신 safe snapshot 병합
- seller store ownership과 다른 store 거부
- API safe response에서 phone/address/token/messageBody/secret 제거
- 허용 action mapping: `AUTO_REFUND_FAILED → RETRY_REFUND`, `CUSTOMER_NOTICE_FAILED → RESEND_SMS`
- 이미 환불된 결제 재환불 방지
- 해결된 notice issue 재발송 방지
- 동시에 같은 action을 요청하면 정상 lease 안에서는 한 요청만 외부 호출
- 성공/실패 action audit record

따라서 위 범위는 `VERIFIED`로 유지한다.

## 5. Operations action lease fencing

`claimAction()`은 5분 lease를 가진 `actionClaim`을 transaction으로 획득한다. 그러나 action 완료/실패 기록은 현재 claim token을 fresh-read해 비교하지 않고 최초에 읽은 `issue` snapshot을 spread하여 일반 `update()`한다.

따라서 첫 worker가 5분 이상 지연된 동안 두 번째 worker가 expired lease를 인수하면:

- stale 첫 worker가 두 번째 claim을 `actionClaim: null`로 지울 수 있고
- stale issue snapshot으로 최신 merge/action 상태를 덮을 수 있으며
- `RESEND_SMS`는 lease takeover 조건에서 중복 외부 발송 가능성이 있다.

현재 테스트는 lease 만료 전 동시 요청만 검증하며 takeover/fencing은 검증하지 않는다.

### 판정

`OPERATION-ACTION-CLAIM-FENCING` = LATER `IMPLEMENTATION FINDING`.

완료 시 claim token/lease generation을 completion transaction에서 fresh-read해 fencing하고, stale worker가 새 claim·reopened issue를 덮지 못하도록 직접 race test를 추가한다.

## 6. Sale-round — 직접 검증된 범위

현재 직접 tests는 다음을 고정한다.

- seller store ownership / admin 예외
- 상태 역전·단계 건너뛰기 거부
- stale status transition expectedStatus 거부
- schedule/limit 기반 `SCHEDULED → OPEN`, `OPEN → CLOSED`
- CAPACITY close와 capacity 회복 reopen
- SCHEDULE_ENDED/MANUAL close 비재개
- unfinished/held order가 있으면 COMPLETED 차단
- 회차 cancellation이 주문 정리 후 CANCELLED로 수렴
- 같은 호출 재실행 멱등
- caught local cancellation failure는 `LOCAL_FAILED`로 남아 재시도 가능

이 범위는 직접 증거가 있다.

## 7. P0 — SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY

### A. live edit race

`updateRound()`은 transaction 밖에서 `getStoredRound()`로 status를 읽고 `DRAFT|SCHEDULED`만 허용한다.

하지만 실제 write transaction에서는 fresh round status를 다시 읽지 않는다. 따라서 status check 뒤 다른 요청이 `OPEN`으로 바꿔도 기존 update가 다음을 적용할 수 있다.

- schedule
- delivery region
- limits
- included saleRoundItems
- round price / sale limit

items 교체 시 현재 items query도 transaction snapshot으로 읽지 않고 삭제/재생성한다. live checkout/reservation과 경합하면 현재 상품·가격·수량 snapshot 무결성에 직접 영향을 줄 수 있다.

현재 stale **status transition** test는 있지만 stale **edit vs OPEN** race test는 없다.

### B. premature OPEN / early checkout

`SaleRoundStateService.updateStatus()`는 `SCHEDULED → OPEN` 순서만 확인하고 `orderOpenAt` 현재시각을 검증하지 않는다.

`OrderCapacityService.assertRoundReservable()`도:

- `status === OPEN`
- cancellation 없음
- `orderCloseAt > now`

만 확인하며 `now >= orderOpenAt`을 확인하지 않는다.

따라서 미래 시작 회차를 seller가 수동 OPEN으로 바꾸면 실제 주문 예약이 시작 시각 전에 가능하다.

### C. cancellation orphan

회차 취소는 먼저 `cancellation.status = CANCELLING`을 저장한 뒤 주문별 취소·환불을 수행한다.

일반 exception은 catch되어 `LOCAL_FAILED`로 바뀌므로 재시도 가능하지만, 프로세스 종료/강제 중단이 `CANCELLING` 저장 이후 catch 이전에 발생하면:

- lease/owner/expiry가 없음
- 이후 `claimCancellation()`은 `CANCELLING`을 “이미 진행 중”으로 거부
- deterministic resume/reaper 경로가 없음

으로 회차 취소가 고착될 수 있다.

### 판정

`SALE-ROUND-STATE-ATOMICITY-AND-RECOVERY` = P0 `IMPLEMENTATION FINDING`.

### 완료 불변식

- `DRAFT|SCHEDULED` edit eligibility를 실제 write transaction에서 fresh status/time으로 재검증
- `OPEN|CLOSED|COMPLETED|CANCELLED` 또는 cancellation 진행 중에는 live configuration edit side effect 0
- `SCHEDULED → OPEN`은 `orderOpenAt <= now < orderCloseAt` 등 authoritative schedule window를 만족할 때만 허용
- checkout reservation도 defense-in-depth로 `orderOpenAt <= now < orderCloseAt`을 직접 검증
- concurrent edit/open에서 한쪽만 정책에 맞게 성공하고 상품/가격/한도 snapshot이 혼합되지 않음
- item replacement가 live reservation과 경합해 reserved/ordered item을 삭제하거나 orphan시키지 않음
- orphaned `CANCELLING`을 안전하게 인수/재개할 lease 또는 deterministic recovery 정책
- 재개 시 이미 환불·취소된 주문에 외부 부작용을 중복 적용하지 않음
- existing automatic OPEN/CLOSE/CAPACITY reopen, normal cancel retry regression 유지

## 8. 문서 처리 원칙

- Current spec의 schedule/live immutability 계약을 현재 구현에 맞춰 완화하지 않는다.
- 구현 우회는 P0 finding으로 추적한다.
- generic retention mechanism의 이미 직접 검증된 부분은 `VERIFIED`를 유지한다.
- 운영 action 기본 동시성 테스트도 lease-expiry finding 때문에 전체 `UNVERIFIED`로 강등하지 않는다.

## 범위 경계

이번 감사에서 코드, 테스트, Firebase Rules, provider, production, 운영 데이터, 실제 결제·환불·알림은 변경하지 않았다.
