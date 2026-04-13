# Green Hub — 로컬 통합 테스트 체크리스트

> **목적**: Railway/Vercel 배포 전, 로컬에서 API ↔ Consumer 전 흐름을 검증한다.
>
> **실행 순서**: API 서버 → Consumer 앱 → 시나리오별 검증

---

## 0. 사전 준비

- [x] `apps/api/.env` 파일에 실제 값 등록 확인 (Firebase, JWT — 포트원은 미입력 상태, 결제 테스트 시 필요)
- [x] `apps/consumer/.env.local` 파일에 실제 값 등록 확인 (포트 오류 수정 완료)
- [ ] Firebase Firestore 규칙에서 테스트 계정 읽기/쓰기 허용 확인

---

## 1. 서버 기동

```bash
# 터미널 A — API (port 3000)
cd C:\Develop\greenhub
pnpm --filter api start:dev

# 터미널 B — Consumer (port 3001)
# 더블클릭: C:\Develop\greenhub\dev-consumer.bat
# 또는:
pnpm --filter consumer dev
```

---

## 2. API 서버 단독 테스트

| # | 항목 | 방법 | 기대 결과 |
|---|------|------|-----------|
| 2-1 | Health check | `GET http://localhost:3000/health` | `{"status":"ok","timestamp":"..."}` |
| 2-2 | 회원가입 | `POST /auth/register` `{"email":"test@test.com","password":"Test1234!","name":"테스터","role":"customer"}` | `{"userId":"..."}` 201 |
| 2-3 | 로그인 | `POST /auth/login` `{"email":"test@test.com","password":"Test1234!"}` | `{"accessToken":"...","user":{...}}` 200 |
| 2-4 | 내 정보 조회 | `GET /auth/me` (Bearer 토큰) | UserProfile 200 |
| 2-5 | 상품 목록 | `GET /stores/:storeId/products` (Bearer 토큰) | `{"items":[],"total":0}` 200 |

---

## 3. Consumer UI 시나리오

| # | 시나리오 | 경로 | 검증 항목 |
|---|----------|------|-----------|
| 3-1 | 로그인 | `http://localhost:3001/login` | 이메일/비밀번호 입력 후 홈 리디렉션 |
| 3-2 | 보호 라우트 | `http://localhost:3001/checkout` (미로그인) | `/login`으로 리디렉션 |
| 3-3 | A2HS 버튼 | `http://localhost:3001/mypage` | "홈화면에 추가" 버튼 노출 (mobile or devtools device) |
| 3-4 | 결제 화면 | `http://localhost:3001/checkout?storeId=<id>&productId=<id>` | 주소 입력 폼 노출 + "카카오페이로 결제" 버튼 |
| 3-5 | 결제 플로우 | 결제 버튼 클릭 | 카카오페이 결제창 오픈 |
| 3-6 | 결제 완료 | 결제 승인 후 | `/order/success?orderId=<id>` 리디렉션 + Firestore 실시간 상태 표시 |

---

## 4. Firestore 실시간 리스너 검증

```
Firestore 콘솔에서 orders/{orderId}.status 를 수동으로
"pending" → "confirmed" → "delivered" 순서로 변경하며
/order/success 화면이 실시간으로 업데이트되는지 확인
```

---

## 5. PWA 설치 검증 (Chrome)

1. Chrome DevTools → Application → Manifest 탭에서 에러 없음 확인
2. Service Worker 등록 확인 (`sw.js`)
3. Lighthouse → PWA 감사 실행 (설치 가능성 통과 확인)

---

## 6. 배포 전 최종 체크

- [x] `pnpm --filter api build` 오류 없음
- [x] `pnpm --filter consumer build --webpack` 오류 없음
- [x] Railway 환경변수 10개 등록 완료 (`FIREBASE_SERVICE_ACCOUNT_JSON` 포함)
- [x] Railway 배포 완료 — Healthcheck 통과, Online 상태 (2026-03-27)
- [x] Firestore 복합 인덱스 7개 배포 완료 (firebase-tools CLI)
- [ ] `CORS_ORIGIN`에 Vercel 프로덕션 도메인 업데이트 예정
- [ ] Vercel 배포 (`apps/consumer`) — 다음 세션
