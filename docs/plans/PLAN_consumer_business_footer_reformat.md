<!-- Language: ko -->

# 🗺️ Project Blueprint: consumer 사업자 푸터 재구성

## 문서 메타

- **SSOT Check**: `apps/consumer/src/lib/publicBusinessInfo.ts`
- **Priority**: 1
- **Labels**: consumer, compliance, kakao-review
- **Architectural Goal**: consumer 홈 푸터를 검증된 사업자 정본 기반의 반응형 정보 블록으로 재구성한다.
- **작성일**: 2026-08-18
- **상태**: 구현·배포·운영 검증 완료

## 📋 업무 요약 (협업용)

### 개요

그린러브 홈페이지 하단의 사업자 정보를 일반 쇼핑몰 푸터 형식으로 정돈한다. 운영 관계 문장은 홈페이지 상단에만 유지하고 푸터에서는 제거한다. 푸터에는 사업자등록증명으로 확인된 상호·대표자·주소·사업자등록번호, 실제 공개 고객센터와 이메일, 실제 호스팅서비스 제공자, 사용자가 확정한 상담시간을 한 구획에서 바로 대조할 수 있게 표시한다.

### 확정 표시 문안

- 제목: `그린러브 사업자 정보`
- 상호: `디어 오키드`
- 대표자: `조정연`
- 주소: `경기도 이천시 백사면 도지리 543-2`
- 사업자등록번호: `505-28-01702`
- 호스팅서비스 제공자: `Vercel Inc.`
- 이메일: `support@greenlove.co.kr`
- 고객센터: `010-4452-2104`
- 상담가능시간: `09:00~18:00 (점심시간 12:00~13:00)`

### 끝났을 때 확인할 것

- 데스크톱에서는 사업자 정보가 짧은 행으로 정돈되어 읽힌다.
- 375×812 모바일에서는 항목이 자연스럽게 줄바꿈되고 가로 넘침이 없다.
- 전화번호와 이메일은 각각 전화·메일 링크로 동작한다.
- `그린러브는 디어 오키드가 운영하는 화훼 쇼핑몰입니다.` 문장은 상단 안내에만 남는다.
- 푸터에서 등록증명에 없는 정보나 미확정 통신판매업 신고번호를 만들지 않는다.

### 이번에 안 하는 것

- 카카오 채널 고객센터 번호 변경
- 카카오 채널 소식 게시
- 카카오 비즈니스 채널 재신청
- 통신판매업 신고 또는 신고번호 추정
- 홈페이지의 별도 404 상품 링크 교정
- 사업자등록증명 이미지나 주민등록번호·발급번호 저장

## 🎯 Origin Intent

- **출처**: 사용자가 제공한 쇼핑몰 푸터 예시와 사업자등록증명
- **원래 목적**: 카카오 심사자가 그린러브의 판매 콘텐츠와 운영 사업자 정보를 홈페이지 한 화면에서 쉽게 대조하게 한다.
- **완료 관찰**: 홈 최하단에서 검증된 사업자 필드가 일반 쇼핑몰 형식으로 보이고 운영 관계 문장은 상단에만 남는다.

## ⚠️ Edge Case Trace

| 엣지 케이스 | 출처 | Task-ID / 범위 밖 | 비고 |
| :--- | :--- | :--- | :--- |
| 사업자등록증명에 불필요한 개인 식별정보가 포함됨 | 첨부 증빙 | 범위 밖 | 공개 필드 외 정보는 코드·문서·PR에 기록하지 않음 |
| 기존 정본 문서는 주소를 미확인으로 기록하지만 코드에는 주소가 존재함 | 저장소 점검 | 1.1 | 최신 증명으로 주소가 확인됐음을 문서에 반영 |
| `디어오키드`와 `디어 오키드` 표기 혼용 가능성 | 사용자 초안 | 1.1~1.4 | 증명과 기존 정본에 맞춰 `디어 오키드` 사용 |
| 푸터에서 운영 관계 문장을 없애면 홈페이지 전체에서 사라질 수 있음 | 사용자 결정 | 1.2, 2.1 | 상단 `BusinessRelationshipNotice` 계약은 유지 |
| 실제 호스팅 제공자를 운영 사업자로 잘못 표시할 수 있음 | 법정 표시 검토 | 1.1, 1.3 | 배포 인프라에 맞춰 `Vercel Inc.` 사용 |
| 상담 요일은 확정되지 않음 | 사용자 답변 | 1.3 | 요일을 추정하지 않고 시간과 점심시간만 표시 |
| 모바일에서 긴 주소·이메일이 가로로 넘칠 수 있음 | 반응형 UI | 1.4, 2.4 | 의미 단위 줄바꿈과 긴 문자열 줄바꿈 검증 |
| 통신판매업 신고번호가 없음 | 기존 공개 정본 | 범위 밖 | 새 번호를 추정하지 않고 별도 확인 전까지 미노출 |
| 대표 상품 홍보 링크 한 건이 404를 반환함 | 운영 점검 | 범위 밖 | 푸터 변경과 분리한 후속 작업으로 관리 |

