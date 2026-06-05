# 육안 검증 재개 핸드오프 — 2026-06-01

> 목적: 다음 대화에서 미완료 체크리스트만 이어서 진행한다.
>
> 원칙: 보류 항목은 이번 검증 범위에서 제외하고 `향후 작업`으로 남긴다.

## 1. 첫 진입

1. `Chrome` 스킬을 사용한다.
2. 확장 브라우저 목록에서 `metadata.profileName === '정연'`인 Chrome을 선택한다.
3. `https://seller.greenlove.co.kr` 도메인의 열린 탭을 이어받는다.
4. 아래 `즉시 재개 순서`부터 읽기 전용으로 진행한다.
5. 운영 데이터 상태를 바꾸는 버튼은 사용자 승인 없이 확인하지 않는다.

현재 확인된 환경:

- Chrome `정연` 프로필에 겸직 계정(`seller` + `admin`) 로그인 세션이 있다.
- Chrome 확장 세션은 `375px` 뷰포트 강제 기능이 없다.
- 앱 내 브라우저는 `375x812` 제어가 가능하지만 seller·admin 로그인 세션은 없다.
- 공개 소비자 홈 모바일 배너 검증은 완료됐다.

2026-06-01 재개 결과:

- `A. 미완료 항목 정합성 감사`를 완료했다. 원본 체크리스트의 데스크톱 완료·향후 이관·후속 계약 대체 상태를 갱신했다.
- 운영 `1920px`에서 관리자 판매자·소비자·주문·정산 테이블 유지와 모바일 카드 미노출을 다시 확인했다. 초대는 토큰 0건 빈 상태다.
- 관리자 정산 confirmed 3건의 단건 `지급처리` 버튼과 `YYYY-MM-DD HH:mm` KST 일시를 읽기 전용으로 확인했다.
- 관리자 배너 기본 수정 Drawer에서 hydrate 유지, PDF 형식 차단, 2MB 초과 JPG 용량 차단을 확인하고 ESC로 폐기했다. Storage 쓰기와 배너 저장은 실행하지 않았다.
- API 배너 단위 테스트 `6/6`을 다시 통과했다. `#240` 공개 `/banner` 호환은 후속 제거 계약으로 `[-]`, `#241~#244`, `#261~#262`는 `[x]`로 정리했다.
- 정산 E2E 재실행은 환경 제약으로 종결하지 못했다. `apps/e2e/.env` 기본 `SELLER_BASE`는 과거 UI 프리뷰라 상태 탭을 찾지 못했고, 운영 `https://seller.greenlove.co.kr` 명시 재실행은 `session cookie not in context after signIn`으로 globalSetup 단계에서 차단됐다.
- 정산 조회 실패 Alert는 `admin-settlements.spec.ts`에 상태별 500 실패 fixture를 추가했다. 직전 목록 유지와 빨간 Alert·오류 안내 노출을 자동 검증하고 원본 `#92`를 `[x]`로 정리했다. 최신 seller 고정 프리뷰 `greenhub-seller-kql0toqxe-jos-projects-d1cecc0c.vercel.app`에서 chromium·mobile 정산 spec 12/12를 통과했다.
- 2026-06-01 후속 재개에서 Chrome `정연` 프로필의 운영 `/orders`, `/admin/invite`, `/admin/banner`를 읽기 전용으로 다시 확인했다. 판매자 주문 `#121~#122`는 이미 데이터 부재 사유와 함께 `[-]` 이관됐고, 초대 토큰은 여전히 `0건`, 배너는 기본 배너 `1건`만 존재했다. 추가로 닫을 수 있는 데스크톱 항목은 없으며 기간 배너·초대 행 검증은 테스트 데이터 또는 승인 조건이 생길 때까지 향후 작업으로 유지한다.
- 2026-06-01 추가 재개에서 Chrome `정연` 프로필의 운영 `/admin/stores`를 읽기 전용으로 확인했다. 뷰포트는 `1920x947`이고 `VF-008` 깨진 상호는 그대로다. 인증 모바일 제어 수단과 추가 테스트 데이터가 없어 새로 종결할 항목은 없었다. 운영 쓰기 없이 종료했으며 API 스토어 단위 테스트 4/4, seller 타입체크·빌드, 최신 고정 프리뷰의 주문·정산·소비자 E2E chromium·mobile 48/48을 통과했다.
- 2026-06-01 핸드오프 재확인에서 Chrome `정연` 프로필의 운영 `/admin/stores`, `/admin/invite`, `/admin/banner`를 읽기 전용으로 다시 대조했다. 스토어는 `1920px` 테이블과 `VF-008` 깨진 상호를 유지하고, 초대 토큰은 `0건`, 배너는 기본 배너 `1건`이다. 새로 종결할 항목은 없으며 운영 쓰기 없이 API 배너 단위 테스트 6/6, API 스토어 단위 테스트 4/4, seller 타입체크·빌드, 최신 고정 프리뷰의 주문·정산·소비자 홈 E2E chromium·mobile 44/44를 통과했다.
- 2026-06-01 추가 핸드오프 재개에서 Chrome `정연` 프로필의 운영 `/admin/stores`, `/admin/invite`, `/admin/banner`를 다시 읽기 전용으로 대조했다. 스토어는 `1920x863` 테이블과 `VF-008` 깨진 상호를 유지하고, 초대 토큰은 여전히 `0건`, 배너는 기본 배너 `1건`이다. 새로 종결할 데스크톱 항목은 없으며 운영 쓰기 없이 API 배너 단위 테스트 6/6, API 스토어 단위 테스트 4/4, seller 타입체크를 통과했다.
- 2026-06-01 이번 재개에서 Chrome `정연` 프로필 연결과 로그인 운영 탭을 확인했으나 확장 브라우저에는 뷰포트 강제 기능이 없고 실제 폭은 `1920px`였다. 대신 최신 seller 고정 프리뷰의 fixture 인증 `mobile` 회귀를 보강해 settlements·orders·stores·invite·users 카드 전환, 핵심 버튼 접근, 테이블 숨김, `375px` 가로 넘침 0을 검증했다. 관련 5개 spec `mobile` 회귀는 39/39 통과했고 원본 `#25~#26`, `#30`, `#34`, `#40`을 종결했다. 실제 카드 밀도·터치 감각·`768px` 전환 경계 육안은 잔여다.
- 2026-06-01 후속 재개에서 Chrome `정연` 프로필의 로그인 운영 탭을 다시 확인했다. 현재 조건에서 가능한 최상위 잔여로 fixture 인증 반응형 경계 회귀와 카드 필수 정보 단언을 추가해 settlements·orders·stores·invite·users 5개 화면의 `767px` 카드 유지, 가로 넘침 0, `768px` 테이블 전환, 모바일 필수 정보와 액션 접근을 검증했다. 최신 seller 고정 프리뷰에서 관련 chromium·mobile 전체 88/88을 통과했다. 원본 `#24`, `#27`, `#29`, `#31~#32`, `#35`, `#41`, `#67`, `#73`, `#80`, `#88`, `#91`, `#101`, `#108`, `#116`, `#178`, `#190`, `#192`, `#199`, `#206`을 종결했다. 실제 모바일 카드 밀도·터치 감각 육안은 인증 가능한 모바일 브라우저 확보 전까지 잔여다.
- 2026-06-01 이번 재개에서 Chrome 확장 연결은 확인했으나 선택 프로필이 `Jo`이고 Green Hub 운영 탭이 없어 운영 읽기 전용 대조는 진행하지 않았다. 현재 조건에서 가능한 최상위 잔여로 판매자 정산 fixture 인증 모바일 회귀를 추가해 `375px` 주문별 상세 5탭 가로 스크롤, 스크롤바 비노출, 마지막 `취소` 탭 접근, 문서 가로 넘침 0을 검증했다. 최신 seller 고정 프리뷰에서 `seller-settlements.spec.ts` chromium·mobile 18/18을 통과했고 원본 `#5~#7`을 종결했다. 다음 실행 가능한 묶음은 판매자 주문 모바일 알림·일괄 액션의 fixture 가능 범위를 분리하는 작업이다.
- 2026-06-01 후속 재개에서 판매자 주문 모바일 알림·일괄 액션의 fixture 가능 범위를 분리했다. `getOrderAlertMeta()` 빈 메타 단위 회귀와 `seller-orders.spec.ts`의 `375px` 우선 알림·일괄 준비 확인 모달·일괄 택배 송장 모달 회귀를 추가했다. 단위 테스트는 7/7 통과했다. E2E 런타임 종결은 보류한다. 최신 고정 프리뷰는 Railway API의 `-git-` CORS 규칙 밖이라 Firebase가 `연결 중`에 머물고, 허용된 `greenhub-seller-git-preview-jos-projects-d1cecc0c.vercel.app`은 실시간 연결되지만 알림·액션 바가 없는 과거 번들이다. 로컬 최신 seller와 API도 Firebase token sync가 완료되지 않아 `연결 중`에 머물렀다. 원본 `#159`, `#160`, `#167`, `#174`는 자동화 추가 상태로 유지하며, 최신 인증 git preview 확보 또는 로컬 Firebase sync 해소 후 재실행한다.
- 2026-06-01 이번 재개에서 판매자 주문 모바일 E2E 환경 제약이 유지됨을 확인하고, 다음 실행 가능한 관리자 드라이버 fixture 인증 묶음을 진행했다. `admin-drivers-status-filter.spec.ts`에 `375px` 4탭 동일 행, 카드 필수 정보·상태별 액션, 승인 확인창·성공 알림 가로 넘침 0과 정지·해제 성공 알림, 500 실패 알림·모달 유지 회귀를 추가했다. 최신 seller 고정 프리뷰에서 chromium·mobile `20/20`을 통과했고 원본 `pending-visual-verify.md` `#218`, `#221`, `#226`, `pending-visual-verify-20260529.md` `#233~#239`를 종결했다. 다음 실행 가능한 묶음은 fixture로 분리 가능한 드라이버 실제 액션 후 목록 이동·처리 중 라벨 또는 배너 실패 주입 모바일 회귀다.
- 2026-06-01 후속 재개에서 관리자 드라이버 fixture 인증 묶음을 끝까지 종결했다. 승인 후 승인 완료 탭 이동, 정지 후 정지됨 탭 이동, 정지 해제 후 승인 완료 탭 복귀, 지연 응답 중 카드 액션 `처리중…` 비활성화, 상태별 버튼 노출·스타일, 승인·정지·정지 해제 확인창의 제목·본문·확인 라벨·계산 배경색을 검증했다. 최신 seller 고정 프리뷰에서 `admin-drivers-status-filter.spec.ts` chromium·mobile `24/24`를 통과했고 원본 `pending-visual-verify.md` `#215~#216`, `#227~#230`을 종결했다. 다음 실행 가능한 묶음은 배너 저장 실패·Storage 업로드 실패 주입과 모바일 입력 배치 fixture 회귀다.

