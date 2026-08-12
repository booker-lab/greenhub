<!-- Language: ko -->

# 🗺️ Project Blueprint: consumer 운영 이미지 복구와 실패 대체 처리

## 문서 메타

- **Linear-Issue**: 없음
- **Priority**: 1
- **Labels**: consumer, firebase-storage, image-recovery, kakao-business
- **Related**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Architectural Goal**: Firebase Storage 접근을 정상화해 기존 상품·배너·스토어 사진을 복구하고 원본 장애가 재발해도 consumer 화면에 깨진 이미지가 노출되지 않게 한다.

## 📋 업무 요약 (협업용)

### 개요

운영 홈의 배너와 공개 상품 5개의 대표 사진, 상품 상세 사진, 공통 스토어 로고가 모두 로드되지 않는다. 운영 API에는 이미지 주소가 등록돼 있지만 모든 원본이 Firebase Storage에서 `402 Payment Required`를 반환한다. Firebase 공식 정책상 2026년 2월 3일부터 Cloud Storage 사용에는 Blaze 요금제가 필요하므로 저장소 접근 복구가 우선이다. 동시에 원본 장애가 다시 발생해도 상품은 중립 대체 이미지, 배너는 이미지 없는 배너, 스토어 로고는 상호 첫 글자 아바타로 안전하게 표시한다.

### 끝났을 때 확인할 것

- 배너, 공개 상품 5개, 상품 상세 사진과 스토어 로고 원본이 HTTP 200과 이미지 콘텐츠 형식으로 응답한다.
- 운영 홈과 5개 상품 상세에서 실제 사진의 `naturalWidth`와 `naturalHeight`가 0보다 크다.
- 의도적으로 실패시킨 상품 이미지에는 중립 대체 이미지가 표시된다.
- 실패한 배너 사진은 깨진 아이콘 없이 텍스트 배너로 유지된다.
- 실패한 스토어 로고는 상호 첫 글자 아바타로 전환된다.
- consumer 테스트, lint, production build, 데스크톱과 375×812 모바일 검증이 통과한다.
- consumer 변경만 배포하고 API, seller, driver, 상품·스토어 데이터는 불필요하게 변경하지 않는다.

### 이번에 하지 않는 것

- 사용자 승인 없는 Firebase Blaze 전환, 결제 계정 연결과 비용 발생
- 기존 사진을 임의 이미지로 교체하거나 상품·스토어 정보를 추측해 수정
- 저장소 제공자 마이그레이션과 판매자 업로드 구조 개편
- 상품, 배너, 스토어 문서 삭제
- 카카오 재신청과 카카오 채널·이메일·DNS·ALIGO 변경
- 주소, 비공개 Gmail, 로그인 정보, 사업자등록증 이미지, 생년월일 기록

## 🎯 Origin Intent

- **출처**: 운영 상품·스토어 사진이 대부분 깨져 보인다는 사용자 확인 요청과 2026년 8월 11일 운영 진단
- **원래 목적**: 카카오 심사자와 일반 고객이 공개 홈페이지에서 실제 판매상품과 운영 스토어를 정상 사진으로 확인하게 한다.
- **완료 관찰**: 운영 홈과 상품 상세에서 실제 사진이 보이고 저장소 장애를 강제로 재현해도 깨진 이미지 표시가 남지 않는다.

## ⚠️ Edge Case Trace

