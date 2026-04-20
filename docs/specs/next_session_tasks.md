# 다음 세션 작업 목록

> 최종 수정: 2026-04-21 | AI 프롬프트 고도화 완료, 버그 수정 반영

---

## 즉시 착수 가능 (외부 조건 없음)

### [1순위] products.varietyId 매핑 스크립트
**배경**: varieties 30종 실제 데이터 구축 완료. 기존 등록 상품들에 varietyId가 연결되지 않아
소비자 상세 페이지 속성 테이블(품종·향기·관상기간)이 표시되지 않음.
**작업**: `scripts/map-variety-ids.mjs` 스크립트 작성 — 상품명/카테고리 기준으로 varietyId 자동 매핑
**규모**: 소 (스크립트 작성 + 실행)

---

## 외부 조건 대기

### [대기] 네이버페이 채널키 연결
**배경**: 네이버페이 파트너 가입 완료, 승인 이메일 대기 중.
**작업**: 승인 이메일 수신 후 Railway 환경변수 추가:
- `PORTONE_WEBHOOK_SECRET=whsec_...` (Portone 콘솔 > 웹훅 > 서명 키)
- `NAVERPAY_CHANNEL_KEY=...`

---

## 알림 시스템 실제 연동

### 카카오 알림톡 실제 연동
**배경**: 로직·발송 코드·스케줄러 전부 구현 완료. API 키 없어 현재 전부 스킵.
**작업 순서**:
1. 알리고(aligo) 계정 가입 + 카카오 비즈니스 채널 연동
2. 각 templateCode별 카카오 알림톡 심사 신청 (약 1~3 영업일)
3. `apps/api/src/notifications/aligo.client.ts` `buildMessage()` — 심사 통과된 템플릿 본문으로 교체
4. Railway 환경변수 추가: `ALIGO_API_KEY`, `ALIGO_USER_ID`, `ALIGO_SENDER_KEY`, `ALIGO_SENDER_PHONE`
**참고**: 템플릿 초안은 `docs/specs/notifications.md` §4에 작성되어 있음

### SELLER_ORDER_BATCH 스케줄러 구현
**배경**: 스펙 설계 완료, 코드 미구현. 판매자 일일 주문 배치 알림 (오후 8시, 0건 미발송).
**구현 위치**: `apps/api/src/notifications/notifications.service.ts`에 `@Cron` 메서드 추가

---

## Phase 2 대규모 작업

### 공동구매 수량 기반 모델 전환
**배경**: 현재 인원 기반 → 수량 기반으로 전환 예정.
**변경 범위** (`docs/CRITICAL_LOGIC.md` [2026-04-13] 참조):
- `groupProductConfig` 스키마 변경
- API 3곳, Seller 폼, Consumer 프로그레스바, shared 타입, Firestore 마이그레이션

### FCM 브라우저 푸시
**배경**: Should Have. 알림톡 주 채널, FCM은 PWA 설치 사용자 보조 채널.
**구현 순서** (`docs/specs/notifications.md` §8 참조):
1. Firebase VAPID 키 발급
2. Service Worker 등록
3. 소비자 앱 푸시 권한 요청 → FCM 토큰 저장
4. NestJS FCM 발송

---

## 이번 세션 수정된 버그 목록 (2026-04-21)

| 커밋 | 내용 |
|------|------|
| `93296d8` | AI 프롬프트 고도화 T1~T4 + stemType 소비자 페이지 반영 |
| `969c7f1` | ImageUpload 버튼 type="button" 누락 → form submit 버그 수정 |
| `79fe2bd` | Gemini JSON 파싱 강화 + 에러 메시지 상세화 |
| `fb33496` | ProductForm localStorage useState→useEffect 이동 (React #418 수정) |
| `0677b2a` | ImageUpload key={url}→key={idx} (대표 배지 미갱신 수정) |
| `c036318` | 가격 입력 NumberInput + thousandSeparator 콤마 포맷 |