## 2. 문서 역할

| 문서 | 역할 |
|------|------|
| `pending-visual-verify.md` | 기본 체크리스트 SSOT |
| `pending-visual-verify-20260529.md` | 추가 체크리스트 SSOT |
| `manual-visual-verify-checklist.md` | 순차 진행판과 완료 이력 |
| `visual-verify-fix-backlog.md` | 실패·보완 작업 누적 |
| `visual-verify-handoff-20260531.md` | 2026-05-31~06-01 상세 실행 이력 |

## 3. 즉시 재개 순서

### A. 미완료 항목 정합성 감사 — 완료

체크리스트에는 구현·테스트 또는 운영 확인을 이미 마쳤지만 `[ ]`로 남은 항목이 섞여 있다. 먼저 원본 메모와 기존 검증 결과를 대조해 `[x]`, `[-]`, `[ ]`를 정리한다.

| 원본 | 우선 대조 범위 | 확인 포인트 |
|------|----------------|-------------|
| `pending-visual-verify.md` | `#22`, `#38~#39`, `#89`, `#91~#92`, `#121~#122`, `#231~#235`, `#237` | 데스크톱·읽기 전용 완료 범위와 실제 잔여 분리 |
| `pending-visual-verify-20260529.md` | `#240~#244`, `#261~#262`, `#268` | API 테스트·배포·마이그레이션 결과를 원문에 반영 |
| `manual-visual-verify-checklist.md` | 부분 완료 묶음 | 이미 닫힌 세부 번호를 묶음 메모에서 제거 |

### B. Chrome 데스크톱 읽기 전용 잔여

데이터 조건이 맞는 항목만 확인한다. 조건이 없으면 억지로 운영 데이터를 만들지 않고 `향후 작업`으로 이관한다.

| 화면 | 원본 번호 | 진행 내용 |
|------|-----------|-----------|
| 판매자 주문 상세 | `pending-visual-verify.md` `#121~#122` | 현재 존재하는 상태 주문만 대조하고, 없는 상태는 데이터 부재로 이관 |
| 관리자 정산 | `pending-visual-verify.md` `#89`, `#91~#92` | 단건 지급 버튼 읽기 전용 회귀, KST 정산일시, 조회 실패 배너의 자동 검증 근거 대조 |
| 관리자 배너 | `pending-visual-verify.md` `#231~#235`, `#237` | 저장 없는 입력 검증, hydrate 유지, 업로드 가드 확인 가능 범위 진행 |
| 관리자 초대 | `pending-visual-verify-20260529.md` `#189~#210` | 운영 토큰이 생긴 경우에만 복사·검색·취소 확인창 읽기 전용 범위 진행 |

### C. 자동 검증으로 닫을 항목

운영 쓰기 없이 실행 가능한 테스트를 먼저 확인하고 원본 메모에 근거를 남긴다.

| 묶음 | 원본 번호 | 기존 근거 |
|------|-----------|-----------|
| 배너 API 계약 | `pending-visual-verify-20260529.md` `#240~#243` | API 배너 테스트 6/6 |
| 배너 배포 계약 | `pending-visual-verify-20260529.md` `#261~#262`, `#268` | API·seller·consumer 운영 배포 및 공개 경로 확인 |
| 관리자 주문 회귀 | `pending-visual-verify.md` `#117`, `#132` | `VF-010` 종결, 최신 preview `admin-orders.spec.ts` 22/22 |
| 관리자 정산 조회 실패 | `pending-visual-verify.md` `#92` | `admin-settlements.spec.ts` 상태별 500 fixture와 Alert·직전 목록 유지 검증, 최신 고정 프리뷰 12/12 |