| 엣지 케이스 | 출처 | Task-ID / 범위 밖 | 안전 조건 |
| :--- | :--- | :--- | :--- |
| Firebase 프로젝트가 Spark 요금제라 모든 Storage 요청이 402를 반환 | 운영 진단·공식 문서 | 0.2, 0.3, 2.4 | 결제 변경 전 사용자 승인을 받고 예산 알림을 함께 설정 |
| Blaze 전환이 승인되지 않음 | 비용 경계 | 0.3, 범위 밖 | 대체 표시 코드까지만 배포하고 실제 사진 복구는 별도 마이그레이션 계획으로 분리 |
| Blaze 전환 뒤 일부 객체만 404 또는 권한 오류 | 데이터 경계 | 0.4, 2.4 | 정확한 누락 목록만 기록하고 승인된 원본 없이 교체하지 않음 |
| Next 이미지 프록시에 이전 실패가 남음 | 캐시 경계 | 2.3, 2.4 | 원본 200 확인 뒤 새 배포와 운영 프록시 응답을 따로 재검증 |
| 대체 이미지 자체가 실패해 오류가 반복됨 | 렌더링 경계 | 1.2 | 실패 상태를 한 번만 전환하고 최종 대체 실패 시 이미지 영역을 안전하게 숨김 |
| 배너 사진만 실패 | 화면 경계 | 1.3 | 배너 문구와 동작은 유지하고 사진 구획만 제거 |
| 스토어 로고만 실패 | 화면 경계 | 1.8 | 기존 `logoUrl=null` 분기와 같은 첫 글자 아바타 사용 |
| 상세용 자유 비율 이미지가 실패 | 화면 경계 | 1.7 | 레이아웃 높이를 깨뜨리지 않고 실패한 상세 이미지만 숨김 |
| 운영 화면 조사 중 개인정보가 노출됨 | 개인정보 경계 | 2.4 | 전체 DOM·주소·연락처를 수집하거나 문서에 기록하지 않음 |
| consumer 외 서비스가 자동 배포됨 | 배포 경계 | 3.2 | `packages/shared`를 변경하지 않고 배포별 영향 범위를 확인 |

## 🔍 Diagnosis & Findings

- 운영 API의 배너와 활성 상품 5개에는 모두 `firebasestorage.googleapis.com` 주소가 등록돼 있다.
- 배너와 상품 5개 원본 요청은 모두 HTTP `402 Payment Required`, 콘텐츠 형식 `application/json`을 반환했다.
- 운영 브라우저의 홈 이미지 6개는 모두 로드 완료 상태지만 실제 크기가 `0×0`이었다.
- 상품 상세 5개에서 대표·상세 이미지와 공통 스토어 로고가 모두 실제 크기 `0×0`이었다.
- Vercel 최근 오류 로그와 브라우저 콘솔에는 관련 서버 예외가 없어 consumer 런타임 자체보다 원본 저장소 접근 실패가 직접 원인이다.
- Firebase 공식 문서는 Spark 요금제 프로젝트의 Storage 요청이 `402` 또는 `403`으로 실패하며 2026년 2월 3일부터 기존 버킷 접근에도 Blaze 요금제가 필요하다고 안내한다.
- 현재 consumer는 이미지 주소가 없을 때만 기본 이미지를 쓰고 등록된 주소의 로드 실패는 처리하지 않는다.

## 🏗️ Architectural Deepening

- **원본 복구 경계**: 기존 주소와 객체를 보존한 채 Firebase Storage 접근을 먼저 복구한다. 정상화되면 DB 주소 변경 없이 사진이 다시 표시돼야 한다.
- **비용 승인 경계**: Blaze 전환과 Cloud Billing 연결은 코드·배포 승인에 포함하지 않는다. 사용자의 별도 명시적 승인을 받은 뒤 실행한다.
- **화면 복원력 경계**: `next/image` 기반 공통 실패 대체 컴포넌트가 원격 주소 실패를 한 번 감지하고 화면별 대체 UI로 전환한다.
- **배너 경계**: 배너 데이터와 문구·동작은 유지하며 사진 실패만 숨긴다.
- **상품 경계**: 대표 사진 실패 시 기존 로컬 아이콘을 대체 이미지로 사용하고 상품명·가격·구매 동선은 유지한다.
- **상세 이미지 경계**: 자유 비율 native 이미지에는 별도 실패 처리를 적용해 실패한 이미지가 레이아웃 빈칸을 만들지 않게 한다.
- **스토어 경계**: 로고 미등록과 로드 실패를 동일한 첫 글자 아바타 UI로 수렴시킨다.
- **배포 경계**: `apps/consumer`와 관련 consumer 테스트·문서만 변경해 API, seller, driver 배포를 유발하지 않는다.
- **대체 경로**: Blaze 전환이 불가하면 이번 계획을 실제 사진 복구 완료로 닫지 않고 저장소 마이그레이션을 새 Blueprint로 분리한다.

## Agent Completion Contract