## 🔍 Diagnosis & Findings

- 현재 공개 정보 정본에는 주소가 존재하지만 `BusinessInfoFooter`는 주소를 렌더링하지 않는다.
- 현재 푸터는 상호·대표자·사업자등록번호·고객센터·이메일을 2열 설명 목록으로 보여 주며, 상단과 같은 운영 관계 문장을 반복한다.
- 사용자가 제공한 사업자등록증명으로 상호·대표자·사업자등록번호·공식 사업장 주소가 현재 코드 값과 일치함을 확인했다.
- `support@greenlove.co.kr`과 `010-4452-2104`는 기존 공개 정본에서 검증된 연락 수단이다.
- 운영 인프라는 Vercel이므로 호스팅서비스 제공자는 운영 사업자 `디어 오키드`가 아니라 `Vercel Inc.`로 표시해야 한다.
- 상담 가능 시간은 `09:00~18:00`, 점심시간은 `12:00~13:00`으로 사용자 확인을 받았다.

## 🏗️ Architectural Deepening

- **정본 경계**: 푸터와 상단 안내가 계속 `PUBLIC_BUSINESS_INFO` 하나를 참조한다.
- **문장 경계**: `relationship` 값은 상단 안내 전용으로 유지하고 푸터는 이 필드를 참조하지 않는다.
- **레이아웃 경계**: 데스크톱에서는 의미 단위별 가로 배치, 좁은 화면에서는 자동 줄바꿈을 적용한다.
- **접근성 경계**: 시각 구분자는 의미 없는 문자 읽기를 만들지 않도록 장식 요소로 처리하고 전화·메일 링크의 터치 영역을 유지한다.
- **공개 경계**: 첨부 증명 원본과 불필요한 식별정보는 저장소에 넣지 않는다.
- **외부 변경 경계**: consumer 코드와 공개 증빙 문서만 변경하며 카카오·Firebase·운영 DB는 건드리지 않는다.

## Agent Completion Contract

각 Task는 지정한 파일 하나만 변경한다. Verify가 종료 코드 0을 반환한 뒤 Conclusion을 실측 결과로 갱신한다. 전체 실행 요청을 받으면 Task 순서를 고정하고 검증 실패나 예상 밖 diff가 있으면 다음 Task로 넘어가지 않는다.

> **에이전트 스코프**: 사용자가 PLAN 전체 실행을 요청하면 Task를 의존성 순서대로 하나씩 진행한다. Blueprint 구조는 동결하고 Verify 종료 코드 0과 Conclusion 갱신을 확인한 뒤 다음 Task로 이동한다. 카카오 재신청과 채널 정보 변경은 이 계획의 권한에 포함하지 않는다.

## Execution Plan

### Phase 1 — 공개 정본과 실패 계약

#### Task 1.1 — 사업자 공개 정본 문서 갱신 [Unit: Atomic]

- **Task-ID**: 1.1
- **Pre-read**: `docs/specs/ops/kakao-business-channel-proof.md`
- **Target**: `docs/specs/ops/kakao-business-channel-proof.md`
- **Goal**: 공개 사업자 정본에 공식 주소·호스팅서비스 제공자·상담시간·푸터 노출 경계를 기록한다.
- **Verify**: `git diff --check -- docs/specs/ops/kakao-business-channel-proof.md`
- **Conclusion**: 공식 주소·호스팅서비스 제공자·상담가능시간과 푸터 노출 경계를 공개 정본에 반영했고, 대상 문서의 `git diff --check`가 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 1.2 — 푸터 실패 계약 갱신 [Unit: Atomic]

- **Task-ID**: 1.2
- **Pre-read**: `apps/consumer/src/components/BusinessInfoFooter.test.mjs`, `apps/consumer/src/components/BusinessInfoFooter.tsx`
- **Target**: `apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **Goal**: 푸터의 새 공개 항목과 운영 관계 문장 비노출을 실패 계약으로 고정한다.
- **Verify**: `node --check apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **Conclusion**: 공개 필드 9개, 푸터의 운영 관계 문장 비노출, 주소·호스팅 제공자·상담시간 렌더링 계약을 추가했다. `node --check`는 종료 코드 0으로 통과했고, 구현 전 계약 테스트는 예상대로 4건 중 3건이 RED였다.
- **Status**: done