## 4. 향후 작업으로 이관

아래 항목은 이번 순차 검증에서 더 진행하지 않는다. 계정, 테스트 데이터, 뷰포트 또는 별도 운영 승인 조건이 갖춰진 뒤 별도 작업으로 재개한다.

### 모바일 인증 묶음

- seller·admin 로그인 상태의 `375px` 뷰포트 제어 수단 확보 후 일괄 진행한다.
- 대상:
  - `pending-visual-verify.md` `#22`, `#28`, `#33`, `#36~#37`, `#60`, `#62`, `#64`, `#135`, `#141`, `#236`
  - `pending-visual-verify-20260529.md` `#148`, `#151~#152`, `#160`, `#167`, `#174`, `#179`, `#188`, `#254`

### 운영 쓰기 또는 테스트 데이터 필요

- 주문 발송·준비·환불·취소:
  - `pending-visual-verify.md` `#119~#120`, `#123~#126`
  - `pending-visual-verify-20260529.md` `#146~#147`, `#173`
- 프로필·스토어:
  - `pending-visual-verify.md` `#43`, `#53~#58`, `#66`
- 소비자 상태:
  - `pending-visual-verify.md` `#74`, `#79`
- 정산 지급:
  - `pending-visual-verify.md` `#85~#87`, `#90`
- 드라이버 상태 전환:
  - `pending-visual-verify.md` `#215~#216`, `#227~#230`
- 초대 토큰:
  - `pending-visual-verify-20260529.md` `#193~#200`, `#207~#210`
- 기간 배너:
  - `pending-visual-verify-20260529.md` `#244`, `#252~#253`, `#256~#259`, `#263~#264`

### 데이터 부족

- 관리자 주문 `더 보기` `#185`: 운영 주문이 25건 미만이다.
- 관리자 초대 `#189~#210`: 운영 초대 토큰이 0건이다.
- 드라이버 승인 완료·정지 카드 액션: 운영 드라이버 19건이 모두 승인 대기다.
- 소비자 전화 검색과 복구 확인창: 운영 소비자 전화가 모두 비어 있고 정지 사용자가 없다.
- 일반 seller·순수 admin·consumer·driver 역할 대조: 별도 로그인 세션이 없다.

### 운영 데이터 정리

- `VF-008`: 스토어 `9b2cb652-ff77-46b9-a773-e1efa78fb763`의 깨진 `name`.
- `VF-011`: 소비자 `69dcfab6-4dca-43c0-952d-908001257168`의 깨진 `name`.
- 정상 이름 확인과 별도 운영 수정 승인 전에는 변경하지 않는다.

## 5. 다음 대화 완료 조건

1. `A. 미완료 항목 정합성 감사`를 먼저 완료한다.
2. Chrome 데스크톱 읽기 전용 잔여 중 현재 데이터로 확인 가능한 항목을 진행한다.
3. 확인 불가능한 항목은 원본 메모에 사유를 남기고 `향후 작업`으로 이관한다.
4. `docs/memory.md`를 최신화한다.
5. 수정 문서의 라인 제한과 `git diff --check`를 확인한다.

## 6. 금지 사항

- 운영 지급, 환불, 취소, 정지, 복구, 삭제, 배너 저장을 승인 없이 실행하지 않는다.
- 모바일 인증 환경을 만들기 위해 운영 계정 설정을 변경하지 않는다.
- `VF-008`, `VF-011` 원본 데이터를 승인 없이 수정하지 않는다.
- 기존 작업 트리의 unrelated 변경을 되돌리지 않는다.

## 7. 반복 핸드오프 프로토콜

앞으로 각 대화는 가능한 범위의 검증을 진행한 뒤 아래 순서로 종결한다.

1. 실제 확인한 세부 항목을 원본 SSOT인 `pending-visual-verify.md` 또는 `pending-visual-verify-20260529.md`에 즉시 반영한다.
   - 통과는 `[x]`
   - 계정·데이터·뷰포트·후속 계약 제약으로 현재 범위에서 확인할 수 없으면 `[-]`와 사유
   - 결함 또는 아직 확인하지 않은 항목은 `[ ]` 유지와 재현 메모
2. 결함이 새로 발견되면 `visual-verify-fix-backlog.md`에 작업 번호, 재현 조건, 수정 계약, 완료 기준을 기록한다.
3. 묶음 진행 상태와 완료 이력은 `manual-visual-verify-checklist.md`에 반영한다. 원본 세부 판정과 충돌하면 원본 SSOT를 우선하고 진행판을 정정한다.
4. 설계 결정이 발생하면 `docs/CRITICAL_LOGIC.md`에 이유와 함께 기록한다.
5. 세션 종료 직전에 `docs/memory.md`를 최신화한다.
6. 다음 대화는 이 문서의 `향후 작업으로 이관` 목록에서 현재 조건으로 실행 가능한 최상위 묶음부터 재개한다.
7. 응답 전 수정 파일 줄 수, `docs/memory.md` 200줄 제한, `docs/CRITICAL_LOGIC.md` 1000줄 제한, `git diff --check`를 확인한다.

핸드오프 응답에는 최소한 아래 내용을 포함한다.

- 이번 대화에서 종결한 원본 항목 번호
- 계속 남긴 원본 항목 번호와 사유
- 새로 발견하거나 종결한 `VF-*` 작업
- 실행한 테스트와 결과
- 다음 대화의 첫 진입 화면 또는 실행 묶음

## 8. 2026-06-02 후속 재개 결과

- 현재 조건에서 가능한 최상위 잔여였던 관리자 배너 저장 실패·Storage 업로드 실패·모바일 입력 배치 fixture 묶음을 종결했다.
- `seller-banner.spec.ts`에 `/admin/banners` 저장 `500` 실패, Firebase Storage 업로드 `403` 실패, `375px` CTA 입력 1열·가로 넘침 0 회귀를 추가했다.
- 모바일 회귀에서 seller Mantine `Drawer.css` 선택 import 누락과 배너 Drawer `size="xl"` 고정 폭을 발견했다. `globals.css`에 `Drawer.css`를 추가하고 `BannerEditDrawer.tsx` 폭을 `min(780px, 100vw)`로 제한했다.
- seller 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`가 `READY`이며, 해당 프리뷰에서 `seller-banner.spec.ts` chromium·mobile `10/10`을 통과했다.
- 원본 `pending-visual-verify.md` `#233~#234`, `#236`과 `pending-visual-verify-20260529.md` `#254`를 `[x]`로 종결했다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 다중 배너 수정 저장·삭제 흐름 `#252~#253`이다. 운영 쓰기 없이 목록 갱신과 성공 알림을 검증한다.

## 9. 2026-06-02 기간 배너 수정·삭제 후속 재개 결과