1. Task를 Dependency 순서대로 한 번에 하나씩 실행한다.
2. 시작 시 지정 worktree의 branch, HEAD, status, 작업 트리 diff와 staging diff를 확인한다.
3. 기준 branch는 `codex/kakao-business-channel-proof`, 기준 HEAD는 `0a02b31806812e85104a409f4284302f64e38c17`, 예상 상태는 clean이다.
4. 기준 상태가 다르거나 예상하지 못한 변경이 있으면 아무것도 수정하지 않고 중단해 보고한다.
5. consumer 코드를 수정하기 전에 `apps/consumer/AGENTS.md`와 설치된 Next.js 16 관련 문서를 읽는다.
6. 신규 실패 대체 로직은 실패 계약을 먼저 만든 뒤 구현한다.
7. Firebase Blaze 전환, Cloud Billing 계정 연결과 비용 변경은 사용자의 별도 명시적 승인 전에는 수행하지 않는다.
8. 승인된 코드 수정·검증·push·PR·consumer 배포 범위만 수행하고 카카오 재신청은 수행하지 않는다.
9. 운영 데이터에서 개별 이미지 주소를 수정하거나 객체를 교체해야 하면 정확한 대상과 승인된 원본을 확인한 뒤 별도 승인을 받는다.
10. 각 Task의 Verify 종료 코드가 0일 때만 Conclusion과 Status를 닫는다.
11. PLAN 전체 실행 요청 뒤 Blueprint 구조는 고정하고 Conclusion·Status·Closeout만 갱신한다.
12. 주소, 비공개 Gmail, 로그인·인증 정보, 사업자등록증 이미지와 생년월일을 코드·문서·로그·commit에 기록하지 않는다.
13. 모든 Git commit 메시지는 한국어로 작성하고 비공개 이메일이 아닌 공개 `noreply` 메타데이터를 사용한다.

> **에이전트 스코프**: 사용자가 PLAN 전체 실행을 요청하면 Firebase Storage 상태와 비용 게이트를 먼저 확인하고 승인된 범위에서 원본 접근을 복구한 뒤 consumer 이미지 실패 대체 처리, 테스트, PR, consumer production 배포와 운영 검증을 순서대로 진행한다. 비용 변경과 승인되지 않은 이미지·데이터 교체는 수행하지 않는다.

## Execution Plan

### Phase 0 — 상태 확인과 Firebase 원본 복구

#### Task 0.1 — 작업공간 기준선 확인 [Unit: Atomic]

- **Task-ID**: 0.1
- **Dependency**: 없음
- **Pre-read**: `apps/consumer/AGENTS.md`, `docs/memory.md`, 본 PLAN
- **Target**: `docs/plans/PLAN_consumer_image_recovery.md`
- **Goal**: 지정 worktree가 승인된 branch와 HEAD의 깨끗한 상태인지 확인한다.
- **Verify**: `git status --short --branch`
- **Conclusion**: branch `codex/kakao-business-channel-proof`, HEAD `0a02b31806812e85104a409f4284302f64e38c17`을 확인했다. 작업 트리에는 예상된 미추적 문서 `PLAN_consumer_image_recovery.md`, `PROMPT_consumer_image_recovery.md`만 있고 작업 트리 diff와 staging diff는 모두 비어 있었다.
- **Status**: done

#### Task 0.2 — Storage 오류와 결제 상태 확정 [Unit: Atomic]

- **Task-ID**: 0.2
- **Dependency**: Task 0.1
- **Pre-read**: Firebase Storage 요금제 변경 공식 문서, 운영 API의 공개 이미지 필드
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 민감정보 없이 원본 402 응답 본문과 Firebase 요금제·Billing 연결 상태를 확정한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Conclusion**: 운영 배너와 공개 상품 5개 대표 이미지 원본은 모두 `firebasestorage.googleapis.com`, HTTP 402, `application/json`이었다. 오류 본문은 소유 프로젝트에 연결된 결제 계정이 `closed` 상태라 비활성이라고 응답했다. Firebase 콘솔의 현재 요금제는 `Spark`이고 프로젝트는 활성 상태지만 Cloud Billing 계정은 연결된 채 닫혀 있으며 `billingEnabled=false`다. 2026년 2월 3일부터 기존 버킷 접근에도 Blaze가 필요하다는 Firebase 공식 정책과 일치하므로 기존 사진 접근 복구에는 활성 Cloud Billing을 통한 Blaze 전환이 필요하다.
- **Status**: done

#### Task 0.3 — Firebase Storage 접근 복구 [승인 게이트]

