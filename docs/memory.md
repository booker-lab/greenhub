# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 항상 최신화. 200라인 초과 시 50라인 이내 요약.

최종 수정: 2026-04-14 (TC-7 소비자 취소 UI 완료)

## ⚡ 다음 세션 즉시 착수 포인트

### 1순위 — Firebase Storage CORS 적용
- cors.json 커밋 완료: `/c/Develop/greenhub/cors.json`
- `winget install Google.CloudSDK` → `gcloud auth login`
- `gcloud storage buckets update gs://green-e4fe3.firebasestorage.app --cors-file=/c/Develop/greenhub/cors.json`

### 2순위 — 네이버페이 채널키 연결 (승인 이메일 수신 후)

### 3순위 — ~~Vercel GitHub 자동배포 복구~~ ✅ 완료 (2026-04-15 확인)
- consumer/seller/driver 3개 앱 모두 GitHub push → Vercel 자동배포 정상 동작 중
- 구 `consumer` 빈 프로젝트 Vercel 대시보드에서 삭제 권장

### 4순위 — 공동구매 수량 기반 모델 전환 (Phase 2)

---

## 전체 진행 상태

| 단계 | 내용 | 상태 |
|------|------|------|
| 1~93 | 이전 세션 전체 완료 | ✅ |
| 94 | TC-7 소비자 취소 UI | ✅ 2026-04-14 |
| 95 | Firebase Storage CORS | ⬜ 다음 세션 |
| 96 | Vercel 자동배포 상태 확인 | ✅ 2026-04-15 (정상 동작 확인) |

---

## 배포 현황

| 항목 | 값 |
|------|-----|
| Railway API | `https://api-production-13e7.up.railway.app` |
| Vercel Consumer | `https://greenlove.co.kr` |
| Vercel Seller | `https://seller.greenlove.co.kr` |
| Vercel Driver | `https://driver.greenlove.co.kr` |
| Firebase | `green-e4fe3` · asia-northeast3 |
| GitHub | `booker-lab/greenhub` |

---

## storeId 구조 (최종)

| 항목 | 값 |
|------|-----|
| 운영 storeId (난플렉스) | `80189070-2c3d-45f2-bc11-68a870b13951` |
| admin 유저 uid | `6c176cb5-40e1-4d86-8764-6bc87035503a` |
| 셀러 로그인 | admin 카카오 계정 1개로 seller 앱 운영 |
| 드라이버 로그인 | 미등록 카카오 계정 → role=driver 자동 생성 (MVP 정책) |

---

## 기술 특이사항 (누적)

- **브랜드명**: Green Love (UI) / greenlove (도메인·기술) / 그린러브 (한글)
- **Firebase Custom Token**: NestJS string → `res.text()` 사용 (res.json() 불가)
- **Firestore SW 충돌**: seller/driver 앱 `worker/index.ts`에 `firestore.googleapis.com` NetworkOnly 등록
- **admin role**: `assertSellerOwnsStore`, `settlements.verifyOwnership` 모두 admin bypass 적용
- **PENDING 15분 타임아웃**: 크론잡 매 분 실행 — 자동 CANCELLED + 환불
- **공동구매 DailyCap 비연계**: `orders-create.service.ts` — saleType=group 시 dailyCap 검증 스킵
- **공동구매 groupBuyConsent**: checkout에서 saleType=group이면 자동 전송
- **공동구매 중복 참여 방지**: 비취소 주문 존재 시 409 / 1인 1개 제한
- **공동구매 isProcessed**: groupProductConfig 생성 시 반드시 false 포함 (크론잡 쿼리 조건)
- **공동구매 cancelOrder**: Firestore 트랜잭션 read 먼저 후 write (순서 위반 시 500)
- **공동구매 마감일시 timezone**: seller 폼에서 `.toISOString()` 변환 후 전송 (KST→UTC)
- **useGroupProduct**: Firestore onSnapshot → Timestamp → ISO string 변환 필수
- **useOrderStatus**: terminal 상태(CANCELLED/DELIVERED/REVIEWED) 도달 시 폴링 중단
- **Firebase Storage CORS**: seller 이미지 업로드 차단 중 — gcloud SDK 설치 후 cors.json 적용 필요
- **Vercel 수동 배포**: consumer는 모노레포 루트에서 VERCEL_PROJECT_ID/ORG_ID 지정 후 배포