- 현재 조건에서 가능한 최상위 잔여였던 다중 배너 수정 저장·삭제 흐름 `#252~#253`을 종결했다.
- `seller-banner.spec.ts`에 기간 배너 목록을 가진 성공형 가변 fixture를 추가했다. `PUT`·`DELETE` 요청을 fixture 상태에 반영하고 후속 `GET` 재조회에서 갱신된 목록을 반환한다.
- 기간 배너 수정 저장 후 Drawer 닫힘·성공 알림·목록 헤드라인 갱신, 삭제 확인 후 성공 알림·목록 제거·기본 배너 유지·기본 배너 삭제 버튼 미노출을 검증했다.
- seller 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `seller-banner.spec.ts` chromium·mobile `12/12`를 통과했다.
- 원본 `pending-visual-verify-20260529.md` `#252~#253`을 `[x]`로 종결했다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 소비자 다중 배너 캐러셀 `#256~#259`, `#263~#264`다. 기간 배너+기본 배너 순서, 자동 전환, 사용자 조작·hover/focus 정지, KST 기간 경계를 운영 쓰기 없이 검증한다.

## 10. 2026-06-02 소비자 다중 배너 캐러셀 후속 재개 결과

- 현재 조건에서 가능한 최상위 잔여였던 소비자 다중 배너 캐러셀 `#256~#259`, `#263~#264`를 종결했다.
- `ENABLE_E2E_FIXTURES=true`일 때만 열리는 consumer `e2e/hero-banner` 하네스를 추가했다. 기본 환경에서는 `notFound()`로 차단하며, consumer 기본 빌드의 해당 경로가 `404`임을 확인했다.
- 실제 `HeroBannerCarousel`에 기간 배너 2장과 기본 배너 1장을 넣고 기간 배너 최신순·기본 배너 마지막 순서, 점 3개, 약 5초 자동 전환, 좌우 버튼·점 조작 후 정지, hover·focus 정지를 검증했다.
- API `BannerQueryService` 단위 테스트는 KST 오늘 종료 배너 포함, 어제 종료 배너 제외, 활성 기간 배너 `createdAt desc` 정렬을 함께 검증한다.
- 로컬 consumer 하네스 직접 확인에서 콘솔 오류 0건과 포인터 이탈 후 자동 전환을 확인했다. `consumer-banner-carousel.spec.ts` chromium `4/4`, API 배너 테스트 `6/6`, consumer 타입체크·빌드, 변경 파일 Biome을 통과했다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 관리자 초대 복사·검색·취소 `#189~#210` 감사다. 기존 `admin-invite-revoke.spec.ts` 자동화 범위를 먼저 대조하고 부족한 계약만 보강한다.

## 11. 2026-06-02 관리자 초대 복사·검색·취소 후속 재개 결과

- 현재 조건에서 가능한 최상위 잔여였던 관리자 초대 복사·검색·취소 `#189~#210`의 기존 자동화 범위를 감사하고 부족한 계약을 보강했다.
- `admin-invite-revoke.spec.ts` fixture에 토큰 발급, clipboard 성공·권한 거부·대체 경로 실패, 조회 query 이력을 추가했다. 데스크톱 행별 복사와 `복사됨` tooltip, 발급일·사용일, 발급 직후 복사 상태 분리, 취소 후 새로고침 유지, `already_used`·`already_revoked`·`expired` 알림, 3자 이하 무조회 보호, 검색 초기화, 검색 결과의 복사·취소 공존과 가로 넘침 0을 검증한다.
- 기본 `apps/e2e/.env`의 `SELLER_BASE`는 과거 UI 프리뷰를 가리켜 최초 실행이 실패했다. 핸드오프의 최신 seller 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`를 명시한 재실행에서 `admin-invite-revoke.spec.ts` chromium·mobile `20/20`을 통과했다.
- API `auth.service.spec.ts`·`admin.service.spec.ts`는 `46/46`을 통과했다. 취소 토큰 가입 차단의 사전 검증·트랜잭션 재검증과 관리자 취소 reason 가드를 함께 재확인했다.
- 원본 `pending-visual-verify-20260529.md` `#189`, `#191`, `#193~#198`, `#200`, `#202~#204`, `#207`, `#210`을 `[x]`로 종결했다. 실제 orange 배지 색감 `#208`과 reason 알림이 주요 조작 영역을 가리는지 확인하는 `#209`는 인증 가능한 육안 환경이 필요해 `[ ]`로 유지한다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 어드민 주문 정렬·커서 페이지네이션 잔여 `#185`, `#188` 감사다. 기존 `admin-orders.spec.ts`에서 `25건 초과` 더 보기와 `375px` 필터 배치를 먼저 대조하고 부족한 계약만 보강한다.

## 12. 2026-06-02 관리자 주문 커서 페이지네이션·모바일 필터 후속 재개 결과

- 현재 조건에서 가능한 최상위 잔여였던 어드민 주문 `#185`, `#188`을 종결했다.
- `admin-orders.spec.ts` fixture에 선택적 페이지네이션 모드를 추가했다. 30건 중 `25개` 첫 조회 후 `cursor=25`로 다음 5건을 이어 붙이고 마지막에는 `더 보기`가 사라지는 계약을 검증한다.
- `375px`에서 스토어·상태·정렬·페이지 크기 Select와 `더 보기` 버튼 노출, 문서 가로 넘침 0을 함께 검증했다.
- 500줄 제한을 지키기 위해 응답 필터·정렬·커서 잘라내기와 30건 fixture 생성은 `_helpers/admin-orders-pagination.ts`로 분리했다. `admin-orders.spec.ts`는 500줄, 보조 모듈은 45줄이다.
- 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-orders.spec.ts` chromium·mobile `28/28`을 통과했다.
- 원본 `pending-visual-verify-20260529.md` `#185`, `#188`을 `[x]`로 종결했다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 관리자 소비자 전화 검색·복구 확인창·모바일 잔여다. 기존 `admin-users.spec.ts` 자동화 범위를 먼저 대조하고 부족한 계약만 보강한다.

## 13. 2026-06-02 관리자 소비자 전화 검색·복구 확인창 후속 재개 결과

- 현재 조건에서 가능한 최상위 잔여였던 관리자 소비자 전화 검색·복구 확인창·모바일 잔여를 종결했다.
- `admin-users.spec.ts`에 저장값 `01099998888`과 입력값 `010-9999-8888`의 하이픈 형태가 다른 전화 검색 회귀를 추가했다. 모바일 복구 확인창 취소 후 가로 넘침 0도 다시 확인한다.
- 검색과 `정지` 필터를 적용한 상태에서 복구 확인창을 열고 `해제`를 실행해 fixture 요청 본문이 `{ suspended: false }`인지 검증했다. 운영 DB 쓰기는 없다.
- 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-users.spec.ts` chromium·mobile `18/18`을 통과했다.
- 원본 `pending-visual-verify.md` `#33`, `#69`, `#74`를 `[x]`로 종결했다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 관리자 주문 상세 모달 모바일 배치 `pending-visual-verify-20260529.md` `#179` 감사다. 기존 `admin-orders.spec.ts` 상세 모달 자동화 범위를 먼저 대조하고 부족한 계약만 보강한다.

## 14. 2026-06-02 관리자 주문 상세 모달 모바일 배치 후속 재개 결과