- **Task-ID**: 0.3
- **Dependency**: Task 0.2, 사용자 비용 변경 승인
- **Pre-read**: Firebase Blaze 전환 공식 문서, Cloud Billing 예산 알림 문서
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 승인된 경우 Firebase 프로젝트를 Blaze 요금제와 활성 Billing에 연결하고 예산 알림을 설정한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Conclusion**: 사용자의 명시적 승인 뒤 운영 프로젝트 `green-e4fe3`를 기존 활성 Cloud Billing 계정에 연결했다. `billingEnabled=true`, 결제 계정 `open=true`, Firebase 콘솔의 `Blaze / 사용한 만큼만 지불`을 확인했다. 운영 프로젝트만 범위로 한정한 월 10,000원 예산과 실제 비용 10·50·90·100% 알림을 만들었다. 예산은 비용을 자동 차단하지 않으며 알림이 지연될 수 있음을 함께 확인했다. 결제수단과 다른 프로젝트·결제 계정은 변경하지 않았다.
- **Status**: done

#### Task 0.4 — 기존 이미지 객체 재검증 [Unit: Atomic]

- **Task-ID**: 0.4
- **Dependency**: Task 0.3
- **Pre-read**: 운영 배너와 공개 상품 API 응답 구조
- **Target**: `apps/consumer/scripts/verify-public-images.mjs`
- **Goal**: 전체 주소를 노출하지 않고 배너와 공개 상품 이미지의 호스트·상태·콘텐츠 형식을 검사하는 읽기 전용 검증기를 만든다.
- **Verify**: `node apps/consumer/scripts/verify-public-images.mjs`
- **Conclusion**: 주소와 토큰을 출력하지 않는 `apps/consumer/scripts/verify-public-images.mjs`를 추가했다. 운영 배너와 활성 상품 5개는 모두 `firebasestorage.googleapis.com`, HTTP 200, `image/png`으로 복구됐고 누락·실패는 0건이었다. 기존 상품·배너·스토어 DB 주소와 객체는 변경하지 않았다.
- **Status**: done

### Phase 1 — consumer 이미지 실패 대체 처리

#### Task 1.1 — 실패 대체 계약 테스트 추가 [Unit: Atomic]

- **Task-ID**: 1.1
- **Dependency**: Task 0.2
- **Pre-read**: 관련 consumer 이미지 컴포넌트와 기존 정적 계약 테스트
- **Target**: `apps/consumer/src/components/ResilientImage.test.mjs`
- **Goal**: 배너 숨김과 상품 대체 이미지와 스토어 첫 글자 아바타 전환을 실패 계약으로 고정한다.
- **Verify**: `node --check apps/consumer/src/components/ResilientImage.test.mjs`
- **Conclusion**: 배너 숨김, 상품 로컬 대체 이미지, 자유 비율 상세 이미지 숨김, 스토어 첫 글자 아바타를 정적 계약으로 추가했다. 테스트 파일 문법 검사는 종료 코드 0, 구현 전 실행은 공통 컴포넌트 부재로 0통과·1실패, 종료 코드 1을 확인했다.
- **Status**: done

#### Task 1.2 — 공통 원격 이미지 실패 경계 구현 [Unit: Atomic]

- **Task-ID**: 1.2
- **Dependency**: Task 1.1
- **Pre-read**: 설치된 Next.js 16 Image 문서, `apps/consumer/src/components/ProductCard.tsx`
- **Target**: `apps/consumer/src/components/ResilientImage.tsx`
- **Goal**: 원격 `next/image` 실패를 한 번만 감지해 화면별 대체 UI로 전환하는 Client Component를 구현한다.
- **Verify**: `node --test apps/consumer/src/components/ResilientImage.test.mjs`
- **Conclusion**: 좁은 `'use client'` 경계의 `ResilientImage`를 구현했다. 원본 실패는 로컬 대체 이미지 또는 화면별 대체 UI로 한 번만 전환하고, 대체 이미지 실패는 최종 숨김으로 종료해 무한 재시도를 막았다. 계약 테스트는 5/5 통과했다.
- **Status**: done

#### Task 1.3 — 배너 이미지 실패 처리 [Unit: Atomic]

