# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 항상 최신화. 200라인 초과 시 50라인 이내 요약.

최종 수정: 2026-04-20 (suspended 차단, varieties 30종, stemType UI, AI 정상 확인)

## ⚡ 다음 세션 착수 순서

> 상세 내용: `docs/specs/next_session_tasks.md`

| 순위 | 작업 | 조건 |
|------|------|------|
| 1 | **네이버페이 채널키 연결** | 승인 이메일 수신 후 |
| 2 | **products.varietyId 매핑** | 기존 상품에 varietyId 연결 스크립트 |
| 3 | AI 프롬프트 규칙 커스터마이징 | product-content.prompt.ts 수정 |
| 4 | 카카오 알림톡 실제 연동 | 알리고 가입 + 심사 |
| 5 | SELLER_ORDER_BATCH 스케줄러 | notifications.service.ts 추가 |
| 6 | 공동구매 수량 기반 모델 전환 | Phase 2 대규모 |
| 7 | FCM 브라우저 푸시 | Should Have |

---

## 이번 세션 완료 내역 (2026-04-20)

| # | 작업 | 결과 |
|---|------|------|
| 1 | suspended 로그인 차단 | ✅ login/kakaoLogin 401 추가, AuditAction 등록 |
| 2 | SW 캐시 갱신 개선 | ✅ cleanupOutdatedCaches + JS청크 NetworkFirst |
| 3 | varieties 30종 실제 데이터 구축 | ✅ 판매 상위 30종 JSON + Firestore 시드 완료 |
| 4 | 스키마 확장 | ✅ flowerSize/plantSize/availableStemTypes/stemType/ColorOption 확장 |
| 5 | stemType UI 연동 | ✅ TouchSelector 출하 형태 섹션, 품종별 필터링 |
| 6 | SelectionDto stemType 추가 | ✅ 400 오류 수정 |
| 7 | shared dist 재빌드 | ✅ Railway 빌드 반영 |
| 8 | AI 상세 설명 autosize | ✅ 내용 전체 표시 |

---

## 전체 진행 상태

| 단계 | 내용 | 상태 |
|------|------|------|
| 1~106 | 기능 개발 + AI Phase A~F + 시드 | ✅ |
| 107 | AI E2E 검증 전체 (S1~F3) | ✅ |
| 108 | cut_flower 500 수정 + 인덱스 배포 | ✅ |
| 109 | 네이버페이 채널키 연결 | ⏳ 승인 이메일 대기 |
| 110 | suspended 로그인 차단 | ✅ 2026-04-20 |
| 111 | varieties 30종 실제 데이터 구축 | ✅ 2026-04-20 |
| 112 | stemType 스키마 + UI 연동 | ✅ 2026-04-20 |

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
- **SW 캐시 갱신**: cleanupOutdatedCaches + JS청크 NetworkFirst — 배포 후 자동 처리 (수동 Unregister 불필요)
- **admin role**: `assertSellerOwnsStore`, `settlements.verifyOwnership` 모두 admin bypass
- **PENDING 15분 타임아웃**: 크론잡 매 분 실행 — 자동 CANCELLED + 환불
- **shared/dist**: gitignore 예외(`!packages/shared/dist/`) — Railway 빌드 지원. **타입 변경 시 반드시 `pnpm --filter @greenhub/shared build` 후 커밋**
- **Railway 자동배포**: GitHub push 시 자동 트리거
- **AI 모델**: `gemini-3-flash-preview` (Google AI Studio) — 정상 작동 확인
- **AI 프롬프트**: `apps/api/src/ai/prompts/product-content.prompt.ts` — 규칙 수정 가능
- **varieties 스키마**: flowerSize(소/중/대륜) + plantSize(소/중/대형) + availableStemTypes(외대/쌍대/가지/3대)
- **stemType**: Selection 필드. 품종 선택 시 availableStemTypes 필터링하여 터치 선택 표시
- **varieties 인덱스**: category+subCategory+name 복합 인덱스 배포 완료
- **Mantine v9 Badge**: `.m_5add502a`에 `text-box-trim:none` 오버라이드 (한글 클리핑 방지)