- 현재 조건에서 가능한 다음 잔여였던 관리자 주문 상세 모달 모바일 배치 `#179`를 종결했다.
- 공용 반응형 도우미 `_helpers/responsive.ts`에 요소 단위 가로 넘침 검증을 추가했다. `admin-orders.spec.ts`의 기존 모바일 카드 시나리오에서 상세 모달을 열어 배송지 표시, 모달 자체와 문서 전체 가로 넘침 0을 검증한다.
- `admin-orders.spec.ts`는 빈 줄을 정리해 정확히 500라인을 유지했다.
- 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-orders.spec.ts` chromium·mobile `28/28`을 통과했다.
- 원본 `pending-visual-verify-20260529.md` `#179`를 `[x]`로 종결하고 `#181` 자동 E2E 기록을 최신화했다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 관리자 주문 환불 모달 모바일 배치 `pending-visual-verify.md` `#141` 감사다. 기존 위험 단계 환불 모달 시나리오에 제목·경고·Textarea·버튼 영역 가로 넘침 계약을 보강한다.

## 15. 2026-06-02 관리자 주문 환불 모달 모바일 배치 후속 재개 결과

- 현재 조건에서 가능한 다음 잔여였던 관리자 주문 환불 모달 모바일 배치 `#141`을 종결했다.
- `admin-orders.spec.ts`에 `375px` 위험 단계 카드 전용 회귀를 추가했다. 환불 모달의 제목·경고·Textarea·취소·환불 처리 버튼 노출과 모달 자체·문서 전체 가로 넘침 0을 검증한다.
- 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-orders.spec.ts` chromium·mobile `30/30`을 통과했다.
- 원본 `pending-visual-verify.md` `#141`을 `[x]`로 종결했다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 관리자 주문 송장 표시 모바일·빈 값 잔여 `pending-visual-verify-20260529.md` `#151~#152` 감사다.

## 16. 2026-06-02 관리자 주문 송장 표시 모바일·빈 값 후속 재개 결과

- 현재 조건에서 가능한 다음 잔여였던 관리자 주문 송장 표시 모바일·빈 값 `#151~#152`를 종결했다.
- `admin-orders.spec.ts` 기본 송장 보유 주문에 40자 운송장번호를 주입하고 공용 반응형 도우미에 송장 카드 전용 검증을 추가했다. `375px` 카드에서 스토어 ID 아래 송장 행, 택배사·긴 운송장번호 수납, 송장 미보유 카드의 `-`, 송장 카드·문서 전체 가로 넘침 0을 확인한다.
- 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-orders.spec.ts` chromium·mobile `30/30`을 통과했다.
- 원본 `pending-visual-verify-20260529.md` `#151~#152`를 `[x]`로 종결했다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 관리자 주문 치운 스토어 토글 모바일·복원 `pending-visual-verify.md` `#131`, `#135` 감사다.

## 17. 2026-06-02 관리자 주문 치운 스토어 토글 모바일·복원 후속 재개 결과

- 현재 조건에서 가능한 다음 잔여였던 관리자 주문 치운 스토어 토글 모바일·복원 `#131`, `#135`를 종결했다.
- `admin-orders.spec.ts`의 기존 치운 스토어 옵션 노출 회귀를 `375px` 복원 회귀로 확장했다. archived 스토어 선택 후 토글 off 시 Select가 `전체 스토어`로 정리되고 전체 목록이 복원되며 마지막 재조회 URL에서 archived `storeId`가 제거되는지 검증한다.
- 같은 흐름에서 스토어 Select, 상태 Select, 치운 스토어 토글, 자동 새로고침 토글, 새로고침 아이콘 노출과 문서 가로 넘침 0을 확인한다.
- 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-orders.spec.ts` chromium·mobile `30/30`을 통과했다.
- 원본 `pending-visual-verify.md` `#131`, `#135`를 `[x]`로 종결했다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 관리자 주문 모바일 환불 가능 상태 카드 액션 `pending-visual-verify.md` `#28` 감사다.

## 18. 2026-06-02 관리자 주문 모바일 환불 가능 상태 카드 액션 감사 결과

- 원본 `#28`은 세션δ `#136~#137`에서 일반 단계와 위험 단계 환불 계약으로 확장·대체된 오래된 항목임을 확인했다.
- 기존 `admin-orders.spec.ts` fixture 회귀는 모바일 PREPARING·DELIVERING·REVIEWED 카드의 `강제환불` 버튼 3개 노출, 일반 단계 무사유 처리, 위험 단계 사유 필수 처리, 위험 단계 직접 호출 400 차단을 이미 검증한다.
- 500라인 제한을 넘은 `admin-orders.spec.ts`의 타이머 가속 도우미를 `_helpers/admin-orders-runtime.ts`로 분리했다.
- 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-orders.spec.ts` chromium·mobile `30/30`을 통과했다.
- 원본 `pending-visual-verify.md` `#28`을 `[-]`, `#119~#120`을 `[x]`로 정리했다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 관리자 반응형 빈 결과 카드 분기 `pending-visual-verify.md` `#36` 감사다.

## 19. 2026-06-02 관리자 반응형 빈 결과 카드 분기 감사 결과

- 현재 조건에서 실행 가능한 다음 요구인 관리자 반응형 빈 결과 카드 분기 `#36`을 종결했다.
- `admin-settlements.spec.ts`에 `375px` 스토어 ID 불일치 필터 시나리오를 추가했다. `정산 내역이 없습니다.` 문구, 필터 입력값·상태 탭 유지, 테이블 미노출, 문서 가로 넘침 0을 검증한다.
- 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-settlements.spec.ts` chromium·mobile `18/18`을 통과했다.
- 원본 `pending-visual-verify.md` `#36`을 `[x]`로 종결했다.
- 다음 실행 가능한 최상위 묶음은 fixture로 분리 가능한 관리자 반응형 로딩 표시 `pending-visual-verify.md` `#37` 감사다.

## 20. 2026-06-02 관리자 반응형 로딩 표시 감사 결과

- 관리자 반응형 로딩 표시 `#37`을 fixture 회귀로 종결했다.
- `admin-settlements.spec.ts` fixture에 선택적 상태별 지연 응답을 추가했다. `375px`에서 `정산 대기` 조회 지연 중 `불러오는 중...` 문구, 필터 입력·상태 탭 유지, 문서 가로 넘침 0과 응답 후 카드 복귀를 검증한다.
- 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-settlements.spec.ts` chromium·mobile `20/20`을 통과했다. 최초 실행은 기존 기간 버튼 케이스의 초기 진입이 한 번 15초를 넘겨 재시도 통과했고, 동일 명령 재실행은 `20/20` 깨끗하게 통과했다.
- 원본 `pending-visual-verify.md` `#37`을 `[x]`로 종결했다.
- 다음 진입점은 원본 체크리스트의 미완료 항목을 다시 감사해 현재 조건으로 실행 가능한 최상위 잔여 묶음을 고르는 것이다.

## 21. 2026-06-02 관리자 스토어 모바일 필터·수수료 편집 감사 결과