- **Task-ID**: 1.3
- **Dependency**: Task 1.2
- **Pre-read**: `apps/consumer/src/components/HeroBanner.tsx`
- **Target**: `apps/consumer/src/components/HeroBanner.tsx`
- **Goal**: 배너 사진 로드 실패 시 문구와 동작은 유지하고 깨진 사진 구획만 숨긴다.
- **Verify**: `node --test apps/consumer/src/components/ResilientImage.test.mjs`
- **Conclusion**: 배너 원본 실패 시 사진 요소만 제거하고 기존 문구와 두 CTA를 유지하도록 공통 실패 경계를 적용했다. 계약과 데스크톱·모바일 강제 실패 검증을 통과했다.
- **Status**: done

#### Task 1.4 — 일반 상품 카드 실패 처리 [Unit: Atomic]

- **Task-ID**: 1.4
- **Dependency**: Task 1.2
- **Pre-read**: `apps/consumer/src/components/ProductCard.tsx`
- **Target**: `apps/consumer/src/components/ProductCard.tsx`
- **Goal**: 일반 상품 대표 사진 실패 시 로컬 대체 이미지를 표시한다.
- **Verify**: `node --test apps/consumer/src/components/ResilientImage.test.mjs`
- **Conclusion**: 일반 상품 카드의 원격 대표 사진 실패 시 기존 로컬 아이콘을 대체 이미지로 표시하도록 적용했고 계약·화면 검증을 통과했다.
- **Status**: done

#### Task 1.5 — 홈 공동구매 카드 실패 처리 [Unit: Atomic]

- **Task-ID**: 1.5
- **Dependency**: Task 1.2
- **Pre-read**: `apps/consumer/src/components/HomeProductList.tsx`
- **Target**: `apps/consumer/src/components/HomeProductList.tsx`
- **Goal**: 홈 공동구매 대표 사진 실패 시 로컬 대체 이미지를 표시한다.
- **Verify**: `node --test apps/consumer/src/components/ResilientImage.test.mjs`
- **Conclusion**: 홈 공동구매 카드에 공통 실패 경계와 로컬 대체 이미지를 적용하고 `fill` 이미지의 부모 위치와 `sizes`를 명시했다. 계약·화면 검증을 통과했다.
- **Status**: done

#### Task 1.6 — 마감 임박 카드 실패 처리 [Unit: Atomic]

- **Task-ID**: 1.6
- **Dependency**: Task 1.2
- **Pre-read**: `apps/consumer/src/components/DeadlineSection.tsx`
- **Target**: `apps/consumer/src/components/DeadlineSection.tsx`
- **Goal**: 마감 임박 카드 사진 실패 시 로컬 대체 이미지를 표시한다.
- **Verify**: `node --test apps/consumer/src/components/ResilientImage.test.mjs`
- **Conclusion**: 마감 임박 카드의 원격 사진 실패 시 로컬 대체 이미지를 표시하도록 적용했고 계약·화면 검증을 통과했다.
- **Status**: done

#### Task 1.7 — 상품 상세 사진 실패 처리 [Unit: Atomic]

- **Task-ID**: 1.7
- **Dependency**: Task 1.2
- **Pre-read**: `apps/consumer/src/app/products/[id]/_components/ProductImages.tsx`, `apps/consumer/src/app/products/[id]/_components/ProductInfo.tsx`
- **Target**: `apps/consumer/src/app/products/[id]/_components/ProductImages.tsx`
- **Goal**: 상품 상세 대표 사진 실패 시 대체 이미지를 표시한다.
- **Verify**: `node --test apps/consumer/src/components/ResilientImage.test.mjs`
- **Conclusion**: 상품 상세 대표·썸네일 사진에 공통 실패 경계와 로컬 대체 이미지를 적용했다. 정상 원본과 강제 실패 대체를 데스크톱·모바일에서 확인했다.
- **Status**: done

#### Task 1.8 — 상품 설명 이미지 실패 처리 [Unit: Atomic]

- **Task-ID**: 1.8
- **Dependency**: Task 1.7
- **Pre-read**: `apps/consumer/src/app/products/[id]/_components/ProductInfo.tsx`, `apps/consumer/src/app/products/[id]/_components/ProductActions.tsx`
- **Target**: `apps/consumer/src/app/products/[id]/_components/ProductInfo.tsx`
- **Goal**: 실패한 자유 비율 상세 이미지를 안전하게 숨긴다.
- **Verify**: `node --test apps/consumer/src/components/ResilientImage.test.mjs`
- **Conclusion**: 크기를 미리 알 수 없는 자유 비율 상세 이미지는 전용 Client Component에서 실패한 요소만 숨기도록 처리했다. 강제 실패 시 깨진 아이콘과 빈 높이 없이 해당 이미지만 제거됨을 확인했다.
- **Status**: done

