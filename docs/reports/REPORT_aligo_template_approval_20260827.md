<!-- Language: ko -->

# ALIGO 회차 알림 템플릿 8종 승인 확인 — 2026-08-27

## 상태

`ALIGO_8_TEMPLATES_APPROVED`

## 확인 시각

- 2026-08-27 15:06 KST 경 ALIGO SmartSMS 카카오 템플릿 관리 화면에서 직접 확인.
- 카카오채널ID: `@greenlove` — 정상.
- 아래 8종 모두 승인 상태가 `승인완료`로 표시됨.

## 승인 템플릿

| 템플릿코드 | 템플릿명 | 승인 상태 |
|---|---|---|
| `UK_5691` | 주문 접수 | 승인완료 |
| `UK_5692` | 상품 준비 시작 | 승인완료 |
| `UK_5693` | 배송 시작 | 승인완료 |
| `UK_5694` | 배송 보류 | 승인완료 |
| `UK_5695` | 재배송비 결제 요청 | 승인완료 |
| `UK_5696` | 재배송 예정 | 승인완료 |
| `UK_5697` | 배송 완료 | 승인완료 |
| `UK_5698` | 주문 취소 | 승인완료 |

## 이번 확인으로 닫힌 항목

- ALIGO 회차 알림 템플릿 8종 provider 심사 대기.
- `ALI-01 — ALIGO Template Approval` 외부 대기 상태.

## 아직 닫히지 않은 항목

이번 승인은 provider 템플릿 심사 완료만 의미한다. 다음은 별도 검증/승인이 필요하다.

- 내부 logical template code ↔ provider `tpl_code` 1:1 매핑 확인.
- 승인된 템플릿 기준 격리 알림톡 실제 발송 검증.
- SMS fallback 실제 검증.
- production ALIGO credentials/template mapping 반영.
- actual release SHA 기준 notification path 회귀 및 release gate.

## 운영 안전 경계

- 실제 알림톡/SMS 발송은 이번 문서 갱신에서 수행하지 않았다.
- production ALIGO 설정 변경을 수행하지 않았다.
- secret, senderkey 원문, 개인정보를 문서에 기록하지 않는다.
