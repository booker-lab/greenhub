# 다음 세션 작업 목록

> 작성: 2026-04-13 | 공동구매 E2E 완료 후 잔여 작업

---

## 1순위 — TC-7 소비자 취소 UI 구현

**배경**: TC-7에서 API는 정상 동작 확인됐으나 Consumer UI가 미구현 상태.

**구현 위치**: `apps/consumer/src/app/mypage/orders/[id]/page.tsx`

**요구사항**:
- RECRUITING 상태일 때만 **"공동구매 참여 취소"** 버튼 노출
- 버튼 클릭 → 확인 모달 ("취소 시 즉시 환불됩니다. 계속하시겠습니까?")
- API 호출: `PATCH /stores/:storeId/orders/:orderId/cancel`
- 성공 시 주문 상태 CANCELLED로 UI 갱신

**API 엔드포인트**: 이미 구현·검증 완료

---

## 2순위 — Firebase Storage CORS 적용

**배경**: Seller 이미지 업로드가 CORS 오류로 차단 중.

**작업 순서**:
```bash
winget install Google.CloudSDK
# 재시작 후
gcloud auth login
gcloud storage buckets update gs://green-e4fe3.firebasestorage.app \
  --cors-file=/c/Develop/greenhub/cors.json
```

**cors.json 위치**: `/c/Develop/greenhub/cors.json`

---

## 3순위 — 네이버페이 채널키 연결

**배경**: 네이버페이 파트너 가입 신청 완료, 승인 이메일 대기 중.

**작업**: 승인 이메일 수신 후 `NAVERPAY_CHANNEL_KEY` 환경변수를 Railway에 추가하면 자동 노출.

---

## 4순위 — 공동구매 수량 기반 모델 전환 (Phase 2)

**배경**: 현재 인원 기반 모델 → 수량 기반으로 전환 예정.

**설계 내용**: `docs/CRITICAL_LOGIC.md` [2026-04-13] 참조

**변경 범위**:
- `groupProductConfig` 스키마: `minParticipants/maxParticipants` → `targetQuantity/minQuantity/maxPerPerson/currentQuantity`
- API 3곳: orders-create / orders-lifecycle / notifications
- Seller 상품 등록 폼 필드 교체
- Consumer 프로그레스바 "N/M개" 표시
- shared 타입 업데이트
- Firestore 기존 데이터 마이그레이션

**주의**: Firestore 스키마 변경이므로 기존 데이터 마이그레이션 스크립트 필요

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