#### Task 1.9 — 스토어 로고 실패 처리 [Unit: Atomic]

- **Task-ID**: 1.9
- **Dependency**: Task 1.2
- **Pre-read**: `apps/consumer/src/app/products/[id]/_components/ProductActions.tsx`
- **Target**: `apps/consumer/src/app/products/[id]/_components/ProductActions.tsx`
- **Goal**: 스토어 로고 미등록과 로드 실패를 동일한 첫 글자 아바타로 표시한다.
- **Verify**: `node --test apps/consumer/src/components/ResilientImage.test.mjs`
- **Conclusion**: 스토어 로고 미등록과 로드 실패가 모두 상호 첫 글자 44×44 아바타로 수렴하도록 적용했다. 공통 스토어 로고 정상 크기 48×48과 강제 실패 시 `디` 아바타를 확인했다.
- **Status**: done

### Phase 2 — 정적 검사와 배포 후보 검증

#### Task 2.1 — consumer 이미지 계약 회귀 검증 [Unit: Atomic]

- **Task-ID**: 2.1
- **Dependency**: Task 1.3~1.9
- **Pre-read**: 변경된 consumer 이미지 컴포넌트와 관련 기존 계약 테스트
- **Target**: `apps/consumer/src/components/ResilientImage.test.mjs`
- **Goal**: 이미지 실패 대체와 기존 상품 상태·홈 증빙 계약의 회귀가 없는지 확인한다.
- **Verify**: `node --test apps/consumer/src/components/ResilientImage.test.mjs apps/consumer/src/components/ProductAvailability.test.mjs apps/consumer/src/components/BusinessRelationshipNotice.test.mjs apps/consumer/src/app/page.test.mjs`
- **Conclusion**: 이미지 실패 계약과 기존 상품 상태·운영 관계·홈 계약을 함께 실행해 17/17 통과, 실패 0건을 확인했다. consumer TypeScript 검사도 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 2.2 — consumer lint 검증 [Unit: Atomic]

- **Task-ID**: 2.2
- **Dependency**: Task 2.1
- **Pre-read**: 변경된 consumer 파일, `apps/consumer/package.json`
- **Target**: `apps/consumer/src/components/ResilientImage.tsx`
- **Goal**: 이미지 실패 대체 변경이 consumer lint 오류와 새 경고를 만들지 않는지 확인한다.
- **Verify**: `pnpm --filter consumer lint`
- **Conclusion**: consumer lint는 종료 코드 0, 오류 0건, 경고 23건으로 통과했다. 기준 25건보다 2건 줄었고 새 경고는 없다.
- **Status**: done

#### Task 2.3 — consumer production build 검증 [Unit: Atomic]

- **Task-ID**: 2.3
- **Dependency**: Task 2.2
- **Pre-read**: `apps/consumer/AGENTS.md`, 설치된 Next.js 16 Image 문서, 변경된 consumer 파일
- **Target**: `apps/consumer/src/components/ResilientImage.tsx`
- **Goal**: consumer production build에서 Server·Client Component 경계와 이미지 설정을 검증한다.
- **Verify**: `pnpm --filter consumer build`
- **Conclusion**: Next.js 16.2.5 production build는 compile·TypeScript·정적 페이지 13/13 생성을 포함해 종료 코드 0으로 통과했다. `git diff --check`도 종료 코드 0이었다.
- **Status**: done

#### Task 2.4 — 배포 후보 실제 화면 검증 [Unit: Atomic]

