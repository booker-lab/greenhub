# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 항상 최신화. 200라인 초과 시 50라인 이내 요약.

최종 수정: 2026-04-19 (F3 검증, cut_flower 500 수정, 자동배포 원인 파악)

## ⚡ 다음 세션 즉시 착수 포인트

### 1순위 — 네이버페이 채널키 연결 (승인 이메일 수신 후)

### 2순위 — varietyId 실제 데이터 구축
- 현재 `varieties` 컬렉션은 더미 시드(호접란 10종)
- 실제 품종 데이터로 전면 교체 시 products.varietyId도 함께 업데이트
- "미니 호접란" 상품: `phala-mini` 매핑 예정

### 3순위 — 다음 기능 개발 (미정)
- 소비자 앱 검색/필터 UX 개선
- 공동구매 마감 알림
- 네이버페이 완료 후 결제 E2E 검증

---

## 이번 세션 완료 내역 (2026-04-19 2차)

| # | 작업 | 결과 |
|---|------|------|
| 1 | F3 검증 (Firestore 신규 필드 저장) | ✅ content/selection/sellerNote 정상 저장 확인 |
| 2 | Railway 자동배포 원인 파악 | ✅ 연결 정상 — 단순 push 누락이 원인이었음 |
| 3 | cut_flower varieties 500 수정 | ✅ try/catch 추가 + 인덱스 firebase deploy 완료 |

**F3 보충**: `varietyId` 필드는 더미 데이터 전면 교체 시 함께 처리 예정 (기능 정상, 속성 테이블만 미표시)

---

## 전체 진행 상태

| 단계 | 내용 | 상태 |
|------|------|------|
| 1~94 | 기능 개발 전체 완료 | ✅ |
| 95 | Firebase Storage CORS + 보안 규칙 | ✅ |
| 96 | Vercel 자동배포 확인 | ✅ |
| 97~99 | 디자인 개편 레이어1~3 | ✅ |
| 100~105 | AI Phase A~F | ✅ |
| 106 | varieties 시드 (호접란 10종) | ✅ |
| 107 | AI E2E 검증 전체 (S1~F3) | ✅ 2026-04-19 완료 |
| 108 | cut_flower 500 수정 + 인덱스 배포 | ✅ 2026-04-19 완료 |
| 109 | 네이버페이 채널키 연결 | ⏳ 승인 이메일 대기 중 |

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

## 기술 특이사항 (누적)

- **브랜드명**: Green Love (UI) / greenlove (도메인·기술) / 그린러브 (한글)
- **Firebase Custom Token**: NestJS string → `res.text()` 사용
- **Firestore SW 충돌**: seller/driver 앱 `worker/index.ts`에 `firestore.googleapis.com` NetworkOnly 등록
- **admin role**: `assertSellerOwnsStore`, `settlements.verifyOwnership` 모두 admin bypass 적용
- **PENDING 15분 타임아웃**: 크론잡 매 분 실행 — 자동 CANCELLED + 환불
- **공동구매 DailyCap 비연계**: saleType=group 시 dailyCap 검증 스킵
- **Firebase Storage**: Blaze 플랜 · asia-northeast3 · CORS + 보안규칙 완료
- **shared/dist**: gitignore 예외(`!packages/shared/dist/`)로 Railway 빌드 지원
- **Railway 자동배포**: GitHub push 시 자동 트리거 정상. 과거 미작동은 로컬 커밋 후 push 누락이 원인
- **varieties 인덱스**: category+subCategory+name 복합 인덱스 배포 완료
- **cut_flower varieties**: 시드 데이터 없음 → 빈 배열 반환(정상). 500은 인덱스 미배포 + 예외처리 부재였음
- **AI 모델**: `gemini-3-flash-preview` (Google AI Studio) — 정상 작동 확인
- **AI generate-content**: POST → 201 Created 정상 반환
- **AI 에러 메시지 버그**: 재생성 성공 시 `setError(null)` 누락 → 수정 완료
- **SW 캐시 충돌**: 새 배포 후 DevTools → Application → SW Unregister + 강력 새로고침
- **Pretendard 폰트**: globals.css CDN import
- **Mantine v9 Badge**: `.m_5add502a`에 `text-box-trim:none` 오버라이드 (한글 클리핑 방지)