#### Task 1.3 — 공개 사업자 데이터 확장 [Unit: Atomic]

- **Task-ID**: 1.3
- **Pre-read**: `apps/consumer/src/lib/publicBusinessInfo.ts`
- **Target**: `apps/consumer/src/lib/publicBusinessInfo.ts`
- **Goal**: 단일 정본에 호스팅서비스 제공자와 상담시간 값을 추가한다.
- **Verify**: `node --test apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **Conclusion**: 단일 정본에 `Vercel Inc.`와 `09:00~18:00 (점심시간 12:00~13:00)`을 추가했고, 푸터 구현 후 계약 테스트 4/4가 종료 코드 0으로 통과했다.
- **Status**: done

### Phase 2 — 푸터 구현과 자동 검증

#### Task 2.1 — 반응형 사업자 푸터 구현 [Unit: Atomic]

- **Task-ID**: 2.1
- **Pre-read**: `apps/consumer/src/components/BusinessInfoFooter.tsx`, `apps/consumer/src/lib/publicBusinessInfo.ts`
- **Target**: `apps/consumer/src/components/BusinessInfoFooter.tsx`
- **Goal**: 푸터를 데스크톱 가로형·모바일 줄바꿈형 사업자 정보 블록으로 재구성한다.
- **Verify**: `node --test apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **Conclusion**: 푸터의 운영 관계 문장 반복을 제거하고 공개 필드 8개를 flex-wrap 정의 목록으로 재구성했다. 전화·이메일 링크와 긴 값의 안전한 줄바꿈을 유지했으며 계약 테스트 4/4가 통과했다.
- **Status**: done

#### Task 2.2 — 상단 안내와 홈 배치 회귀 검증 [Unit: Atomic]

- **Task-ID**: 2.2
- **Pre-read**: `apps/consumer/src/components/BusinessRelationshipNotice.test.mjs`, `apps/consumer/src/app/page.test.mjs`
- **Target**: `apps/consumer/src/components/BusinessInfoFooter.test.mjs`
- **Goal**: 푸터·상단 안내·홈 배치 계약의 회귀 부재를 자동 검증한다.
- **Verify**: `node --test apps/consumer/src/components/BusinessInfoFooter.test.mjs apps/consumer/src/components/BusinessRelationshipNotice.test.mjs apps/consumer/src/app/page.test.mjs`
- **Conclusion**: 푸터·상단 안내·홈 배치 계약 14/14가 통과했다. 운영 관계 문장은 상단에만 남고, 푸터는 Server Component 경계와 좁은 화면 줄바꿈 계약을 충족한다.
- **Status**: done

#### Task 2.3 — consumer 정적 품질 검증 [Unit: Atomic]

- **Task-ID**: 2.3
- **Pre-read**: `apps/consumer/package.json`
- **Target**: `apps/consumer/src/components/BusinessInfoFooter.tsx`
- **Goal**: 변경된 consumer 푸터가 프로젝트 정적 품질 규칙을 만족하는지 확인한다.
- **Verify**: `pnpm --filter consumer lint`
- **Conclusion**: footer landmark 제목 연결을 유효한 `contentinfo` 역할로 보정했다. `pnpm --filter consumer lint`는 오류 0건, 기존 경고 23건으로 종료 코드 0을 반환했고 변경 파일 단독 lint도 통과했다.
- **Status**: done

#### Task 2.4 — consumer production build 검증 [Unit: Atomic]

- **Task-ID**: 2.4
- **Pre-read**: `apps/consumer/package.json`
- **Target**: `apps/consumer/src/components/BusinessInfoFooter.tsx`
- **Goal**: 변경된 푸터가 consumer production build에서 정상 컴파일되는지 확인한다.
- **Verify**: `pnpm --filter consumer build`
- **Conclusion**: Next.js 16.2.5 production build가 compile·TypeScript·정적 페이지 13/13 생성까지 종료 코드 0으로 통과했다.
- **Status**: done

### Phase 3 — 화면 검증과 배포 후보 확정

#### Task 3.1 — 데스크톱·모바일 화면 검증 [Unit: Atomic]