- 운영 쓰기 또는 별도 계정 조건이 필요한 앞선 항목은 보류하고, fixture로 분리 가능한 관리자 스토어 모바일 잔여 `#60`, `#62`, `#64`, `#66`을 종결했다.
- 기존 `admin-stores-filter-sort.spec.ts`는 모바일 Select 정렬 URL 전환, 직접 URL 검색어·상태 복원, 카드 내 수수료 입력·저장·취소와 가로 넘침 0을 이미 검증했다.
- 모바일 수수료 입력의 `inputmode="decimal"`과 카드·테이블 양쪽 증감 제어 DOM 노출, 정상 `0.05` 저장 요청 본문과 저장 후 `5.0%` 표시를 보강했다.
- 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-stores-filter-sort.spec.ts` chromium·mobile `22/22`를 통과했다. 실행 전 기존 `global-setup.ts` `storageState()` 탐색 경쟁이 두 번 재현됐으나 세 번째 실행은 전체 통과했다.
- 다음 실행 가능한 후보는 관리자 정산 일괄 지급 fixture 잔여 `pending-visual-verify.md` `#85~#87` 감사다.

## 22. 2026-06-02 관리자 정산 일괄 지급 fixture 감사 결과

- 기존 정산 fixture의 부분 실패 검증을 대조하고 전부 성공과 요청 중 중복 클릭 차단을 보강했다.
- `admin-settlements.spec.ts` fixture에 선택적 실패 ID와 bulk 응답 지연을 추가했다. 전부 성공 알림·재조회·confirmed 목록 0건 복귀, 부분 실패 성공 건 제거·실패 건 선택 유지·실패 사유, 지연 중 ConfirmModal 확인 버튼 비활성화·bulk 요청 1회를 검증한다.
- 원본 `pending-visual-verify.md` `#86`, `#87`, `#90`을 `[x]`로 종결했다.
- `#85`는 전부 성공 알림·재조회·`paid` 전환까지 자동 검증했지만 현재 정산 UI에 `paidAt` 표시 영역이 없어 별도 설계 잔여로 유지한다.
- 최신 seller 고정 프리뷰 `greenhub-seller-2omkcjr8s-jos-projects-d1cecc0c.vercel.app`에서 `admin-settlements.spec.ts` chromium·mobile `24/24`를 통과했다.
- 다음 진입점은 `#85`의 `paidAt` 표시 영역을 별도 SDD로 설계할지 결정하거나, fixture로 분리 가능한 판매자 주문 모바일 잔여 `pending-visual-verify-20260529.md` `#146~#148`을 감사하는 것이다.

## 23. 2026-06-03 잔여 체크리스트 재분류

> 기준: 원본 SSOT `pending-visual-verify.md`, `pending-visual-verify-20260529.md`의 `[ ]` 30개와 `[-]` 7개를 다시 감사했다.

### A. 즉시 fixture 감사 가능

- 판매자 주문 택배 발송 완료·소비자 노출·모바일 모달 배치: `#146~#148`
- 판매자 주문 알림 빈 상태·모바일 배치: `#159~#160`
- 판매자 주문 일괄 준비 모바일 배치: `#167`
- 판매자 주문 일괄 택배 발송 결과·모바일 배치: `#173~#174`
- 소비자 주문 취소 상태 표시 묶음: `#123~#126`

### B. 별도 SDD 또는 제품 결정 필요

- 관리자 정산 전부 성공 처리의 `paidAt` 표시 영역: `#85`

### C. 운영·계정 조건 또는 쓰기 승인 필요

- 겸직 셀러 프로필 저장: `#43`
- 일반 셀러 설정·온보딩 회귀: `#49~#50`
- 순수 관리자 온보딩 리다이렉트: `#51`
- 정지 사용자 refresh token 차단 수동 확인: `#79`

### D. 운영 쓰기 또는 육안 전용

- 관리자 스토어 치우기·복구·기록 보존: `#53~#58`
- 관리자 초대 취소 배지 색상·reason 알림 위치: `#208~#209`

### E. 대체·조건부 종료 유지

- 모바일 폭 터치 타깃: `#22`
- 관리자 주문 강제환불 구계약: `#28`, `#118`
- 순수 관리자 헤더 셀러 화면 이동: `#52`
- 셀러 주문 취소 운영 데이터 부족: `#121~#122`
- 공개 구 배너 계약 제거: `#240`

### 다음 진입점

- 현재 조건에서 최상위 실행 가능 묶음은 판매자 주문 택배 발송 `#146~#148` fixture 감사다.

## 24. 2026-06-03 판매자 주문 택배 발송 fixture 감사 진행 결과

- `scripts/seed-e2e-orders.mjs`에 송장 보유 `DELIVERED` 읽기 전용 주문과 모바일 모달 전용 `PREPARING` 주문을 추가했다. 기존 발송 쓰기 주문과 분리해 반복 실행 순서가 검증 결과를 바꾸지 않게 했다.
- `seller-parcel-ship.spec.ts`에 판매자 상세의 택배사·운송장번호·발송 버튼 미노출과 `375px` 모달 입력·버튼·가로 넘침 0 단언을 추가했다.
- `consumer-mypage.spec.ts`에 소비자 상세의 택배사·운송장번호 표시 단언을 추가했다.
- seller 전용 회귀가 consumer 운영 인증 실패에 함께 막히지 않도록 `global-setup.ts`에 `SKIP_CONSUMER_AUTH_SETUP=true` 선택 실행 게이트를 추가했다.
- 시드 재적재는 성공했고 변경 파일 Biome은 통과했다. 다만 최신 seller 고정 프리뷰에서는 새 seller 세션으로도 `/orders/:id`가 내비게이션 셸만 표시하고 상세 데이터가 비어 `seller-parcel-ship.spec.ts` chromium 4/4가 실패했다.
- seller 운영 도메인은 Credentials 로그인 단계에서 `set-cookie count=0`이 3회 반복되어 진입 전 차단됐다. consumer 운영 도메인도 통합 실행에서 같은 쿠키 미발급이 3회 반복됐다.
- 원본 `#146~#148`은 자동 검증 코드 준비만 완료됐고 실행 종결은 보류하므로 `[ ]`를 유지한다.

### 다음 진입점

- seller 최신 인증 프리뷰의 상세 조회가 복구되면 `SKIP_CONSUMER_AUTH_SETUP=true`로 `seller-parcel-ship.spec.ts`를 재실행한다.
- consumer Credentials 쿠키 발급이 복구되면 `consumer-mypage.spec.ts`를 재실행해 `#147`을 종결한다.
- 현재 환경에서 계속 진행할 다음 fixture 가능 묶음은 판매자 주문 알림 빈 상태·모바일 배치 `#159~#160`이다.

## 25. 2026-06-03 판매자 주문 알림 빈 상태·모바일 배치 fixture 감사 결과

- 현재 조건에서 계속 진행 가능한 최상위 묶음이었던 판매자 주문 우선 알림 `#159~#160`을 종결했다.
- `ENABLE_E2E_FIXTURES=true`일 때만 열리는 seller `/e2e/order-priority-alert` 하네스를 추가했다. 실제 `OrderPriorityAlert`, 공통 `SegmentedTabs`, `EmptyState`를 조합하고 seller `proxy.ts`와 `Providers`도 fixture 경로에서만 인증 경계를 우회한다.
- 전용 `seller-order-priority-alert.spec.ts`는 빈 메타에서 알림 미노출·탭 5개·기존 empty state 유지와 `375px` 알림 텍스트·두 버튼·문서 가로 넘침 0을 검증한다.
- 로컬 브라우저에서 하네스 렌더, 오류 오버레이 없음, 가로 넘침 0을 확인했다. 전용 Playwright chromium `2/2`, seller 우선 알림 단위 테스트 `7/7`, 변경 파일 Biome, seller 타입체크, seller 기본 빌드를 통과했다.
- 환경 변수 없는 기본 빌드의 `/e2e/order-priority-alert` 공개 접근은 `/login` `307`로 차단됨을 확인했다.
- 원본 `pending-visual-verify-20260529.md` `#159~#160`을 `[x]`로 종결했다.
- 다음 실행 가능한 최상위 묶음은 판매자 주문 일괄 준비 모바일 배치 `#167` 감사다.

