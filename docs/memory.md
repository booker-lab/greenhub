# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 항상 최신화. 200라인 초과 시 50라인 이내 요약.

최종 수정: 2026-04-21 (AI 프롬프트 고도화, stemType 소비자 페이지 반영, ImageUpload 버그 수정)

## ⚡ 다음 세션 착수 순서

> 상세 내용: `docs/specs/next_session_tasks.md`

| 순위 | 작업 | 조건 |
|------|------|------|
| 1 | **네이버페이 채널키 연결 + PORTONE_WEBHOOK_SECRET 설정** | 승인 이메일 수신 후 — Railway 환경변수에 `PORTONE_WEBHOOK_SECRET=whsec_...` 추가 |
| 2 | **products.varietyId 매핑** | 기존 상품에 varietyId 연결 스크립트 |
| 3 | 카카오 알림톡 실제 연동 | 알리고 가입 + 심사 |
| 4 | SELLER_ORDER_BATCH 스케줄러 | notifications.service.ts 추가 |
| 5 | GreenLoveBrandSection 브랜드 이미지 추가 | 디자이너 이미지 파일 수령 후 |
| 6 | 공동구매 수량 기반 모델 전환 | Phase 2 대규모 |
| 7 | FCM 브라우저 푸시 | Should Have |

---

## 이번 세션 완료 내역 (2026-04-21)

| # | 작업 | 결과 |
|---|------|------|
| 1 | stemType 소비자 상세 페이지 속성 테이블 추가 | ✅ |
| 2 | varieties 30종 availableStemTypes 전체 4가지 통일 | ✅ Firestore 재시드 완료 |
| 3 | AI 프롬프트 T1~T4 고도화 | ✅ stemType 반영, 헤드라인 규칙 강화, description 3문장 구조+\n, 카테고리별 분기 |
| 4 | generate-content DTO/params에 category 필드 추가 | ✅ |
| 5 | 소비자 description whiteSpace: pre-line 적용 | ✅ |
| 6 | ImageUpload 버튼 type="button" 누락 버그 수정 | ✅ 대표 설정·삭제·사진 추가 버튼 모두 수정 |

---

## 전체 진행 상태

| 단계 | 내용 | 상태 |
|------|------|------|
| 1~109 | 기능 개발 + AI Phase A~F + E2E 검증 | ✅ |
| 110 | suspended 로그인 차단 | ✅ |
| 111 | varieties 30종 실제 데이터 구축 | ✅ |
| 112 | stemType 스키마 + UI 연동 | ✅ |
| 113 | 네이버페이 채널키 연결 | ⏳ 승인 이메일 대기 |
| 114 | AI 프롬프트 고도화 (T1~T4) | ✅ 2026-04-21 |
| 115 | ImageUpload form submit 버그 수정 | ✅ 2026-04-21 |

---

## 배포 현황

| 항목 | 값 |
|------|-----|
| Railway API | `https://api-production-13e7.up.railway.app` |
| Vercel Consumer | `https://greenlove.co.kr` |
| Vercel Seller | `https://seller.greenlove.co.kr` |
| Firebase | `green-e4fe3` · asia-northeast3 |
| GitHub | `booker-lab/greenhub` |

---

## 기술 특이사항 (누적)

- **브랜드명**: Green Love (UI) / greenlove (도메인·기술)
- **Firebase Custom Token**: NestJS string → `res.text()` 사용
- **Firestore SW 충돌**: seller/driver `worker/index.ts`에 `firestore.googleapis.com` NetworkOnly 등록
- **SW 캐시 갱신**: cleanupOutdatedCaches + JS청크 NetworkFirst — 배포 후 자동 처리
- **admin role**: `assertSellerOwnsStore`, `settlements.verifyOwnership` 모두 admin bypass
- **PENDING 15분 타임아웃**: 크론잡 매 분 실행 — 자동 CANCELLED + 환불
- **shared/dist**: gitignore 예외(`!packages/shared/dist/`) — Railway 빌드 지원. **타입 변경 시 반드시 `pnpm --filter @greenhub/shared build` 후 커밋**
- **Railway 자동배포**: GitHub push 시 자동 트리거
- **AI 모델**: `gemini-3-flash-preview` (Google AI Studio) — 정상 작동 확인
- **AI 프롬프트**: `apps/api/src/ai/prompts/product-content.prompt.ts` — 규칙 수정 가능
- **AI 프롬프트 구조**: 헤드라인(명사형 15자) + description(3문장 \n 구분) + 카테고리별 분기
- **기존 상품 AI 재생성**: 셀러 앱 편집 → Step 4 → "다시 생성하기" 클릭 필요
- **varieties 스키마**: flowerSize + plantSize + availableStemTypes(전 품종 4가지 통일)
- **stemType**: Selection 필드. 소비자 상세 페이지 속성 테이블에 출하 형태로 표시
- **ImageUpload 버튼**: `type="button"` 필수 — 미지정 시 form submit 트리거됨
- **Mantine v9 Badge**: `.m_5add502a`에 `text-box-trim:none` 오버라이드 (한글 클리핑 방지)
