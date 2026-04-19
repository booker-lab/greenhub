# 다음 세션 작업 목록

> 최종 수정: 2026-04-20 | AI 프롬프트 규칙 커스터마이징 항목 추가

---

## AI 프롬프트 규칙 커스터마이징

### AI 헤드라인·상세 설명 생성 규칙 수정
**배경**: 현재 생성 규칙은 `apps/api/src/ai/prompts/product-content.prompt.ts` 한 파일에 집중되어 있으며 자유롭게 수정 가능.  
**수정 가능 항목**:
- headline 길이 제한 (현재 15자 이내)
- headline 스타일 (품종명 포함 필수, 감성적 문구 등)
- description 구성 구조 (색상→관상기간→선물 용도 고정 순서 등)
- description 길이 (현재 2~4문장)
- 어조 (친근체 / 격식체 / 감성적 등)
- stemType(외대/쌍대/가지/3대) 문구 자동 반영 여부
**구현 위치**: `apps/api/src/ai/prompts/product-content.prompt.ts`  
**규모**: 소 (프롬프트 텍스트 수정만)

---

## 즉시 착수 가능 (외부 조건 없음)

### suspended 사용자 로그인 차단
**배경**: admin에서 사용자 정지 기능은 구현됐으나, auth.service.ts에 검증 없어 정지된 사용자도 로그인 가능.  
**구현 위치**: `apps/api/src/auth/auth.service.ts` — 로그인 시 `suspended === true` 검증 + `401` 반환  
**규모**: 한 줄 수준

---

## 외부 조건 대기

### 네이버페이 채널키 연결
**배경**: 네이버페이 파트너 가입 완료, 승인 이메일 대기 중.  
**작업**: 승인 이메일 수신 후 `NAVERPAY_CHANNEL_KEY` 환경변수를 Railway에 추가하면 자동 노출.

---

## 데이터 구축

### varietyId 실제 데이터 구축
**배경**: `varieties` 컬렉션은 더미 시드(호접란 10종). 실제 품종 데이터로 전면 교체 필요.  
**작업**:
- 실제 품종 데이터 입력 (Firestore 또는 시드 스크립트)
- 기존 products.varietyId 매핑 업데이트
- "미니 호접란" 상품: `phala-mini` 매핑 예정

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
**배경**: 스펙 설계 완료, 코드 미구현. 판매자 일일 주문 배치 알림 (오후 8시 유력, 0건 미발송).  
**구현 위치**: `apps/api/src/notifications/notifications.service.ts`에 `@Cron` 메서드 추가

### GROUP_DEADLINE_SOON 중복 발송 방지
**배경**: 스펙 §9에 "이미 발송된 건 제외" 명시되어 있으나 현재 매 10분마다 중복 발송 가능.  
**구현 방법**: `notifications` 컬렉션에서 `templateCode=GROUP_DEADLINE_SOON + productId` 발송 이력 조회 후 스킵

### SMS 폴백 구현
**배경**: 알리고 API는 `failover: 'Y'` 파라미터로 알림톡 수신 불가 시 SMS 자동 대체 지원.  
**구현 위치**: `apps/api/src/notifications/aligo.client.ts` `sendAlimtalk()` 파라미터 추가

---

## Phase 2 대규모 작업

### 공동구매 수량 기반 모델 전환
**배경**: 현재 인원 기반 → 수량 기반으로 전환 예정.  
**변경 범위** (`docs/CRITICAL_LOGIC.md` [2026-04-13] 참조):
- `groupProductConfig` 스키마: `minParticipants/maxParticipants` → `targetQuantity/minQuantity/maxPerPerson/currentQuantity`
- API 3곳: orders-create / orders-lifecycle / notifications
- Seller 상품 등록 폼 필드 교체
- Consumer 프로그레스바 "N/M개" 표시
- shared 타입 업데이트
- Firestore 기존 데이터 마이그레이션 스크립트 필요

### FCM 브라우저 푸시
**배경**: Should Have. 알림톡이 주 채널, FCM은 PWA 설치 사용자 보조 채널.  
**구현 순서** (`docs/specs/notifications.md` §8 참조):
1. Firebase 프로젝트 FCM VAPID 키 발급
2. Service Worker (`firebase-messaging-sw.js`) 등록
3. 소비자 앱: 푸시 권한 요청 → FCM 토큰 → `PATCH /auth/me/fcm-token`
4. NestJS: `firebase-admin` SDK로 FCM 발송

---

## 참고 — 이번 세션 수정된 버그 목록 (2026-04-13)

| 커밋 | 내용 |
|------|------|
| `0c0f4cf` | seller/driver 브랜딩 Green Hub → Green Love (manifest, layout, login) |
| `836b5b9` | seller 주문 상세 createdAt Invalid Date + RECRUITING 마감 카운트다운 표시 |
| `77d08dc` | 공동구매 중복 참여 방지 + 1인 1개 수량 제한 |
| `9803c4d` | 공동구매 마감일시 timezone 오류 수정 (datetime-local → toISOString) |
| `c1e77ec` | groupProductConfig 생성 시 isProcessed: false 누락 수정 |
| `5974c0f` | useOrderStatus terminal 상태 도달 시 폴링 중단 |
| `7000cd0` | cancelOrder Firestore 트랜잭션 read/write 순서 오류 수정 |