## 26. 2026-06-03 판매자 주문 일괄 준비 모바일 배치 fixture 감사 결과

- 현재 조건에서 계속 진행 가능한 최상위 묶음이었던 판매자 주문 일괄 준비 모바일 배치 `#167`을 종결했다.
- `ENABLE_E2E_FIXTURES=true`일 때만 열리는 seller `/e2e/order-bulk-prepare` 하네스를 추가했다. 실제 `OrderBulkActionBar`, `OrderCard`, `ConfirmModal`을 조합해 제품 UI 계약을 그대로 검증한다.
- 전용 `seller-order-bulk-prepare.spec.ts`는 `375px`에서 준비 가능 액션 바, 카드 체크박스, 긴 상품명, 확인 모달 문구와 두 버튼, 요소와 문서 전체의 가로 넘침 0을 검증한다.
- 전용 Playwright chromium `1/1`, 변경 파일 Biome, seller 타입체크를 통과했다.
- 원본 `pending-visual-verify-20260529.md` `#167`을 `[x]`로 종결했다.
- 다음 실행 가능한 최상위 묶음은 판매자 주문 일괄 택배 발송 결과·모바일 배치 `#173~#174` 감사다.

## 27. 2026-06-03 판매자 주문 일괄 택배 발송 모바일 배치 fixture 감사 결과

- 판매자 주문 일괄 택배 발송 잔여 `#173~#174` 중 fixture로 분리 가능한 모바일 배치 `#174`를 종결했다.
- `ENABLE_E2E_FIXTURES=true`일 때만 열리는 seller `/e2e/order-bulk-parcel-ship` 하네스를 추가했다. 실제 `OrderBulkActionBar`, `OrderCard`, `BulkParcelShipModal`을 조합해 제품 UI 계약을 그대로 검증한다.
- 전용 `seller-order-bulk-parcel-ship.spec.ts`는 `375px`에서 택배 발송 액션 바, 카드 체크박스, 송장 모달의 택배사·운송장번호 입력, 취소·발송 완료 버튼, 모달과 문서 전체의 가로 넘침 0을 검증한다.
- 일괄 준비 `#167` 하네스와 함께 전용 Playwright chromium `2/2`, 변경 파일 Biome, seller 타입체크를 통과했다.
- 원본 `pending-visual-verify-20260529.md` `#174`를 `[x]`로 종결했다.
- `#173` 실제 일괄 발송 결과는 운영 쓰기 또는 페이지 통합용 데이터 계층이 필요하므로 `[ ]`로 유지한다.
- 다음 실행 가능한 최상위 묶음은 소비자 주문 취소 상태 표시 `pending-visual-verify.md` `#123~#126` 감사다.

## 28. 2026-06-03 소비자 주문 취소 상태 표시 fixture 감사 결과

- 현재 조건에서 계속 진행 가능한 최상위 묶음이었던 소비자 주문 취소 상태 표시 `#123~#126`을 종결했다.
- `ENABLE_E2E_FIXTURES=true`일 때만 열리는 consumer·seller `/e2e/order-cancel-status` 하네스를 추가했다. consumer 하네스는 실제 주문 상세 컴포넌트를 fixture 세션과 조합하고, seller 하네스는 실제 `OrderInfoSection`을 조합한다.
- 전용 `consumer-order-cancel-status.spec.ts`는 모집 중 공동구매 취소 확인창·PATCH 1회·취소 안내 전환, 확정 이후 취소 버튼 미노출·타임라인 유지, `payment_failed`·`timeout`·`목표 수량 미달성으로 취소` 사유 표시와 `375px` 가로 넘침 0을 검증한다. seller 상세의 최소 수량 미달 사유 표시도 함께 검증한다.
- 로컬 브라우저에서 seller 하네스를 확인하는 중 `OrderInfoSection`의 서버 `AM`·브라우저 `오전` 시각 포맷 차이로 hydration 오류가 발생함을 발견했다. 시각 표시에 `hour12: false`를 고정해 서버·클라이언트 출력을 맞췄다.
- 전용 Playwright chromium·mobile `12/12`, 변경 파일 Biome, consumer·seller 타입체크와 기본 빌드를 통과했다. seller 상세 회귀는 브라우저 `pageerror` 0건도 단언한다.
- 기본 환경 production 서버에서 consumer 하네스는 `404`, seller 하네스는 `/login` `307`로 차단됨을 확인했다.
- 원본 `pending-visual-verify.md` `#123~#126`을 `[x]`로 종결했다.

### 다음 진입점

- 즉시 fixture 감사 가능 묶음은 소진됐다.
- 다음 우선순위는 별도 SDD 결정이 필요한 관리자 정산 `paidAt` 표시 영역 `pending-visual-verify.md` `#85`다.
- 구현 없이 계속 검증하려면 운영·계정 조건이 필요한 `#43`, `#49~#51`, `#79` 또는 육안 전용 `#53~#58`, `#208~#209` 중 조건이 확보된 묶음을 고른다.

## 29. 2026-06-03 관리자 정산 입금 시각 표시 `#85` 종결

- 최상위 잔여 묶음이었던 관리자 정산 `paidAt` 표시 `#85`를 별도 SDD 후 종결했다.
- `admin-settlements-payment-timing-plan.md`와 `#CL-81`에서 표현 계약을 확정했다. `paid`는 `입금 완료 YYYY-MM-DD HH:mm`, `confirmed`는 `지급 대기 · 확정 YYYY-MM-DD HH:mm`, 과거 `confirmedAt` 누락 데이터는 `지급 대기`로 표시한다. 백엔드에 없는 입금 예정일은 추정하지 않는다.
- `paymentTimingText()`를 추가하고 데스크톱 표·모바일 카드가 같은 함수를 사용하도록 연결했다. ISO 문자열과 Firestore raw `{ _seconds }` 포맷은 기존 KST 변환 경로를 재사용한다.
- `admin-settlements.spec.ts` fixture에 `confirmedAt`을 추가하고, 모바일 카드의 확정·입금 완료 문구와 일괄 지급 전부 성공 후 paid 탭의 신규 `paidAt` 표시를 검증한다.
- 원격 `.env` 기준 git 프리뷰는 첫 화면 진입에서 멈춰 로컬 seller 서버에 `.env.vercel.local`, 임시 `AUTH_SECRET`, `NEXT_PUBLIC_API_URL`을 주입했다. `SELLER_BASE=http://localhost:3000`, `SKIP_CONSUMER_AUTH_SETUP=true`로 정산 E2E chromium·mobile `24/24`를 통과했다.
- 포맷 함수 단위 테스트 `4/4`, 변경 파일 Biome, seller 타입체크를 통과했다.
- 원본 `pending-visual-verify.md` `#85`를 `[x]`로 종결했다.

