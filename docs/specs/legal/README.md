<!-- Language: ko -->

# Legal 문서 라우터와 판매 활성화 게이트

> 최종 정합화: 2026-08-24 KST
> 상태: Current

## 현재 정본

- consumer 개인정보처리방침·이용약관 공개 baseline: `docs/specs/legal/consumer-legal-documents.md`
- 실제 공개 구현:
  - `apps/consumer/src/app/privacy/page.tsx`
  - `apps/consumer/src/app/terms/page.tsx`
- 공개 사업자 정보 정본: `apps/consumer/src/lib/publicBusinessInfo.ts`

### 2026-08-24 current-fact errata — 선택 마케팅 동의

`docs/specs/legal/consumer-legal-documents.md`는 2026-08-19 공개 페이지 baseline이며, 그 문서의 **“consumer에 마케팅 수신 동의 기능이 없다”는 구현 사실은 더 이상 현재가 아니다.** 마케팅 동의 존재 여부에 한해서는 이 errata가 해당 2026-08-19 snapshot보다 우선한다.

현재 코드에는 다음이 존재한다.

- round checkout의 선택 카카오톡/문자 마케팅 동의 checkbox
- order `marketingConsent` snapshot
- `marketingConsentLogs`의 consent retention record
- MY `마케팅 알림 설정` 화면
- `users/{userId}.notificationPreferences`
- `PATCH /notifications/me/preferences` 철회 경로

반면 **실제 선택 마케팅 메시지를 발송하는 sender는 이번 감사에서 확인되지 않았고**, 주문·결제·배송 정보성 연락은 마케팅 동의와 별개의 현재 계약이다. 따라서 공개 문서에서 “마케팅 발송이 운영 중”이라고 확대해석하지 않는다.

또한 checkout consent, user preference, 철회, retention evidence가 현재 하나의 lifecycle로 수렴하지 않는 `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY` P0가 남아 있다. 최종 공개 legal 문구는 이 P0의 제품·구현 결정을 반영해 다시 확정한다.

증거: `docs/reports/REPORT_settlements_notifications_legal_ops_audit_20260824.md`.

## 현재 공개 상태

현재 공개 법적 문서는 **판매기능 활성화 전 상태**를 전제로 한다.

- 시행일: 2026-08-19
- 이용약관은 `2026년 8월 19일 현재 상용 주문·결제·배송 서비스를 운영하지 않습니다.`라고 명시한다.
- 개인정보처리방침도 현재 상용 주문·결제·배송은 운영하지 않는다고 명시한다.
- PortOne·결제사업자는 현재 상용 처리 수탁자로 운영하지 않는다고 고지한다.
- ALIGO를 통한 실제 고객 알림 발송은 현재 공개 처리위탁 목록에 별도 공급자로 명시돼 있지 않다.
- 선택 마케팅 consent UI/storage는 코드에 존재하지만 실제 마케팅 발송 활성화와 동의 lifecycle 정합화는 완료되지 않았다.

따라서 이 문서들이 production에 반영돼 있다는 사실만으로 **회차 직배송 판매 활성화 법적 준비가 완료됐다고 판단하면 안 된다.**

## P0 — 판매 활성화 전 재정합화

`round_direct` 실제 판매를 공개하기 전에 다음을 하나의 출시 게이트로 검토한다.

1. 이용약관의 비판매 문구를 실제 판매 계약과 일치하도록 개정한다.
2. 주문 성립 시점, 취소·환불, 배송, 재배송비, 배송 보류 등 실제 MVP 정책과 공개 문구가 일치하는지 확인한다.
3. PortOne 및 실제 결제사업자의 개인정보 처리 역할·데이터 흐름을 확인해 개인정보처리방침에 필요한 내용을 반영한다.
4. 실제 고객 알림에 ALIGO를 사용한다면 전화번호·메시지 처리 흐름과 처리위탁/외부 서비스 고지 필요 범위를 확인한다.
5. 선택 마케팅 consent를 유지한다면 `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY`를 먼저 해결하고 수집 목적·항목·동의/철회·보관기간·실제 marketing sender 여부를 공개 문구와 일치시킨다. 실제 마케팅을 MVP에서 하지 않을 경우 불필요한 consent 수집/설정 노출을 중단하는 선택도 포함한다.
6. seller·driver에게 고객 배송정보가 노출되는 실제 처리 구조와 제3자 제공/내부 업무처리 설명이 일치하는지 확인한다. 특히 `docs/specs/api/orders.md`의 direct Firestore read P0가 해결되어 **업무 수행에 필요한 범위로 실제 접근 경계가 먼저 축소·검증**된 뒤 공개 문구를 확정한다.
7. 시행일을 갱신하고 필요하면 이전 버전을 보존한다.
8. `apps/consumer/src/app/legal-documents.test.mjs`의 **비판매 상태 고정 assertion**을 새 공개 계약에 맞게 수정한다.
9. 변경된 법적 페이지가 release SHA에 포함된 뒤 production 배포 전에 비로그인 `/privacy`, `/terms`를 재검증한다.

