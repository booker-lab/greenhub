# Green Love — 프로젝트 메모리

> **SSOT** — 세션 종료 시 항상 최신화. 200라인 초과 시 50라인 이내 요약.

최종 수정: 2026-04-23 (카카오 채널 개설, 알리고 연동 진행, 공동구매 수량 전환 설계)

## ⚡ 다음 세션 착수 순서

| 순위 | 작업 | 조건 |
|------|------|------|
| 1 | **공동구매 수량 기반 전환** | 즉시 가능 — 상세 계획 `docs/specs/next_session_tasks.md` |
| 2 | **네이버페이 채널키 연결** | 승인 이메일 수신 후 |
| 3 | **알리고 ↔ 카카오 채널 연동 + 템플릿 심사** | 그린러브 사업자등록증 발급 후 |
| 4 | **SELLER_ORDER_BATCH 스케줄러** | 알림톡 연동 후 |
| 5 | **GreenLoveBrandSection 브랜드 이미지** | 디자이너 이미지 수령 후 |

---

## 이번 세션 완료 내역 (2026-04-23)

| # | 작업 | 결과 |
|---|------|------|
| 1 | ai_product_content.md A2 체크박스 완료 처리 | ✅ varieties 30종 완료 반영 |
| 2 | 알리고 가입 (디어오키드 사업자) | ✅ tazan1988 계정 |
| 3 | 카카오 비즈니스 채널 개설 | ✅ 채널명: 그린러브, ID: greenlove |
| 4 | 알리고 ↔ 카카오 채널 연동 시도 → 사업자인증 필요로 보류 | ⏸ 그린러브 사업자등록증 후 재시도 |
| 5 | 공동구매 수량 기반 전환 설계 완료 | 📋 아토믹 태스크 준비 완료 |

---

## 전체 진행 상태

| 단계 | 내용 | 상태 |
|------|------|------|
| 1~117 | 기능 개발 + AI Phase A~F + 버그수정 다수 | ✅ |
| 118 | 네이버페이 채널키 연결 | ⏳ 승인 이메일 대기 |
| 119 | 카카오 채널 개설 | ✅ 2026-04-23 |
| 120 | 알리고 ↔ 카카오 연동 | ⏸ 사업자등록증 후 |
| 121 | 공동구매 수량 기반 전환 | 📋 다음 세션 착수 |

---

## 실서비스 오픈 전 체크리스트

| 항목 | 내용 |
|------|------|
| 알리고 선불 충전 | 건당 8~15원, 충전 없이 발송 불가 |
| 카카오비즈니스 사업자 등록 | 그린러브 사업자등록증 발급 후 채널에 등록 |
| 알리고 ↔ 카카오 연동 | `smartsms.aligo.in` → 카카오톡 → 발신프로필 등록 (채널 ID: greenlove) |
| 알림톡 템플릿 심사 | 25개 템플릿, 3~5 영업일 소요 |
| 네이버페이 채널키 | PORTONE_WEBHOOK_SECRET + NAVERPAY_CHANNEL_KEY Railway 설정 |

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
- **카카오 채널**: ID `greenlove`, URL `http://pf.kakao.com/_vGfjX`
- **알리고 계정**: tazan1988, 디어오키드 사업자 등록 — 그린러브 채널 연동 시 사용 가능
- **Firebase Custom Token**: NestJS string → `res.text()` 사용
- **Firestore SW 충돌**: seller/driver `worker/index.ts`에 `firestore.googleapis.com` NetworkOnly 등록
- **shared/dist**: gitignore 예외(`!packages/shared/dist/`) — **타입 변경 시 반드시 `pnpm --filter @greenhub/shared build` 후 커밋**
- **Railway 자동배포**: GitHub push 시 자동 트리거
- **AI 모델**: `gemini-3-flash-preview` — 정상 작동 확인
- **AI 프롬프트**: `apps/api/src/ai/prompts/product-content.prompt.ts`
- **Gemini JSON 파싱**: 줄바꿈 이스케이프 처리 완료
- **varieties**: availableStemTypes 전 품종 4가지 통일. 30종 Firestore 시드 완료
- **ImageUpload**: 버튼 `type="button"` 필수 / `key={idx}` (position 기반)
- **ProductForm localStorage**: `useState` 초기화가 아닌 `useEffect`에서 복원 (hydration 방지)
- **가격 입력**: Mantine `NumberInput` + `thousandSeparator=","` + `hideControls`
- **공동구매**: 현재 인원 기반 — 수량 기반 전환 예정 (다음 세션)