### 다음 진입점

- 즉시 fixture 감사 가능 묶음은 소진됐다.
- 현재 잔여는 운영·계정 조건 또는 쓰기 승인이 필요한 `#43`, `#49~#51`, `#53~#58`, `#79`, `#208~#209`, 통합 데이터 계층이 필요한 `#173`, 인증 환경 복구가 필요한 `#146~#148`이다.
- 조건 없이 계속 구현하려면 별도 SDD가 필요한 다음 백로그 묶음을 선택한다.

## 30. 2026-06-03 관리자 정산 스토어명 표시·Select화 종결

- 핸드오프의 즉시 fixture 감사 가능 묶음이 소진되어, 조건 없이 구현 가능한 최상위 백로그 `ADMIN-SETTLEMENTS-F4`를 진행했다.
- 별도 SDD `admin-settlements-store-name-plan.md`와 `#CL-82`에서 기존 `useAdminStores()` 재사용, 정산 API `storeId` 계약 유지, 누락 ID 축약 대체 표시를 확정했다.
- `/admin/settlements` 필터를 검색 가능한 스토어명 `Select`로 교체하고, 데스크톱 표·모바일 카드·체크박스 접근성 이름이 같은 `storeId -> name` 사전을 사용하도록 연결했다.
- `admin-settlements.spec.ts`에 `/admin/stores` fixture, 이름 선택 후 `storeId` 쿼리 전달, 스토어명 표시, 고아 ID 대체 표시 검증을 추가했다.
- 로컬 seller 인증 환경에서 정산 E2E chromium·mobile `24/24`, seller 타입체크, seller 빌드, 변경 파일 Biome을 통과했다.

### 다음 진입점

- 운영·계정 조건 없이 계속 구현 가능한 다음 최상위 백로그는 관리자 정산 `ADMIN-SETTLEMENTS-F3` 500건 하드캡 페이지네이션이다.
- 운영 인증 환경이 복구되면 보류 중인 `#146~#148` 판매자·소비자 택배 발송 상세 검증을 재실행한다.

## 31. 2026-06-03 관리자 정산 500건 하드캡 페이지네이션 종결

- 운영·계정 조건 없이 계속 구현 가능한 최상위 백로그 `ADMIN-SETTLEMENTS-F3`를 진행했다.
- 별도 SDD `admin-settlements-pagination-plan.md`와 `#CL-83`에서 `limit` 기본 100·최대 500, `cursor`, `nextCursor`, `더 보기` 계약을 확정했다.
- `GET /admin/settlements`는 `limit + 1`로 조회하고 `nextCursor`를 반환한다. 기존 운영 `settledAt desc` 인덱스를 재사용하기 위해 커서는 `settledAt` ISO 문자열로 유지한다.
- `/admin/settlements` 프론트 훅은 첫 페이지와 추가 페이지를 분리해 관리하고, 필터 변경·지급 처리 후에는 첫 페이지를 재조회한다. 화면 하단에는 다음 페이지가 있을 때만 `더 보기` 버튼을 표시한다.
- 페이지네이션 전용 `admin-settlements-pagination.spec.ts`를 추가해 100건 첫 조회 후 다음 1건 이어붙이기와 버튼 소멸, `limit`·`cursor` 쿼리 전송을 검증한다.
- API 단위 테스트, 변경 파일 Biome, API·seller 타입체크, API·seller 빌드는 통과했다. 로컬 E2E 실행은 seller 인증 환경의 `NEXT_PUBLIC_API_URL` 미설정(`undefined/auth/login`)과 Firebase 공개 env 불일치로 차단되어 완료하지 못했다.

### 다음 진입점

- 운영·계정 조건 없이 계속 구현하려면 다음 최상위 백로그를 다시 선별한다.
- 운영 인증 환경이 복구되면 보류 중인 `#146~#148` 판매자·소비자 택배 발송 상세 검증을 재실행한다.

## 32. 2026-06-03 관리자 판매자 상세 드릴다운 종결

- 운영·계정 조건 없이 계속 구현 가능한 다음 최상위 백로그 `ADMIN-STORES-T7`을 진행했다.
- 별도 SDD `admin-stores-detail-drilldown-plan.md`와 `#CL-84`에서 첫 범위를 읽기 전용 상세와 집계 API로 제한했다.
- `GET /admin/stores/:storeId/summary`는 스토어 문서, owner 기본 정보, 주문 상태별 건수·총 주문 금액, 정산 상태별 건수·플랫폼 수수료·실지급 합계를 반환한다.
- `/admin/stores/[id]`는 상세 지표 카드와 주문·정산 상태 버킷을 표시하며, `/admin/stores` 목록의 `상세` 버튼은 현재 필터 URL을 `back` 쿼리로 전달해 뒤로가기 복원을 보장한다.
- API 단위 테스트 `admin.service.spec.ts` 46/46, 변경 파일 Biome, API·seller 타입체크, API·seller 빌드를 통과했다.

### 다음 진입점

- 운영·계정 조건 없이 계속 구현 가능한 다음 최상위 백로그는 `ADMIN-STORES-T8` 플랫폼 기본 수수료율 설정이다.
- 운영 인증 환경이 복구되면 보류 중인 `#146~#148` 판매자·소비자 택배 발송 상세 검증을 재실행한다.

## 33. 2026-06-03 관리자 드라이버 상세 정보 보강 진행 결과

- 운영·계정 조건 없이 계속 구현 가능한 다음 백로그 `ADMIN-DRIVERS-F4`를 진행했다.
- 별도 SDD `admin-drivers-detail-info-plan.md`와 `#CL-86`에서 저장된 `users.phone`만 즉시 표시하고, 차량 정보는 현재 저장 필드가 있을 때만 표시하며 없으면 `차량 정보 미등록`으로 명시하기로 확정했다.
- `/admin/drivers` 응답과 seller `AdminDriver` 타입에 `phone`, 선택 차량 필드 `vehicleType`, `vehicleNumber`를 추가했다. 검색 대상도 이름·이메일·전화번호로 확장했다.
- 드라이버 카드에는 연락처, 차량 정보, 가입일이 함께 표시된다. 차량 정보 입력·보험 증명서는 별도 SDD로 남겼다.
- API 단위 테스트 `admin.service.spec.ts` 49/49, 변경 파일 Biome, API 타입체크, API 빌드, seller 빌드는 통과했다. seller 타입체크는 빌드 전 병렬 실행 때 `.next/types` 누락으로 한 번 실패했으나, seller 빌드 후 단독 재실행은 통과했다.
- 드라이버 E2E fixture 단언은 보강했지만 기본 config는 기존 `global-setup.ts` `storageState()` 네비게이션 레이스에서 차단됐고, fixture config는 인증 환경 주입 실행이 제한 시간 안에 끝나지 않아 종결하지 못했다.
- 원본 `pending-visual-verify-20260529.md` §33 `#269~#271`은 자동·육안 확인 대기로 `[ ]` 유지한다.

### 다음 진입점

- 조건 없이 계속 구현 가능한 다음 백로그는 `ADMIN-DRIVERS-F5` 정렬·페이지네이션이다.
- 검증 안정성을 먼저 높이려면 기존 P4 `global-setup storageState flake` 보강을 우선한다.
