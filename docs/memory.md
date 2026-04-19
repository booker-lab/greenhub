# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 항상 최신화. 200라인 초과 시 50라인 이내 요약.

최종 수정: 2026-04-19 (AI E2E 검증 완료, Railway 배포 수정)

## ⚡ 다음 세션 즉시 착수 포인트

### 1순위 — F3 검증 (Firebase Console)
- Firebase Console → Firestore → products 컬렉션 → "미니 호접란" 상품 문서
- `varietyId`, `selection`, `content` 필드 저장 확인
- 확인 후 AI E2E 검증 전체 완료 선언

### 2순위 — Railway 자동 배포 복구
- GitHub → Settings → Integrations → GitHub Apps → Railway App → Configure
- `booker-lab/greenhub` 레포 접근 권한 확인 및 재설정
- 현재 push마다 Railway에서 수동 배포 필요한 상태

### 3순위 — category=cut_flower 500 오류 수정
- 절화(cut_flower) 카테고리 선택 시 varieties API 500 반환
- 빈 배열 반환이 정상이나 500이 발생 중 → orderBy 인덱스 누락 가능성
- `varieties.service.ts` findAll에서 카테고리 없을 때 예외처리 추가 고려

### 4순위 — 네이버페이 채널키 연결 (승인 이메일 수신 후)

---

## 이번 세션 완료 내역 (2026-04-19)

| # | 작업 | 결과 |
|---|------|------|
| 1 | Railway 빌드 오류 수정 (TS2307 @greenhub/shared) | ✅ shared/dist git 포함으로 해결 |
| 2 | GitHub webhook 재연결 | ✅ Railway Settings에서 branch 재연결 |
| 3 | Firestore varieties 복합 인덱스 추가 | ✅ firebase deploy 완료 |
| 4 | S1 Storage 업로드 CORS 검증 | ✅ |
| 5 | S2/S3 품종 API + 선택 검증 | ✅ 호접란 10종 정상 로드 |
| 6 | T1/T2 터치 선택 검증 | ✅ |
| 7 | A1 Gemini AI 생성 검증 | ✅ "책상 위 순백의 미니 호접란" 생성 |
| 8 | A4 재생성 검증 | ✅ API 201 성공 (UI 버그 수정 포함) |
| 9 | F1/F2 상품 등록·목록 검증 | ✅ |
| 10 | AI 재생성 에러 메시지 잔류 버그 수정 | ✅ setError(null) 추가 |

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
| 107 | AI E2E 검증 (P1~A4, F1/F2) | ✅ |
| 108 | F3 Firestore 신규 필드 저장 확인 | ⏳ 다음 세션 |

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
- **Railway 자동배포**: GitHub App 설치 확인됐으나 push 자동 트리거 미작동 → 수동 배포 필요
- **varieties 인덱스**: category+subCategory+name 복합 인덱스 배포 완료
- **AI 모델**: `gemini-3-flash-preview` (Google AI Studio) — 정상 작동 확인
- **AI generate-content**: POST → 201 Created 정상 반환
- **AI 에러 메시지 버그**: 재생성 성공 시 `setError(null)` 누락 → 수정 완료
- **SW 캐시 충돌**: 새 배포 후 DevTools → Application → SW Unregister + 강력 새로고침
- **Pretendard 폰트**: globals.css CDN import
- **Mantine v9 Badge**: `.m_5add502a`에 `text-box-trim:none` 오버라이드 (한글 클리핑 방지)