- **Task-ID**: 3.1
- **Pre-read**: `apps/consumer/src/app/page.tsx`, `apps/consumer/src/components/BusinessInfoFooter.tsx`
- **Target**: `apps/consumer/src/app/page.tsx`
- **Goal**: 홈 최하단 사업자 푸터의 줄바꿈·링크·가로 넘침·하단 내비게이션 회피를 실제 브라우저에서 확인한다.
- **Verify**: `pnpm --filter consumer build`
- **Conclusion**: 로컬 배포 후보를 데스크톱과 375×812에서 확인했다. 공개 필드 8개가 모두 보이고 운영 관계 문장은 상단에만 1회 남았으며, 모바일 가로 넘침이 없고 전화·이메일 링크 높이는 각각 44px였다. 검증 프로세스에만 더미 인증값과 공개 운영 API 주소를 주입한 재검증에서는 콘솔 오류·경고가 0건이었다.
- **Status**: done

#### Task 3.2 — 변경 범위와 공백 오류 검증 [Unit: Atomic]

- **Task-ID**: 3.2
- **Pre-read**: `docs/plans/PLAN_consumer_business_footer_reformat.md`
- **Target**: `docs/plans/PLAN_consumer_business_footer_reformat.md`
- **Goal**: 최종 diff가 consumer 푸터·계약·공개 증빙 문서 범위만 포함하는지 확인한다.
- **Verify**: `git diff --check`
- **Conclusion**: 최종 점검에서 변경 범위는 consumer 푸터·계약·공개 정본과 카카오 공개 증빙·계획·보고서 문서뿐이었고 staging은 비어 있었다. 보고서 갱신 뒤 재실행한 `git diff --check`도 종료 코드 0으로 통과했다.
- **Status**: done

#### Task 3.3 — 검증 결과 보고서 기록 [Unit: Atomic]

- **Task-ID**: 3.3
- **Pre-read**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Target**: `docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Goal**: 푸터 변경·자동 검증·화면 검증·배포 결과를 카카오 재심사 보고서에 기록한다.
- **Verify**: `git diff --check -- docs/plans/REPORT_kakao_business_channel_reapproval.md`
- **Conclusion**: 공개 정본·구현·자동 검증·배포 후보 화면 검증, checkpoint·PR·병합·production 배포와 운영 재검증 결과를 보고서에 기록했고 대상 문서와 전체 `git diff --check`가 통과했다.
- **Status**: done

## Release Gate

- 사용자에게 PLAN 전체 실행 요청을 받은 뒤에만 구현을 시작한다.
- 관련 계약 테스트, consumer lint, production build, `git diff --check`가 모두 통과해야 checkpoint를 만든다.
- checkpoint는 한국어 메시지와 저장소 이력의 공개 `noreply` 메타데이터를 사용한다.
- push·PR·main 병합·consumer production 배포는 전체 diff와 화면 검증이 통과한 뒤 진행한다.
- production에서는 데스크톱과 375×812 모바일에서 푸터 전체가 보이는지 다시 확인한다.
- seller·driver·Railway API의 예상 밖 배포 여부는 상태만 확인하고 임의 변경이나 rollback을 하지 않는다.
- 카카오 재심사는 이 계획과 분리하며, 사용자의 별도 명시적 요청을 받은 경우에만 진행한다.

### Release Gate 결과

- checkpoint `8898102bd451870255e22cbf263e683f33a83668`을 원격 작업 branch에 push했다.
- PR #22의 검사가 모두 통과했고 merge commit `0a73f9360e287e3ae95c5cc7af59f18af0c4c35c`로 main에 병합했다.
- consumer production `dpl_Bnn4DCf77F1rLE9sVRwojrXHF3bR`가 `Ready`이고 운영 도메인 별칭과 HTTP 200 응답을 확인했다.
- 운영 데스크톱·375×812에서 푸터 전체, 상단 관계 문장 1회, 가로 넘침 없음, 깨진 이미지 0건, 콘솔 오류·경고 0건을 확인했다.
- seller·driver는 Ignored Build Step으로 취소됐고 Railway API는 watched path 변경 없음으로 건너뛰어 기존 production을 유지했다.

## Conclusion

- 계획의 구현 Task 10개를 모두 완료했고 계약 테스트 14/14, lint 오류 0건, production build, 데스크톱·375×812 화면 검증과 전체 `git diff --check`를 통과했다.
- 공식 주소·호스팅서비스 제공자·고객센터·상담시간을 footer에 공개하고 운영 관계 문장은 상단에만 유지했다.
- 운영 DB·Firebase·카카오 채널·이메일·DNS·ALIGO·공개 소식은 변경하지 않았다.
- checkpoint·push·PR #22·main 병합·consumer production 배포와 운영 재검증까지 완료했다.
- 통신판매업 신고번호와 404 홍보 링크는 이번 푸터 작업에서 분리된 잔여 위험이다.