이 게이트는 법률 자문을 대체하려는 것이 아니라, **현재 공개 문서와 실제 출시 동작이 서로 모순되는 것을 방지하기 위한 저장소 정합성 게이트**다. 법적 판단이 필요한 항목은 별도 확인을 거친다.

### 현재 확인된 선행 P0 — 주문 직접 읽기와 최소 접근

2026-08-24 코드·Rules 감사에서 다음을 확인했다.

- API `OrdersQueryService`는 driver 상세 조회를 `order.driverId === requesterId`로 제한한다.
- 반면 `firestore.rules`의 `orders` read는 `role == 'driver'`이면 주문의 `driverId`, 상태, store와 무관하게 허용한다.
- driver 보드와 상세 화면은 API가 아니라 Firestore `orders` 문서를 직접 구독한다.
- seller 주문 목록도 Firestore `orders` 원문을 직접 구독한다.
- 회차 주문 원문에는 배송 수행 정보 외에도 `acquisition`, `marketingConsent`, `clientOrderPayloadHash`, reservation 관련 필드 등 역할별 업무에 반드시 필요한 것으로 입증되지 않은 데이터가 함께 저장될 수 있다.
- 현재 Firestore Rules 테스트는 driver가 다른 store 주문을 직접 읽는 동작을 성공 케이스로 고정하고 있다.

따라서 **API 조회 권한이 안전하다는 사실만으로 seller/driver의 실제 고객정보 접근 계약이 `VERIFIED`라고 판단하지 않는다.** 이 상태에서 법적 문구를 넓혀 현재 구현을 정당화해서는 안 된다.

판매 활성화 법적 문구를 확정하기 전에 최소한 다음이 먼저 충족되어야 한다.

- 미배정 `PREPARING` direct/hub 주문을 기사에게 discovery할 필요가 있다면 그 목적과 허용 필드를 별도 계약으로 명시한다.
- 임의 driver가 배정되지 않은 일반 주문·완료 주문·다른 기사 주문 원문을 직접 읽을 수 없어야 한다.
- seller/driver에 제공하는 주문 데이터는 역할 수행에 필요한 필드만 반환하는 DTO·projection 또는 동등한 데이터 분리를 사용한다.
- `marketingConsent`, `acquisition` 등 배송·판매 수행에 불필요한 정보가 raw order read를 통해 전달되지 않도록 한다.
- Firestore Rules와 직접 Rules 테스트가 위 경계를 거부/허용 케이스로 고정한다.
- frontend가 raw `orders` 직접 읽기를 계속 사용한다면 Rules만으로 필드 최소화가 가능한지 검증하고, 불가능하면 API/projection 등 구조를 변경한다.

정본과 remediation Acceptance Criteria는 `docs/specs/api/orders.md`, `docs/BACKLOG.md`를 따른다.

### 현재 확인된 선행 P0 — 선택 마케팅 동의 lifecycle

현재 checkout consent, user-level preference, withdrawal, retention evidence가 서로 다른 저장/갱신 경계를 사용한다.

판매 활성화 legal을 확정하기 전 다음 중 하나로 수렴한다.

- 마케팅을 MVP에서 사용하지 않음: consent 수집/설정 노출을 비활성화·제거하고 공개 문서에도 실제 미운영 상태를 반영.
- consent 기능 유지: authoritative user-level 상태, checkout 동기화, 철회 evidence, 실제 marketing sender gating을 구현·직접 검증하고 공개 문구를 일치시킴.

정보성 주문·결제·배송 연락은 선택 마케팅 동의와 별개로 유지한다.

정본: `docs/specs/api/notifications.md`, `docs/specs/mvp-sales-round-direct-delivery.md`, `docs/BACKLOG.md`.

## 실행 순서 관계

- ALIGO provider 심사 대기 중에는 현재 공개 문구를 미리 `판매 중` 상태로 바꾸지 않는다.
- ALIGO 실제 격리 발송 검증과 같은 테스트는 별도 승인·격리 데이터로 수행할 수 있다.
- seller/driver 주문 read authorization·데이터 최소화 P0가 해결되기 전에는 판매 활성화 개인정보 문구를 최종 확정하지 않는다.
- `MARKETING-CONSENT-LIFECYCLE-CONSISTENCY` 결과가 확정되기 전에는 마케팅 consent/철회 공개 문구를 최종 확정하지 않는다.
- 실제 출시 대상 SHA를 고정하기 **전에** 법적 문서와 공개 페이지 변경을 완료해야 한다. 법적 페이지 코드 변경도 release SHA의 일부이기 때문이다.
- 최종 `salesMode: round_direct` 전환 전에 production에서 새 법적 문서가 노출되는지 확인한다.

## 역사 자료

카카오 비즈니스 채널 재심사를 위해 작성된 PLAN·REPORT·PROMPT의 비판매 문구는 당시 증빙 이력이다. 현재 출시 지시로 사용하지 않는다.
