# PWA 웹앱 설계 문서 part 03

> 원본: $Path에서 2026-06-29 문서 정리 시 분리.

---

## 9. 주문 상태 머신

세 앱이 동일한 주문 상태를 공유한다. 판매자 수락/거절 단계 없음 — 결제 완료가 곧 주문 접수.

### 일반 판매 (saleType: normal)

```
PENDING      → [내부] 결제 처리 중 (Portone webhook 수신 전, 소비자 미노출, 15분 자동 삭제)
    ↓
ACCEPTED     → 결제 완료 (주문 첫 상태)
    ↓
PREPARING    → 판매자가 상품 준비 중
    ↓
DELIVERING   → 드라이버가 픽업 후 목적지로 이동 중
    ↓
[직배송·택배] DELIVERED  → 배송 완료
[거점 픽업]  HUB_ARRIVED → 거점 도착, 픽업 대기
                ↓
             PICKED_UP  → 소비자가 픽업 코드로 수령 완료
    ↓
REVIEWED     → 구매 확정 또는 리뷰 작성 완료

(어느 단계에서든) → CANCELLED
```

### 공동구매 (saleType: group)

```
PENDING      → [내부] 결제 처리 중 (Portone webhook 수신 전, 소비자 미노출, 15분 자동 삭제)
    ↓
RECRUITING   → 즉시 결제 완료, 최소 인원 모집 중 (공동구매 첫 상태)
    │              ※ 참여 전 동의 체크박스 필수 (GroupBuyOptionSheet)
    │              ※ groupBuyConsent Firestore 저장 (법적 증거)
    │
    ├─ [개인 취소 — RECRUITING 중만 가능]
    │      → status: CANCELLED (해당 주문만)
    │      → currentParticipants -1 (Firestore 트랜잭션)
    │      → Portone 환불 API 호출 (본인만 알림톡)
    │
    ├─ [최소 인원 달성] → CONFIRMED → 이후 취소 불가
    │
    └─ [마감까지 미달]  → CANCELLED → 전체 자동 취소 + Portone 자동 환불 (전체 알림톡)
    ↓
PREPARING    → 상품 준비 중 (전체 알림톡)
    ↓
DELIVERING   → 배송 이동 중 (전체 알림톡)
    ↓
DELIVERED    → 배송 완료 (공동구매는 직배송·택배만, 거점 픽업 미지원)
    ↓
REVIEWED     → 구매 확정 또는 리뷰 작성 완료
```

**공동구매 취소 정책 요약**

| 구간 | 취소 | 환불 | 비고 |
|------|------|------|------|
| RECRUITING | ✅ 가능 | Portone 즉시 처리 | 인원 -1, 타 참여자 알림 없음 |
| CONFIRMED 이후 | ❌ 불가 | 해당 없음 | 동의 체크박스로 사전 고지 완료 |

### 앱별 상태 표시

| 상태 코드 | 소비자 노출 명칭 | 판매자 | 배송기사 | 적용 방식 |
|-----------|----------------|--------|---------|----------|
| PENDING | (미노출) | (미노출) | - | 공통 — 내부 처리 상태, 15분 자동 삭제 |
| RECRUITING | 모집 중 | 모집 중 | - | 공동구매 |
| CONFIRMED | 주문 확정 | 주문 확정 | - | 공동구매 |
| ACCEPTED | 결제 완료 | 신규 주문 접수 | - | 일반 판매 |
| PREPARING | 상품 준비 중 | 준비 중 | - | 공통 |
| DELIVERING | 배송 중 | 배송 중 | 배달 이동 중 | 공통 |
| HUB_ARRIVED | 거점 도착 | 거점 도착 | 배달 완료 | 거점 픽업 |
| PICKED_UP | 픽업 완료 | 픽업 완료 | - | 거점 픽업 |
| DELIVERED | 배송 완료 | 배송 완료 | 완료! | 직배송·택배 |
| CANCELLED | 주문 취소 | 취소 | - | 공통 |
| REVIEWED | 구매 확정 | 구매 확정 | - | 공통 |