- **Task-ID**: 2.4
- **Dependency**: Task 0.4, Task 2.3
- **Pre-read**: 배포 후보 URL, 운영 이미지 검증기 결과
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 데스크톱과 375×812 모바일에서 정상 원본과 강제 실패 대체 화면을 모두 확인한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Visual Verify**: 홈 배너·상품 카드·상품 상세·스토어 로고의 실제 크기, 가로 넘침, 콘솔 오류를 확인하고 실패 응답을 가로챈 화면에서 대체 표시를 확인한다.
- **Conclusion**: Vercel 미리보기 `dpl_EbiC6jebymZswZCcvVcCADNgZMuc`에서 데스크톱과 375×812 모바일을 검증했다. 홈 배너·상품 5개와 상세 5개의 대표·상세·스토어 로고 실제 크기는 모두 양수이고 가로 넘침과 앱 오류가 없었다. 강제 실패 시 배너 사진만 숨고 문구·버튼은 유지됐으며 상품 5개는 로컬 대체 이미지, 상세 자유 비율 이미지는 숨김, 스토어 로고는 `디` 아바타로 전환됐다. 대체 이미지 자체 실패도 최종 숨김으로 종료됐고 깨진 이미지 0건이었다. 검증용 임시 별칭은 제거했다.
- **Status**: done

### Phase 3 — 원격 반영과 운영 검증

#### Task 3.1 — 변경 checkpoint와 PR 생성 [Unit: Atomic]

- **Task-ID**: 3.1
- **Dependency**: Task 2.4
- **Pre-read**: 전체 diff, 전체 검증 결과, Git 작성자 메타데이터
- **Target**: `docs/plans/PLAN_consumer_image_recovery.md`
- **Goal**: 예상 consumer·테스트·문서 변경만 한국어 checkpoint로 커밋하고 main 대상 PR을 만든다.
- **Verify**: `gh pr view --json headRefOid,baseRefName,state,mergeStateStatus,statusCheckRollup`
- **Conclusion**: [판정 대기 — commit·push·PR과 검사 상태를 기록.]
- **Status**: todo

#### Task 3.2 — consumer production 배포 [Unit: Atomic]

- **Task-ID**: 3.2
- **Dependency**: Task 3.1, PR 검사 통과
- **Pre-read**: PR diff, Vercel 배포 대상 경로, 기존 운영 배포 상태
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 검증된 변경을 main에 병합해 consumer production에 배포한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Conclusion**: [판정 대기 — merge SHA, consumer 배포 식별자·상태, 비대상 서비스 배포 여부를 기록.]
- **Status**: todo

#### Task 3.3 — 운영 이미지와 로그 재검증 [Unit: Atomic]

- **Task-ID**: 3.3
- **Dependency**: Task 3.2
- **Pre-read**: 운영 도메인, 운영 API, 배포 식별자
- **Target**: `apps/consumer/scripts/verify-public-images.mjs`
- **Goal**: 운영 원본과 Next 이미지 프록시와 실제 브라우저에서 이미지 복구와 대체 동작을 재확인한다.
- **Verify**: `node apps/consumer/scripts/verify-public-images.mjs`
- **Visual Verify**: 운영 홈과 공개 상품 5개 상세를 데스크톱·375×812 모바일로 확인하고 개인정보 영역은 캡처·기록하지 않는다.
- **Conclusion**: [판정 대기 — 원본·프록시·브라우저 상태, 콘솔과 Vercel 오류 로그 결과를 기록.]
- **Status**: todo

#### Task 3.4 — 문서와 다음 인계 프롬프트 마감 [Unit: Atomic]

- **Task-ID**: 3.4
- **Dependency**: Task 3.3
- **Pre-read**: 본 PLAN, REPORT, 최종 Git·배포·운영 검증 상태
- **Target**: `docs/plans/PROMPT_consumer_image_recovery.md`
- **Goal**: 최종 branch·HEAD·diff·검증·PR·배포·외부 변경·남은 위험을 다음 인계 프롬프트에 기록한다.
- **Verify**: `git diff --check -- docs/plans/PROMPT_consumer_image_recovery.md`
- **Conclusion**: [판정 대기 — 최종 인계 정보와 미완료 게이트를 기록.]
- **Status**: todo

## Closeout

- **Status**: todo
- **완료 조건**: 실제 운영 사진 복구, 강제 실패 대체, consumer 검증, PR·production 배포, 운영 재검증이 모두 통과해야 한다.
- **차단 조건**: Blaze 전환이 승인되지 않고 대체 저장소도 합의되지 않으면 실제 사진 복구는 완료로 선언하지 않는다.
- **별도 계획 조건**: 기존 객체가 유실됐거나 Blaze 전환을 선택하지 않으면 승인된 원본 자산과 저장소 제공자를 정한 새 마이그레이션 Blueprint를 만든다.