---

## 10. 개발 우선순위 (Phase)

### Phase 1 - MVP

**공통 인프라**
- [ ] Next.js 15 프로젝트 세팅 + Firestore 연결 + Vercel 배포
- [ ] NextAuth.js 인증 (카카오, 네이버, 이메일)
- [ ] Firestore 보안 규칙 설정 (role 기반 접근 제어)

**소비자 앱**
- [ ] 상품 탐색 → 상세 → 장바구니 → 결제 핵심 플로우
- [ ] 배송 수단 선택 + isMetropolitan 분기 + Daily Cap Date Picker
- [ ] Portone SDK 결제 연동 (카카오페이, 네이버페이, 카드)
- [ ] Firestore 실시간 리스너 기반 주문 현황 보드
- [ ] 공동구매 참여 흐름 (RECRUITING → CONFIRMED / CANCELLED + 자동 환불)
- [ ] 카카오 알림톡 연동 (주문 상태 변경 알림)
- [ ] PWA 설치 유도 (A2HS, manifest.json, Service Worker)

**판매자 앱**
- [ ] 주문 현황 확인 + 상태 업데이트 (ACCEPTED → PREPARING → DELIVERING)
- [ ] Daily Cap 설정 / 배송비 설정 / 기상 제한 모드
- [ ] 상품 등록 (saleType, deliverySize, 공동구매 설정)
- [ ] 드라이버 배정 (주문별 직접 배정)

**배송기사 앱**
- [ ] 오늘의 배달 목록 확인 (판매자 배정 주문)
- [ ] 픽업 완료 → DELIVERING 처리
- [ ] 직배송·택배: 배달 완료 → DELIVERED 처리
- [ ] 거점 픽업: 거점 도착 → HUB_ARRIVED 처리
- [ ] FCM 배달 배정 알림 수신

### Phase 2

- [ ] QR 스캔 기반 거점 픽업 인증 고도화 (픽업 코드 방식 → QR)
- [ ] 지도 기반 실시간 배송 위치 추적 (Kakao Map / Google Maps)
- [ ] 배송기사 자동 배차 알고리즘 (외부 드라이버 모집 시)
- [ ] PWA 브라우저 푸시 알림 전체 연동 (FCM + Service Worker)
- [ ] 정산 시스템 (판매자별 수익 집계)

### Phase 3

- [ ] 다중 판매자 마켓플레이스 전환 (stores 테이블 확장, 가게 목록 화면)
- [ ] 지역 기반 필터링 UI 활성화
- [ ] 리뷰/평점 집계 및 노출 시스템
- [ ] 통계 대시보드 (판매자 앱)
- [ ] 오프라인 지원 고도화

---

## 11. 보안 체크리스트

### 인증 & 세션 관리

**NextAuth.js 설계 원칙**
```
Session Token  → HttpOnly Cookie에 저장 (XSS 방어)
Firestore 접근 → 서버 측 Admin SDK 또는 Firestore 보안 규칙으로 제어

❌ localStorage에 토큰 저장 (XSS에 취약)
✅ HttpOnly Cookie + Secure 플래그 사용
```

**필수 구현 항목**
- 로그인 실패 5회 시 계정 잠금
- 로그아웃 시 서버에서 세션 무효화
- 비밀번호: bcrypt / argon2로 해싱 (평문 저장 금지)

---

### API 보안

**인증 & 권한**
```
모든 API 요청 → NextAuth.js 세션 검증
역할 확인      → consumer / seller / driver 분리
소유권 확인    → 자기 데이터만 접근 가능

// 주문 조회 시 반드시 소유권 확인
order.userId === session.user.id  ← 누락 시 타인 주문 조회 가능
```

**Rate Limiting** (과도한 요청 차단)
```
로그인 시도    → 분당 5회
주문 생성      → 분당 10회
일반 API       → 분당 100회
```

**입력값 검증**
```
모든 입력값 서버에서 재검증 (클라이언트 검증만 믿으면 안됨)
Firestore 보안 규칙으로 role 및 소유권 이중 검증
XSS → 입력값 Sanitize, CSP 헤더 설정
```

---

### 결제 보안

```
❌ 카드번호, CVV를 자체 서버에 저장/전송
✅ Portone SDK 사용 (PG사에서 직접 처리)

결제 금액 반드시 서버에서 재검증:
  - 클라이언트가 보낸 금액 신뢰 금지
  - 주문 ID로 Firestore 금액 조회 후 대조
```

---

### HTTPS & 통신 보안

```
✅ 모든 통신 HTTPS (HTTP → HTTPS 리다이렉트)
✅ HSTS 헤더 설정
✅ Firestore 보안 규칙 설정 (인증된 사용자만 자기 데이터 접근)
✅ TLS 1.2 이상만 허용
```

**필수 HTTP 보안 헤더**
```
Content-Security-Policy    → XSS 방어
X-Frame-Options: DENY      → Clickjacking 방어
X-Content-Type-Options     → MIME 스니핑 방어
Referrer-Policy            → 민감 URL 노출 방어
```

---

### 역할별 추가 보안

**판매자 앱**
```
가게 소유권 검증 필수
  → 자기 가게 상품/주문만 수정 가능
  → storeId 항상 서버에서 검증

파일 업로드 (상품 이미지)
  → 파일 타입 검증 (확장자 + MIME Type)
  → 용량 제한 (예: 5MB)
  → S3/CDN에 저장, 서버에 직접 저장 금지
```

**배송기사 앱**
```
배정된 주문만 접근 가능
위치 정보는 배달 진행중일 때만 수집/전송
배달 완료 사진 → 개인정보 마스킹 고려 (택배 라벨 등)
```

**소비자 앱**
```
개인정보 (주소, 전화번호) 마스킹 표시
  예: 서울시 강남구 **동 → 상세 조회 시에만 전체 노출
주문 내역 타인 접근 불가 철저히 검증
```

---

### 데이터 보안

```
개인정보 암호화 저장
  → 전화번호, 주소, 계좌번호 등

로그에 민감정보 출력 금지
  → 카드번호, 비밀번호, 토큰 절대 로그 출력 금지

Firestore 접근
  → 앱에서 직접 접근 시 보안 규칙으로 제어
  → 관리 작업은 Admin SDK (서버 측) 사용
```

---

### PWA 특화 보안

```
Service Worker
  → HTTPS에서만 동작 (기본 보장)
  → 캐시에 민감 데이터(토큰, 결제정보) 저장 금지

오프라인 캐시 범위
  → 공개 데이터(상품 목록)만 캐싱
  → 주문/결제/인증 정보는 캐싱 제외
```

---

### 우선순위 요약

**MVP부터 필수**
- [ ] HTTPS 적용 (Vercel 기본 제공)
- [ ] NextAuth.js 세션 Cookie 저장
- [ ] Firestore 보안 규칙 (role 기반 소유권 검증)
- [ ] 비밀번호 해싱 (bcrypt/argon2)
- [ ] Portone 결제 연동 (직접 카드 처리 금지)
- [ ] 입력값 서버 검증

**오픈 전 필수**
- [ ] Rate Limiting
- [ ] 보안 HTTP 헤더 (CSP, X-Frame-Options 등)
- [ ] 파일 업로드 검증
- [ ] 개인정보 암호화

**운영 후 지속**
- [ ] 의존성 취약점 정기 점검 (`npm audit`)
- [ ] 로그 모니터링 (비정상 접근, 대량 요청 감지)
- [ ] 정기 백업 및 복구 테스트

---

## 다음 단계

- 소비자 앱 화면 설계 (Wireframe → Mockup)
- 판매자 앱 상세 화면 설계
- 배송기사 앱 상세 화면 설계
- API 명세 설계 (엔드포인트 전체 정리)
- Firestore 보안 규칙 설계
